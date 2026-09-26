import http from 'node:http';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderDashboard } from './dashboard.mjs';
import { renderProductCreator } from './product-creator.mjs';
import { renderTestOrderPage } from './test-order-page.mjs';
import { renderPricingPage } from './pricing-page.mjs';
import { renderShippingProfilePage } from './shipping-profile-page.mjs';
import { pricingCatalogForZone, pricingCatalogForMarket, publicShippingPricingConfig } from './pricing.mjs';
import { buildTestReceipt } from './test-order.mjs';
import { etsyReceiptToSensariaCsvFromR2 } from './fulfillment.mjs';
import {
  checkR2Connection,
  getArtworkObject,
  signedArtworkUploadUrl,
  artworkObjectExists,
  getJsonObject,
  putJsonObject
} from './r2.mjs';
import {
  reserveArtworkUpload,
  completeArtworkUpload,
  cancelArtworkUpload,
  loadArtworkManifest,
  saveArtworkManifest
} from './artwork-storage.mjs';
import { buildOwnSilviaInventory } from './variants.mjs';
import { podProviderStatus, testPodProvider } from './pod-providers.mjs';
import {
  chooseRecentMockupReference,
  getEtsyListingImages,
  sortCustomMockupsByReference,
  mapWithConcurrency
} from './mockup-sorter.mjs';
import {
  verifyAdminPassword,
  createAdminSessionCookie,
  clearAdminSessionCookie,
  isAdminAuthenticated,
  renderLogin
} from './auth.mjs';
import {
  generatePkce,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshEtsyToken,
  getUserIdFromAccessToken,
  getShopByOwnerUserId,
  getShopShippingProfiles,
  createShopShippingProfile,
  createShopShippingProfileDestination,
  deleteShopShippingProfile,
  getShopReadinessStateDefinitions,
  getShopListings,
  getShopSections,
  getShopReturnPolicies,
  getShopProductionPartners,
  updateListingProperty,
  getPropertiesByTaxonomyId,
  updateListingInventory,
  uploadListingImage,
  uploadListingVideo,
  updateListing,
  createDraftListing
} from './etsy.mjs';

const port = Number(process.env.PORT || 10000);
const oauthRequests = new Map();
const OAUTH_TTL_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const products = JSON.parse(readFileSync(new URL('../config/products.json', import.meta.url), 'utf8'));
const sizeMatrix = JSON.parse(readFileSync(new URL('../config/size-matrix.json', import.meta.url), 'utf8'));
const listingDefaults = JSON.parse(readFileSync(new URL('../config/listing-defaults.json', import.meta.url), 'utf8'));
const shippingProfileDefaults = JSON.parse(readFileSync(new URL('../config/etsy-shipping-profile.json', import.meta.url), 'utf8'));
const mappingCount = Object.keys(products).length;
const mappedSizeCount = Object.values(sizeMatrix).filter((item) => item.fineArtPrint || item.canvas || item.framedCanvas).length;
const unresolvedSizes = Object.entries(sizeMatrix)
  .filter(([, item]) => String(item.status || '').toLowerCase().includes('needs'))
  .map(([size, item]) => `${size} — ${item.status}`);

let etsySessionCache = null;
const taxonomyCache = new Map();
const mockupReferenceCache = new Map();

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  const body = String(html);
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function requireAdminPage(req, res, returnTo = '/') {
  if (isAdminAuthenticated(req)) return true;
  const safeReturnTo = String(returnTo || '/').startsWith('/') ? String(returnTo || '/') : '/';
  res.writeHead(302, {
    location: `/login?returnTo=${encodeURIComponent(safeReturnTo)}`,
    'cache-control': 'no-store'
  });
  res.end();
  return false;
}

function requireAdminApi(req, res) {
  if (isAdminAuthenticated(req)) return true;
  sendJson(res, 401, { ok: false, error: 'Admin login required.' });
  return false;
}

function callbackUrl() {
  return process.env.ETSY_CALLBACK_URL || 'https://silvia-sensaria-bridge.onrender.com/etsy/callback';
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readFormBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return new URLSearchParams(raw);
}

function cleanOauthRequests() {
  const now = Date.now();
  for (const [key, pending] of oauthRequests.entries()) {
    if (now - pending.createdAt > OAUTH_TTL_MS) oauthRequests.delete(key);
  }
}

const PRESET_MEDIA = [
  {
    role: 'choose-option',
    key: 'presets/listing-media/choose-option.jpeg',
    filename: 'Choose Option.jpeg',
    contentType: 'image/jpeg'
  },
  {
    role: 'choose-frame',
    key: 'presets/listing-media/choose-frame.png',
    filename: 'Choose Frame.png',
    contentType: 'image/png'
  },
  {
    role: 'promotion',
    key: 'presets/listing-media/promotion.jpg',
    filename: 'Promotion.jpg',
    contentType: 'image/jpeg'
  },
  {
    role: 'video',
    key: 'presets/listing-media/Video.mov',
    filename: 'Video.mov',
    contentType: 'video/quicktime'
  }
];

async function presetMediaStatus() {
  const items = await Promise.all(PRESET_MEDIA.map(async (item) => ({
    ...item,
    exists: await artworkObjectExists(item.key)
  })));
  return {
    configured: items.every((item) => item.exists),
    items
  };
}

function taxonomyProperties(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function normalizeEtsyPropertyText(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function propertyNames(property) {
  return [
    property?.name,
    property?.display_name,
    property?.displayName
  ].map(normalizeEtsyPropertyText).filter(Boolean);
}

function possibleValues(property) {
  return Array.isArray(property?.possible_values)
    ? property.possible_values
    : Array.isArray(property?.possibleValues)
      ? property.possibleValues
      : [];
}

function findTaxonomyProperty(properties, attributeName, desiredValues = []) {
  const wantedName = normalizeEtsyPropertyText(attributeName);
  const desired = desiredValues.map(normalizeEtsyPropertyText).filter(Boolean);

  const byName = properties.find((property) => {
    const names = propertyNames(property);
    return names.includes(wantedName) || names.some((name) => name.includes(wantedName) || wantedName.includes(name));
  });
  if (byName) return byName;

  if (desired.length) {
    return properties.find((property) => {
      const values = new Set(possibleValues(property).map((value) => normalizeEtsyPropertyText(value?.name)));
      return desired.every((value) => values.has(value));
    }) || null;
  }

  return null;
}

async function applyTaxonomyValues({
  session,
  listingId,
  properties,
  attributeName,
  values
}) {
  const desired = (values || []).map((value) => String(value || '').trim()).filter(Boolean);
  if (!desired.length) return { applied: false, reason: 'no values requested' };

  const property = findTaxonomyProperty(properties, attributeName, desired);
  if (!property) {
    return {
      applied: false,
      warning: `Etsy property "${attributeName}" was not available for this taxonomy.`
    };
  }

  const available = possibleValues(property);
  const matches = desired.map((wanted) => {
    const normalized = normalizeEtsyPropertyText(wanted);
    return available.find((value) => normalizeEtsyPropertyText(value?.name) === normalized) || null;
  });

  const missing = desired.filter((_, index) => !matches[index]);
  if (missing.length) {
    return {
      applied: false,
      warning: `Etsy property "${attributeName}" is missing value(s): ${missing.join(', ')}.`
    };
  }

  await updateListingProperty({
    shopId: session.shop.shop_id,
    listingId,
    propertyId: property.property_id,
    valueIds: matches.map((value) => value.value_id),
    values: matches.map((value) => value.name),
    scaleId: property.scale_id ?? undefined,
    keystring: session.keystring,
    sharedSecret: session.sharedSecret,
    accessToken: session.accessToken
  });

  return {
    applied: true,
    propertyId: property.property_id,
    propertyName: property.display_name || property.name || attributeName,
    values: matches.map((value) => value.name)
  };
}

async function getEtsySession({ forceRefresh = false } = {}) {
  if (
    !forceRefresh &&
    etsySessionCache &&
    Number(etsySessionCache.expiresAt || 0) > Date.now() + 60_000
  ) {
    return etsySessionCache;
  }

  const keystring = process.env.ETSY_KEYSTRING;
  const sharedSecret = process.env.ETSY_SHARED_SECRET;
  const refreshToken = process.env.ETSY_REFRESH_TOKEN;
  if (!keystring || !sharedSecret || !refreshToken) {
    throw new Error('ETSY_KEYSTRING, ETSY_SHARED_SECRET, and ETSY_REFRESH_TOKEN must be configured in Render.');
  }

  const token = await refreshEtsyToken({ keystring, refreshToken });
  const userId = getUserIdFromAccessToken(token.access_token);
  const shop = await getShopByOwnerUserId({
    userId,
    keystring,
    sharedSecret,
    accessToken: token.access_token
  });
  const expiresInMs = Math.max(5 * 60 * 1000, (Number(token.expires_in || 3600) * 1000) - 120_000);

  etsySessionCache = {
    keystring,
    sharedSecret,
    accessToken: token.access_token,
    userId,
    shop,
    scope: token.scope || '',
    expiresAt: Date.now() + expiresInMs
  };
  return etsySessionCache;
}

async function getCachedTaxonomyProperties(session, taxonomyId) {
  const key = String(taxonomyId);
  const cached = taxonomyCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.properties;

  const response = await getPropertiesByTaxonomyId({
    taxonomyId,
    keystring: session.keystring,
    sharedSecret: session.sharedSecret,
    accessToken: session.accessToken
  });
  const properties = taxonomyProperties(response);
  taxonomyCache.set(key, { cachedAt: Date.now(), properties });
  return properties;
}

function mostCommonValue(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const value = getter(item);
    if (value === undefined || value === null || value === '') continue;
    const key = JSON.stringify(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let bestKey = null;
  let bestCount = -1;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey === null ? null : JSON.parse(bestKey);
}

const MOCKUP_ORDER_TEMPLATE_KEY = 'presets/mockup-order-template-v3.json';

// The v3 locked template is the exact reference that produced the user's latest
// test draft. Its custom-image slots are stable, but that reference's custom
// order differs from the shop's canonical 15-image layout. This remap converts
// those 12 identified custom slots into the exact established Silvia order.
// Preset images are inserted separately at image ranks 2, 5 and 15.
const SILVIA_CANONICAL_CUSTOM_REMAP_15 = [1, 10, 0, 11, 7, 9, 8, 6, 5, 3, 2, 4];

function canonicalCustomMockupOrder(items) {
  const values = Array.from(items || []);
  if (values.length !== SILVIA_CANONICAL_CUSTOM_REMAP_15.length) return values;
  return SILVIA_CANONICAL_CUSTOM_REMAP_15.map((index) => values[index]).filter(Boolean);
}

async function optimizeEtsyImageObject(object) {
  if (!object?.body) return object;
  try {
    const optimized = await sharp(object.body, { failOn: 'none' })
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({
        quality: 92,
        chromaSubsampling: '4:4:4',
        progressive: true
      })
      .toBuffer();
    return {
      ...object,
      body: optimized,
      contentType: 'image/jpeg',
      originalBytes: object.body.length,
      uploadBytes: optimized.length
    };
  } catch {
    return object;
  }
}

async function fetchExactMockupReference(session, listingId, title = '') {
  const images = await getEtsyListingImages({
    listingId,
    keystring: session.keystring,
    sharedSecret: session.sharedSecret,
    accessToken: session.accessToken
  });
  if (images.length < 2) {
    throw new Error(`Mockup template listing #${listingId} does not have enough Etsy images.`);
  }
  return {
    listingId: Number(listingId),
    title: String(title || ''),
    imageCount: images.length,
    images,
    locked: true
  };
}

async function cacheRecentMockupReference(session, sourceListings) {
  const shopId = String(session.shop.shop_id);
  const current = mockupReferenceCache.get(shopId);
  if (current && Date.now() - current.cachedAt < CACHE_TTL_MS) return current.reference;

  let savedTemplate = null;
  try {
    if (await artworkObjectExists(MOCKUP_ORDER_TEMPLATE_KEY)) {
      savedTemplate = await getJsonObject(MOCKUP_ORDER_TEMPLATE_KEY);
    }
  } catch {
    savedTemplate = null;
  }

  const envListingId = String(process.env.ETSY_MOCKUP_TEMPLATE_LISTING_ID || '').trim();
  const pinnedListingId = envListingId || savedTemplate?.listingId || null;
  let reference = null;

  if (pinnedListingId) {
    try {
      reference = await fetchExactMockupReference(
        session,
        pinnedListingId,
        savedTemplate?.title || ''
      );
    } catch (error) {
      // An explicitly configured listing ID should never silently change.
      if (envListingId) throw error;
      reference = null;
    }
  }

  if (!reference) {
    reference = await chooseRecentMockupReference({
      listings: sourceListings,
      keystring: session.keystring,
      sharedSecret: session.sharedSecret,
      accessToken: session.accessToken,
      minImages: 4,
      maxCandidates: 8
    });

    if (reference) {
      reference = { ...reference, locked: true };
      await putJsonObject(MOCKUP_ORDER_TEMPLATE_KEY, {
        version: 1,
        listingId: reference.listingId,
        title: reference.title || '',
        imageCount: reference.imageCount,
        lockedAt: new Date().toISOString()
      });
    }
  }

  mockupReferenceCache.set(shopId, { cachedAt: Date.now(), reference });
  return reference;
}

function currentMockupReference(session) {
  const cached = mockupReferenceCache.get(String(session.shop.shop_id));
  if (!cached || Date.now() - cached.cachedAt >= CACHE_TTL_MS) return null;
  return cached.reference || null;
}

function sleepMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isEtsyListingConflict(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('(409)') ||
    message.includes('being edited by another process') ||
    message.includes('listing is being edited');
}

async function withEtsyListingRetry(task, { attempts = 6, baseDelayMs = 300 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isEtsyListingConflict(error) || attempt === attempts) throw error;
      const delay = Math.min(2500, baseDelayMs * attempt + Math.floor(Math.random() * 180));
      await sleepMs(delay);
    }
  }
  throw lastError;
}

async function prepareMediaPlan({ session, manifest }) {
  const customMedia = Array.isArray(manifest?.mockups) ? manifest.mockups : [];
  const presetStatus = await presetMediaStatus();
  if (!presetStatus.configured) {
    throw new Error('The 3 preset images + listing video are not installed in R2 yet.');
  }

  const reference = currentMockupReference(session);
  const customImages = customMedia.filter((item) =>
    String(item?.contentType || '').startsWith('image/')
  );

  // The established Silvia listing layout has preset images interleaved at
  // Etsy IMAGE ranks 2, 5 and 15. The listing video is separate and Etsy shows
  // it as the second featured tile automatically. Match only artwork-specific
  // mockups against the remaining reference-image slots.
  const presetImageRanks = new Map([
    [2, 'choose-option'],
    [5, 'choose-frame'],
    [15, 'promotion']
  ]);

  if (!reference) {
    throw new Error('No locked Etsy mockup reference is available. Open Product Creator once to cache an active listing template.');
  }

  const referenceCustomImages = (reference.images || []).filter((_, index) =>
    !presetImageRanks.has(index + 1)
  );

  const sortResult = customImages.length
    ? await sortCustomMockupsByReference({
        customMedia: customImages,
        referenceImages: referenceCustomImages,
        getObject: getArtworkObject
      })
    : {
        items: [],
        applied: true,
        reason: 'no custom mockups',
        averageScore: null,
        matches: []
      };

  if (customImages.length >= 2 && (
    !sortResult.applied ||
    (sortResult.matches || []).length !== customImages.length
  )) {
    throw new Error(
      `Exact mockup ordering could not be matched to #${reference.listingId}. ${sortResult.reason || 'Every uploaded mockup must match one template slot.'}`
    );
  }

  const presetByRole = new Map(PRESET_MEDIA.map((item) => [item.role, {
    key: item.key,
    contentType: item.contentType,
    originalFilename: item.filename,
    presetRole: item.role
  }]));

  // Convert the stable v3 reference-slot identities into the exact canonical
  // 15-image shop layout shown in the approved Etsy listing.
  const canonicalCustomItems = canonicalCustomMockupOrder(sortResult.items);

  const orderedImages = [];
  let customIndex = 0;
  const totalImageCount = customImages.length + 3;
  for (let rank = 1; rank <= totalImageCount; rank += 1) {
    const presetRole = presetImageRanks.get(rank);
    if (presetRole && presetByRole.get(presetRole)) {
      orderedImages.push(presetByRole.get(presetRole));
    } else if (canonicalCustomItems[customIndex]) {
      orderedImages.push(canonicalCustomItems[customIndex]);
      customIndex += 1;
    }
  }
  while (customIndex < canonicalCustomItems.length) {
    orderedImages.push(canonicalCustomItems[customIndex]);
    customIndex += 1;
  }

  const videoPreset = presetByRole.get('video');
  const mediaItems = videoPreset ? [...orderedImages, videoPreset] : orderedImages;
  const existingImages = new Map((manifest.etsyMedia?.images || []).map((item) => [item.key, item]));
  const preparedBuffers = sortResult.preparedBuffers instanceof Map
    ? sortResult.preparedBuffers
    : new Map();

  const needBuffers = mediaItems.filter((item) => {
    if (String(item.contentType || '').startsWith('video/')) {
      return !(manifest.etsyMedia?.video?.videoId && manifest.etsyMedia?.video?.key === item.key);
    }
    return !existingImages.get(item.key)?.listingImageId && !preparedBuffers.has(item.key);
  });

  const fetched = await mapWithConcurrency(needBuffers, 6, async (item) => {
    const object = await getArtworkObject(item.key);
    return [item.key, object];
  });
  const objectByKey = new Map(fetched);

  for (const [key, buffer] of preparedBuffers.entries()) {
    objectByKey.set(key, { body: buffer, contentType: null });
  }

  // Etsy image upload latency is dominated by transferring large mockup files.
  // 2400 px / quality 92 remains well above Etsy thumbnail/display needs while
  // dramatically reducing payload size. The R2 originals are never modified.
  const imageKeys = mediaItems
    .filter((item) => String(item.contentType || '').startsWith('image/'))
    .map((item) => item.key);
  await mapWithConcurrency(imageKeys, 3, async (key) => {
    const object = objectByKey.get(key);
    if (!object) return;
    objectByKey.set(key, await optimizeEtsyImageObject(object));
  });

  return {
    mediaItems,
    objectByKey,
    sort: {
      applied: Boolean(sortResult.applied),
      reason: sortResult.reason || null,
      averageScore: sortResult.averageScore ?? null,
      referenceListingId: reference?.listingId || null,
      referenceTitle: reference?.title || null,
      presetImageRanks: Object.fromEntries([...presetImageRanks.entries()].map(([rank, role]) => [role, rank])),
      canonicalLayoutApplied: canonicalCustomItems.length === 12,
      canonicalLayoutVersion: canonicalCustomItems.length === 12 ? 'silvia-15-v1' : null,
      matches: sortResult.matches || []
    }
  };
}

async function uploadPreparedMediaToEtsy({ session, listingId, manifest, plan }) {
  manifest.etsyMedia ||= { images: [], video: null };
  const existingImages = new Map((manifest.etsyMedia.images || []).map((item) => [item.key, item]));
  const imageItems = plan.mediaItems
    .filter((item) => String(item.contentType || '').startsWith('image/'))
    .map((item, index) => ({ item, rank: index + 1 }));
  const videoItem = plan.mediaItems.find((item) => String(item.contentType || '').startsWith('video/')) || null;

  // Two upload workers are materially faster than fully serial uploads while
  // still respecting Etsy's short listing lock. Any 409 is retried with backoff.
  const uploadStartedAt = Date.now();
  let originalImageBytes = 0;
  let uploadImageBytes = 0;
  const uploadedImages = new Array(imageItems.length);
  await mapWithConcurrency(imageItems, 2, async ({ item, rank }, index) => {
    const existing = existingImages.get(item.key);
    if (existing?.listingImageId) {
      uploadedImages[index] = { ...existing, rank };
      return;
    }

    const object = plan.objectByKey.get(item.key) || await getArtworkObject(item.key);
    originalImageBytes += Number(object.originalBytes || object.body?.length || 0);
    uploadImageBytes += Number(object.uploadBytes || object.body?.length || 0);
    const filename = String(item.originalFilename || item.key.split('/').pop() || 'listing-image.jpg');
    const uploaded = await withEtsyListingRetry(() => uploadListingImage({
      shopId: session.shop.shop_id,
      listingId,
      imageBuffer: object.body,
      filename,
      contentType: object.contentType || item.contentType || 'image/jpeg',
      rank,
      altText: manifest.title || '',
      keystring: session.keystring,
      sharedSecret: session.sharedSecret,
      accessToken: session.accessToken
    }), { attempts: 8, baseDelayMs: 180 });

    uploadedImages[index] = {
      listingImageId: uploaded.listing_image_id || null,
      key: item.key,
      filename,
      rank
    };
  });

  let video = manifest.etsyMedia.video || null;
  if (
    videoItem &&
    !(manifest.etsyMedia.video?.videoId && manifest.etsyMedia.video?.key === videoItem.key)
  ) {
    const object = plan.objectByKey.get(videoItem.key) || await getArtworkObject(videoItem.key);
    const filename = String(videoItem.originalFilename || videoItem.key.split('/').pop() || 'listing-video.mov');
    const uploaded = await withEtsyListingRetry(() => uploadListingVideo({
      shopId: session.shop.shop_id,
      listingId,
      videoBuffer: object.body,
      filename,
      contentType: object.contentType || videoItem.contentType || 'video/quicktime',
      keystring: session.keystring,
      sharedSecret: session.sharedSecret,
      accessToken: session.accessToken
    }), { attempts: 8, baseDelayMs: 180 });
    video = {
      videoId: uploaded.video_id || null,
      key: videoItem.key,
      filename
    };
  }

  // Persist media state once instead of doing an R2 manifest write after every
  // image. This removes a large number of network round-trips during drafts.
  manifest.etsyMedia.images = uploadedImages.filter(Boolean).sort((a, b) => a.rank - b.rank);
  manifest.etsyMedia.video = video;
  manifest.mockupSort = plan.sort;
  await saveArtworkManifest(manifest);

  return {
    imageCount: manifest.etsyMedia.images.length,
    videoUploaded: Boolean(video?.videoId),
    uploadMs: Date.now() - uploadStartedAt,
    originalImageBytes,
    uploadImageBytes,
    bytesSaved: Math.max(0, originalImageBytes - uploadImageBytes),
    mockupSort: plan.sort
  };
}

async function applyAllListingAttributes({ session, listingId, body, properties }) {
  const requested = [
    ...Object.entries(listingDefaults.fixedAttributes || {}).map(([attributeName, values]) => ({
      attributeName,
      values,
      optional: attributeName === 'Sustainability'
    })),
    ...(body.homestyle ? [{ attributeName: 'Homestyle', values: [body.homestyle], optional: false }] : [])
  ];

  const settled = [];
  for (const entry of requested) {
    try {
      const result = await withEtsyListingRetry(() => applyTaxonomyValues({
        session,
        listingId,
        properties,
        attributeName: entry.attributeName,
        values: entry.values
      }));
      settled.push({ ...result, attributeName: entry.attributeName, optional: entry.optional });
    } catch (error) {
      settled.push({
        applied: false,
        attributeName: entry.attributeName,
        optional: entry.optional,
        warning: `${entry.attributeName}: ${error?.message || error}`
      });
    }
  }

  return {
    results: settled,
    warnings: settled
      .filter((item) => item.warning && !item.optional)
      .map((item) => item.warning)
  };
}

async function getAuthorizedShop() {
  const { userId, shop, scope } = await getEtsySession();
  return { userId, shop, scope };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'silvia-sensaria-bridge' });
  }

  if (req.method === 'GET' && url.pathname === '/login') {
    if (isAdminAuthenticated(req)) {
      res.writeHead(302, { location: '/', 'cache-control': 'no-store' });
      return res.end();
    }
    const returnTo = url.searchParams.get('returnTo') || '/';
    return sendHtml(res, 200, renderLogin({ returnTo }));
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    try {
      const form = await readFormBody(req);
      const password = form.get('password') || '';
      const returnToRaw = form.get('returnTo') || '/';
      const returnTo = String(returnToRaw).startsWith('/') ? String(returnToRaw) : '/';

      if (!verifyAdminPassword(password)) {
        return sendHtml(res, 401, renderLogin({
          error: 'Incorrect password.',
          returnTo
        }));
      }

      res.writeHead(302, {
        location: returnTo,
        'set-cookie': createAdminSessionCookie(),
        'cache-control': 'no-store'
      });
      return res.end();
    } catch (error) {
      return sendHtml(res, 503, renderLogin({
        error: error?.message || String(error),
        returnTo: '/'
      }));
    }
  }

  if (req.method === 'GET' && url.pathname === '/logout') {
    res.writeHead(302, {
      location: '/login',
      'set-cookie': clearAdminSessionCookie(),
      'cache-control': 'no-store'
    });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/test-order') {
    if (!requireAdminPage(req, res, '/test-order')) return;
    return sendHtml(res, 200, renderTestOrderPage());
  }

  if (req.method === 'POST' && url.pathname === '/api/test-order') {
    if (!requireAdminApi(req, res)) return;
    const startedAt = Date.now();
    try {
      const body = await readJsonBody(req);
      const { meta, receipt } = buildTestReceipt(body);
      const manifest = await loadArtworkManifest(meta.artworkId);
      if (!manifest?.master?.key || manifest.status !== 'ready') {
        throw new Error(`Artwork ${meta.artworkId} is not ready in R2. Create/upload that artwork first.`);
      }

      // Dry-run is for validating GO mappings and checkout/shipping costs.
      // Do not render the enormous production canvas inside the web request;
      // use the existing master-artwork URL and keep the production spec visible.
      const result = await etsyReceiptToSensariaCsvFromR2(receipt, { renderProduction: false });
      const source = result.sources?.[0] || {};
      const spec = source.spec || {};
      const output = spec.output || null;
      const row = result.rows?.[0] || {};

      return sendJson(res, 200, {
        ok: true,
        dryRun: true,
        submittedToSensaria: false,
        reference: meta.reference,
        sku: meta.sku,
        productCode: row['Product Code'] || null,
        wrapType: row['Wrap Type'] || '',
        shippingType: row['Shipping Type'] || '',
        productionKey: source.rendered ? (source.key || null) : null,
        sourceKey: source.key || manifest.master.key || null,
        production: {
          kind: spec.kind || null,
          dpi: spec.dpi || null,
          output,
          face: spec.face || null,
          mirrorBleedPx: spec.mirrorBleedPx || 0,
          safeInsetPx: spec.safeInsetPx || 0,
          template: spec.template || null,
          rendered: Boolean(source.rendered)
        },
        rows: result.rows,
        csv: result.csv,
        timingMs: Date.now() - startedAt
      });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        dryRun: true,
        submittedToSensaria: false,
        error: error?.message || String(error),
        timingMs: Date.now() - startedAt
      });
    }
  }


  if (req.method === 'GET' && url.pathname === '/shipping-profile') {
    if (!requireAdminPage(req, res, '/shipping-profile')) return;
    return sendHtml(res, 200, renderShippingProfilePage());
  }

  if (req.method === 'GET' && url.pathname === '/api/shipping-profile') {
    if (!requireAdminApi(req, res)) return;
    try {
      const session = await getEtsySession();
      const profilesResponse = await getShopShippingProfiles({
        shopId: session.shop.shop_id,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      });
      const profiles = profilesResponse.results || profilesResponse || [];
      const managedProfile = profiles.find((profile) =>
        String(profile?.title || '').trim() === String(shippingProfileDefaults.title || '').trim()
      ) || null;

      return sendJson(res, 200, {
        ok: true,
        scopes: session.scope || '',
        defaults: shippingProfileDefaults,
        shopPostalCode: managedProfile?.origin_postal_code || '',
        managedProfile
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/shipping-profile') {
    if (!requireAdminApi(req, res)) return;
    let createdProfileId = null;
    try {
      const session = await getEtsySession();
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('shops_w')) {
        return sendJson(res, 403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy to grant shops_w before creating a shipping profile.'
        });
      }

      const body = await readJsonBody(req);
      const originPostalCode = String(body.origin_postal_code || '').trim();
      if (!originPostalCode) {
        return sendJson(res, 400, { ok: false, error: 'Origin postal code is required.' });
      }

      const allowed = new Map(
        (shippingProfileDefaults.destinations || []).map((destination) => [
          String(destination.countryIso || '').toUpperCase(),
          destination
        ])
      );
      const requested = Array.from(new Set(
        (Array.isArray(body.destinations) ? body.destinations : [])
          .map((value) => String(value || '').trim().toUpperCase())
          .filter((value) => allowed.has(value))
      ));
      if (!requested.length) {
        return sendJson(res, 400, { ok: false, error: 'Select at least one supported destination.' });
      }
      if (!requested.includes('CA')) requested.unshift('CA');

      const profileTitle = String(shippingProfileDefaults.title || 'Silvia Sensaria Free Shipping').trim();
      const shopArgs = {
        shopId: session.shop.shop_id,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      };

      const profilesResponse = await getShopShippingProfiles(shopArgs);
      const profiles = profilesResponse.results || profilesResponse || [];
      const existing = profiles.find((profile) => String(profile?.title || '').trim() === profileTitle);
      if (existing) {
        return sendJson(res, 200, {
          ok: true,
          alreadyExists: true,
          shippingProfileId: existing.shipping_profile_id,
          destinationCount: Array.isArray(existing.shipping_profile_destinations)
            ? existing.shipping_profile_destinations.length
            : requested.length,
          profile: existing
        });
      }

      const domestic = shippingProfileDefaults.domesticDelivery || { minDays: 3, maxDays: 7 };
      const international = shippingProfileDefaults.internationalDelivery || { minDays: 5, maxDays: 14 };
      const firstIso = requested[0];
      const firstTiming = firstIso === 'CA' ? domestic : international;

      const profile = await createShopShippingProfile({
        ...shopArgs,
        title: profileTitle,
        originCountryIso: shippingProfileDefaults.originCountryIso || 'CA',
        destinationCountryIso: firstIso,
        primaryCost: shippingProfileDefaults.primaryCost ?? 0,
        secondaryCost: shippingProfileDefaults.secondaryCost ?? 0,
        originPostalCode,
        minDeliveryDays: firstTiming.minDays,
        maxDeliveryDays: firstTiming.maxDays
      });
      createdProfileId = profile.shipping_profile_id;

      const createdDestinations = [firstIso];
      for (const countryIso of requested.slice(1)) {
        const timing = countryIso === 'CA' ? domestic : international;
        await createShopShippingProfileDestination({
          ...shopArgs,
          shippingProfileId: createdProfileId,
          destinationCountryIso: countryIso,
          primaryCost: shippingProfileDefaults.primaryCost ?? 0,
          secondaryCost: shippingProfileDefaults.secondaryCost ?? 0,
          minDeliveryDays: timing.minDays,
          maxDeliveryDays: timing.maxDays
        });
        createdDestinations.push(countryIso);
      }

      return sendJson(res, 201, {
        ok: true,
        shippingProfileId: createdProfileId,
        title: profileTitle,
        destinationCount: createdDestinations.length,
        destinations: createdDestinations,
        profile
      });
    } catch (error) {
      let rollbackError = null;
      if (createdProfileId) {
        try {
          const session = await getEtsySession();
          await deleteShopShippingProfile({
            shopId: session.shop.shop_id,
            shippingProfileId: createdProfileId,
            keystring: session.keystring,
            sharedSecret: session.sharedSecret,
            accessToken: session.accessToken
          });
        } catch (rollback) {
          rollbackError = rollback?.message || String(rollback);
        }
      }
      return sendJson(res, 500, {
        ok: false,
        error: error?.message || String(error),
        rolledBack: Boolean(createdProfileId && !rollbackError),
        rollbackError
      });
    }
  }

  if (req.method === 'GET' && url.pathname === '/pricing') {
    if (!requireAdminPage(req, res, '/pricing')) return;
    return sendHtml(res, 200, renderPricingPage());
  }

  if (req.method === 'GET' && url.pathname === '/api/pricing') {
    if (!requireAdminApi(req, res)) return;
    try {
      const marketKey = String(url.searchParams.get('market') || '').trim();
      if (marketKey) {
        const priced = pricingCatalogForMarket(marketKey);
        return sendJson(res, 200, {
          ok: true,
          market: priced.market,
          zone: priced.market.zone,
          rows: priced.rows,
          config: publicShippingPricingConfig()
        });
      }

      const explicitZone = String(url.searchParams.get('zone') || '').trim().toUpperCase();
      if (explicitZone) {
        return sendJson(res, 200, {
          ok: true,
          zone: explicitZone,
          rows: pricingCatalogForZone(explicitZone, { customerPaysShipping: false }),
          config: publicShippingPricingConfig()
        });
      }

      const priced = pricingCatalogForMarket('CA');
      return sendJson(res, 200, {
        ok: true,
        market: priced.market,
        zone: priced.market.zone,
        rows: priced.rows,
        config: publicShippingPricingConfig()
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/product-creator') {
    if (!requireAdminPage(req, res, '/product-creator')) return;
    return sendHtml(res, 200, renderProductCreator());
  }

  if (req.method === 'GET' && url.pathname === '/') {
    if (!requireAdminPage(req, res, '/')) return;
    return sendHtml(res, 200, renderDashboard({
      mappingCount,
      mappedSizeCount,
      unresolvedSizes,
      webhookConfigured: Boolean(process.env.ETSY_WEBHOOK_SECRET),
      r2Configured: Boolean(
        process.env.R2_ACCOUNT_ID &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        process.env.R2_BUCKET_NAME
      )
    }));
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    if (!requireAdminApi(req, res)) return;
    return sendJson(res, 200, {
      ok: true,
      service: 'Silvia Art Collective → Sensaria Bridge',
      etsyCallbackUrl: callbackUrl(),
      etsyConnectUrl: '/etsy/connect',
      etsyStatusUrl: '/etsy/status',
      etsyConfigured: Boolean(
        process.env.ETSY_KEYSTRING &&
        process.env.ETSY_SHARED_SECRET &&
        process.env.ETSY_REFRESH_TOKEN
      ),
      webhookConfigured: Boolean(process.env.ETSY_WEBHOOK_SECRET),
      r2Configured: Boolean(
        process.env.R2_ACCOUNT_ID &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        process.env.R2_BUCKET_NAME
      ),
      sensariaMappings: mappingCount,
      mappedSizes: mappedSizeCount,
      unresolvedSizes,
      podProviders: podProviderStatus()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/providers/status') {
    if (!requireAdminApi(req, res)) return;
    return sendJson(res, 200, {
      ok: true,
      fulfillmentMode: String(process.env.FULFILLMENT_MODE || 'shadow'),
      masterLiveSubmissionEnabled: String(process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED || '').toLowerCase() === 'true',
      providers: podProviderStatus()
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/providers/test') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const result = await testPodProvider(body?.provider);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/r2/status') {
    if (!requireAdminApi(req, res)) return;
    try {
      const status = await checkR2Connection();
      return sendJson(res, 200, { ok: true, ...status });
    } catch (error) {
      return sendJson(res, 500, {
        ok: false,
        connected: false,
        error: error?.message || String(error)
      });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/presets/status') {
    if (!requireAdminApi(req, res)) return;
    try {
      return sendJson(res, 200, { ok: true, ...(await presetMediaStatus()) });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/presets/reserve') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const files = Array.isArray(body.files) ? body.files : [];
      const byRole = new Map(files.map((file) => [String(file.role || ''), file]));
      const uploads = await Promise.all(PRESET_MEDIA.map(async (item) => {
        const supplied = byRole.get(item.role);
        if (!supplied) throw new Error(`Missing preset file: ${item.role}`);
        return {
          role: item.role,
          filename: item.filename,
          key: item.key,
          contentType: item.contentType,
          uploadUrl: await signedArtworkUploadUrl(item.key, item.contentType)
        };
      }));
      return sendJson(res, 201, { ok: true, uploads });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/presets/complete') {
    if (!requireAdminApi(req, res)) return;
    try {
      const status = await presetMediaStatus();
      if (!status.configured) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Preset media upload is incomplete.',
          items: status.items
        });
      }
      return sendJson(res, 200, { ok: true, ...status });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/artworks/reserve') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const reservation = await reserveArtworkUpload(body);
      return sendJson(res, 201, { ok: true, ...reservation });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  const artworkCancelMatch = url.pathname.match(/^\/api\/artworks\/(SAC\d+)\/cancel$/i);
  if (req.method === 'POST' && artworkCancelMatch) {
    if (!requireAdminApi(req, res)) return;
    try {
      const result = await cancelArtworkUpload(artworkCancelMatch[1].toUpperCase());
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  const artworkCompleteMatch = url.pathname.match(/^\/api\/artworks\/(SAC\d+)\/complete$/i);
  if (req.method === 'POST' && artworkCompleteMatch) {
    if (!requireAdminApi(req, res)) return;
    try {
      const manifest = await completeArtworkUpload(artworkCompleteMatch[1].toUpperCase());
      return sendJson(res, 200, { ok: true, artworkId: manifest.artworkId, manifest });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/etsy/listing-options') {
    if (!requireAdminApi(req, res)) return;
    try {
      const session = await getEtsySession();
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_w') || !scopes.has('listings_r')) {
        return sendJson(res, 403, {
          ok: false,
          needsReauthorization: true,
          scopes: session.scope,
          error: 'Reconnect Etsy to grant listings_r and listings_w.'
        });
      }

      const shopArgs = {
        shopId: session.shop.shop_id,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      };

      const [shipping, readiness, listings, sections, returnPolicies, productionPartners, presetStatus, taxonomyWarm] = await Promise.all([
        getShopShippingProfiles(shopArgs),
        getShopReadinessStateDefinitions(shopArgs),
        getShopListings({ ...shopArgs, state: 'active', limit: 100 }),
        getShopSections(shopArgs),
        getShopReturnPolicies(shopArgs),
        getShopProductionPartners(shopArgs),
        presetMediaStatus(),
        getCachedTaxonomyProperties(session, listingDefaults.taxonomyId)
      ]);

      const sourceListings = (listings.results || listings || []).map((listing) => ({
        listing_id: listing.listing_id,
        title: listing.title,
        taxonomy_id: listing.taxonomy_id,
        shipping_profile_id: listing.shipping_profile_id,
        readiness_state_id: listing.readiness_state_id,
        return_policy_id: listing.return_policy_id,
        shop_section_id: listing.shop_section_id,
        who_made: listing.who_made,
        when_made: listing.when_made,
        is_supply: listing.is_supply,
        should_auto_renew: listing.should_auto_renew,
        is_customizable: listing.is_customizable,
        is_taxable: listing.is_taxable,
        production_partner_ids: Array.isArray(listing.production_partner_ids)
          ? listing.production_partner_ids
          : []
      }));

      const managedShippingProfile = (shipping.results || shipping || []).find((profile) =>
        String(profile?.title || '').trim() === String(shippingProfileDefaults.title || '').trim()
      ) || null;

      const detectedPreset = {
        shipping_profile_id: managedShippingProfile?.shipping_profile_id || mostCommonValue(sourceListings, (x) => x.shipping_profile_id),
        readiness_state_id: mostCommonValue(sourceListings, (x) => x.readiness_state_id),
        return_policy_id: mostCommonValue(sourceListings, (x) => x.return_policy_id),
        shop_section_id: mostCommonValue(sourceListings, (x) => x.shop_section_id),
        who_made: mostCommonValue(sourceListings, (x) => x.who_made),
        when_made: mostCommonValue(sourceListings, (x) => x.when_made),
        is_supply: mostCommonValue(sourceListings, (x) => x.is_supply),
        should_auto_renew: mostCommonValue(sourceListings, (x) => x.should_auto_renew),
        production_partner_id: mostCommonValue(
          sourceListings,
          (x) => Array.isArray(x.production_partner_ids) && x.production_partner_ids.length
            ? x.production_partner_ids[0]
            : null
        )
      };

      const mockupReference = await cacheRecentMockupReference(session, sourceListings);

      return sendJson(res, 200, {
        ok: true,
        shopId: session.shop.shop_id,
        shopName: session.shop.shop_name,
        defaults: listingDefaults,
        detectedPreset,
        variantCatalog: {
          ownedByApp: true,
          pricingLogic: 'Silvia approved regular CAD ladder converted to USD at 1 USD = 1.39 CAD; 20% Etsy shop sale applied separately',
          productStyles: ['Matte Paper Poster','Canvas','Framed Canvas - Natural Oak','Framed Canvas - Dark Walnut','Framed Canvas - Matte Black','Framed Canvas - White']
        },
        presetMedia: presetStatus,
        mockupReference: mockupReference ? {
          listingId: mockupReference.listingId,
          title: mockupReference.title,
          imageCount: mockupReference.imageCount
        } : null,
        activeListingCount: sourceListings.length,
        shippingProfiles: shipping.results || shipping || [],
        readinessProfiles: readiness.results || readiness || [],
        sourceListings,
        shopSections: sections.results || sections || [],
        returnPolicies: returnPolicies.results || returnPolicies || [],
        productionPartners: productionPartners.results || productionPartners || []
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/etsy/drafts') {
    if (!requireAdminApi(req, res)) return;
    const startedAt = Date.now();
    try {
      const session = await getEtsySession();
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_w')) {
        return sendJson(res, 403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy to grant listings_w.'
        });
      }

      const body = await readJsonBody(req);
      const seoDescription = String(body.seo_description || '').trim();
      const shopSectionName = String(body.seo_section_name || '').trim();
      const shopSectionUrl = String(body.seo_section_url || '').trim();
      body.description = listingDefaults.descriptionTemplate
        .replace('{{SHORT_SEO_DESCRIPTION}}', seoDescription)
        .replace('{{SHOP_SECTION_NAME}}', shopSectionName)
        .replace('{{SHOP_SECTION_URL}}', shopSectionUrl);
      body.taxonomy_id = listingDefaults.taxonomyId;
      body.should_auto_renew = listingDefaults.autoRenew;

      const required = ['artwork_id','title','description','taxonomy_id','shipping_profile_id','readiness_state_id'];
      const missing = required.filter((key) => body[key] === undefined || body[key] === null || body[key] === '');
      if (missing.length) return sendJson(res, 400, { ok:false, error:`Missing: ${missing.join(', ')}` });

      const manifest = await loadArtworkManifest(body.artwork_id);
      if (!manifest || manifest.status !== 'ready') {
        return sendJson(res, 400, {
          ok: false,
          error: 'The artwork upload is not complete in R2. Re-upload the master artwork and listing media before creating the Etsy draft.'
        });
      }
      if (!(manifest.mockups || []).some((item) => String(item?.contentType || '').startsWith('image/'))) {
        return sendJson(res, 400, {
          ok: false,
          error: 'At least one listing mockup image is required before creating the Etsy draft.'
        });
      }

      const variantInventory = buildOwnSilviaInventory({
        artworkId: body.artwork_id,
        catalog: products,
        readinessStateId: body.readiness_state_id,
        defaultQuantity: 999
      });
      body.price = variantInventory.minimumPrice;
      body.quantity = 999;

      const taxonomyPromise = getCachedTaxonomyProperties(session, body.taxonomy_id);
      const mediaPrepStartedAt = Date.now();
      const mediaPlanPromise = prepareMediaPlan({ session, manifest });

      let draft;
      const draftStartedAt = Date.now();
      if (manifest.etsyDraftListingId) {
        draft = {
          listing_id: Number(manifest.etsyDraftListingId),
          state: 'draft',
          title: body.title,
          resumed: true
        };
      } else {
        draft = await createDraftListing({
          shopId: session.shop.shop_id,
          keystring: session.keystring,
          sharedSecret: session.sharedSecret,
          accessToken: session.accessToken,
          listing: body
        });
        manifest.etsyDraftListingId = draft.listing_id;
        manifest.etsyDraftCreatedAt = new Date().toISOString();
        await saveArtworkManifest(manifest);
      }
      const draftMs = Date.now() - draftStartedAt;

      // Taxonomy/media preparation above can stay parallel because it does not
      // mutate Etsy. Etsy listing writes themselves must be serialized: Etsy
      // returns HTTP 409 when two processes edit the same listing at once.
      const inventoryStartedAt = Date.now();
      await withEtsyListingRetry(() => updateListingInventory({
        listingId: draft.listing_id,
        inventory: variantInventory,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      }));
      const inventoryMs = Date.now() - inventoryStartedAt;

      if (body.return_policy_id || body.production_partner_id || body.shop_section_id) {
        await withEtsyListingRetry(() => updateListing({
          shopId: session.shop.shop_id,
          listingId: draft.listing_id,
          listing: {
            return_policy_id: body.return_policy_id || undefined,
            production_partner_ids: body.production_partner_id
              ? [Number(body.production_partner_id)]
              : undefined,
            shop_section_id: body.shop_section_id || undefined
          },
          keystring: session.keystring,
          sharedSecret: session.sharedSecret,
          accessToken: session.accessToken
        }));
      }

      const properties = await taxonomyPromise;
      const attributesStartedAt = Date.now();
      const attributes = await applyAllListingAttributes({
        session,
        listingId: draft.listing_id,
        body,
        properties
      });
      const attributesMs = Date.now() - attributesStartedAt;

      const mediaPlan = await mediaPlanPromise;
      const mediaPrepMs = Date.now() - mediaPrepStartedAt;
      const media = await uploadPreparedMediaToEtsy({
        session,
        listingId: draft.listing_id,
        manifest,
        plan: mediaPlan
      });

      manifest.etsyConfiguredAt = new Date().toISOString();
      manifest.etsyConfiguration = {
        listingId: draft.listing_id,
        variants: variantInventory.products.length,
        materials: listingDefaults.fixedAttributes?.Materials || [],
        tags: body.tags || [],
        media,
        attributes: attributes.results
      };
      await saveArtworkManifest(manifest);

      return sendJson(res, 201, {
        ok: true,
        listingId: draft.listing_id,
        state: draft.state || 'draft',
        title: draft.title || body.title,
        resumed: Boolean(draft.resumed),
        url: draft.url || null,
        attributeWarnings: attributes.warnings,
        media,
        mockupSort: media.mockupSort,
        presetMedia: {
          imageCount: 3,
          videoCount: 1
        },
        timing: {
          totalMs: Date.now() - startedAt,
          draftMs,
          inventoryMs,
          attributesMs,
          mediaPrepMs,
          mediaUploadMs: media.uploadMs || 0
        },
        aiGenerator: {
          applied: false,
          reason: 'Etsy Open API does not currently expose the listing-editor AI generator checkbox.'
        },
        variants: {
          count: variantInventory.products.length,
          enabledCount: variantInventory.enabledCount,
          disabledCount: variantInventory.disabledCount,
          minimumPrice: variantInventory.minimumPrice,
          maximumPrice: variantInventory.maximumPrice,
          variation1: 'Size',
          variation2: 'Product - Style',
          pricing: variantInventory.pricing
        }
      });
    } catch (error) {
      return sendJson(res, 500, {
        ok:false,
        error:error?.message || String(error),
        timing: { totalMs: Date.now() - startedAt }
      });
    }
  }

  if (req.method === 'GET' && url.pathname === '/etsy/status') {
    if (!requireAdminApi(req, res)) return;
    try {
      const { userId, shop, scope } = await getAuthorizedShop();
      return sendJson(res, 200, {
        ok: true,
        connected: true,
        userId,
        shopId: shop.shop_id,
        shopName: shop.shop_name,
        scopes: scope
      });
    } catch (error) {
      return sendJson(res, 500, {
        ok: false,
        connected: false,
        error: error?.message || String(error)
      });
    }
  }

  if (req.method === 'GET' && url.pathname === '/etsy/connect') {
    if (!requireAdminPage(req, res, '/etsy/connect')) return;
    if (!process.env.ETSY_KEYSTRING) {
      return sendJson(res, 500, {
        ok: false,
        error: 'ETSY_KEYSTRING is not configured in Render.'
      });
    }

    cleanOauthRequests();
    const { codeVerifier, codeChallenge, state } = generatePkce();
    oauthRequests.set(state, { codeVerifier, createdAt: Date.now() });

    const authorizationUrl = buildAuthorizationUrl({
      keystring: process.env.ETSY_KEYSTRING,
      redirectUri: callbackUrl(),
      codeChallenge,
      state,
      scopes: ['transactions_r', 'transactions_w', 'listings_r', 'listings_w', 'shops_r', 'shops_w']
    });

    res.writeHead(302, {
      location: authorizationUrl,
      'cache-control': 'no-store'
    });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/etsy/callback') {
    const error = url.searchParams.get('error');
    if (error) {
      return sendHtml(res, 400, `<!doctype html>
        <meta charset="utf-8">
        <title>Etsy authorization failed</title>
        <h1>Etsy authorization failed</h1>
        <p>${escapeHtml(url.searchParams.get('error_description') || error)}</p>`);
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const pending = state ? oauthRequests.get(state) : null;

    if (!code || !state || !pending || Date.now() - pending.createdAt > OAUTH_TTL_MS) {
      if (state) oauthRequests.delete(state);
      return sendHtml(res, 400, `<!doctype html>
        <meta charset="utf-8">
        <title>OAuth session expired</title>
        <h1>Etsy OAuth session expired</h1>
        <p>Return to the dashboard and connect Etsy again.</p>`);
    }

    oauthRequests.delete(state);
    try {
      const token = await exchangeAuthorizationCode({
        code,
        codeVerifier: pending.codeVerifier,
        keystring: process.env.ETSY_KEYSTRING,
        sharedSecret: process.env.ETSY_SHARED_SECRET,
        callbackUrl: callbackUrl()
      });

      if (token.refresh_token) {
        // The Render environment remains the source of truth for persistence.
        // Surface the token once so the administrator can store it there.
        return sendHtml(res, 200, `<!doctype html><html><body style="font-family:system-ui;padding:32px"><h1>Etsy connected</h1><p>Save this refresh token in Render as <code>ETSY_REFRESH_TOKEN</code>:</p><textarea style="width:100%;height:120px">${escapeHtml(token.refresh_token)}</textarea><p><a href="/">Return to dashboard</a></p></body></html>`);
      }

      return sendHtml(res, 200, '<h1>Etsy connected.</h1><p><a href="/">Return to dashboard</a></p>');
    } catch (error) {
      return sendHtml(res, 500, `<h1>Etsy connection failed</h1><pre>${escapeHtml(error?.message || error)}</pre>`);
    }
  }

  if (req.method === 'POST' && url.pathname === '/etsy/webhook') {
    return sendJson(res, 503, {
      ok: false,
      message: 'Webhook endpoint is reserved but not enabled until the Etsy webhook signing secret is configured.'
    });
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Keep Render's edge proxy from reusing a connection Node has already closed.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 120_000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Silvia Sensaria bridge listening on port ${port}`);
});
