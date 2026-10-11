import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderDashboard } from './dashboard.mjs';
import { renderReadinessPage } from './readiness-page.mjs';
import { renderListingReposterPage } from './listing-reposter-page.mjs';
import {
  cropOutputKeyForJob, isStagedRevisionJob, reserveArtworkRevision,
  startArtworkRevisionCrop, getArtworkRevisionStatus, artworkIdFromInventory
} from './artwork-revision.mjs';
import { findCandidates, getDetails, reserveMockups, prepareReplacement, finalizeReplacement } from './listing-reposter.mjs';
import { supplierOrderEndpointStatus } from './order-endpoints.mjs';
import { decorateAdminHtml } from './admin-sidebar.mjs';
import { renderTrackingPage } from './tracking-page.mjs';
import { listTrackingRecords, linkTrackingOrder, checkSupplierTracking, checkEtsyShipmentStatus, sensariaCandidates, stageShipment, sendStagedShipmentToEtsy } from './order-tracking.mjs';

const TRACKING_SHOP_NAME="Silvia Art Collective";
import { renderDescriptionUpdaterPage } from './description-updater-page.mjs';
import { previewDescriptionUpdates, applyDescriptionUpdates } from './description-updater.mjs';

import { renderProductCreator } from './product-creator.mjs';
import { handleMockupAPI } from './mockup-api.mjs';
import { renderTestOrderPage } from './test-order-page.mjs';
import { renderPricingPage } from './pricing-page.mjs';
import { renderListingConverterPage } from './listing-converter-page.mjs';
import { hasAuthorizedConverterLink } from './listing-converter-link.mjs';
import { renderShippingProfilePage } from './shipping-profile-page.mjs';
import { pricingCatalogForZone, pricingCatalogForMarket, publicShippingPricingConfig } from './pricing.mjs';
import { scanSupplierComparison } from './supplier-comparison.mjs';
import { renderSupplierComparisonPage } from './supplier-comparison-page.mjs';
import { renderCustomSizeLookupPage } from './custom-size-page.mjs';
import { lookupCustomSize } from './custom-size-lookup.mjs';
import { renderCustomOrdersPage } from './custom-orders-page.mjs';
import { renderOrdersPage } from './orders-page.mjs';
import { renderFulfillmentReviewPage } from './fulfillment-review-page.mjs';
import { prepareRegularRoute, approveRegularRoute } from './regular-order-routing.mjs';
import { listOrders, readOrder, recordImportedReceipt, optionalJson, reviewKey } from './custom-order-store.mjs';
import { automaticallyPrepareReceipt, selectAutomaticCandidates } from './auto-fulfillment.mjs';
import { classify, quote, savePlan, approve, markOrdered } from './custom-order-workflow.mjs';
import { recentPaidReceipts, receiptTransactions } from './etsy-orders-read.mjs';
import { buildPrintifyCostsForRequest } from './printify-cost-builder.mjs';
import { buildTestReceipt } from './test-order.mjs';
import { etsyReceiptToSensariaCsvFromR2 } from './fulfillment.mjs';
import {
  checkR2Connection,
  getArtworkObject,
  signedArtworkUrl,
  signedArtworkUploadUrl,
  artworkObjectExists,
  listArtworkManifestKeys,
  getJsonObject,
  putJsonObject
} from './r2.mjs';
import {
  reserveArtworkUpload,
  completeArtworkUpload,
  cancelArtworkUpload,
  generateArtworkFulfillmentRatios,
  loadArtworkManifest,
  saveArtworkManifest
} from './artwork-storage.mjs';
import {
  buildOwnSilviaInventory,
  productKeyFromVariationValues,
  normalizeSize,
  retailPriceForProductKey,
  SILVIA_REFERENCE_CAD_PER_USD,
  SILVIA_SALE_DISCOUNT_PERCENT
} from './variants.mjs';
import {
  FULFILLMENT_RATIOS,
  FULFILLMENT_RATIO_MIN_PIXELS,
  fulfillmentRatioObjectKey
} from './artwork-ratios.mjs';
import {
  createCropJob,
  getCropJob,
  claimNextCropJob,
  updateCropJobProgress,
  completeCropJob,
  failCropJob
} from './crop-job-store.mjs';
import { podProviderStatus, testPodProvider } from './pod-providers.mjs';
import { verifyEtsyWebhook, receiptReferenceFromEtsyResource } from './etsy-webhook.mjs';
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
  updateShopShippingProfileDestination,
  deleteShopShippingProfile,
  getShopReadinessStateDefinitions,
  getShopListings,
  getShopSections,
  getShopReturnPolicies,
  getShopProductionPartners,
  updateListingProperty,
  getPropertiesByTaxonomyId,
  getListingInventory,
  updateListingInventory,
  uploadListingImage,
  uploadListingVideo,
  updateListing,
  createDraftListing,
  getShopReceipt
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

function moneyAmount(value) {
  if (value && typeof value === 'object' && Number.isFinite(Number(value.amount))) {
    const divisor = Number(value.divisor || 100);
    return Number(value.amount) / divisor;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstPropertyValue(product, matcher) {
  const property = (product?.property_values || []).find(item =>
    matcher(String(item?.property_name || '').trim().toLowerCase())
  );
  return String(property?.values?.[0] || '').trim();
}

function productKeyForExistingInventoryProduct(product) {
  const properties = Array.isArray(product?.property_values) ? product.property_values : [];
  const values = properties.flatMap(property =>
    Array.isArray(property?.values) ? property.values.map(value => String(value || '').trim()) : []
  ).filter(Boolean);

  let sizeValue = firstPropertyValue(product, name => name === 'size' || name.includes('size'));
  if (!sizeValue) {
    sizeValue = values.find(value => Boolean(normalizeSize(value))) || '';
  }

  let styleValue = firstPropertyValue(product, name => name === 'product - style' || name.includes('style'));
  if (!styleValue) {
    styleValue = values.find(value => /framed\s*canvas|canvas|poster|paper|print/i.test(value)) || '';
  }

  let key = productKeyFromVariationValues(sizeValue, styleValue);
  if (key) return key;

  // Older/app-created listings may have a valid SAC SKU even when Etsy's
  // variation property names differ from the current Product Creator labels.
  const sku = String(product?.sku || '').trim().toUpperCase();
  const match = sku.match(/^SAC\d+-(P|C|FC)-(\d{3,4})(?:-(BLK|WHT|NAT|BRN|DWD))?$/);
  if (!match) return null;

  const [, format, digits, frameRaw] = match;
  const size = digits.length === 4
    ? `${Number(digits.slice(0, 2))}x${Number(digits.slice(2))}`
    : `${Number(digits.slice(0, 1))}x${Number(digits.slice(1))}`;
  let frame = frameRaw || 'NONE';
  if (frame === 'DWD') frame = 'BRN';
  if (format === 'FC' && frame === 'NONE') return null;
  return `${format}|${size}|${format === 'FC' ? frame : 'NONE'}`;
}

function priceSyncPlanForInventory(inventory) {
  const cloned = JSON.parse(JSON.stringify(inventory || {}));
  const changes = [];
  const skipped = [];

  for (const product of cloned.products || []) {
    const sizeValue = firstPropertyValue(product, name => name === 'size' || name.includes('size'));
    const styleValue = firstPropertyValue(product, name => name === 'product - style' || name.includes('style'));
    const productKey = productKeyForExistingInventoryProduct(product);

    if (!productKey) {
      skipped.push({ sku: String(product?.sku || ''), size: sizeValue, style: styleValue, reason: 'Unrecognized Silvia variation' });
      continue;
    }

    const targetUsd = retailPriceForProductKey(productKey);
    if (!(targetUsd > 0)) {
      skipped.push({ sku: String(product?.sku || ''), size: sizeValue, style: styleValue, productKey, reason: 'No configured Silvia retail price' });
      continue;
    }

    for (const offering of product.offerings || []) {
      const currentUsd = moneyAmount(offering?.price);
      if (currentUsd == null) continue;
      if (Math.abs(currentUsd - targetUsd) < 0.005) continue;

      changes.push({
        sku: String(product?.sku || ''),
        productKey,
        size: sizeValue,
        style: styleValue,
        currentUsd: Number(currentUsd.toFixed(2)),
        targetUsd: Number(targetUsd.toFixed(2)),
        targetRegularCad: Number((targetUsd * SILVIA_REFERENCE_CAD_PER_USD).toFixed(2)),
        targetSaleCad: Number((targetUsd * SILVIA_REFERENCE_CAD_PER_USD * (1 - SILVIA_SALE_DISCOUNT_PERCENT / 100)).toFixed(2))
      });
      offering.price = Number(targetUsd.toFixed(2));
    }
  }

  return {
    inventory: cloned,
    changes,
    skipped,
    changed: changes.length > 0
  };
}

async function allShopListingsForPriceSync(session) {
  const shopArgs = {
    shopId: session.shop.shop_id,
    keystring: session.keystring,
    sharedSecret: session.sharedSecret,
    accessToken: session.accessToken
  };
  const combined = [];
  for (const state of ['active', 'draft']) {
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await getShopListings({ ...shopArgs, state, limit: 100, offset });
      const items = page?.results || page || [];
      combined.push(...items.map(item => ({ ...item, state })));
      if (!Array.isArray(items) || items.length < 100) break;
    }
  }
  const seen = new Set();
  return combined.filter(item => {
    const id = Number(item?.listing_id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function buildExistingPriceSyncPreview(session) {
  const listings = await allShopListingsForPriceSync(session);
  const details = [];
  let variantChangeCount = 0;
  let skippedVariantCount = 0;
  let recognizedListingCount = 0;

  for (const listing of listings) {
    try {
      const inventory = await getListingInventory({
        listingId: listing.listing_id,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      });
      const plan = priceSyncPlanForInventory(inventory);
      const recognizableProducts = (inventory?.products || []).filter(product =>
        Boolean(productKeyForExistingInventoryProduct(product))
      );
      const recognized = recognizableProducts.length > 0;

      if (recognized) recognizedListingCount += 1;
      variantChangeCount += plan.changes.length;
      skippedVariantCount += plan.skipped.length;

      details.push({
        listingId: Number(listing.listing_id),
        title: String(listing.title || ''),
        state: String(listing.state || ''),
        recognized,
        canUpdate: recognized && plan.changes.length > 0,
        productCount: Array.isArray(inventory?.products) ? inventory.products.length : 0,
        recognizedProductCount: recognizableProducts.length,
        changeCount: plan.changes.length,
        skippedCount: plan.skipped.length,
        changes: plan.changes,
        skipped: plan.skipped,
        note: recognized
          ? (plan.changes.length ? '' : 'Recognized, but already matches the current price ladder.')
          : 'Could not map this listing to the Silvia size/style price ladder.'
      });
    } catch (error) {
      details.push({
        listingId: Number(listing.listing_id),
        title: String(listing.title || ''),
        state: String(listing.state || ''),
        recognized: false,
        canUpdate: false,
        productCount: 0,
        recognizedProductCount: 0,
        changeCount: 0,
        skippedCount: 0,
        error: error?.message || String(error)
      });
    }
  }

  return {
    shopListingCount: listings.length,
    listingCount: details.length,
    recognizedListingCount,
    unrecognizedListingCount: details.filter(item => !item.recognized).length,
    listingsWithChanges: details.filter(item => item.changeCount > 0).length,
    variantChangeCount,
    skippedVariantCount,
    listings: details
  };
}


const LISTING_CONVERTER_MAP_KEY = 'migrations/gelato-to-silvia-map-v1.json';

async function loadListingConverterMap() {
  try {
    if (!(await artworkObjectExists(LISTING_CONVERTER_MAP_KEY))) {
      return { version: 1, listings: {} };
    }
    const value = await getJsonObject(LISTING_CONVERTER_MAP_KEY);
    return {
      version: 1,
      ...value,
      listings: value?.listings && typeof value.listings === 'object' ? value.listings : {}
    };
  } catch {
    return { version: 1, listings: {} };
  }
}

async function saveListingConverterMap(map) {
  const next = {
    version: 1,
    ...map,
    updatedAt: new Date().toISOString(),
    listings: map?.listings && typeof map.listings === 'object' ? map.listings : {}
  };
  await putJsonObject(LISTING_CONVERTER_MAP_KEY, next);
  return next;
}

function firstListingImageUrl(image) {
  return image?.url_570xN
    || image?.url_fullxfull
    || image?.url_300x300
    || image?.url_170x135
    || null;
}

function readinessStateFromInventory(inventory) {
  for (const product of inventory?.products || []) {
    for (const offering of product?.offerings || []) {
      const value = Number(offering?.readiness_state_id);
      if (Number.isInteger(value) && value > 0) return value;
    }
  }
  return null;
}

function enabledInventoryProducts(inventory) {
  return (inventory?.products || []).filter(product =>
    (product?.offerings || []).some(offering => offering?.is_enabled)
  );
}

async function converterListingRows(session) {
  const listings = await allShopListingsForPriceSync(session);
  const converterMap = await loadListingConverterMap();

  const rows = await mapWithConcurrency(listings, 2, async listing => {
    let firstImageUrl = null;
    let imageCount = 0;
    let imageError = null;
    try {
      const images = await getEtsyListingImages({
        listingId: listing.listing_id,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      });
      imageCount = images.length;
      firstImageUrl = firstListingImageUrl(images[0]);
    } catch (error) {
      imageError = error?.message || String(error);
    }

    const mapping = converterMap.listings?.[String(listing.listing_id)] || null;
    return {
      listingId: Number(listing.listing_id),
      title: String(listing.title || ''),
      state: String(listing.state || ''),
      firstImageUrl,
      imageCount,
      imageError,
      artworkId: mapping?.artworkId || null,
      converted: mapping?.status === 'converted',
      conversionStatus: mapping?.status || 'not-linked',
      convertedAt: mapping?.convertedAt || null,
      lastReconvertedAt: mapping?.lastReconvertedAt || null,
      reconversionCount: Math.max(0, Number(mapping?.reconversionCount) || 0)
    };
  });

  return { listings: rows, converterMap };
}

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
  const source = decorateAdminHtml(html);
  // Every HTML response, including login, gets the current shop's favicon.
  const body = source.includes('href="/favicon.svg')
    ? source : source.replace(/<\/head>/i,
      '<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg?v=1"></head>');
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

const CROP_WORKER_HEARTBEAT_TTL_MS = 45 * 1000;
let cropWorkerHeartbeat = {
  workerId: '',
  version: '',
  busy: false,
  jobId: '',
  lastSeenAt: 0
};

function timingSafeTextEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isCropWorkerAuthorized(req) {
  const expected = String(process.env.CROP_WORKER_TOKEN || '').trim();
  if (!expected) return false;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  return timingSafeTextEqual(header.slice(7).trim(), expected);
}

function requireCropWorker(req, res) {
  if (isCropWorkerAuthorized(req)) return true;
  sendJson(res, 401, { ok: false, error: 'Invalid crop worker token.' });
  return false;
}

function recordCropWorkerHeartbeat(input = {}) {
  cropWorkerHeartbeat = {
    workerId: String(input.workerId || cropWorkerHeartbeat.workerId || '').trim(),
    version: String(input.version || cropWorkerHeartbeat.version || '').trim(),
    mockups: Number.parseInt(String(input.version || cropWorkerHeartbeat.version || '0').split('.')[0],10)>=4,
    busy: input.busy === true,
    jobId: String(input.jobId || '').trim(),
    lastSeenAt: Date.now()
  };
  return cropWorkerHeartbeat;
}

function cropWorkerStatus() {
  const configured = Boolean(String(process.env.CROP_WORKER_TOKEN || '').trim());
  const online = configured &&
    cropWorkerHeartbeat.lastSeenAt > 0 &&
    Date.now() - cropWorkerHeartbeat.lastSeenAt <= CROP_WORKER_HEARTBEAT_TTL_MS;
  return {
    configured,
    online,
    workerId: online ? cropWorkerHeartbeat.workerId : '',
    version: online ? cropWorkerHeartbeat.version : '',
    mockups: online ? cropWorkerHeartbeat.mockups===true : false,
    busy: online ? cropWorkerHeartbeat.busy : false,
    jobId: online ? cropWorkerHeartbeat.jobId : '',
    lastSeenAt: cropWorkerHeartbeat.lastSeenAt
      ? new Date(cropWorkerHeartbeat.lastSeenAt).toISOString()
      : null
  };
}

function cropTarget(ratio, orientation = 'portrait') {
  const base = FULFILLMENT_RATIO_MIN_PIXELS[ratio];
  if (!base) throw new Error(`Unsupported fulfillment ratio: ${ratio}`);
  const landscape = String(orientation || '').trim().toLowerCase() === 'landscape';
  return {
    width: landscape ? base[1] : base[0],
    height: landscape ? base[0] : base[1]
  };
}

function fulfillmentStatusKey(artworkId) {
  const id = String(artworkId || '').trim().toUpperCase();
  return `artworks/${id}/fulfillment/status.json`;
}

async function writeFulfillmentStatus(artworkId, patch = {}) {
  const id = String(artworkId || '').trim().toUpperCase();
  await putJsonObject(fulfillmentStatusKey(id), {
    artworkId: id,
    updatedAt: new Date().toISOString(),
    ...patch
  });
}

function callbackUrl() {
  return process.env.ETSY_REDIRECT_URI ||
    process.env.ETSY_CALLBACK_URL ||
    'https://silvia-sensaria-bridge.onrender.com/etsy/callback';
}

async function readRawBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const raw = (await readRawBody(req)).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}


async function readTrackingJsonBody(req) {
  const chunks=[];let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if(size>1_800_000) throw new Error('Tracking request exceeds 1.8MB; split the CSV report.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
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
  const canonicalCount = SILVIA_CANONICAL_CUSTOM_REMAP_15.length;
  if (values.length < canonicalCount) return values;
  const canonical = SILVIA_CANONICAL_CUSTOM_REMAP_15
    .map((index) => values[index])
    .filter(Boolean);
  return [...canonical, ...values.slice(canonicalCount)];
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

  let reference = currentMockupReference(session);
  if (!reference) {
    const shopArgs = {
      shopId: session.shop.shop_id,
      keystring: session.keystring,
      sharedSecret: session.sharedSecret,
      accessToken: session.accessToken
    };
    const listings = await getShopListings({ ...shopArgs, state: 'active', limit: 100 });
    const sourceListings = (listings.results || listings || []).map((listing) => ({
      listing_id: listing.listing_id,
      title: listing.title
    }));
    reference = await cacheRecentMockupReference(session, sourceListings);
  }

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
    throw new Error('No usable active Etsy listing was found to use as the locked mockup reference.');
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

  const requiredMatchedSlots = Math.min(customImages.length, referenceCustomImages.length);
  if (customImages.length >= 2 && (
    !sortResult.applied ||
    (sortResult.matches || []).length !== requiredMatchedSlots
  )) {
    throw new Error(
      `Exact mockup ordering could not be matched to #${reference.listingId}. ${sortResult.reason || 'The available template slots could not be matched reliably.'}`
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

// Read-only Etsy polling and recommendation preparation. Supplier purchasing is never invoked.
const AUTO_REVIEW_INTERVAL_MS=5*60*1000;
const AUTO_REVIEW_MAX_PER_CYCLE=5;
const AUTO_REVIEW_ENABLED=String(process.env.AUTO_FULFILLMENT_REVIEW_ENABLED||'true').toLowerCase()!=='false';
const pendingAutoReview=new Map();
let autoReviewTail=Promise.resolve(), autoReviewPolling=false;
let lastAutoReviewPoll=null, lastAutoReviewError='';
function scheduleAutomaticReview(receiptId,shopId){
  if(!AUTO_REVIEW_ENABLED)return Promise.resolve({status:'disabled'});
  const id=String(receiptId);
  if(pendingAutoReview.has(id))return pendingAutoReview.get(id);
  if(pendingAutoReview.size>=50)return Promise.resolve({status:'queue_full'});
  const task=autoReviewTail.then(()=>automaticallyPrepareReceipt(id,shopId))
    .catch(error=>{
      console.error('[automatic supplier review] '+id+': '+String(error.message||error));
      return {status:'error',receiptId:id};
    });
  pendingAutoReview.set(id,task);
  autoReviewTail=task.then(()=>{pendingAutoReview.delete(id);});
  return task;
}
async function reconcileNewEtsyPaidOrders(){
 if(!AUTO_REVIEW_ENABLED||autoReviewPolling)return;
 autoReviewPolling=true;
 try{
   const session=await getEtsySession();
   const shopId=Number(session.shop?.shop_id||0);
   if(!shopId)throw new Error('Cannot reconcile orders without an authorized Etsy shop.');
   const recent=await recentPaidReceipts(session,40);
   const reviewIds=recent.map(item=>String(item.receipt_id||''))
     .filter(id=>/^[1-9]\d{0,19}$/.test(id));
   const saved=Object.fromEntries(await Promise.all(reviewIds.map(async id=>[
     id,await optionalJson(reviewKey(id))
   ])));
   const toPrepare=selectAutomaticCandidates(recent,saved,AUTO_REVIEW_MAX_PER_CYCLE);
   for(const id of toPrepare){
     if(pendingAutoReview.has(id))continue;
     try{
       const receipt=await getShopReceipt({
         shopId,receiptId:id,keystring:session.keystring,
         sharedSecret:session.sharedSecret,accessToken:session.accessToken
       });
       if(!Array.isArray(receipt.transactions)||!receipt.transactions.length)
         receipt.transactions=await receiptTransactions(session,id);
       if(!receipt.transactions?.length)throw new Error('Etsy receipt has no readable transactions');
       if(receipt.was_paid!==true&&receipt.is_paid!==true)continue;
       if(receipt.is_shipped===true||receipt.was_shipped===true||receipt.was_canceled===true||receipt.is_canceled===true)continue;
       await recordImportedReceipt(receipt,shopId);
       void scheduleAutomaticReview(id,shopId);
     }catch(error){
       console.warn('[automatic Etsy sync] '+id+': '+String(error.message||error));
     }
   }
   lastAutoReviewPoll=new Date().toISOString();
   lastAutoReviewError='';
 }catch(error){
   lastAutoReviewError=String(error.message||error);
   console.warn('[automatic Etsy sync] '+lastAutoReviewError);
 }finally{autoReviewPolling=false;}
}

const server = http.createServer(async (req, res) => {
  // Photopea mockup batch endpoints are private and separate from Etsy fulfillment.
  const mockupUrl=new URL(req.url||'/', 'https://'+String(req.headers.host||'localhost'));
  if(mockupUrl.pathname==='/assets/crop-worker-auto.js'&&req.method==='GET'){
    if(!requireAdminApi(req,res))return;
    const js=readFileSync(new URL('./crop-worker-auto.js',import.meta.url));
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',
      'content-length':js.length,'cache-control':'private, no-store',
      'x-content-type-options':'nosniff'});
    res.end(js);return;
  }
  if(mockupUrl.pathname==='/assets/mockup-generator-client.js'){
    if(!requireAdminApi(req,res))return;
    const js=readFileSync(new URL('./mockup-generator-client.js',import.meta.url));
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',
      'content-length':js.length,'cache-control':'private, no-store',
      'x-content-type-options':'nosniff'});
    res.end(js);return;
  }
  if(await handleMockupAPI(req,res,mockupUrl,{
    authenticated:(request,response)=>isCropWorkerAuthorized(request)||requireAdminApi(request,response),
    workerAuthorized:isCropWorkerAuthorized,
    readJson:readJsonBody,sendJson
  }))return;

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/favicon.svg') {
    const svg = readFileSync(new URL('./favicon.svg', import.meta.url));
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-length': svg.length,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff'
    });
    return res.end(svg);
  }
  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    res.writeHead(302, { location:'/favicon.svg?v=1','cache-control':'public,max-age=3600' });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'silvia-sensaria-bridge' });
  }

  if (req.method === 'POST' && url.pathname === '/api/crop-worker/heartbeat') {
    if (!requireCropWorker(req, res)) return;
    try {
      const input = await readJsonBody(req);
      if (!String(input.workerId || '').trim()) {
        return sendJson(res, 400, { ok: false, error: 'workerId is required' });
      }
      return sendJson(res, 200, {
        ok: true,
        worker: recordCropWorkerHeartbeat(input)
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/crop-jobs/claim') {
    if (!requireCropWorker(req, res)) return;
    try {
      const input = await readJsonBody(req);
      const workerId = String(input.workerId || '').trim();
      if (!workerId) return sendJson(res, 400, { ok: false, error: 'workerId is required' });
      recordCropWorkerHeartbeat({ workerId, busy: false, version: input.version });

      const job = await claimNextCropJob(workerId);
      if (!job) return sendJson(res, 200, { ok: true, job: null });

      const uploadUrls = {};
      const targets = {};
      for (const ratio of job.ratios || FULFILLMENT_RATIOS) {
        const key = cropOutputKeyForJob(job, ratio);
        targets[ratio] = cropTarget(ratio, job.orientation);
        uploadUrls[ratio] = await signedArtworkUploadUrl(key, 'image/jpeg', 2 * 60 * 60);
      }

      recordCropWorkerHeartbeat({ workerId, busy: true, jobId: job.id });
      await writeFulfillmentStatus(job.artworkId, {
        status: 'claimed',
        jobId: job.id,
        workerId,
        progress: 0,
        message: 'Crop job claimed by shared workstation'
      }).catch(() => {});
      return sendJson(res, 200, {
        ok: true,
        job: {
          ...job,
          masterDownloadUrl: await signedArtworkUrl(job.masterKey, 2 * 60 * 60),
          uploadUrls,
          targets
        }
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  {
    const progressMatch = /^\/api\/crop-jobs\/([^/]+)\/progress$/.exec(url.pathname);
    if (req.method === 'POST' && progressMatch) {
      if (!requireCropWorker(req, res)) return;
      try {
        const input = await readJsonBody(req);
        const workerId = String(input.workerId || '').trim();
        const jobId = decodeURIComponent(progressMatch[1]);
        recordCropWorkerHeartbeat({ workerId, busy: true, jobId, version: input.version });
        const job = await updateCropJobProgress(jobId, workerId, input);
        await writeFulfillmentStatus(job.artworkId, {
          status: job.status,
          jobId: job.id,
          workerId,
          progress: job.progress,
          currentRatio: job.currentRatio || '',
          completedRatios: job.completedRatios || [],
          message: job.message || ''
        }).catch(() => {});
        return sendJson(res, 200, { ok: true, job });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
    }
  }

  {
    const completeMatch = /^\/api\/crop-jobs\/([^/]+)\/complete$/.exec(url.pathname);
    if (req.method === 'POST' && completeMatch) {
      if (!requireCropWorker(req, res)) return;
      try {
        const input = await readJsonBody(req);
        const workerId = String(input.workerId || '').trim();
        const jobId = decodeURIComponent(completeMatch[1]);
        const currentJob = await getCropJob(jobId);
        if (!currentJob) return sendJson(res, 404, { ok: false, error: 'Crop job not found' });

        const manifest = await loadArtworkManifest(currentJob.artworkId);
        if (isStagedRevisionJob(currentJob)) {
          if (!manifest?.master?.key || !(await artworkObjectExists(currentJob.masterKey)))
            throw new Error('Staged replacement master missing while crop job was running');
        } else if (!manifest?.master?.key || manifest.master.key !== currentJob.masterKey) {
          throw new Error('Artwork master changed while crop job was running');
        }

        const assets = {};
        for (const ratio of currentJob.ratios || FULFILLMENT_RATIOS) {
          const result = input.assets?.[ratio];
          if (!result) throw new Error(`Worker did not return ${ratio} output metadata`);
          const target = cropTarget(ratio, currentJob.orientation);
          const width = Number(result.width || 0);
          const height = Number(result.height || 0);
          if (width !== target.width || height !== target.height) {
            throw new Error(
              `${ratio} output is ${width}×${height}; expected ${target.width}×${target.height}`
            );
          }
          const key = cropOutputKeyForJob(currentJob, ratio);
          if (!(await artworkObjectExists(key))) {
            throw new Error(`Uploaded ${ratio} crop is missing from R2`);
          }
          assets[ratio] = {
            ratio,
            key,
            width,
            height,
            requiredWidth: target.width,
            requiredHeight: target.height,
            orientation: currentJob.orientation,
            productionReady: true,
            generatedFromMaster: true,
            cropMode: 'center',
            sourceMasterKey: currentJob.masterKey,
            density: Number(result.density || 300),
            sizeBytes: Number(result.sizeBytes || 0) || null,
            upscaled: result.upscaled === true,
            updatedAt: new Date().toISOString()
          };
        }

        if (!isStagedRevisionJob(currentJob)) {
        manifest.fulfillmentRatios = assets;
        manifest.fulfillmentRatioInsufficient = {};
        manifest.fulfillmentRatiosReady = FULFILLMENT_RATIOS.every(
          ratio => Boolean(assets[ratio]?.productionReady)
        );
        manifest.fulfillmentRatiosUpdatedAt = new Date().toISOString();
        manifest.cropWorkerJobId = currentJob.id;
        await saveArtworkManifest(manifest);

        }
        const job = await completeCropJob(jobId, workerId, assets);
        if (!isStagedRevisionJob(currentJob)) await writeFulfillmentStatus(currentJob.artworkId, {
          status: 'completed',
          jobId: currentJob.id,
          workerId,
          progress: 100,
          completedRatios: currentJob.ratios || FULFILLMENT_RATIOS,
          assets
        }).catch(() => {});
        recordCropWorkerHeartbeat({ workerId, busy: false });
        return sendJson(res, 200, { ok: true, job });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
    }
  }

  {
    const failMatch = /^\/api\/crop-jobs\/([^/]+)\/fail$/.exec(url.pathname);
    if (req.method === 'POST' && failMatch) {
      if (!requireCropWorker(req, res)) return;
      try {
        const input = await readJsonBody(req);
        const workerId = String(input.workerId || '').trim();
        const job = await failCropJob(
          decodeURIComponent(failMatch[1]),
          workerId,
          input.error
        );
        await writeFulfillmentStatus(job.artworkId, {
          status: 'failed',
          jobId: job.id,
          workerId,
          progress: job.progress || 0,
          error: job.error || input.error || 'Crop worker failed',
          message: job.message || ''
        }).catch(() => {});
        recordCropWorkerHeartbeat({ workerId, busy: false });
        return sendJson(res, 200, { ok: true, job });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/crop-worker/status') {
    if (!requireAdminApi(req, res)) return;
    return sendJson(res, 200, { ok: true, worker: cropWorkerStatus() });
  }

  if (req.method === 'POST' && url.pathname === '/api/crop-jobs') {
    if (!requireAdminApi(req, res)) return;
    try {
      const input = await readJsonBody(req);
      const artworkId = String(input.artworkId || '').trim().toUpperCase();
      const manifest = await loadArtworkManifest(artworkId);
      if (!manifest?.master?.key || manifest.status !== 'ready') {
        throw new Error(`Artwork ${artworkId} must be fully uploaded before queueing crops`);
      }
      const orientation = String(input.orientation || manifest.orientation || 'portrait').trim().toLowerCase();
      const created = await createCropJob({
        artworkId,
        masterKey: manifest.master.key,
        orientation
      });
      manifest.cropWorkerJobId = created.job.id;
      manifest.cropWorkerQueuedAt = new Date().toISOString();
      await saveArtworkManifest(manifest);
      await writeFulfillmentStatus(artworkId, {
        status: created.job.status || 'pending',
        jobId: created.job.id,
        progress: created.job.progress || 0,
        completedRatios: created.job.completedRatios || [],
        message: created.job.message || 'Waiting for shared crop workstation'
      }).catch(() => {});
      return sendJson(res, created.reused ? 200 : 201, {
        ok: true,
        ...created,
        worker: cropWorkerStatus()
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  {
    const jobMatch = /^\/api\/crop-jobs\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && jobMatch) {
      if (!requireAdminApi(req, res)) return;
      try {
        const job = await getCropJob(decodeURIComponent(jobMatch[1]));
        if (!job) return sendJson(res, 404, { ok: false, error: 'Crop job not found' });
        const previews = {};
        if (job.status === 'completed') {
          for (const [ratio, asset] of Object.entries(job.resultAssets || {})) {
            if (asset?.key) previews[ratio] = await signedArtworkUrl(asset.key, 60 * 60);
          }
        }
        return sendJson(res, 200, {
          ok: true,
          job,
          previews,
          worker: cropWorkerStatus()
        });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
    }
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
      const session = await getEtsySession({ forceRefresh: true });
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
      const session = await getEtsySession({ forceRefresh: true });
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

      const domestic = shippingProfileDefaults.domesticDelivery || { minDays: 2, maxDays: 6 };
      const international = shippingProfileDefaults.internationalDelivery || { minDays: 2, maxDays: 6 };

      if (existing) {
        const currentDestinations = Array.isArray(existing.shipping_profile_destinations)
          ? existing.shipping_profile_destinations
          : [];
        const byCountry = new Map(
          currentDestinations
            .filter((item) => item?.destination_country_iso)
            .map((item) => [String(item.destination_country_iso).toUpperCase(), item])
        );

        const updatedDestinations = [];
        const createdDestinations = [];
        for (const countryIso of requested) {
          const timing = countryIso === 'CA' ? domestic : international;
          const current = byCountry.get(countryIso);
          if (current?.shipping_profile_destination_id) {
            await updateShopShippingProfileDestination({
              ...shopArgs,
              shippingProfileId: existing.shipping_profile_id,
              shippingProfileDestinationId: current.shipping_profile_destination_id,
              primaryCost: shippingProfileDefaults.primaryCost ?? 0,
              secondaryCost: shippingProfileDefaults.secondaryCost ?? 0,
              minDeliveryDays: timing.minDays,
              maxDeliveryDays: timing.maxDays
            });
            updatedDestinations.push(countryIso);
          } else {
            await createShopShippingProfileDestination({
              ...shopArgs,
              shippingProfileId: existing.shipping_profile_id,
              destinationCountryIso: countryIso,
              primaryCost: shippingProfileDefaults.primaryCost ?? 0,
              secondaryCost: shippingProfileDefaults.secondaryCost ?? 0,
              minDeliveryDays: timing.minDays,
              maxDeliveryDays: timing.maxDays
            });
            createdDestinations.push(countryIso);
          }
        }

        return sendJson(res, 200, {
          ok: true,
          updatedExisting: true,
          shippingProfileId: existing.shipping_profile_id,
          destinationCount: requested.length,
          updatedDestinations,
          createdDestinations,
          minDeliveryDays: 2,
          maxDeliveryDays: 6,
          profile: existing
        });
      }
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

  if(req.method==='GET'&&url.pathname==='/api/fulfillment-auto/status'){
    if(!requireAdminApi(req,res))return;
    return sendJson(res,200,{ok:true,enabled:AUTO_REVIEW_ENABLED,
      pending:pendingAutoReview.size,lastPolledAt:lastAutoReviewPoll,
      lastError:lastAutoReviewError,pollIntervalMinutes:AUTO_REVIEW_INTERVAL_MS/60000,
      orderPurchasingEnabled:false});
  }
  // Regular fulfillment phase 1: shop-scoped recommendations and approval ONLY.
  // No endpoint below buys anything from a supplier or completes an Etsy shipment.
  if(req.method==='GET' && url.pathname==='/fulfillment-review'){
    if(!requireAdminPage(req,res,'/fulfillment-review'))return;
    return sendHtml(res,200,renderFulfillmentReviewPage('Silvia Art Collective'));
  }
  const regularRoute=url.pathname.match(/^\/api\/fulfillment-review\/([1-9]\d{0,19})(?:\/(prepare|approve))?$/);
  if(regularRoute && req.method==='GET' && !regularRoute[2]){
    if(!requireAdminApi(req,res))return;
    try{
      const data=await readOrder(regularRoute[1]);
      return sendJson(res,200,{ok:true,review:data.review||null,summary:data.summary});
    }catch(error){return sendJson(res,404,{ok:false,error:String(error.message||error)});}
  }
  if(regularRoute && req.method==='POST' && regularRoute[2]){
    if(!requireAdminApi(req,res))return;
    const origin=String(req.headers.origin||'');
    const expected=(req.headers['x-forwarded-proto']||'https')+'://'+String(req.headers.host||'');
    if((origin&&origin!==expected)||req.headers['sec-fetch-site']==='cross-site')
      return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))
      return sendJson(res,415,{ok:false,error:'JSON request required.'});
    try{
      const id=regularRoute[1],action=regularRoute[2],body=await readJsonBody(req);
      const session=await getEtsySession();
      const shopId=Number(session.shop.shop_id);
      const scopes=new Set(String(session.scope||'').split(/\s+/));
      if(!scopes.has('transactions_r'))
        return sendJson(res,403,{ok:false,error:'Etsy transactions_r permission required.'});
      // Always refresh actual Etsy payment, address, and transaction details before
      // planning or approving a supplier. An old webhook alone is insufficient.
      const latest=await getShopReceipt({
        shopId,receiptId:id,keystring:session.keystring,
        sharedSecret:session.sharedSecret,accessToken:session.accessToken
      });
      if(!Array.isArray(latest.transactions)||!latest.transactions.length)
        latest.transactions=await receiptTransactions(session,id);
      if(latest.was_paid!==true && latest.is_paid!==true)
        throw new Error('Etsy does not explicitly show this receipt as paid.');
      if(latest.was_shipped===true||latest.is_shipped===true)
        throw new Error('This Etsy order has already shipped. No supplier placement is needed.');
      await recordImportedReceipt(latest,shopId);
      if(action==='prepare')
        return sendJson(res,200,{ok:true,...await prepareRegularRoute(id,shopId)});
      if(action==='approve')
        return sendJson(res,200,{ok:true,review:await approveRegularRoute(id,shopId,body)});
    }catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
  }

  // Private, read-only Etsy staging plus explicit human supplier approval.
  // No route here submits orders to Printify, Gelato, Prodigi, Sensaria, Artelo or PrintShrimp.
  if (req.method === 'GET' && url.pathname === '/orders') {
    if (!requireAdminPage(req, res, '/orders')) return;
    return sendHtml(res, 200, renderOrdersPage());
  }
  if (req.method === 'GET' && url.pathname === '/orders-client.js') {
    if (!requireAdminApi(req, res)) return;
    const js = readFileSync(new URL('./orders-client.js', import.meta.url), 'utf8');
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
    });
    return res.end(js);
  }
  if (req.method === 'GET' && url.pathname === '/custom-orders') {
    if (!requireAdminPage(req, res, '/custom-orders')) return;
    return sendHtml(res, 200, renderCustomOrdersPage());
  }
  if (req.method === 'GET' && url.pathname === '/custom-orders-client.js') {
    if (!requireAdminApi(req, res)) return;
    const js = readFileSync(new URL('./custom-orders-client.js', import.meta.url), 'utf8');
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return res.end(js);
  }
  if (req.method === 'GET' && url.pathname === '/api/custom-orders/artworks') {
    if (!requireAdminApi(req, res)) return;
    try {
      const keys = await listArtworkManifestKeys();
      const rows = [];
      for (let i = 0; i < keys.length; i += 12) {
        const page = await Promise.all(keys.slice(i, i + 12).map(async key => {
          try {
            const manifest = await getJsonObject(key);
            if (!/^SAC[0-9]{4,}$/.test(String(manifest?.artworkId || '')) ||
                manifest.status !== 'ready' || !manifest.master?.key) return null;
            return {
              artworkId: manifest.artworkId,
              title: String(manifest.title || ''),
              orientation: String(manifest.orientation || ''),
              masterReady: Boolean(await artworkObjectExists(manifest.master.key))
            };
          } catch { return null; }
        }));
        rows.push(...page.filter(Boolean));
      }
      rows.sort((a,b)=> a.artworkId.localeCompare(b.artworkId,undefined,{numeric:true}));
      return sendJson(res, 200, { ok: true, artworks: rows });
    } catch(error) {
      return sendJson(res, 500, { ok: false, error: String(error.message || error) });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/orders') {
    if (!requireAdminApi(req, res)) return;
    try {
      if(AUTO_REVIEW_ENABLED && !autoReviewPolling &&
         (!lastAutoReviewPoll || Date.now()-Date.parse(lastAutoReviewPoll)>120000))
        void reconcileNewEtsyPaidOrders();
      return sendJson(res,200,{ok:true,...(await listOrders())});
    }
    catch (error) { return sendJson(res, 500, { ok: false, error: String(error.message || error) }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/custom-orders') {
    if (!requireAdminApi(req, res)) return;
    try {
      const data = await listOrders();
      const custom = data.orders.filter(order => order.classification === 'custom' ||
        (order.classification === 'unclassified' && order.inference?.categoryHint === 'possible_custom'));
      return sendJson(res, 200, { ok: true, orders: custom, count: custom.length, stagedCount: data.count,
        truncated: data.truncated });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: String(error.message || error) });
    }
  }
  const customOrderRoute = url.pathname.match(/^\/api\/custom-orders\/([1-9]\d{0,19})(?:\/(quote|plan|classify|approve|mark-ordered))?$/);
  if (req.method === 'POST' && (url.pathname === '/api/custom-orders/import' || url.pathname === '/api/custom-orders/sync' || customOrderRoute)) {
    if (!requireAdminApi(req, res)) return;
    const origin = String(req.headers.origin || '');
    const expectedOrigin = (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
    if ((origin && origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') {
      return sendJson(res, 403, { ok: false, error: 'Cross-site request blocked.' });
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
      return sendJson(res, 415, { ok: false, error: 'JSON request required.' });
    }
    try {
      const body = await readJsonBody(req);
      if (url.pathname === '/api/custom-orders/sync') {
        const session = await getEtsySession();
        const receipts = await recentPaidReceipts(session, 15);
        const imported = [];
        const failures = [];
        for (const item of receipts) {
          try {
            const receipt = await getShopReceipt({
              shopId: session.shop.shop_id, receiptId: item.receipt_id,
              keystring: session.keystring, sharedSecret: session.sharedSecret,
              accessToken: session.accessToken
            });
            if (!Array.isArray(receipt.transactions) || !receipt.transactions.length) {
              receipt.transactions = await receiptTransactions(session, item.receipt_id);
            }
            const staged=await recordImportedReceipt(receipt,session.shop.shop_id);
            imported.push(staged.receiptId);
            void scheduleAutomaticReview(staged.receiptId,session.shop.shop_id);
          } catch (error) {
            failures.push({ receiptId: String(item.receipt_id || ''), error: String(error.message || error) });
          }
        }
        return sendJson(res, 200, { ok: true, imported, failures,
          note: 'Synced only paid Etsy receipts. No supplier orders submitted.' });
      }
      if (url.pathname === '/api/custom-orders/import') {
        const receiptId = String(body.receiptId || '').trim();
        if (!/^[1-9]\d{0,19}$/.test(receiptId)) throw new Error('Valid Etsy receipt ID required.');
        const session = await getEtsySession();
        const shopId = Number(session.shop.shop_id);
        const receipt = await getShopReceipt({
          shopId, receiptId, keystring: session.keystring,
          sharedSecret: session.sharedSecret, accessToken: session.accessToken
        });
        if (!Array.isArray(receipt.transactions) || !receipt.transactions.length) {
          receipt.transactions = await receiptTransactions(session, receiptId);
        }
        const staged=await recordImportedReceipt(receipt,shopId);
        void scheduleAutomaticReview(staged.receiptId,shopId);
        return sendJson(res,200,{ok:true,summary:staged,automaticRecommendation:'queued'});
      }
      const [, id, action] = customOrderRoute;
      if (action === 'classify') return sendJson(res, 200, { ok: true, review: await classify(id, body.classification) });
      if (action === 'quote') return sendJson(res, 200, { ok: true, ...(await quote(id, body)) });
      if (action === 'plan') return sendJson(res, 200, { ok: true, review: await savePlan(id, body) });
      if (action === 'mark-ordered') return sendJson(res, 200, { ok: true, review: await markOrdered(id, body) });
      if (action === 'approve') {
        const previous = await readOrder(id);
        const session = await getEtsySession();
        const shopId = Number(session.shop.shop_id);
        const latest = await getShopReceipt({
          shopId, receiptId: id, keystring: session.keystring,
          sharedSecret: session.sharedSecret, accessToken: session.accessToken
        });
        if (!Array.isArray(latest.transactions) || !latest.transactions.length) {
          latest.transactions = await receiptTransactions(session, id);
          if (!latest.transactions.length) {
            latest.transactions = previous.staged.receipt?.transactions || [];
          }
        }
        await recordImportedReceipt(latest, shopId);
        return sendJson(res, 200, { ok: true, review: await approve(id, body) });
      }
      return sendJson(res, 400, { ok: false, error: 'Unsupported custom order action.' });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error.message || error) });
    }
  }
  if (req.method === 'GET' && customOrderRoute && !customOrderRoute[2]) {
    if (!requireAdminApi(req, res)) return;
    try { return sendJson(res, 200, { ok: true, ...(await readOrder(customOrderRoute[1])) }); }
    catch (error) { return sendJson(res, 404, { ok: false, error: String(error.message || error) }); }
  }

  if (req.method === 'GET' && url.pathname === '/description-updater') {
    if (!requireAdminPage(req, res, '/description-updater')) return;
    return sendHtml(res, 200, renderDescriptionUpdaterPage());
  }

  if (req.method === 'GET' && url.pathname === '/description-updater-client.js') {
    if (!requireAdminApi(req, res)) return;
    const script = readFileSync(new URL('./description-updater-client.js', import.meta.url), 'utf8');
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    return res.end(script);
  }

  if (req.method === 'POST' && url.pathname === '/api/description-updater/preview') {
    if (!requireAdminApi(req, res)) return;
    if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
      return sendJson(res, 415, { ok: false, error: 'JSON request required.' });
    }
    try {
      const body = await readJsonBody(req);
      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_r')) {
        return sendJson(res, 403, { ok: false, error: 'Etsy listings_r permission required.' });
      }
      return sendJson(res, 200, {
        ok: true,
        ...(await previewDescriptionUpdates(session, {
          findText: body.findText, replaceText: body.replaceText
        }))
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error?.message || error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/description-updater/preview') {
    if (!requireAdminApi(req, res)) return;
    try {
      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_r')) {
        return sendJson(res, 403, { ok: false, error: 'Etsy listings_r permission required.' });
      }
      return sendJson(res, 200, { ok: true, ...(await previewDescriptionUpdates(session)) });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: String(error?.message || error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/description-updater/apply') {
    if (!requireAdminApi(req, res)) return;
    const origin = String(req.headers.origin || '');
    const expectedOrigin = String(req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
    if ((origin && origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') {
      return sendJson(res, 403, { ok: false, error: 'Cross-site request blocked.' });
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
      return sendJson(res, 415, { ok: false, error: 'JSON request required.' });
    }
    try {
      const body = await readJsonBody(req);
      if (body.confirm !== 'UPDATE DESCRIPTIONS') {
        return sendJson(res, 400, { ok: false, error: 'Explicit update confirmation required.' });
      }
      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_w') || !scopes.has('listings_r')) {
        return sendJson(res, 403, { ok: false, error: 'Etsy listings_r and listings_w required.' });
      }
      return sendJson(res, 200, { ok: true, ...(await applyDescriptionUpdates(session, body.selections, { findText: body.findText, replaceText: body.replaceText })) });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error?.message || error) });
    }
  }


  // CSV import is review-only. Etsy shipment updates have a separate guarded approval action.
  if (req.method === 'GET' && url.pathname === '/tracking') {
    if (!requireAdminPage(req, res, '/tracking')) return;
    return sendHtml(res, 200, renderTrackingPage(TRACKING_SHOP_NAME));
  }
  if (req.method === 'GET' && url.pathname === '/tracking-client.js') {
    if (!requireAdminApi(req, res)) return;
    const js=readFileSync(new URL('./tracking-client.js',import.meta.url),'utf8');
    res.writeHead(200,{'content-type':'application/javascript; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'});
    return res.end(js);
  }
  if (req.method === 'GET' && url.pathname === '/api/tracking/orders') {
    if (!requireAdminApi(req,res)) return;
    try {
      const session=await getEtsySession({forceRefresh:true});
      return sendJson(res,200,{ok:true,...(await listTrackingRecords(session))});
    }catch(error){return sendJson(res,502,{ok:false,error:String(error.message||error)});}
  }
  if (req.method === 'POST' && /^\/api\/tracking\/(link|check-supplier|check-etsy|csv-preview|csv-import|send-etsy)$/.test(url.pathname)) {
    if (!requireAdminApi(req,res)) return;
    const origin=String(req.headers.origin||'');
    const host=String(req.headers.host||'');
    if(!host || (origin && origin!==(String(req.headers['x-forwarded-proto']||'https')+'://'+host)) ||
       req.headers['sec-fetch-site']==='cross-site')
      return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))
      return sendJson(res,415,{ok:false,error:'JSON request required.'});
    let body;
    try {body=await readTrackingJsonBody(req);}
    catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
    try {
      const session=await getEtsySession({forceRefresh:true});
      const scopes=new Set(String(session.scope||'').split(/\s+/).filter(Boolean));
      if(!scopes.has('transactions_r')) return sendJson(res,403,{ok:false,error:'Etsy transactions_r access required.'});
      if(url.pathname==='/api/tracking/send-etsy'){
        if(!scopes.has('transactions_w'))
          return sendJson(res,403,{ok:false,error:'Etsy transactions_w scope required.'});
        return sendJson(res,200,{ok:true,...await sendStagedShipmentToEtsy(session,body)});
      }
      if(url.pathname==='/api/tracking/link'){
        const record=await linkTrackingOrder(session,body);
        return sendJson(res,200,{ok:true,record});
      }
      if(url.pathname==='/api/tracking/check-supplier'){
        return sendJson(res,200,{ok:true,...(await checkSupplierTracking(session,body.receiptId))});
      }
      if(url.pathname==='/api/tracking/check-etsy'){
        const record=await checkEtsyShipmentStatus(session,body.receiptId);
        return sendJson(res,200,{ok:true,record});
      }
      if(url.pathname==='/api/tracking/csv-preview'){
        const docs=await listTrackingRecords(session);
        return sendJson(res,200,{ok:true,...sensariaCandidates(body.csv,docs.records)});
      }
      if(url.pathname==='/api/tracking/csv-import'){
        if(body.confirm!=='IMPORT TRACKING')throw new Error('Explicit CSV import confirmation required.');
        const docs=await listTrackingRecords(session);
        const {rows,skipped}=sensariaCandidates(body.csv,docs.records);
        const chosen=Array.isArray(body.selected)?body.selected:[];
        if(!chosen.length||chosen.length>30)throw new Error('Select 1–30 shipments per import.');
        const unique=new Set(),errors=[];let saved=0,duplicates=0;
        for(const selection of chosen){
          const k=String(selection.receiptId)+'|'+String(selection.trackingNumber).toUpperCase();
          if(unique.has(k)){errors.push({receiptId:selection.receiptId,error:'Duplicate selection'});continue;}
          unique.add(k);
          const item=rows.find(v=>v.receiptId===String(selection.receiptId)&&
            v.trackingNumber.toUpperCase()===String(selection.trackingNumber).toUpperCase());
          if(!item){errors.push({receiptId:selection.receiptId,error:'Shipment not in the verified preview.'});continue;}
          if(!String(selection.carrier||'').trim()){errors.push({receiptId:item.receiptId,error:'Carrier not confirmed.'});continue;}
          try{
            const data=await stageShipment(session,{...item,carrier:String(selection.carrier).trim()});
            if(data.duplicate)duplicates++;else saved++;
          }catch(error){errors.push({receiptId:item.receiptId,error:String(error.message||error)});}
        }
        return sendJson(res,200,{ok:true,saved,duplicates,failed:errors.length,errors,
          skippedRows:skipped.length,etsySubmitted:false});
      }
    }catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
  }

  if (req.method === 'GET' && url.pathname === '/custom-size') {
    if (!requireAdminPage(req, res, '/custom-size')) return;
    return sendHtml(res, 200, renderCustomSizeLookupPage());
  }

  if (req.method === 'POST' && url.pathname === '/api/custom-size/lookup') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await lookupCustomSize(body));
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: error?.message || String(error)
      });
    }
  }

  // Deliberately admin-only and explicitly confirmed: this may create
  // temporary UNPUBLISHED Printify draft products, never orders or listings.
  if (req.method === 'POST' && url.pathname === '/api/printify/pricing-library/build') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await buildPrintifyCostsForRequest(body));
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: error?.message || String(error)
      });
    }
  }

  if (req.method === 'GET' && url.pathname === '/compare') {
    if (!requireAdminPage(req, res, '/compare')) return;
    const providers = podProviderStatus();
    return sendHtml(res, 200, renderSupplierComparisonPage({
      configured: {
        sensaria: Boolean(providers?.Sensaria?.ready),
        prodigi: Boolean(providers?.Prodigi?.ready),
        printshrimp: Boolean(providers?.PrintShrimp?.ready),
        printify: Boolean(providers?.Printify?.ready),
        gelato: Boolean(providers?.Gelato?.ready),
        artelo: Boolean(providers?.Artelo?.ready)
      }
    }));
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

  if (req.method === 'GET' && url.pathname === '/api/pricing/listings-preview') {
    if (!requireAdminApi(req, res)) return;
    try {
      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_r')) {
        return sendJson(res, 403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy to grant listings_r before previewing existing listing prices.'
        });
      }
      const preview = await buildExistingPriceSyncPreview(session);
      return sendJson(res, 200, {
        ok: true,
        saleDiscountPercent: SILVIA_SALE_DISCOUNT_PERCENT,
        referenceCadPerUsd: SILVIA_REFERENCE_CAD_PER_USD,
        ...preview
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/pricing/sync-listings') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      if (String(body.confirm || '') !== 'UPDATE SILVIA PRICES') {
        return sendJson(res, 400, {
          ok: false,
          error: 'Explicit confirmation is required before changing live Etsy listing prices.'
        });
      }

      const requestedListingIds = Array.from(new Set(
        (Array.isArray(body.listingIds) ? body.listingIds : [])
          .map(value => Number(value))
          .filter(value => Number.isInteger(value) && value > 0)
      ));
      if (!requestedListingIds.length) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Select at least one Etsy listing to update.'
        });
      }
      const requestedSet = new Set(requestedListingIds);

      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_r') || !scopes.has('listings_w')) {
        return sendJson(res, 403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy with listings_r and listings_w before syncing prices.'
        });
      }

      const listings = (await allShopListingsForPriceSync(session))
        .filter(listing => requestedSet.has(Number(listing.listing_id)));

      const foundIds = new Set(listings.map(listing => Number(listing.listing_id)));
      const missingListingIds = requestedListingIds.filter(id => !foundIds.has(id));
      const results = [];
      let updatedListings = 0;
      let updatedVariants = 0;

      for (const listing of listings) {
        try {
          const inventory = await getListingInventory({
            listingId: listing.listing_id,
            keystring: session.keystring,
            sharedSecret: session.sharedSecret,
            accessToken: session.accessToken
          });
          const plan = priceSyncPlanForInventory(inventory);
          if (!plan.changed) {
            results.push({
              listingId: Number(listing.listing_id),
              title: String(listing.title || ''),
              state: String(listing.state || ''),
              updatedVariants: 0,
              skipped: true,
              note: 'No mapped variant price changes were available for this listing.'
            });
            continue;
          }

          await withEtsyListingRetry(() => updateListingInventory({
            listingId: listing.listing_id,
            inventory: plan.inventory,
            keystring: session.keystring,
            sharedSecret: session.sharedSecret,
            accessToken: session.accessToken
          }));

          const verifiedInventory = await getListingInventory({
            listingId: listing.listing_id,
            keystring: session.keystring,
            sharedSecret: session.sharedSecret,
            accessToken: session.accessToken
          });
          const verification = priceSyncPlanForInventory(verifiedInventory);
          if (verification.changed) {
            throw new Error(
              `Etsy accepted the inventory request, but ${verification.changes.length} mapped prices still do not match the current ladder.`
            );
          }

          updatedListings += 1;
          updatedVariants += plan.changes.length;
          results.push({
            listingId: Number(listing.listing_id),
            title: String(listing.title || ''),
            state: String(listing.state || ''),
            updatedVariants: plan.changes.length,
            verified: true,
            changes: plan.changes
          });
        } catch (error) {
          results.push({
            listingId: Number(listing.listing_id),
            title: String(listing.title || ''),
            state: String(listing.state || ''),
            error: error?.message || String(error)
          });
        }
      }

      return sendJson(res, 200, {
        ok: true,
        requestedListings: requestedListingIds.length,
        updatedListings,
        updatedVariants,
        failedListings: results.filter(item => item.error).length,
        missingListingIds,
        saleDiscountPercent: SILVIA_SALE_DISCOUNT_PERCENT,
        referenceCadPerUsd: SILVIA_REFERENCE_CAD_PER_USD,
        results
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/suppliers/compare') {
    if (!requireAdminApi(req, res)) return;
    try {
      const countriesParam = String(url.searchParams.get('countries') || 'CA').trim();
      const countryCodes = countriesParam.split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
      const productsParam = String(url.searchParams.get('products') || 'P,C,FC').trim();
      const productCodes = productsParam.split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
      const copiesRaw = Number(url.searchParams.get('copies') || 1);
      const copies = Number.isInteger(copiesRaw) && copiesRaw > 0 ? copiesRaw : 1;
      const shippingMethod = String(url.searchParams.get('shippingMethod') || '').trim() || undefined;
      return sendJson(res, 200, await scanSupplierComparison({
        countryCodes,
        productCodes,
        copies,
        shippingMethod,
        sensariaProducts: products
      }));
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error?.message || String(error) });
    }
  }


  const reposterArtworkRoute=url.pathname.match(/^\/api\/reposter\/([1-9]\d{0,19})\/artwork(?:\/(reserve|crop|status))?$/);
  if(reposterArtworkRoute){
    if(!requireAdminApi(req,res))return;
    if(!['GET','POST'].includes(req.method))return sendJson(res,405,{ok:false,error:'Unsupported method'});
    const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
    if(req.method==='POST' && (!host||(origin&&origin!==String(req.headers['x-forwarded-proto']||'https')+'://'+host)||
       req.headers['sec-fetch-site']==='cross-site'))
      return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    try{
      const session=await getEtsySession({forceRefresh:true});
      const scopes=new Set(String(session.scope||'').split(/\s+/));
      const action=reposterArtworkRoute[2]||'status',id=reposterArtworkRoute[1];
      if(action==='status'&&req.method==='GET')
        return sendJson(res,200,{ok:true,revision:await getArtworkRevisionStatus(session.shop.shop_id,id),
          worker:cropWorkerStatus()});
      if(req.method!=='POST')return sendJson(res,405,{ok:false,error:'POST required'});
      if(!scopes.has('listings_r')||!scopes.has('listings_w')||!scopes.has('transactions_r'))
        return sendJson(res,403,{ok:false,error:'Etsy listings_r, listings_w and transactions_r scopes required'});
      if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))
        return sendJson(res,415,{ok:false,error:'JSON request required'});
      const source=await getDetails(session,id);
      if(source.assessment.status!=='review_renewals'||source.listing.state!=='active')
        throw Error('This original listing is not a verified zero-sale repost candidate.');
      const body=await readJsonBody(req);
      if(action==='reserve'){
        const inventory=await getListingInventory({listingId:id,
          shopId:session.shop.shop_id,keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken});
        return sendJson(res,200,{ok:true,...await reserveArtworkRevision({
          shopId:session.shop.shop_id,listingId:id,inventory,file:body.file})});
      }
      if(action==='crop')return sendJson(res,200,{ok:true,...await startArtworkRevisionCrop({
        shopId:session.shop.shop_id,listingId:id})});
      return sendJson(res,404,{ok:false,error:'Unknown artwork revision action'});
    }catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
  }

  // Repost only after verifying a separate draft; retain the source until publish succeeds.
  if (req.method === 'GET' && url.pathname === '/listing-reposter') {
    if (!requireAdminPage(req,res,'/listing-reposter')) return;
    return sendHtml(res,200,renderListingReposterPage('Silvia Art Collective'));
  }
  if (req.method === 'GET' && url.pathname === '/api/reposter/candidates') {
    if (!requireAdminApi(req,res)) return;
    try {
      const session=await getEtsySession({forceRefresh:true});
      return sendJson(res,200,{ok:true,...await findCandidates(session)});
    }catch(error){return sendJson(res,502,{ok:false,error:String(error.message||error)});}
  }
  const reposterRoute=url.pathname.match(/^\/api\/reposter\/([1-9]\d{0,19})(?:\/(prepare|finalize|uploads\/reserve))?$/);
  if(req.method==='GET'&&reposterRoute&&!reposterRoute[2]){
    if(!requireAdminApi(req,res))return;
    try {
      const session=await getEtsySession({forceRefresh:true});
      return sendJson(res,200,{ok:true,...await getDetails(session,reposterRoute[1])});
    }catch(error){return sendJson(res,502,{ok:false,error:String(error.message||error)});}
  }
  if(req.method==='POST'&&reposterRoute&&reposterRoute[2]){
    if(!requireAdminApi(req,res))return;
    const origin=String(req.headers.origin||'');
    const host=String(req.headers.host||'');
    if(!host||(origin&&origin!==String(req.headers['x-forwarded-proto']||'https')+'://'+host)||
       req.headers['sec-fetch-site']==='cross-site')
      return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))
      return sendJson(res,415,{ok:false,error:'JSON required.'});
    try{
      const body=await readJsonBody(req);
      const session=await getEtsySession({forceRefresh:true});
      const scopes=new Set(String(session.scope||'').split(/\s+/));
      if(!scopes.has('listings_r')||!scopes.has('listings_w')||!scopes.has('transactions_r'))
        return sendJson(res,403,{ok:false,error:'Etsy listings_r, listings_w and transactions_r scopes required.'});
      const id=reposterRoute[1],action=reposterRoute[2];
      if(action==='uploads/reserve')
        return sendJson(res,200,{ok:true,uploads:await reserveMockups(session,id,body.files)});
      if(action==='prepare')
        return sendJson(res,200,{ok:true,...await prepareReplacement(session,id,body)});
      if(action==='finalize'){
        const result=await finalizeReplacement(session,id,body.confirm);
        // Preserve the converted listing's artwork ID linkage for the new Etsy listing.
        const mapping=await loadListingConverterMap(),source=mapping.listings?.[id];
        if(source?.status==='converted' && source.artworkId){
          const nextId=String(result.record.draftId),other=mapping.listings[nextId];
          if(other && other.artworkId!==source.artworkId)
            throw new Error('Replacement is already mapped to another artwork. Review Etsy listing manually.');
          mapping.listings[nextId]={...source,listingId:Number(nextId),status:'converted',
            replacedFromListingId:Number(id),repostedAt:new Date().toISOString()};
          mapping.listings[id]={...source,status:'reposted',replacedByListingId:Number(nextId)};
          await saveListingConverterMap(mapping);
        }
        return sendJson(res,200,{ok:true,...result});
      }
    }catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
  }

  if (req.method === 'GET' && url.pathname === '/listing-converter') {
    if (!requireAdminPage(req, res, '/listing-converter')) return;
    return sendHtml(res, 200, renderListingConverterPage());
  }

  if (req.method === 'GET' && url.pathname === '/api/listing-converter/listings') {
    if (!requireAdminApi(req, res)) return;
    try {
      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_r')) {
        return sendJson(res, 403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy with listings_r before loading converter listings.'
        });
      }
      const data = await converterListingRows(session);
      return sendJson(res, 200, {
        ok: true,
        listingCount: data.listings.length,
        convertedCount: data.listings.filter(item => item.converted).length,
        listings: data.listings
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/listing-converter/reserve') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const listingId = Number(body.listingId);
      if (!Number.isInteger(listingId) || listingId <= 0) {
        return sendJson(res, 400, { ok: false, error: 'A valid Etsy listing ID is required.' });
      }
      if (!body.master?.filename) {
        return sendJson(res, 400, { ok: false, error: 'Choose a master artwork file first.' });
      }

      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_r') || !scopes.has('listings_w')) {
        return sendJson(res, 403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy with listings_r and listings_w before converting listings.'
        });
      }

      const listings = await allShopListingsForPriceSync(session);
      const listing = listings.find(item => Number(item.listing_id) === listingId);
      if (!listing) {
        return sendJson(res, 404, { ok: false, error: 'That Etsy listing was not found in the Silvia shop.' });
      }

      const converterMap = await loadListingConverterMap();
      const existing = converterMap.listings?.[String(listingId)];
      if(existing?.status==='reserved' && existing.artworkId){
        // Interrupted conversion: reuse saved manifest and artwork ID, not a new one.
        const previous=await loadArtworkManifest(existing.artworkId);
        if(Number(previous.sourceEtsyListingId)!==listingId)
          throw new Error('Prior artwork reservation belongs to another Etsy listing.');
        if(String(previous.master?.originalFilename||'')!==String(body.master.filename||'') ||
           Number(previous.master?.size||0)!==Number(body.master.size||0))
          return sendJson(res,409,{ok:false,existingArtworkId:existing.artworkId,
            error:'Listing is already reserved as '+existing.artworkId+
              ' with another file. Select the original master to resume; no new ID was created.'});
        const uploadAlreadyPresent=await artworkObjectExists(previous.master.key);
        return sendJson(res,200,{ok:true,resumed:true,listingId,
          artworkId:existing.artworkId,orientation:previous.orientation,
          uploadAlreadyPresent,cropJobId:previous.cropWorkerJobId||null,
          upload:{key:previous.master.key,contentType:previous.master.contentType,
            uploadUrl:await signedArtworkUploadUrl(previous.master.key,previous.master.contentType)}});
      }
      if (existing?.status === 'converted') {
        return sendJson(res, 409, {
          ok: false,
          error: `Listing #${listingId} is already linked to ${existing.artworkId}.`
        });
      }

      const reservation = await reserveArtworkUpload({
        title: listing.title || '',
        orientation: String(body.orientation || 'portrait').toLowerCase(),
        master: body.master,
        mockups: []
      });

      const manifest = reservation.manifest;
      manifest.sourceEtsyListingId = listingId;
      manifest.sourceEtsyListingTitle = String(listing.title || '');
      manifest.sourceSystem = 'gelato-listing-converter';
      await saveArtworkManifest(manifest);

      converterMap.listings ||= {};
      converterMap.listings[String(listingId)] = {
        listingId,
        title: String(listing.title || ''),
        artworkId: reservation.artworkId,
        status: 'reserved',
        orientation: manifest.orientation,
        reservedAt: new Date().toISOString()
      };
      await saveListingConverterMap(converterMap);

      return sendJson(res, 201, {
        ok: true,
        listingId,
        artworkId: reservation.artworkId,
        orientation: manifest.orientation,
        upload: reservation.uploads.master
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/listing-converter/convert') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const listingId = Number(body.listingId);
      const artworkId = String(body.artworkId || '').trim().toUpperCase();
      if (!Number.isInteger(listingId) || listingId <= 0 || !/^SAC\d+$/.test(artworkId)) {
        return sendJson(res, 400, { ok: false, error: 'A valid listing ID and SAC artwork ID are required.' });
      }

      const manifest = await loadArtworkManifest(artworkId);
      if (!manifest?.master?.key || manifest.status !== 'ready') {
        return sendJson(res, 400, { ok: false, error: `${artworkId} has not finished uploading to Cloudflare R2.` });
      }
      // Explicit reconversion reuses the exact artwork ID already linked to this listing.
      // A second conversion must never reserve another ID or cross-link different artwork.
      const reconvert = body.reconvert === true;
      const mapBefore = await loadListingConverterMap();
      const prior = mapBefore.listings?.[String(listingId)] || null;
      if (!prior || prior.artworkId !== artworkId ||
          (reconvert ? prior.status !== 'converted' :
           !['reserved','converted'].includes(prior.status))) {
        return sendJson(res, 409, { ok: false,
          error: 'The listing-to-artwork link changed. Refresh listings before converting; no Etsy changes were made.' });
      }
      if (prior.status === 'converted' && !reconvert) {
        return sendJson(res, 409, { ok: false,
          error: 'This listing was already converted. Use the Reconvert listing button to reapply settings safely.' });
      }
      if (!hasAuthorizedConverterLink({
        listingId, sourceListingId: manifest.sourceEtsyListingId,
        artworkId, reconvert, mappings: mapBefore.listings
      })) {
        return sendJson(res, 409, { ok:false,
          error: 'Artwork ownership could not be verified for this Etsy listing or its reposting history. No Etsy changes were made.' });
      }

      const cropJobId = String(manifest.cropWorkerJobId || '');
      const cropJob = cropJobId ? await getCropJob(cropJobId) : null;
      if (!cropJob || cropJob.status !== 'completed') {
        return sendJson(res, 409, {
          ok: false,
          error: 'The production crop job must finish before the Etsy listing can be converted.'
        });
      }

      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_r') || !scopes.has('listings_w')) {
        return sendJson(res, 403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy with listings_r and listings_w before converting listings.'
        });
      }

      const listings = await allShopListingsForPriceSync(session);
      const listing = listings.find(item => Number(item.listing_id) === listingId);
      if (!listing) {
        return sendJson(res, 404, { ok: false, error: 'The Etsy listing is no longer active or draft.' });
      }

      const currentInventory = await getListingInventory({
        listingId,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      });

      const readinessStateId = Number(listing.readiness_state_id)
        || readinessStateFromInventory(currentInventory)
        || Number(mostCommonValue(listings, item => item.readiness_state_id));

      if (!Number.isInteger(readinessStateId) || readinessStateId <= 0) {
        throw new Error('Could not determine the Etsy readiness state for this listing.');
      }

      const shipping = await getShopShippingProfiles({
        shopId: session.shop.shop_id,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      });
      const managedShippingProfile = (shipping.results || shipping || []).find(profile =>
        String(profile?.title || '').trim() === String(shippingProfileDefaults.title || '').trim()
      ) || null;

      // Apply Silvia's structural listing settings first, then replace the full
      // variation inventory. Existing SEO copy and existing listing media are preserved.
      await withEtsyListingRetry(() => updateListing({
        shopId: session.shop.shop_id,
        listingId,
        listing: {
          taxonomy_id: listingDefaults.taxonomyId,
          shipping_profile_id: managedShippingProfile?.shipping_profile_id || undefined,
          readiness_state_id: readinessStateId,
          should_auto_renew: listingDefaults.autoRenew,
          type: 'physical'
        },
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      }));

      const variantInventory = buildOwnSilviaInventory({
        artworkId,
        catalog: products,
        readinessStateId,
        defaultQuantity: 999
      });

      await withEtsyListingRetry(() => updateListingInventory({
        listingId,
        inventory: variantInventory,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      }));

      const verifiedInventory = await getListingInventory({
        listingId,
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      });
      const priceVerification = priceSyncPlanForInventory(verifiedInventory);
      if (priceVerification.changed) {
        throw new Error(
          `Etsy still reports ${priceVerification.changes.length} Silvia variant price mismatch(es) after conversion.`
        );
      }

      const enabledProducts = enabledInventoryProducts(verifiedInventory);
      const badSkus = enabledProducts
        .map(product => String(product?.sku || ''))
        .filter(sku => !sku.startsWith(`${artworkId}-`));
      if (badSkus.length) {
        throw new Error(`Etsy conversion verification found ${badSkus.length} enabled variant(s) without ${artworkId} SKUs.`);
      }

      const properties = await getCachedTaxonomyProperties(session, listingDefaults.taxonomyId);
      const attributes = await applyAllListingAttributes({
        session,
        listingId,
        body: {},
        properties
      });

      manifest.etsyConfiguredAt = new Date().toISOString();
      manifest.etsyConfiguration = {
        listingId,
        sourceSystem: 'gelato-listing-converter',
        variants: variantInventory.products.length,
        enabledVariants: variantInventory.enabledCount,
        materials: listingDefaults.fixedAttributes?.Materials || [],
        attributes: attributes.results,
        existingMediaPreserved: true,
        existingSeoPreserved: true
      };
      await saveArtworkManifest(manifest);

      const converterMap = await loadListingConverterMap();
      converterMap.listings ||= {};
      const saved = converterMap.listings[String(listingId)] || prior;
      const finishedAt = new Date().toISOString();
      converterMap.listings[String(listingId)] = {
        ...saved,
        listingId,
        title: String(listing.title || manifest.sourceEtsyListingTitle || ''),
        artworkId,
        status: 'converted',
        orientation: manifest.orientation,
        convertedAt: saved?.convertedAt || finishedAt,
        ...(reconvert ? {
          lastReconvertedAt: finishedAt,
          reconversionCount: Math.max(0, Number(saved?.reconversionCount) || 0) + 1,
          reconversionHistory: [
            ...(Array.isArray(saved?.reconversionHistory) ? saved.reconversionHistory : []),
            {at:finishedAt, artworkId, enabledVariants:variantInventory.enabledCount}
          ].slice(-10)
        } : {}),
        cropJobId,
        enabledVariants: variantInventory.enabledCount
      };
      await saveListingConverterMap(converterMap);

      return sendJson(res, 200, {
        ok: true,
        listingId,
        artworkId,
        enabledVariants: variantInventory.enabledCount,
        totalVariants: variantInventory.products.length,
        pricing: variantInventory.pricing,
        shippingProfileId: managedShippingProfile?.shipping_profile_id || null,
        attributeWarnings: attributes.warnings,
        verified: true,
        reconverted: reconvert,
        reconversionCount: converterMap.listings[String(listingId)].reconversionCount || 0
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
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

  if (req.method === 'GET' && url.pathname === '/readiness') {
    if (!requireAdminPage(req, res, '/readiness')) return;
    return sendHtml(res, 200, renderReadinessPage('Silvia Art Collective'));
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

  if (req.method === 'GET' && url.pathname === '/api/orders/endpoints') {
    if (!requireAdminApi(req,res)) return;
    return sendJson(res,200,{ok:true,...supplierOrderEndpointStatus()});
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

  const artworkRatiosMatch = url.pathname.match(/^\/api\/artworks\/(SAC\d+)\/ratios$/i);
  if (req.method === 'POST' && artworkRatiosMatch) {
    if (!requireAdminApi(req, res)) return;
    try {
      const result = await generateArtworkFulfillmentRatios(artworkRatiosMatch[1].toUpperCase());
      return sendJson(res, 200, { ok: true, ...result });
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

      // Repair/ensure the production crop queue independently of Etsy draft creation.
      // A crop failure must never block creation of the Etsy draft.
      let cropQueue = null;
      let cropQueueWarning = '';
      if (!manifest.fulfillmentRatiosReady) {
        try {
          const created = await createCropJob({
            artworkId: body.artwork_id,
            masterKey: manifest.master.key,
            orientation: body.orientation || manifest.orientation || 'portrait'
          });
          manifest.cropWorkerJobId = created.job.id;
          manifest.cropWorkerQueuedAt = manifest.cropWorkerQueuedAt || new Date().toISOString();
          await saveArtworkManifest(manifest);
          await writeFulfillmentStatus(body.artwork_id, {
            status: created.job.status || 'pending',
            jobId: created.job.id,
            progress: created.job.progress || 0,
            completedRatios: created.job.completedRatios || [],
            message: created.job.message || 'Waiting for shared crop workstation'
          }).catch(() => {});
          cropQueue = {
            jobId: created.job.id,
            status: created.job.status || 'pending',
            reused: Boolean(created.reused),
            worker: cropWorkerStatus()
          };
        } catch (error) {
          cropQueueWarning = error?.message || String(error);
        }
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
      // Start image sorting/download/optimization immediately and let it run while
      // Etsy creates/configures the draft. This removes media-prep time from the
      // critical path without performing concurrent Etsy writes.
      let mediaPrepMs = 0;
      const mediaPlanPromise = prepareMediaPlan({ session, manifest }).then(
        (plan) => ({ ok: true, plan, ms: Date.now() - mediaPrepStartedAt }),
        (error) => ({ ok: false, error, ms: Date.now() - mediaPrepStartedAt })
      );

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

      const mediaPrepared = await mediaPlanPromise;
      mediaPrepMs = mediaPrepared.ms;
      if (!mediaPrepared.ok) throw mediaPrepared.error;
      const mediaPlan = mediaPrepared.plan;

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
        attributeWarnings: [
          ...attributes.warnings,
          ...(cropQueueWarning ? ['Production crop queue: ' + cropQueueWarning] : [])
        ],
        cropQueue,
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
        redirectUri: callbackUrl()
      });

      if (token.refresh_token) {
        // The Render environment remains the source of truth for persistence.
        // Surface the token once so the administrator can store it there, and
        // show the granted scopes so permission changes can be verified before
        // the token is saved.
        const grantedScopes = String(token.scope || '').trim();
        const hasShopsWrite = new Set(grantedScopes.split(/\s+/).filter(Boolean)).has('shops_w');
        return sendHtml(res, 200, `<!doctype html><html><body style="font-family:system-ui;padding:32px;max-width:900px"><h1>Etsy connected</h1><p><strong>Granted scopes:</strong> <code>${escapeHtml(grantedScopes || 'not returned')}</code></p>${hasShopsWrite ? '<p style="color:#2f6b3f"><strong>shops_w granted.</strong> This token can create the Silvia shipping profile.</p>' : '<p style="color:#9a4a3a"><strong>shops_w was NOT granted.</strong> Do not save this token yet; revoke the Etsy app authorization and reconnect.</p>'}<p>Save this refresh token in Render as <code>ETSY_REFRESH_TOKEN</code>:</p><textarea style="width:100%;height:120px">${escapeHtml(token.refresh_token)}</textarea><p><a href="/">Return to dashboard</a></p></body></html>`);
      }

      return sendHtml(res, 200, '<h1>Etsy connected.</h1><p><a href="/">Return to dashboard</a></p>');
    } catch (error) {
      return sendHtml(res, 500, `<h1>Etsy connection failed</h1><pre>${escapeHtml(error?.message || error)}</pre>`);
    }
  }

  if (req.method === 'POST' && url.pathname === '/etsy/webhook') {
    const signingSecret = String(process.env.ETSY_WEBHOOK_SECRET || '').trim();
    if (!signingSecret) {
      return sendJson(res, 503, {
        ok: false,
        error: 'ETSY_WEBHOOK_SECRET is not configured in Render.'
      });
    }

    let rawBody;
    try {
      rawBody = (await readRawBody(req)).toString('utf8');
    } catch (error) {
      return sendJson(res, /too large/i.test(error?.message || '') ? 413 : 400, {
        ok: false,
        error: error?.message || String(error)
      });
    }

    let verification;
    try {
      verification = verifyEtsyWebhook({
        secret: signingSecret,
        webhookId: req.headers['webhook-id'],
        webhookTimestamp: req.headers['webhook-timestamp'],
        webhookSignature: req.headers['webhook-signature'],
        rawBody
      });
    } catch (error) {
      return sendJson(res, 401, {
        ok: false,
        error: 'Invalid Etsy webhook authentication headers.'
      });
    }

    if (!verification.ok) {
      return sendJson(res, 401, {
        ok: false,
        error: verification.reason === 'stale_timestamp'
          ? 'Stale Etsy webhook timestamp.'
          : 'Invalid Etsy webhook signature.'
      });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch {
      return sendJson(res, 400, { ok: false, error: 'Etsy webhook body is not valid JSON.' });
    }

    const supportedEvents = new Set(['order.paid', 'order.canceled', 'order.shipped', 'order.delivered']);
    const eventType = String(payload?.event_type || '').trim();
    const shopId = Number(payload?.shop_id || 0);
    if (!supportedEvents.has(eventType) || !shopId || !payload?.resource_url) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Etsy webhook payload is missing a supported event_type, shop_id, or resource_url.'
      });
    }

    const configuredShopId = Number(process.env.SILVIA_ETSY_SHOP_ID || 0);
    if (configuredShopId && shopId !== configuredShopId) {
      // Etsy's Webhook Portal "Send Example" uses sample shop/receipt IDs.
      // The delivery is still cryptographically verified above, so acknowledge
      // signed non-Silvia examples without staging or processing them.
      return sendJson(res, 200, {
        ok: true,
        accepted: true,
        ignored: true,
        reason: 'signed_non_silvia_test_or_event',
        eventType,
        shopId
      });
    }

    let receiptRef;
    try {
      receiptRef = receiptReferenceFromEtsyResource(payload.resource_url);
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
    if (receiptRef.shopId !== shopId) {
      return sendJson(res, 400, { ok: false, error: 'Webhook resource shop does not match payload shop_id.' });
    }

    const safeWebhookId = String(verification.webhookId).replace(/[^A-Za-z0-9._-]/g, '_');
    const deliveryKey = `webhooks/etsy/${safeWebhookId}.json`;

    try {
      if (await artworkObjectExists(deliveryKey)) {
        return sendJson(res, 200, {
          ok: true,
          duplicate: true,
          eventType,
          receiptId: receiptRef.receiptId
        });
      }

      const delivery = {
        webhookId: verification.webhookId,
        webhookTimestamp: verification.timestamp,
        receivedAt: new Date().toISOString(),
        signatureVerified: true,
        eventType,
        shopId,
        receiptId: receiptRef.receiptId,
        resourceUrl: payload.resource_url,
        payload
      };

      if (eventType === 'order.paid') {
        try {
          const session = await getEtsySession();
          if (Number(session.shop?.shop_id || 0) !== shopId) {
            throw new Error('Authorized Etsy shop does not match webhook shop.');
          }

          const receipt = await getShopReceipt({
            shopId,
            receiptId: receiptRef.receiptId,
            keystring: session.keystring,
            sharedSecret: session.sharedSecret,
            accessToken: session.accessToken
          });

          if(!Array.isArray(receipt.transactions)||!receipt.transactions.length)
            receipt.transactions=await receiptTransactions(session,receiptRef.receiptId);
          if((receipt.was_paid!==true&&receipt.is_paid!==true)||!receipt.transactions?.length)
            throw new Error('Etsy receipt is not confirmed paid with readable transactions.');
          await recordImportedReceipt(receipt,shopId);
          delivery.receiptStaged = true;
          // The webhook is acknowledged after durable R2 staging. Supplier quote
          // discovery runs in the background and is reconciled if interrupted.
          void scheduleAutomaticReview(receiptRef.receiptId,shopId);
        } catch (error) {
          delivery.receiptStaged = false;
          delivery.receiptFetchError = error?.message || String(error);
        }
      }

      await putJsonObject(deliveryKey, delivery);

      return sendJson(res, 200, {
        ok: true,
        accepted: true,
        eventType,
        receiptId: receiptRef.receiptId,
        receiptStaged: Boolean(delivery.receiptStaged)
      });
    } catch (error) {
      return sendJson(res, 500, {
        ok: false,
        error: error?.message || String(error)
      });
    }
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
  if(AUTO_REVIEW_ENABLED){
    setTimeout(()=>{void reconcileNewEtsyPaidOrders();},30000).unref();
    setInterval(()=>{void reconcileNewEtsyPaidOrders();},AUTO_REVIEW_INTERVAL_MS).unref();
  }
});
