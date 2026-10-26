import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import {getFaviconAssets} from './favicon-assets.mjs';
import { renderDashboard } from './dashboard.mjs';
import {workerUpdateBundle,latestWorkerVersion,heartbeatUpdate,workerUpdateText,compareWorkerVersions} from './worker-update.mjs';
import { renderReadinessPage } from './readiness-page.mjs';
import { renderListingReposterPage } from './listing-reposter-page.mjs';
import { renderRepostListingsPage } from './repost-listings-page.mjs';
import { renderListingFeesPage } from './listing-fees-page.mjs';
import { ledgerEntries, summarizeFees, MAX_RANGE_SECONDS } from './listing-fees.mjs';
import { renderDailyListingsPage } from './daily-listings-page.mjs';
import {
  cropOutputKeyForJob, isStagedRevisionJob, isStagedConverterCropJob, reserveArtworkRevision,
  startArtworkRevisionCrop, getArtworkRevisionStatus, artworkIdFromInventory
} from './artwork-revision.mjs';
import { findCandidates, getDetails, reserveMockups, prepareReplacement, finalizeReplacement, listingSalesCount } from './listing-reposter.mjs';
import { startRenewal, resumeRenewal, stopRenewal, renewalRunning, MAX_RENEWALS, DEFAULT_RENEWALS } from './listing-renewer.mjs';
import { supplierOrderEndpointStatus } from './order-endpoints.mjs';
import { decorateAdminHtml } from './admin-sidebar.mjs';
import { renderTrackingPage } from './tracking-page.mjs';
import {beginGmailAuthorization,finishGmailAuthorization,gmailConnectionStatus,disconnectGmail,gmailOAuthConfigured} from './gmail-oauth.mjs';
import {scanSensariaGmail,gmailTrackingStatus,saveGmailTrackingSettings} from './sensaria-gmail-tracking.mjs';
import { listTrackingRecords, linkTrackingOrder, checkSupplierTracking, checkEtsyShipmentStatus, sensariaCandidates, stageShipment, sendStagedShipmentToEtsy } from './order-tracking.mjs';

const TRACKING_SHOP_NAME="Silvia Art Collective";
import { renderDescriptionUpdaterPage } from './description-updater-page.mjs';
import { previewDescriptionUpdates, applyDescriptionUpdates, reviseCanvasThickness } from './description-updater.mjs';

import { renderProductCreator } from './product-creator.mjs';
import {getMockupJob,listMockupJobs,getPcMockupFolder,mockupFileKey,listMockupTemplates,getMockupTemplate,linkMockupArtwork} from './mockup-generator.mjs';
import {receivedEtsyImageIds,verifyEtsyImageReceipts} from './etsy-media-verification.mjs';
import {reserveRegularMockups,confirmRegularMockups} from './regular-mockup-uploads.mjs';
import {mockupObjectKey} from './production.mjs';
import { handleMockupAPI, mockupJobFromArtwork, mockupJobFromStaged } from './mockup-api.mjs';
import { mockupOrientationOf } from './mockup-orientation.mjs';
import { addToBatch, batchStatus, batchRunning, stopBatch, resumeBatch, resumeAfterRestart, setPublish, publishBatch, closeBatch, startOver, batchDraftBody, MAX_BATCH, mockupPresets, presetKey, templateSuits, photoOrderKey, orderForArtwork } from './batch-poster.mjs';
import {canonicalWallArtStyle,styleAttributes,ETSY_WALL_ART_STYLES} from './etsy-style.mjs';
import {assertSeoShopSection} from './seo-shop-section.mjs';
import { generateEtsySeo, loadAiSeoSettings, saveAiSeoSettings, aiSeoConfigured, seoImage, seoPasteText, sectionUrl, DEFAULT_AI_SEO_INSTRUCTIONS, DEFAULT_AI_SEO_MODEL } from './ai-seo.mjs';
import {starterDraftMedia} from './draft-starter-media.mjs';
import { renderTestOrderPage } from './test-order-page.mjs';
import { renderPricingPage } from './pricing-page.mjs';
import {listingLayoutForManifest,listingLayoutForReconversion} from './panoramic-layout.mjs';
import {loadListingTemplates,saveListingTemplate,listingDescription,TEMPLATE_ORIENTATIONS} from './listing-templates.mjs';
import {planDefaultTemplateInventory,templateInventoryFingerprint} from './default-listing-pricing.mjs';
import { renderListingConverterPage } from './listing-converter-page.mjs';
import {renderListingsPage} from './listings-page.mjs';
import {
  listingEditorFields,listingEditorFingerprint,validateMasterListingEdit,
  inventoryEditorRows,inventoryEditorFingerprint,applyInventoryEditorChanges,
  artworkIdFromSkus
} from './master-listings.mjs';
import {originalEtsyCreationTimestamp,sortConverterListingsOldestFirst} from './converter-listing-order.mjs';
import { listingSeoPreservation, describeEtsyDescriptionDifference, sameEtsyDescription } from './converter-description.mjs';
import { hasAuthorizedConverterLink } from './listing-converter-link.mjs';
import {
 enqueueConversion,getConversionJob,getConversionQueueSummary,claimNextConversion,
 updateConversionJob,cancelConversion
} from './listing-conversion-queue.mjs';
import {
 reserveConverterArtworkRevision,reserveConverterArtworkRegeneration,startConverterArtworkCrop,getConverterArtworkRevisionStatus,getConverterArtworkRevisionStatuses,
 assertConverterArtworkReady,activateConverterArtworkRevision
} from './converter-artwork-revision.mjs';
import { renderShippingProfilePage } from './shipping-profile-page.mjs';
import {renderInternationalShippingPage} from './international-shipping-page.mjs';
import {internationalShippingPreview,listingWorstCaseShippingPreview} from './international-shipping-planner.mjs';
import {auditListingDestination} from './international-listing-audit.mjs';
import { pricingCatalogForZone, pricingCatalogForMarket, publicShippingPricingConfig } from './pricing.mjs';
import { scanSupplierComparison } from './supplier-comparison.mjs';
import {startSupplierComparisonJob,getSupplierComparisonJob} from './supplier-comparison-jobs.mjs';
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
import {scanForPhoto,replacePhotos,stopPhotoJob,photoJobRunning,photoFingerprint,comparePhotos,photoUrl,placePhotoAtSlot} from './photo-replacer.mjs';
import { buildTestReceipt } from './test-order.mjs';
import { etsyReceiptToSensariaCsvFromR2 } from './fulfillment.mjs';
import {validateSensariaCsvOrder} from './sensaria-order-csv.mjs';
import {startCsvJob,csvJobStatus,csvJobResult} from './sensaria-csv-jobs.mjs';
import {resolveProviderArtworkAsset} from './fulfillment-assets.mjs';
import {
  checkR2Connection,
  getArtworkObject,
  copyArtworkObject,
  signedArtworkUrl,
  signedArtworkUploadUrl,
  artworkObjectExists,
  artworkObjectInfo,
  listArtworkManifestKeys,
  getJsonObject,
  putJsonObject,
  putArtworkObject,
  deleteArtworkObject,
  isMissingR2Object
} from './r2.mjs';
import {
  reserveArtworkUpload,
  stageMasterUpload,
  stagedMasterObjectKey,
  pruneStagedMasters,
  completeArtworkUpload,
  cancelArtworkUpload,
  generateArtworkFulfillmentRatios,
  loadArtworkManifest,
  saveArtworkManifest,
  updateArtworkManifest
} from './artwork-storage.mjs';
import {
  buildOwnSilviaInventory,
  productKeyFromVariationValues,
  normalizeSize,
  retailPriceForProductKey,
  SILVIA_REFERENCE_CAD_PER_USD,
  SILVIA_SALE_DISCOUNT_PERCENT
} from './variants.mjs';
import { normalizeCropSize,sizeCropRatioKey,sizeCropTarget,sizeCropObjectKey } from './size-crops.mjs';
import {
  FULFILLMENT_RATIOS,
  fulfillmentRatiosForOrientation,
  FULFILLMENT_RATIO_MIN_PIXELS,
  fulfillmentRatioObjectKey
} from './artwork-ratios.mjs';
import {
  createCropJob,
  getCropJob,
  getCropJobSummaries,
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
import {ETSY_PHOTO_LIMIT,defaultPlannedOrder,mergeOrder,desiredImageOrder,rankUpdates} from './etsy-photo-organizer.mjs';
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
  getListing,
  getShopLedgerEntries,
  getShopSections,
  getShopReturnPolicies,
  getShopProductionPartners,
  updateListingProperty,
  getPropertiesByTaxonomyId,
  getListingInventory,
  updateListingInventory,
  uploadListingImage,
  setListingImageRank,
  deleteListingImage,
  uploadListingVideo,
  attachListingVideo,
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
const inflightDraftSetups = new Set();

// Preserve independently uploaded JPG/PNG mockups when the Etsy draft is
// configuring: never save its earlier, stale snapshot over the R2 manifest.
async function persistDraftManifestFields(manifest, fields) {
  return updateArtworkManifest(manifest.artworkId, current => {
    for (const field of fields) current[field] = manifest[field];
  });
}

// Crop jobs that read a staged replacement master (Listings editor re-upload,
// converter reconversion, or the older revisions flow) write to their own
// staging folder and must not be compared with, or written over, the artwork's
// live master and crops until the replacement is activated.
function isStagedCropJob(job){
  return isStagedRevisionJob(job)||isStagedConverterCropJob(job);
}

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
  const match = sku.match(/^SAC\d+-(P|C|FC)-(\d{2,4})(?:-(BLK|WHT|NAT|BRN|DWD))?$/);
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

// Etsy listing metadata is independent of image previews. Never delay rendering
// hundreds of converter rows while fetching the first image of every listing.
const CONVERTER_PREVIEW_TTL_MS=10*60*1000;
const converterPreviewCache=new Map();
async function cachedConverterListingPreview(session,listingId){
 const key=String(session.shop.shop_id)+':'+String(listingId);
 const existing=converterPreviewCache.get(key);
 if(existing&&existing.expiresAt>Date.now())return existing.value||existing.pending;
 const pending=getEtsyListingImages({
  listingId,keystring:session.keystring,sharedSecret:session.sharedSecret,
  accessToken:session.accessToken
 }).then(images=>{
  const value={firstImageUrl:firstListingImageUrl(images[0]),imageCount:images.length,imageError:null};
  converterPreviewCache.set(key,{value,expiresAt:Date.now()+CONVERTER_PREVIEW_TTL_MS});
  return value;
 }).catch(error=>{
  converterPreviewCache.delete(key);
  throw error;
 });
 converterPreviewCache.set(key,{pending,expiresAt:Date.now()+60*1000});
 // Bound memory even when an Etsy shop contains many listings.
 if(converterPreviewCache.size>1200)converterPreviewCache.delete(converterPreviewCache.keys().next().value);
 return pending;
}

// Fast paginated master-list view: make at most two Etsy calls per page,
// loading active and draft pages concurrently. A short cache avoids an Etsy
// round-trip every time the user switches tabs or refreshes.
const masterListingPageCache=new Map();
const MASTER_PAGE_TTL_MS=2*60*1000;
// Verified listing → artwork link for edits that touch artwork files: either a
// converted listing in the converter map, or a Product Creator listing whose
// artwork manifest records this Etsy listing ID.
async function resolveListingArtwork({listingId,listing,map}){
 const id=Number(listingId);
 const mapping=map?.listings?.[String(id)];
 if(mapping?.status==='converted'&&mapping.artworkId){
  const artworkId=String(mapping.artworkId).toUpperCase();
  const manifest=await loadArtworkManifest(artworkId).catch(()=>null);
  if(manifest?.master?.key&&manifest.status==='ready'&&hasAuthorizedConverterLink({
    listingId:id,sourceListingId:manifest.sourceEtsyListingId,artworkId,
    reconvert:true,mappings:map.listings}))
   return {artworkId,source:'converter',manifest};
 }
 const fromSku=artworkIdFromSkus(listing?.skus);
 if(fromSku){
  const manifest=await loadArtworkManifest(fromSku).catch(()=>null);
  const recorded=[manifest?.etsyDraftListingId,manifest?.etsyConfiguration?.listingId,manifest?.sourceEtsyListingId]
   .some(value=>Number(value)===id);
  if(manifest?.master?.key&&manifest.status==='ready'&&recorded)
   return {artworkId:fromSku,source:'product-creator',manifest};
 }
 return null;
}
async function masterListingPage(session,offset=0){
 const safeOffset=Number(offset);
 if(!Number.isInteger(safeOffset)||safeOffset<0||safeOffset>4900||safeOffset%100!==0)
   throw Error('Listing offset must be a multiple of 100 between 0 and 4900.');
 const key=String(session.shop.shop_id)+':'+safeOffset;
 const previous=masterListingPageCache.get(key);
 if(previous&&previous.expiry>Date.now())return previous.result||previous.pending;
 const pending=(async()=>{
   const auth={shopId:session.shop.shop_id,keystring:session.keystring,
     sharedSecret:session.sharedSecret,accessToken:session.accessToken};
   const [active,draft,map]=await Promise.all([
     getShopListings({...auth,state:'active',offset:safeOffset,limit:100}),
     getShopListings({...auth,state:'draft',offset:safeOffset,limit:100}),
     loadListingConverterMap()
   ]);
   const a=Array.isArray(active?.results)?active.results:[];
   const d=Array.isArray(draft?.results)?draft.results:[];
   const seen=new Set();
   const rows=[...a.map(x=>({...x,state:'active'})),...d.map(x=>({...x,state:'draft'}))]
     .filter(x=>{const id=Number(x.listing_id);if(!id||seen.has(id))return false;seen.add(id);return true;})
     .map(x=>{
       const mapping=map.listings?.[String(x.listing_id)];
       return {listingId:Number(x.listing_id),title:String(x.title||''),state:x.state,
         artworkId:mapping?.artworkId||artworkIdFromSkus(x.skus),converted:mapping?.status==='converted',
         originalCreationTimestamp:originalEtsyCreationTimestamp(x)};
     });
   return {listings:sortConverterListingsOldestFirst(rows),offset:safeOffset,
     nextOffset:safeOffset+100,hasMore:(a.length===100||d.length===100)&&safeOffset<4900};
 })();
 masterListingPageCache.set(key,{pending,expiry:Date.now()+30*1000});
 if(masterListingPageCache.size>80)masterListingPageCache.delete(masterListingPageCache.keys().next().value);
 try{
   const result=await pending;
   masterListingPageCache.set(key,{result,expiry:Date.now()+MASTER_PAGE_TTL_MS});
   return result;
 }catch(error){masterListingPageCache.delete(key);throw error;}
}

async function converterListingRows(session) {
 const [listings, converterMap]=await Promise.all([
  allShopListingsForPriceSync(session),loadListingConverterMap()
 ]);
 const rows=listings.map(listing=>{
  const mapping=converterMap.listings?.[String(listing.listing_id)]||null;
  const originalCreationTimestamp=originalEtsyCreationTimestamp(listing);
  return {
   listingId:Number(listing.listing_id),
   originalCreationTimestamp,
   originalListedAt:originalCreationTimestamp!==null?
    new Date(originalCreationTimestamp*1000).toISOString():null,
   title:String(listing.title||''),
   state:String(listing.state||''),
   firstImageUrl:null,imageCount:0,imageError:null,
   artworkId:mapping?.artworkId||null,
   converted:mapping?.status==='converted',
   conversionStatus:mapping?.status||'not-linked',
   convertedAt:mapping?.convertedAt||null,
   lastReconvertedAt:mapping?.lastReconvertedAt||null,
   reconversionCount:Math.max(0,Number(mapping?.reconversionCount)||0)
  };
 });
 return { listings: sortConverterListingsOldestFirst(rows), converterMap };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

const FAVICON_LINKS = [
  '<link rel="shortcut icon" href="/favicon.ico?v=4" type="image/x-icon">',
  '<link rel="icon" href="/favicon-16.png?v=4" type="image/png" sizes="16x16">',
  '<link rel="icon" href="/favicon-32.png?v=4" type="image/png" sizes="32x32">',
  '<link rel="apple-touch-icon" href="/favicon.png?v=4" sizes="64x64">'
].join('');
function sendHtml(res, status, html) {
  const source = decorateAdminHtml(html);
  // Real PNG and ICO favicons work in Chrome tabs, mobile and bookmarks.
  // Remove any previously embedded favicon links instead of serving duplicates.
  const body = source
    .replace(/<link\b[^>]*\brel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>/gi, '')
    .replace(/<\/head>/i, FAVICON_LINKS+'</head>');
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

// The worker checks in every 8 s; after 20 s of silence it is reported offline.
const CROP_WORKER_HEARTBEAT_TTL_MS = 20 * 1000;
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
    activeApp: String(input.activeApp || '').trim().slice(0, 80),
    // Only the worker's own heartbeats carry these; job claims and progress keep them.
    update: 'update' in input ? heartbeatUpdate(input.update) : cropWorkerHeartbeat.update || null,
    autoUpdate: typeof input.autoUpdate === 'boolean' ? input.autoUpdate : cropWorkerHeartbeat.autoUpdate ?? null,
    // What the worker found in this shop's mockup folder on the PC.
    mockupFolder: input.mockupFolder && typeof input.mockupFolder === 'object' ? {
      path: String(input.mockupFolder.path || '').slice(0, 300),
      count: Math.max(0, Math.floor(Number(input.mockupFolder.count) || 0)),
      error: String(input.mockupFolder.error || '').slice(0, 200),
      fromConfig: input.mockupFolder.fromConfig === true
    } : 'mockupFolder' in input ? null : cropWorkerHeartbeat.mockupFolder || null,
    lastSeenAt: Date.now()
  };
  return cropWorkerHeartbeat;
}
// A worker that said it is restarting for an update is reported as updating,
// not offline, for up to three minutes.
const WORKER_UPDATE_RESTART_MS = 3 * 60 * 1000;

// The PC worker says why it was started again after stopping unexpectedly
// (worker/supervise.mjs); logged once, so Render's log keeps the reason.
let loggedWorkerRestart='';
function logWorkerRestart(restart){
  const at=String(restart?.at||'');
  if(!at||at===loggedWorkerRestart)return;
  loggedWorkerRestart=at;
  console.error('PC worker stopped unexpectedly at '+at+' ('+String(restart.reason||'unknown').slice(0,200)+
    ', after '+(Number(restart.ranSeconds)||0)+' s) and was started again. Its last lines:\n'+String(restart.lastLines||'(none)').slice(0,1500));
}
function cropWorkerStatus() {
  const configured = Boolean(String(process.env.CROP_WORKER_TOKEN || '').trim());
  const online = configured &&
    cropWorkerHeartbeat.lastSeenAt > 0 &&
    Date.now() - cropWorkerHeartbeat.lastSeenAt <= CROP_WORKER_HEARTBEAT_TTL_MS;
  const restarting = configured && !online && cropWorkerHeartbeat.update?.state === 'restarting' &&
    Date.now() - cropWorkerHeartbeat.lastSeenAt <= WORKER_UPDATE_RESTART_MS;
  const latestVersion = latestWorkerVersion();
  const update = online || restarting ? cropWorkerHeartbeat.update : null;
  const updateText = workerUpdateText({ online, version: cropWorkerHeartbeat.version, latestVersion, update,
    restarting, autoUpdate: cropWorkerHeartbeat.autoUpdate });
  return {
    configured,
    online,
    latestVersion,
    outdated: online && Boolean(latestVersion) && compareWorkerVersions(cropWorkerHeartbeat.version, latestVersion) < 0,
    updating: restarting || (online && ['downloading', 'waiting', 'restarting'].includes(update?.state)),
    update,
    updateText,
    mockupFolder: online ? cropWorkerHeartbeat.mockupFolder || null : null,
    workerId: online ? cropWorkerHeartbeat.workerId : '',
    version: online ? cropWorkerHeartbeat.version : '',
    mockups: online ? cropWorkerHeartbeat.mockups===true : false,
    busy: online ? cropWorkerHeartbeat.busy : false,
    jobId: online ? cropWorkerHeartbeat.jobId : '',
    activeApp: online ? cropWorkerHeartbeat.activeApp || '' : '',
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

// Each custom size uses its own key, without modifying the default ratio crops.
function cropJobTarget(job, ratio) {
  return job.size ? sizeCropTarget(job.size,job.orientation) : cropTarget(ratio,job.orientation);
}
function cropJobOutputKey(job, ratio) {
  if (job.size) {
    if (String(ratio)!==sizeCropRatioKey(job.size)) throw Error('Wrong on-demand crop identifier.');
    return sizeCropObjectKey(job.artworkId,job.size);
  }
  return cropOutputKeyForJob(job,ratio);
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

// ---------------------------------------------------------------- photo replacer
const PHOTO_REPLACER_JOB_KEY='settings/photo-replacer/job.json';
async function photoReplacerImages(listingId){
  const session=await getEtsySession();
  return getEtsyListingImages({listingId,keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken});
}
// Only Etsy's own photo addresses are downloaded.
async function etsyPhotoBuffer(url){
  const parsed=new URL(String(url||''));
  if(parsed.protocol!=='https:'||!/(^|\.)etsystatic\.com$/i.test(parsed.hostname))throw Error('Not an Etsy photo address.');
  const response=await fetch(parsed.href,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Etsy photo download failed ('+response.status+').');
  return Buffer.from(await response.arrayBuffer());
}
// The preset slot (choose option / frame / promotion) the chosen photo is, if any.
async function presetRoleForPhoto(url){
  const reference=await photoFingerprint(await etsyPhotoBuffer(url));
  for(const preset of PRESET_MEDIA.filter(item=>item.role!=='video')){
    if(!await artworkObjectExists(preset.key))continue;
    const installed=await photoFingerprint((await getArtworkObject(preset.key)).body);
    if(comparePhotos(reference,installed).kind!=='different')return preset.role;
  }
  return null;
}
// Each converted listing shows the "choose your frame" preset (choose-frame.png
// in Cloudflare R2) as its 5th photo, replacing what was there.
const CONVERTER_FRAME_SLOT=5;
async function placeConverterFramePhoto(listingId){
  const preset=PRESET_MEDIA.find(item=>item.role==='choose-frame');
  if(!await artworkObjectExists(preset.key))return {status:'skipped',reason:preset.filename+' is not in Cloudflare R2.'};
  const object=await etsyReadyImage(preset.key);
  return placePhotoAtSlot(photoReplacerDeps(),{listingId,slot:CONVERTER_FRAME_SLOT,
    photo:{buffer:object.body,filename:'Choose Frame.jpg',contentType:object.contentType||'image/jpeg'}});
}
// A POST from another site (Daily Listings changes Etsy, so only its own page may).
function crossSitePost(req){
  const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
  const scheme=String(req.headers['x-forwarded-proto']||(req.socket?.encrypted?'https':'http')).split(',')[0].trim();
  return !host||(origin&&origin!==scheme+'://'+host)||req.headers['sec-fetch-site']==='cross-site';
}
// Daily Listings → New listings (batch-poster.mjs): the batch and the mockup
// preset last chosen are kept in R2; the presets are folders on the PC.
const BATCH_JOB_KEY='settings/batch-poster/job.json';
const BATCH_PRESET_KEY='settings/batch-poster/mockup-preset.json';
const LAYOUT_NAMES={portrait:'Vertical',landscape:'Horizontal',square:'Square',panoramic:'Panoramic'};
const presetImagesOf=media=>media.items.filter(item=>item.exists&&item.role!=='video');
// The Etsy photo order arranged for each preset and shape (Arrange photos).
const BATCH_PHOTO_ORDERS_KEY='settings/batch-poster/photo-orders.json';
async function loadPhotoOrders(){
  try{return (await getJsonObject(BATCH_PHOTO_ORDERS_KEY))||{}}catch(error){if(isMissingR2Object(error))return {};throw error}
}
// The organizer's tiles for a preset: the preset photos and the preset's PSDs.
const presetPhotoTiles=(preset,presetImages)=>[
  ...presetImages.map(item=>({id:'key:'+item.key,kind:'preset',label:PRESET_LABELS[item.role]||'Preset photo',
    thumb:'/api/etsy-photo-organizer/thumb?key='+encodeURIComponent(item.key)})),
  ...preset.templates.map(t=>({id:'generated:'+t.id,kind:'mockup',label:t.name,thumb:'/api/batch/template-preview/'+encodeURIComponent(t.id)}))];
// A preset's photos for one shape, in its saved order (else the usual one):
// the preset photos and the preset's PSDs that suit the shape.
function presetPhotoPlan(preset,layout,{presetImages,orders}){
  const ids=[...presetImages.map(item=>'key:'+item.key),
    ...preset.templates.filter(t=>templateSuits(t,layout)).map(t=>'generated:'+t.id)];
  const saved=orders[photoOrderKey(preset.name,layout)]?.order||null;
  const planned=defaultPlannedOrder({presets:presetImages,generated:ids.filter(id=>id.startsWith('generated:'))});
  return {ids,saved,order:mergeOrder(saved||planned,ids)};
}
// A small picture of a template for the page: the worker's preview of the PSD,
// else the last mockup made with it. Kept in memory once made.
const templatePreviews=new Map();
let latestRenders={at:0,keys:null};
async function latestRenderOf(templateId){
  if(!latestRenders.keys||Date.now()-latestRenders.at>5*60*1000){
    const keys=new Map();
    for(const job of await listMockupJobs(150).catch(()=>[]))
      for(const item of job.templates||[])
        if(item.status==='completed'&&(item.previewKey||item.outputKey)&&!keys.has(item.id))keys.set(item.id,item.previewKey||item.outputKey);
    latestRenders={at:Date.now(),keys};
  }
  return latestRenders.keys.get(templateId)||'';
}
async function templatePreview(templateId){
  const template=await getMockupTemplate(templateId);
  const source=template.previewKey||await latestRenderOf(template.id);
  if(!source)return null;
  const known=templatePreviews.get(template.id);
  if(known?.source===source)return known.bytes;
  const bytes=await sharp((await getArtworkObject(source)).body,{limitInputPixels:false})
    .rotate().resize(480,480,{fit:'inside',withoutEnlargement:true}).jpeg({quality:78}).toBuffer();
  templatePreviews.set(template.id,{source,bytes});
  if(templatePreviews.size>400)templatePreviews.delete(templatePreviews.keys().next().value);
  return bytes;
}
async function batchShopDefaults(session){
  const shopArgs={shopId:session.shop.shop_id,keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken};
  const [shipping,listings,templates]=await Promise.all([getShopShippingProfiles(shopArgs),
    getShopListings({...shopArgs,state:'active',limit:100}),loadListingTemplates().catch(()=>({orientations:{}}))]);
  return {preset:detectedListingPreset(shipping.results||shipping||[],listings.results||listings||[]),templates:templates.orientations||{}};
}
let batchDefaultsCache={at:0,value:null};
function batchDeps(){
  return {
    newId:()=>crypto.randomUUID(),
    loadJob:async()=>{try{return await getJsonObject(BATCH_JOB_KEY)}catch(error){if(isMissingR2Object(error))return null;throw error}},
    saveJob:job=>putJsonObject(BATCH_JOB_KEY,job),
    pause:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    reserveArtwork:async item=>{
      const reservation=await reserveArtworkUpload({title:'',orientation:'auto',
        master:{filename:item.filename,contentType:item.contentType,size:item.size},mockups:[],stagedMaster:{stageId:item.stageId}});
      const manifest=await completeArtworkUpload(reservation.artworkId);
      return {artworkId:reservation.artworkId,orientation:listingLayoutForManifest(manifest)};
    },
    // From the staged master (no artwork ID yet), or from the artwork when it has one.
    startMockups:async item=>{
      const layout=item.orientation,[templates,media,orders]=await Promise.all([listMockupTemplates(),presetMediaStatus(),loadPhotoOrders()]);
      const preset=mockupPresets(templates).find(entry=>presetKey(entry.name)===presetKey(item.preset));
      if(!preset)throw Error('The mockup preset "'+(item.preset||'(none)')+'" is not a folder in the PC mockup folder any more. Choose a preset, then try again.');
      // With an arranged order, the PSDs placed within Etsy's 20 photos; else the first that fit.
      const presetImages=presetImagesOf(media),room=ETSY_PHOTO_LIMIT-presetImages.length;
      const plan=presetPhotoPlan(preset,layout,{presetImages,orders});
      const ids=plan.saved?plan.order.slice(0,ETSY_PHOTO_LIMIT).filter(id=>id.startsWith('generated:')).map(id=>id.slice(10)):
        preset.templates.filter(t=>templateSuits(t,layout)).map(t=>t.id).slice(0,room);
      if(!ids.length)throw Error(preset.name+' has no '+LAYOUT_NAMES[layout]+' mockups. Add some to its folder on the PC '+
        '(or set their orientation in the Product Creator), then try again.');
      // queue:'batch': the PC makes these oldest first, after any Product Creator mockups.
      const job=item.artworkId?await mockupJobFromArtwork({artworkId:item.artworkId,templateIds:ids,queue:'batch'}):
        await mockupJobFromStaged({stagedKey:stagedMasterObjectKey(item.stageId,item.filename),filename:item.filename,
          templateIds:ids,orientation:layout,queue:'batch'}).catch(error=>{
          throw /not found|NoSuchKey|404/i.test(String(error?.message||error))
            ?Error('The uploaded file is no longer in temporary storage (kept 3 days). Start over and add this artwork again.'):error;
        });
      return {jobId:job.id,total:job.templates.length};
    },
    // Mockups made before the artwork had an ID now belong to it.
    linkMockups:async item=>{
      const manifest=await loadArtworkManifest(item.artworkId);
      await linkMockupArtwork(item.mockupJobId,{artworkId:item.artworkId,masterKey:manifest.master.key,orientation:mockupOrientationOf(manifest)});
    },
    // Start over: a master that never got an artwork ID, and its preview, are removed.
    discardUpload:async item=>{
      await deleteArtworkObject(stagedMasterObjectKey(item.stageId,item.filename)).catch(()=>{});
      if(item.previewKey)await deleteArtworkObject(item.previewKey).catch(()=>{});
    },
    mockupStatus:async jobId=>{
      const job=await getMockupJob(jobId);
      const count=status=>job.templates.filter(t=>t.status===status).length;
      const working=job.templates.find(t=>t.status==='processing');
      const note=!cropWorkerStatus().online?'the PC worker is offline: start it on the PC to go on':
        working?String(working.progress||'').replace(/\.+$/,''):count('queued')?'waiting for the PC to finish the artworks before it':'';
      return {total:job.templates.length,done:count('completed'),failed:count('failed')+count('needs_mapping'),
        finished:!job.templates.some(t=>['queued','processing'].includes(t.status)),note,
        completedIds:job.templates.filter(t=>t.status==='completed').map(t=>t.id)};
    },
    writeSeo:async item=>{
      let picture=null;
      if(item.previewKey)picture=(await getArtworkObject(item.previewKey).catch(()=>null))?.body||null;
      if(!picture){
        // No preview from the page (e.g. a TIFF): the master in R2.
        const manifest=await loadArtworkManifest(item.artworkId);
        picture=(await getArtworkObject(manifest.master.key)).body;
      }
      return generateEtsySeo({image:await seoImage(picture),orientation:item.orientation,...(await seoShopContext(await getEtsySession()))});
    },
    attachMockups:(artworkId,jobId,templateIds)=>syncGeneratedMockupsForArtwork({artworkId,jobId,templateIds}),
    // The order arranged for the preset and shape goes on the artwork, as the
    // Product Creator's organizer does; the draft is then set up in that order.
    savePhotoOrder:async(item,templateIds)=>{
      const saved=(await loadPhotoOrders())[photoOrderKey(item.preset,item.orientation)]?.order;
      if(!saved?.length)return;
      const presetKeys=presetImagesOf(await presetMediaStatus()).map(entry=>entry.key);
      const tiles=orderForArtwork(saved,{templateIds,presetKeys});
      await updateArtworkManifest(item.artworkId,current=>{
        current.etsyPhotoOrder={tiles,jobId:item.mockupJobId,savedAt:new Date().toISOString()};
      });
    },
    createDraft:async item=>{
      if(!batchDefaultsCache.value||Date.now()-batchDefaultsCache.at>10*60*1000)
        batchDefaultsCache={at:Date.now(),value:await batchShopDefaults(await getEtsySession())};
      const {preset,templates}=batchDefaultsCache.value;
      const body=batchDraftBody({artworkId:item.artworkId,layout:item.orientation,seo:item.seo,
        preset,template:templates[item.orientation]||{}});
      if(!body.shipping_profile_id||!body.readiness_state_id)
        throw Error('Choose the shipping and processing profiles in Listings → Templates → '+LAYOUT_NAMES[item.orientation]+
          ' (the shop has no listing to take them from), then try again.');
      const reply=await createEtsyDraft(body);
      if(reply.status>=400)throw Error(reply.payload?.error||'The Etsy draft could not be created.');
      return Number(reply.payload.listingId);
    },
    draftSetup:async artworkId=>{
      const stored=(await loadArtworkManifest(artworkId))?.etsyDraftSetup||{};
      const status=stored.status==='running'&&!inflightDraftSetups.has(artworkId)?'interrupted':(stored.status||'not_started');
      return {status,error:stored.error||''};
    },
    publish:async listingId=>{
      const session=await getEtsySession();
      const args={keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken};
      await withEtsyListingRetry(()=>updateListing({...args,shopId:session.shop.shop_id,listingId,listing:{state:'active'}}));
      const listing=await getListing({listingId,...args});
      if(listing.state!=='active')throw Error('Etsy kept the listing as '+listing.state+'.');
    }
  };
}
// Renew listings (listing-renewer.mjs): the job is kept in R2.
const RENEWER_JOB_KEY='settings/listing-renewer/job.json';
async function loadRenewalJob(){try{return await getJsonObject(RENEWER_JOB_KEY)}catch(error){if(isMissingR2Object(error))return null;throw error}}
async function allActiveListings(session){
  const shopArgs={shopId:session.shop.shop_id,keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken};
  const listings=[];
  for(let offset=0;offset<10000;offset+=100){
    const page=await getShopListings({...shopArgs,state:'active',limit:100,offset});
    const items=page?.results||[];
    listings.push(...items);
    if(items.length<100)break;
  }
  return [...new Map(listings.map(item=>[Number(item.listing_id),item])).values()];
}
// New SEO for a listing being renewed, from its first photo. The listing keeps
// its shop section; an app-made listing gets its orientation's description
// template with the new SEO description, any other keeps its description.
async function renewalSeo(listingId){
  const session=await getEtsySession();
  const args={keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken};
  const listing=await getListing({listingId,...args});
  const [first]=await getEtsyListingImages({listingId,...args});
  if(!first)throw Error('This listing has no photos for ChatGPT to look at.');
  let manifest=null;
  try{manifest=await loadArtworkManifest(artworkIdFromInventory(await getListingInventory({listingId,...args})))}catch{}
  const layout=manifest?listingLayoutForManifest(manifest):'';
  const context=await seoShopContext(session);
  const seo=await generateEtsySeo({image:await seoImage(await etsyPhotoBuffer(first.url_fullxfull||first.url_570xN)),
    orientation:layout,previous:{title:listing.title,tags:listing.tags||[]},...context});
  if(!manifest)return {title:seo.title,tags:seo.tags,style:seo.style,description:String(listing.description||''),descriptionKept:true};
  const current=context.sections.find(item=>String(item.shop_section_id)===String(listing.shop_section_id||''));
  const template=(await loadListingTemplates().catch(()=>null))?.orientations?.[layout];
  return {title:seo.title,tags:seo.tags,style:seo.style,description:listingDescription(template,listingDefaults.descriptionTemplate,{
    seoDescription:seo.description,
    shopSectionName:current?current.title:seo.sectionName,
    shopSectionUrl:current?sectionUrl(context.shopName,current.shop_section_id):seo.sectionUrl})};
}
// The latest draft template for a listing being reposted or renewed: the
// variants (sizes, prices, SKUs), profiles and attributes a new Product Creator
// draft of its artwork gets today, so a renewed listing does not keep old sizes
// or prices. A listing the app did not make has no artwork to build them for:
// it is copied as it is (null). Its shop section, materials and photos stay.
async function repostTemplate({listing,inventory,properties},{style=''}={}){
  let artworkId='',manifest=null;
  try{artworkId=artworkIdFromInventory(inventory);if(artworkId)manifest=await loadArtworkManifest(artworkId)}catch{}
  if(!manifest||manifest.status!=='ready')return null;
  const session=await getEtsySession();
  if(!batchDefaultsCache.value||Date.now()-batchDefaultsCache.at>10*60*1000)
    batchDefaultsCache={at:Date.now(),value:await batchShopDefaults(session)};
  const {preset,templates}=batchDefaultsCache.value,layout=listingLayoutForManifest(manifest);
  const body=batchDraftBody({artworkId,layout,seo:{title:listing.title,description:'',tags:[]},preset,template:templates[layout]||{}});
  const readiness=body.readiness_state_id||Number(listing.readiness_state_id)||null;
  if(!readiness)throw Error('Choose the processing profile in Listings → Templates → '+LAYOUT_NAMES[layout]+' first.');
  const variants=buildOwnSilviaInventory({artworkId,catalog:products,readinessStateId:readiness,defaultQuantity:999,orientation:layout});
  // ChatGPT's style for a renewal, else the one the listing has.
  const oldStyle=(properties?.results||[]).find(p=>String(p.property_name||'').toLowerCase()==='style')?.values?.[0];
  const listingStyle=[style,oldStyle].find(value=>value&&canonicalWallArtStyle(value))||'';
  return {
    listing:{price:variants.minimumPrice,quantity:999,taxonomy_id:listingDefaults.taxonomyId,
      shipping_profile_id:body.shipping_profile_id||listing.shipping_profile_id,readiness_state_id:readiness,
      return_policy_id:body.return_policy_id||listing.return_policy_id,
      production_partner_ids:body.production_partner_ids.length?body.production_partner_ids:listing.production_partner_ids||[],
      who_made:body.who_made,when_made:body.when_made,is_supply:body.is_supply,should_auto_renew:body.should_auto_renew},
    inventory:variants,
    applyAttributes:listingStyle?async listingId=>{
      const result=await applyAllListingAttributes({session,listingId,body:{listing_style:listingStyle},
        properties:await getCachedTaxonomyProperties(session,listingDefaults.taxonomyId)});
      const failed=result.results?.filter(item=>!item.applied&&!item.optional)||[];
      if(failed.length)console.error('Renewed listing '+listingId+' attributes:',failed.map(item=>item.warning).join('; '));
    }:null
  };
}
// A reposted listing that the converter linked to its artwork stays linked:
// the new listing takes the old one's place in the converter map.
async function relinkReposted(oldId,newId){
  const mapping=await loadListingConverterMap(),source=mapping.listings?.[String(oldId)];
  if(!(source?.status==='converted'&&source.artworkId))return;
  const nextId=String(newId),other=mapping.listings[nextId];
  if(other&&other.artworkId!==source.artworkId)
    throw new Error('Replacement is already mapped to another artwork. Review Etsy listing manually.');
  mapping.listings[nextId]={...source,listingId:Number(nextId),status:'converted',
    replacedFromListingId:Number(oldId),repostedAt:new Date().toISOString()};
  mapping.listings[String(oldId)]={...source,status:'reposted',replacedByListingId:Number(nextId)};
  await saveListingConverterMap(mapping);
}
// SEO for a listing reposted with new mockups: ChatGPT's title, tags, style and
// description; the listing keeps its shop section.
async function refreshSeo(listingId){
  const session=await getEtsySession();
  const args={keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken};
  const listing=await getListing({listingId,...args});
  const [first]=await getEtsyListingImages({listingId,...args});
  if(!first)throw Error('This listing has no photos for ChatGPT to look at.');
  let layout='';
  try{layout=listingLayoutForManifest(await loadArtworkManifest(artworkIdFromInventory(await getListingInventory({listingId,...args}))))}catch{}
  const context=await seoShopContext(session);
  const seo=await generateEtsySeo({image:await seoImage(await etsyPhotoBuffer(first.url_fullxfull||first.url_570xN)),
    orientation:layout,previous:{title:listing.title,tags:listing.tags||[]},...context});
  const current=context.sections.find(item=>String(item.shop_section_id)===String(listing.shop_section_id||''));
  return {title:seo.title,tags:seo.tags,style:seo.style,description:seo.description,
    ...(current?{sectionId:String(current.shop_section_id),sectionName:current.title,sectionUrl:sectionUrl(context.shopName,current.shop_section_id)}
      :{sectionId:seo.sectionId,sectionName:seo.sectionName,sectionUrl:seo.sectionUrl})};
}
// Listing Reposter (listing-renewer.mjs). The mockup, draft and publish steps
// are the Daily Listings batch's (batchDeps).
const REPOST_PRESET_KEY='settings/listing-renewer/mockup-preset.json';
const listingFeesCache=new Map(); // month range → the fees read from Etsy, for 10 minutes
function renewalDeps(){
  const batch=batchDeps();
  const etsyArgs=async()=>{const s=await getEtsySession();return {keystring:s.keystring,sharedSecret:s.sharedSecret,accessToken:s.accessToken}};
  return {
    newId:()=>crypto.randomUUID(),
    loadJob:loadRenewalJob,
    saveJob:job=>putJsonObject(RENEWER_JOB_KEY,job),
    pause:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    listActive:async()=>allActiveListings(await getEtsySession()),
    salesCount:async id=>listingSalesCount(await getEtsySession(),id),
    // Whether the listing's artwork is in the app (it then gets new mockups), its shape and first photo.
    describe:async listingId=>{
      const args=await etsyArgs();
      const [inventory,[first]]=await Promise.all([getListingInventory({listingId,...args}),getEtsyListingImages({listingId,...args})]);
      let artworkId='',layout='';
      try{
        const id=artworkIdFromInventory(inventory),manifest=await loadArtworkManifest(id);
        if(manifest?.status==='ready'&&manifest.master?.key&&await artworkObjectExists(manifest.master.key)){artworkId=id;layout=listingLayoutForManifest(manifest)}
      }catch{}
      return {artworkId,layout,photo:first?.url_170x135||first?.url_570xN||''};
    },
    refreshSeo,
    startMockups:batch.startMockups,
    mockupStatus:batch.mockupStatus,
    // The artwork lets go of its old listing and mockups, so the new listing is
    // set up from scratch with this run's mockups (a draft left by an earlier
    // try of this listing is kept and finished).
    prepareArtwork:async row=>{
      const args=await etsyArgs(),manifest=await loadArtworkManifest(row.artworkId);
      let keepDraft=false;
      if(manifest?.etsyDraftListingId&&String(manifest.etsyDraftListingId)!==String(row.listingId))
        keepDraft=(await getListing({listingId:manifest.etsyDraftListingId,...args}).catch(()=>null))?.state==='draft';
      await updateArtworkManifest(row.artworkId,current=>{
        current.repostHistory=[...(current.repostHistory||[]),{at:new Date().toISOString(),fromListingId:Number(row.listingId),
          previousListingId:current.etsyDraftListingId||null,previousMockups:(current.mockups||[]).length}].slice(-20);
        current.mockups=[];current.selectedMockupTemplates={};delete current.etsyPhotoOrder;
        if(!keepDraft)for(const field of ['etsyDraftListingId','etsyDraftCreatedAt','etsyDraftSetup','etsyConfiguredAt','etsyConfiguration'])
          delete current[field];
      });
    },
    attachMockups:batch.attachMockups,
    savePhotoOrder:batch.savePhotoOrder,
    createDraft:batch.createDraft,
    draftSetup:batch.draftSetup,
    publish:batch.publish,
    deactivate:async(oldId,newId)=>{
      const session=await getEtsySession(),args=await etsyArgs();
      const old=await getListing({listingId:oldId,...args});
      if(old.state==='active')
        await withEtsyListingRetry(()=>updateListing({...args,shopId:session.shop.shop_id,listingId:oldId,listing:{state:'inactive'}}));
      const [oldAfter,newAfter]=await Promise.all([getListing({listingId:oldId,...args}),getListing({listingId:newId,...args})]);
      if(newAfter.state!=='active'||oldAfter.state!=='inactive')
        throw Error('Check both listings on Etsy: the new one is '+newAfter.state+', the old one '+oldAfter.state+'.');
      await relinkReposted(oldId,newId);
    },
    // A listing whose artwork is not in the app is copied (listing-reposter.mjs).
    record:async id=>{
      const session=await getEtsySession();
      try{return await getJsonObject('reposter/'+session.shop.shop_id+'/'+id+'/replacement.json')}
      catch(error){if(isMissingR2Object(error))return null;throw error}
    },
    newSeo:renewalSeo,
    prepare:async(id,input)=>prepareReplacement(await getEtsySession(),id,input,{automatic:true,
      template:context=>repostTemplate(context,{style:input.style})}),
    finalize:async id=>{
      const result=await finalizeReplacement(await getEtsySession(),id,'PUBLISH AND DEACTIVATE');
      await relinkReposted(id,result.record.draftId);
      return result;
    }
  };
}
function photoReplacerDeps(){
  let prepared=null,preparedKey='';
  const loadJob=async()=>{try{return await getJsonObject(PHOTO_REPLACER_JOB_KEY)}catch(error){if(isMissingR2Object(error))return null;throw error}};
  const etsyArgs=async()=>{const s=await getEtsySession();return {shopId:s.shop.shop_id,keystring:s.keystring,sharedSecret:s.sharedSecret,accessToken:s.accessToken}};
  return {
    newId:()=>crypto.randomUUID(),
    pause:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    loadJob,saveJob:job=>putJsonObject(PHOTO_REPLACER_JOB_KEY,job),
    listListings:async()=>(await allShopListingsForPriceSync(await getEtsySession())).map(item=>({
      listingId:Number(item.listing_id),title:item.title,state:item.state,artworkId:artworkIdFromSkus(item.skus)||null})),
    getImages:listingId=>photoReplacerImages(listingId),
    fetchImage:etsyPhotoBuffer,
    // The new photo as Etsy gets it (resized like the other listing photos).
    newImage:async()=>{
      const job=await loadJob();
      if(!job?.newImage?.key)throw Error('The new photo is missing; start again.');
      if(prepared&&preparedKey===job.newImage.key)return prepared;
      const optimized=await optimizeEtsyImageObject(await getArtworkObject(job.newImage.key));
      preparedKey=job.newImage.key;
      prepared={buffer:optimized.body,contentType:optimized.contentType||'image/jpeg',
        filename:String(job.newImage.filename||'photo').replace(/\.\w+$/,'')+(String(optimized.contentType).includes('png')?'.png':'.jpg')};
      return prepared;
    },
    uploadPhoto:async({listingId,rank,overwrite,buffer,filename,contentType})=>{
      const args=await etsyArgs();
      return withEtsyListingRetry(()=>uploadListingImage({...args,listingId,imageBuffer:buffer,filename,contentType,rank,overwrite}));
    },
    deletePhoto:async({listingId,listingImageId})=>withEtsyListingRetry(async()=>deleteListingImage({...await etsyArgs(),listingId,listingImageId})),
    setRank:async({listingId,listingImageId,rank})=>withEtsyListingRetry(async()=>setListingImageRank({...await etsyArgs(),listingId,listingImageId,rank})),
    // New drafts use the new photo too: it is saved over the preset, in the preset's format.
    updatePreset:async role=>{
      const preset=PRESET_MEDIA.find(item=>item.role===role&&role!=='video');
      const job=await loadJob();
      if(!preset||!job?.newImage?.key)return;
      const source=(await getArtworkObject(job.newImage.key)).body;
      const body=preset.contentType==='image/png'?await sharp(source).rotate().png().toBuffer():await sharp(source).rotate().jpeg({quality:92}).toBuffer();
      await putArtworkObject({key:preset.key,body,contentType:preset.contentType});
      presetEtsyImages.delete(preset.key);
    },
    // The app's record of which Etsy photo is which follows the swap.
    onReplaced:async({artworkId,oldImageId,newImageId})=>{
      if(!artworkId)return;
      const job=await loadJob();
      await updateArtworkManifest(artworkId,current=>{
        for(const receipt of current?.etsyMedia?.images||[]){
          if(String(receipt.listingImageId)!==String(oldImageId))continue;
          receipt.listingImageId=String(newImageId);
          if(!(job?.updatePreset&&PRESET_MEDIA.some(item=>item.key===receipt.key))){
            receipt.key=job?.newImage?.key||receipt.key;receipt.filename=job?.newImage?.filename||receipt.filename;
          }
        }
      });
    }
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

  // Prefer exact Style over Homestyle (or Size/Product - Style).
  const byName = properties.find(property=>propertyNames(property).includes(wantedName))
    || properties.find(property=>{
      const names=propertyNames(property);
      return names.some(name=>name.includes(wantedName)||wantedName.includes(name));
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

// Etsy-ready (2400 px) copies of generated mockups are made by the PC worker,
// so the server does not download and resize full-size originals with Render's
// small CPU and memory. Preset photos are resized once and kept in memory. (The
// master artwork is never an Etsy photo.)
const presetEtsyImages=new Map();
async function etsyReadyImage(key,{etsyKey=''}={}){
  if(etsyKey){
    try{return {...await getArtworkObject(etsyKey),etsyReady:true}}catch{}
  }
  if(presetEtsyImages.has(key))return presetEtsyImages.get(key);
  const optimized={...await optimizeEtsyImageObject(await getArtworkObject(key)),etsyReady:true};
  if(PRESET_MEDIA.some(item=>item.key===key))presetEtsyImages.set(key,optimized);
  return optimized;
}
const etsyKeyForMedia=(manifest,key)=>(manifest?.mockups||[]).find(m=>m.key===key)?.etsyKey||'';

// The preset video is uploaded to Etsy once per shop; later drafts attach it
// by its video_id instead of downloading and uploading it again.
const PRESET_VIDEO_IDS_KEY='presets/listing-media/etsy-video-ids.json';
async function presetVideoId(shopId,key){
  try{const ids=await getJsonObject(PRESET_VIDEO_IDS_KEY);const row=ids?.[String(shopId)];return row?.key===key?row.videoId:null}
  catch{return null}
}
// The shop's sections and name, for ChatGPT to choose a section (cached 10 minutes).
let seoShopCache={at:0,shopId:'',value:null};
async function seoShopContext(session){
  const shopId=String(session.shop.shop_id);
  if(seoShopCache.value&&seoShopCache.shopId===shopId&&Date.now()-seoShopCache.at<10*60*1000)return seoShopCache.value;
  const sections=await getShopSections({shopId,keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken});
  const value={sections:sections.results||sections||[],shopName:session.shop.shop_name||''};
  seoShopCache={at:Date.now(),shopId,value};
  return value;
}
// A replaced or removed preset video must be uploaded to Etsy again.
async function forgetPresetVideoIds(){await putJsonObject(PRESET_VIDEO_IDS_KEY,{})}
async function savePresetVideoId(shopId,key,videoId){
  let ids={};try{ids=await getJsonObject(PRESET_VIDEO_IDS_KEY)||{}}catch{}
  ids[String(shopId)]={key,videoId,savedAt:new Date().toISOString()};
  await putJsonObject(PRESET_VIDEO_IDS_KEY,ids);
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
      const rateLimited=/\(429\)|rate.?limit|exceeded per second/i.test(String(error?.message||error));
      if ((!isEtsyListingConflict(error)&&!rateLimited) || attempt === attempts) throw error;
      const delay = rateLimited
        ?Math.min(30000,1200*Math.pow(2,attempt-1))+Math.floor(Math.random()*500)
        :Math.min(2500,baseDelayMs*attempt+Math.floor(Math.random()*180));
      await sleepMs(delay);
    }
  }
  throw lastError;
}

async function prepareMediaPlan({ session, manifest }) {
  const customMedia = Array.isArray(manifest?.mockups) ? manifest.mockups : [];
  const presetStatus = await presetMediaStatus();
  // Reusable presets are optional. A missing R2 preset must NEVER prevent
  // the master artwork or user-uploaded mockups from reaching the Etsy draft.
  const installedPresets = presetStatus.items.filter(item=>item.exists);
  const missingPresetRoles = presetStatus.items.filter(item=>!item.exists).map(item=>item.role);

  const customImages = customMedia.filter(item =>
    String(item?.contentType||'').startsWith('image/')
  // Etsy's 20 photos, less the preset photos installed (the Product Creator lets
  // the same number of mockups be picked).
  ).slice(0,ETSY_PHOTO_LIMIT-installedPresets.filter(item=>item.role!=='video').length);
  const starterOnly=customImages.length===0;
  // The locked reference is only an ordering hint. No active listing is needed.
  const reference=starterOnly?null:currentMockupReference(session);
  const presetImageRanks = new Map([
    [2, 'choose-option'],
    [5, 'choose-frame'],
    [15, 'promotion']
  ]);
  const referenceCustomImages = (reference?.images || []).filter((_, index) =>
    !presetImageRanks.has(index + 1)
  );
  // Never reject a draft because matching images is slow, unavailable, or uncertain.
  // In that case preserve the user's uploaded JPG order instead.
  let sortResult={
    items:customImages,
    applied:false,
    reason:starterOnly?'Draft created from the preset images (the master artwork is never an Etsy photo)':
      'No reliable locked reference; preserving uploaded mockup order',
    averageScore:null,
    matches:[],
    preparedBuffers:new Map()
  };
  if(!starterOnly&&referenceCustomImages.length){
    try{
      // The original locked template identifies only its first 12 artwork mockups.
      // Place up to 5 additional mockups after that group, reaching Etsy's 20-photo limit.
      const referenceCandidates=customImages.slice(0,12);
      const matched=await sortCustomMockupsByReference({
        customMedia:referenceCandidates,
        referenceImages:referenceCustomImages,
        getObject:getArtworkObject
      });
      const required=Math.min(referenceCandidates.length,referenceCustomImages.length);
      if(matched.applied&&(matched.matches||[]).length===required){
        sortResult={...matched,items:[...matched.items,...customImages.slice(12)]};
      }else{
        sortResult.reason=(matched.reason||'No reliable match')+'; preserving uploaded mockup order';
      }
    }catch(error){
      sortResult.reason='Mockup reference lookup failed; preserving uploaded mockup order: '+
        String(error?.message||error).slice(0,100);
    }
  }

  const presetByRole = new Map(installedPresets.map((item) => [item.role, {
    key: item.key,
    contentType: item.contentType,
    originalFilename: item.filename,
    presetRole: item.role
  }]));

  // Convert the stable v3 reference-slot identities into the exact canonical
  // 15-image shop layout shown in the approved Etsy listing.
  const canonicalCustomItems = starterOnly ? [] :
    (sortResult.applied ? canonicalCustomMockupOrder(sortResult.items) : sortResult.items);

  const orderedImages = starterOnly ? (
    presetStatus.configured
      ? starterDraftMedia(manifest.master,PRESET_MEDIA).filter(item=>item.presetRole!=='video')
      : installedPresets.filter(item=>item.role!=='video').map(item=>({
          key:item.key,contentType:item.contentType,originalFilename:item.filename,presetRole:item.role
        }))
  ) : [];
  let customIndex = 0;
  const totalImageCount = canonicalCustomItems.length + installedPresets.filter(item=>item.role!=='video').length;
  for (let rank = 1; !starterOnly && rank <= totalImageCount; rank += 1) {
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
  // For partial batches (e.g. 1–7 JPGs), ranks 5 and 15 may be beyond
  // the batch length. Still attach all 3 reusable shop images.
  if(!starterOnly){
    for(const role of ['choose-option','choose-frame','promotion']){
      const preset=presetByRole.get(role);
      if(preset&&!orderedImages.some(image=>image.presetRole===role))orderedImages.push(preset);
    }
  }

  const videoPreset = presetByRole.get('video');
  // Photos the organizer put after Etsy's 20 (e.g. a preset moved below the
  // line to make room for mockups) are not added.
  const pastLimit = new Set((manifest?.etsyPhotoOrder?.tiles || []).slice(ETSY_PHOTO_LIMIT));
  const keptImages = orderedImages.filter((item) => !pastLimit.has('key:' + item.key));
  const mediaItems = videoPreset ? [...keptImages, videoPreset] : keptImages;
  const existingImages = new Map((manifest.etsyMedia?.images || []).map((item) => [item.key, item]));
  const preparedBuffers = sortResult.preparedBuffers instanceof Map
    ? sortResult.preparedBuffers
    : new Map();

  const reusableVideoId = videoPreset ? await presetVideoId(session.shop.shop_id, videoPreset.key) : null;
  const needBuffers = mediaItems.filter((item) => {
    if (String(item.contentType || '').startsWith('video/')) {
      if (reusableVideoId) return false; // attached by its Etsy video_id
      return !(manifest.etsyMedia?.video?.videoId && manifest.etsyMedia?.video?.key === item.key);
    }
    return !existingImages.get(item.key)?.listingImageId && !preparedBuffers.has(item.key);
  });

  const fetched = await mapWithConcurrency(needBuffers, 4, async (item) => {
    if (String(item.contentType || '').startsWith('image/'))
      return [item.key, await etsyReadyImage(item.key, { etsyKey: etsyKeyForMedia(manifest, item.key) })];
    return [item.key, await getArtworkObject(item.key)];
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
  await mapWithConcurrency(imageKeys, 2, async (key) => {
    const object = objectByKey.get(key);
    if (!object || object.etsyReady) return;
    objectByKey.set(key, await optimizeEtsyImageObject(object));
  });

  return {
    mediaItems,
    reusableVideoId,
    missingPresetRoles,
    installedPresetRoles:installedPresets.map(item=>item.role),
    objectByKey,
    sort: {
      applied: !starterOnly && Boolean(sortResult.applied),
      reason: sortResult.reason || null,
      averageScore: sortResult.averageScore ?? null,
      referenceListingId: reference?.listingId || null,
      referenceTitle: reference?.title || null,
      presetImageRanks: Object.fromEntries([...presetImageRanks.entries()].map(([rank, role]) => [role, rank])),
      canonicalLayoutApplied: sortResult.applied && canonicalCustomItems.length >= 12,
      canonicalLayoutVersion: sortResult.applied && canonicalCustomItems.length >= 12 ? 'silvia-15-v1' : null,
      matches: sortResult.matches || []
    }
  };
}

// Photo uploads to one listing. Three run at a time while Etsy accepts that.
// When Etsy refuses a simultaneous edit of the listing (HTTP 409) or asks to
// slow down (429), this upload goes on with one lane fewer, and uploads in the
// next 10 minutes start at that lower number; after that the full speed is
// tried again (a single refusal used to mean one at a time until a restart).
// Photos are read from R2 ahead of their turn, and each receipt is handed to
// onUploaded as it arrives, so none is lost if a later upload fails.
const ETSY_PHOTO_LANES=3,ETSY_LANE_COOLDOWN_MS=10*60*1000;
let etsyLaneLimit=ETSY_PHOTO_LANES,etsyLaneLimitAt=0;
function etsyStartingLanes(now=Date.now()){
  if(now-etsyLaneLimitAt>ETSY_LANE_COOLDOWN_MS)etsyLaneLimit=ETSY_PHOTO_LANES;
  return etsyLaneLimit;
}
async function uploadPhotosToListing({session,listingId,altText='',photos,onUploaded=()=>{}}){
  const reads=new Map();
  const readAhead=index=>{
    if(index>=photos.length||reads.has(index))return;
    const read=photos[index].read();
    read.catch(()=>{});
    reads.set(index,read);
  };
  let next=0,lanes=etsyStartingLanes(),parallel=false;
  const inFlight=new Set();
  // One-at-a-time uploads (including the retry of a refused one) queue here.
  let queue=Promise.resolve();
  const oneAtATime=task=>{const run=queue.then(task,task);queue=run.catch(()=>{});return run};
  const send=(photo,object,serial)=>{
    const call=()=>uploadListingImage({shopId:session.shop.shop_id,listingId,imageBuffer:object.body,
      filename:photo.filename,contentType:object.contentType||'image/jpeg',rank:photo.rank,altText,
      keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken});
    return serial?withEtsyListingRetry(call,{attempts:8,baseDelayMs:180}):call();
  };
  const lane=async id=>{
    while(id<lanes&&next<photos.length){
      const index=next++;
      readAhead(index);readAhead(index+lanes);
      const photo=photos[index],object=await reads.get(index);
      if(typeof photo.rank==='function')photo.rank=photo.rank();
      let result;
      const attempt=lanes>1?send(photo,object,false):oneAtATime(()=>send(photo,object,true));
      if(lanes>1)parallel=true;
      inFlight.add(attempt);
      try{result=await attempt}
      catch(error){
        const refused=isEtsyListingConflict(error)||/\(429\)|rate.?limit/i.test(String(error?.message||error));
        if(!refused||(lanes===1&&!parallel))throw error;
        if(lanes>1){
          lanes--;etsyLaneLimit=Math.min(etsyLaneLimit,lanes);etsyLaneLimitAt=Date.now();
          console.warn('Etsy refused simultaneous photo uploads; continuing with '+lanes+' at a time.');
        }
        // Retry once the other upload has finished, so Etsy is not asked again
        // while the listing is still busy.
        inFlight.delete(attempt);
        await Promise.allSettled([...inFlight]);
        result=await oneAtATime(()=>send(photo,object,true));
      }finally{inFlight.delete(attempt)}
      const listingImageId=result?.listing_image_id||result?.listingImageId||null;
      if(!listingImageId)throw Error('Etsy returned no image ID for '+photo.filename+
        '. Do not consider it uploaded; inspect the Etsy listing before retrying.');
      await onUploaded(photo,listingImageId);
    }
  };
  const settled=await Promise.allSettled(Array.from({length:lanes},(_,id)=>lane(id)));
  const failed=settled.find(result=>result.status==='rejected');
  if(failed)throw failed.reason;
  return {parallel};
}
// Simultaneous uploads can land a place or two off: puts the given photos
// (listing image IDs, in order) first and the others after them as they are.
async function ensureListingPhotoOrder({session,listingId,orderedIds}){
  const live=(await getEtsyListingImages({listingId,keystring:session.keystring,
    sharedSecret:session.sharedSecret,accessToken:session.accessToken}))
    .slice().sort((a,b)=>Number(a.rank)-Number(b.rank));
  const desired=desiredImageOrder({order:orderedIds.map(id=>'etsy:'+id),liveImages:live});
  const updates=rankUpdates(live.map(image=>String(image.listing_image_id)),desired);
  for(const update of updates){
    await withEtsyListingRetry(()=>setListingImageRank({shopId:session.shop.shop_id,listingId,
      listingImageId:update.listingImageId,rank:update.rank,keystring:session.keystring,
      sharedSecret:session.sharedSecret,accessToken:session.accessToken}),{attempts:6,baseDelayMs:220});
  }
  return updates.length;
}

// The preset photos of a new draft (the video follows the mockups, see
// uploadPreparedVideoToEtsy).
async function uploadPreparedMediaToEtsy({ session, listingId, manifest, plan }) {
  manifest.etsyMedia ||= { images: [], video: null };
  const existingImages = new Map((manifest.etsyMedia.images || []).map((item) => [item.key, item]));
  const imageItems = plan.mediaItems
    .filter((item) => String(item.contentType || '').startsWith('image/'))
    .map((item, index) => ({ item, rank: index + 1 }));

  const uploadStartedAt=Date.now();
  let originalImageBytes=0,uploadImageBytes=0;
  const uploadedImages=new Array(imageItems.length);
  const readRemoteImages=()=>getEtsyListingImages({
    listingId,keystring:session.keystring,sharedSecret:session.sharedSecret,
    accessToken:session.accessToken
  });
  const initialRemoteIds=receivedEtsyImageIds(await readRemoteImages());
  const photos=[];
  imageItems.forEach(({item,rank},index)=>{
    const previous=existingImages.get(item.key);
    if(previous?.listingImageId&&initialRemoteIds.has(String(previous.listingImageId))){
      uploadedImages[index]={...previous,rank};return;
    }
    photos.push({index,item,rank,
      filename:String(item.originalFilename||item.key.split('/').pop()||'listing-image.jpg'),
      read:async()=>{
        const object=plan.objectByKey.get(item.key)||await getArtworkObject(item.key);
        originalImageBytes+=Number(object.originalBytes||object.body?.length||0);
        uploadImageBytes+=Number(object.uploadBytes||object.body?.length||0);
        return {...object,contentType:object.contentType||item.contentType||'image/jpeg'};
      }});
  });
  const {parallel}=await uploadPhotosToListing({session,listingId,altText:manifest.title||'',photos,
    onUploaded:async(photo,listingImageId)=>{
      const receipt={listingImageId,key:photo.item.key,filename:photo.filename,rank:photo.rank};
      uploadedImages[photo.index]=receipt;
      // Do not lose successful uploads if a later image or preset video fails.
      // Always merge against the latest R2 manifest (not the stale draft snapshot).
      const latest=await updateArtworkManifest(manifest.artworkId,current=>{
        current.etsyMedia||={images:[],video:null};
        current.etsyMedia.images=[
          ...(current.etsyMedia.images||[]).filter(row=>row.key!==photo.item.key),
          receipt
        ];
      });
      manifest.etsyMedia=latest.etsyMedia;
    }});
  if(parallel)await ensureListingPhotoOrder({session,listingId,
    orderedIds:uploadedImages.filter(Boolean).map(row=>String(row.listingImageId))});

  // Persist media state once instead of doing an R2 manifest write after every
  // image. This removes a large number of network round-trips during drafts.
  // Read Etsy again after upload processing to verify every requested image.
  // Nothing to check when every preset photo was moved past Etsy's 20.
  const confirmed=uploadedImages.some(Boolean)?await verifyEtsyImageReceipts({
    receipts:uploadedImages.filter(Boolean),readImages:readRemoteImages
  }):{verified:0,remoteCount:0};
  const latestManifest=await updateArtworkManifest(manifest.artworkId,current=>{
    current.etsyMedia||={images:[],video:null};
    current.etsyMedia.images=[
      ...(current.etsyMedia.images||[]).filter(row=>
        !uploadedImages.some(item=>item?.key===row.key)),
      ...uploadedImages.filter(Boolean)
    ].sort((a,b)=>a.rank-b.rank);
    current.mockupSort=plan.sort;
    current.etsyMediaVerifiedAt=new Date().toISOString();
  });
  manifest.etsyMedia=latestManifest.etsyMedia;

  return {
    imageCount: confirmed.verified,
    verifiedImageCount: confirmed.verified,
    verificationRemoteCount: confirmed.remoteCount,
    missingPresetRoles:plan.missingPresetRoles||[],
    videoUploaded: Boolean(manifest.etsyMedia.video?.videoId),
    uploadMs: Date.now() - uploadStartedAt,
    originalImageBytes,
    uploadImageBytes,
    bytesSaved: Math.max(0, originalImageBytes - uploadImageBytes),
    mockupSort: plan.sort
  };
}

// The preset video goes on once the photos are up: its place on Etsy (second)
// does not depend on when it is added, and a first-time upload of the file is
// the slowest step of a draft.
async function uploadPreparedVideoToEtsy({ session, listingId, manifest, plan }) {
  manifest.etsyMedia ||= { images: [], video: null };
  const videoItem = plan.mediaItems.find((item) => String(item.contentType || '').startsWith('video/')) || null;
  let video = manifest.etsyMedia.video || null;
  if (
    videoItem &&
    !(manifest.etsyMedia.video?.videoId && manifest.etsyMedia.video?.key === videoItem.key)
  ) {
    const filename = String(videoItem.originalFilename || videoItem.key.split('/').pop() || 'listing-video.mov');
    let uploaded = null;
    if (plan.reusableVideoId) {
      uploaded = await withEtsyListingRetry(() => attachListingVideo({
        shopId: session.shop.shop_id, listingId, videoId: plan.reusableVideoId, name: filename,
        keystring: session.keystring, sharedSecret: session.sharedSecret, accessToken: session.accessToken
      }), { attempts: 4, baseDelayMs: 180 }).catch(() => null);
    }
    if (!uploaded) {
      const object = plan.objectByKey.get(videoItem.key) || await getArtworkObject(videoItem.key);
      uploaded = await withEtsyListingRetry(() => uploadListingVideo({
        shopId: session.shop.shop_id,
        listingId,
        videoBuffer: object.body,
        filename,
        contentType: object.contentType || videoItem.contentType || 'video/quicktime',
        keystring: session.keystring,
        sharedSecret: session.sharedSecret,
        accessToken: session.accessToken
      }), { attempts: 8, baseDelayMs: 180 });
      if (videoItem.presetRole === 'video' && uploaded?.video_id)
        await savePresetVideoId(session.shop.shop_id, videoItem.key, uploaded.video_id).catch(() => {});
    }
    video = {
      videoId: uploaded.video_id || plan.reusableVideoId || null,
      key: videoItem.key,
      filename
    };
  }
  const latest=await updateArtworkManifest(manifest.artworkId,current=>{
    current.etsyMedia||={images:[],video:null};
    current.etsyMedia.video=video;
  });
  manifest.etsyMedia=latest.etsyMedia;
  return Boolean(video?.videoId);
}

// Follow-up regular JPG uploads can arrive after the draft has been created.
 // Only update an unpublished draft, and verify each new Etsy image receipt.
const regularMockupSyncActive=new Set();
async function syncRegularMockupsToEtsy(artworkId){
 const manifest=await loadArtworkManifest(artworkId);
 if(!manifest?.etsyDraftListingId)
  return {pendingDraft:true,message:'Mockups saved in R2; Etsy draft has not been created.'};
 if(inflightDraftSetups.has(artworkId))
  return {pendingSetup:true,message:'Mockups saved in R2; Etsy draft setup is currently processing.'};
 const session=await getEtsySession(),listingId=Number(manifest.etsyDraftListingId);
 const listing=await getListing({listingId,keystring:session.keystring,
  sharedSecret:session.sharedSecret,accessToken:session.accessToken});
 if(!['draft','active'].includes(String(listing.state)))
  throw Error('Mockups remain saved in R2. Etsy images can only be added to an editable draft or active listing (current state: '+String(listing.state)+').');
 const readImages=()=>getEtsyListingImages({
  listingId,keystring:session.keystring,sharedSecret:session.sharedSecret,
  accessToken:session.accessToken
 });
 // The master artwork is never added as an Etsy photo, even to a draft with none.
 const remote=await readImages();
 const existingIds=receivedEtsyImageIds(remote);
 const recorded=new Map((await loadArtworkManifest(artworkId)).etsyMedia?.images?.map(row=>[row.key,row])||[]);
 // Include new uploads and legacy manually uploaded images, but NEVER
 // PSD-generated JPGs that the customer has not explicitly selected.
 const needed=(manifest.mockups||[]).filter(row=>!row.generatedFromKey&&row.key&&
  !(recorded.get(row.key)?.listingImageId&&existingIds.has(String(recorded.get(row.key).listingImageId))));
 let uploaded=0,count=remote.length;
 const newlyUploaded=[];
 for(const item of needed){
  if(count>=20)throw Error('Etsy draft reached its 20-photo limit; '+(needed.length-uploaded)+
   ' regular mockup(s) remain saved in R2.');
  const optimized=await etsyReadyImage(item.key,{etsyKey:item.etsyKey||''});
  const result=await withEtsyListingRetry(()=>uploadListingImage({
   shopId:session.shop.shop_id,listingId,imageBuffer:optimized.body,
   filename:item.originalFilename||item.key.split('/').pop(),
   contentType:optimized.contentType||item.contentType,
   rank:count+1,altText:manifest.title||'',keystring:session.keystring,
   sharedSecret:session.sharedSecret,accessToken:session.accessToken
  }),{attempts:8,baseDelayMs:180});
  const listingImageId=result?.listing_image_id||result?.listingImageId||null;
  if(!listingImageId)throw Error('Etsy returned no image ID for '+item.originalFilename);
  count++;uploaded++;
  const receipt={key:item.key,filename:item.originalFilename,rank:count,listingImageId};
  newlyUploaded.push(receipt);
  await updateArtworkManifest(artworkId,updated=>{
    updated.etsyMedia||={images:[],video:null};
    updated.etsyMedia.images=[
      ...(updated.etsyMedia.images||[]).filter(row=>row.key!==item.key),receipt
    ];
  });
 }
 if(newlyUploaded.length){
  const verified=await verifyEtsyImageReceipts({receipts:newlyUploaded,readImages});
  await updateArtworkManifest(artworkId,updated=>{
    if(updated.etsyDraftSetup?.media){
      updated.etsyDraftSetup.media.imageCount=verified.remoteCount;
      updated.etsyDraftSetup.media.verifiedImageCount=verified.remoteCount;
    }
  });
 }
 return {ok:true,uploaded,photoCount:count,verified:true};
}
async function queueRegularMockupEtsySync(artworkId){
 if(regularMockupSyncActive.has(artworkId))return {processing:true};
 const initial=await loadArtworkManifest(artworkId);
 if(!initial?.etsyDraftListingId)return {pendingDraft:true};
 if(inflightDraftSetups.has(artworkId))
  return {pendingSetup:true};
 regularMockupSyncActive.add(artworkId);
 await updateArtworkManifest(artworkId,latest=>{
   latest.regularMockupSync={status:'running',startedAt:new Date().toISOString()};
 });
 void (async()=>{
  try{
   const result=await syncRegularMockupsToEtsy(artworkId);
   await updateArtworkManifest(artworkId,latest=>{
     latest.regularMockupSync={status:'completed',...result,
       completedAt:new Date().toISOString()};
   });
  }catch(error){
   console.error('[regular mockups Etsy sync] '+artworkId+': '+error.message);
   await updateArtworkManifest(artworkId,latest=>{
     latest.regularMockupSync={status:'failed',error:String(error.message||error).slice(0,650),
       failedAt:new Date().toISOString()};
   }).catch(()=>{});
  }finally{regularMockupSyncActive.delete(artworkId)}
 })();
 return {processing:true};
}

async function applyAllListingAttributes({ session, listingId, body, properties }) {
  const requested = [
    ...styleAttributes(listingDefaults.fixedAttributes,body.listing_style),
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


class ConversionHttpError extends Error{
 constructor(status,details){
  super(String(details?.error||'Etsy conversion failed.'));
  this.status=status;this.details=details;
 }
}
function conversionReply(status,payload){
 if(status>=400)throw new ConversionHttpError(status,payload);
 return payload;
}
const SHIPPING_CACHE_TTL=10*60*1000;
const converterShippingCache=new Map();
async function cachedConverterShippingProfiles(session){
 const key=String(session.shop.shop_id),existing=converterShippingCache.get(key);
 if(existing&&existing.expires>Date.now())return existing.data||existing.pending;
 const pending=getShopShippingProfiles({
  shopId:session.shop.shop_id,keystring:session.keystring,
  sharedSecret:session.sharedSecret,accessToken:session.accessToken
 });
 converterShippingCache.set(key,{expires:Date.now()+SHIPPING_CACHE_TTL,pending});
 try{
  const data=await pending;
  converterShippingCache.set(key,{expires:Date.now()+SHIPPING_CACHE_TTL,data});
  return data;
 }catch(error){converterShippingCache.delete(key);throw error}
}
// Keep the full listing text and actual Etsy shop-section assignment. Etsy
// sometimes normalizes line endings or whitespace; missing words/links never pass.
async function ensureConverterListingSeo(session,listingId,expectedDescription,originalShopSectionId){
 const args={listingId,keystring:session.keystring,
  sharedSecret:session.sharedSecret,accessToken:session.accessToken};
 let latest=await getListing(args);
 let report=listingSeoPreservation(latest,expectedDescription,originalShopSectionId);
 if(report.ok)return latest;
 // Read-after-write can be briefly stale. Check before issuing a second PATCH.
 for(let attempt=0;attempt<2;attempt++){
  await sleepMs(800);
  latest=await getListing(args);
  report=listingSeoPreservation(latest,expectedDescription,originalShopSectionId);
  if(report.ok)return latest;
 }
 const correction={};
 if(!report.descriptionPreserved)correction.description=expectedDescription;
 if(!report.sectionPreserved)correction.shop_section_id=Number(originalShopSectionId);
 await withEtsyListingRetry(()=>updateListing({
  shopId:session.shop.shop_id,listingId,listing:correction,
  keystring:session.keystring,sharedSecret:session.sharedSecret,
  accessToken:session.accessToken
 }));
 for(let attempt=0;attempt<4;attempt++){
  if(attempt)await sleepMs(800);
  latest=await getListing(args);
  report=listingSeoPreservation(latest,expectedDescription,originalShopSectionId);
  if(report.ok)return latest;
 }
 throw Error('Etsy could not verify preserved listing content: '+
  [!report.descriptionPreserved?'description text or shop-section URL differs':null,
   !report.sectionPreserved?'shop section assignment differs':null].filter(Boolean).join('; ')+
   (!report.descriptionPreserved?' '+describeEtsyDescriptionDifference(latest.description,expectedDescription):'')+
   ' The original description remains saved in the converter recovery record.');
}

async function performListingConversion(body){
      const listingId = Number(body.listingId);
      const artworkId = String(body.artworkId || '').trim().toUpperCase();
      if (!Number.isInteger(listingId) || listingId <= 0 || !/^SAC\d+$/.test(artworkId)) {
        return conversionReply(400, { ok: false, error: 'A valid listing ID and SAC artwork ID are required.' });
      }

      const manifest = await loadArtworkManifest(artworkId);
      if (!manifest?.master?.key || manifest.status !== 'ready') {
        return conversionReply(400, { ok: false, error: `${artworkId} has not finished uploading to Cloudflare R2.` });
      }
      // A valid R2 manifest without its master is not a fully linked artwork.
      if(!(await artworkObjectExists(manifest.master.key)))
        return conversionReply(409,{ok:false,error:'Artwork '+artworkId+
          ' has no master file in Cloudflare R2. Conversion stopped before Etsy changes.'});
      // Explicit reconversion reuses the exact artwork ID already linked to this listing.
      // A second conversion must never reserve another ID or cross-link different artwork.
      const reconvert = body.reconvert === true;
      const mapBefore = await loadListingConverterMap();
      const prior = mapBefore.listings?.[String(listingId)] || null;
      if (!prior || prior.artworkId !== artworkId ||
          (reconvert ? prior.status !== 'converted' :
           !['reserved','converted'].includes(prior.status))) {
        return conversionReply(409, { ok: false,
          error: 'The listing-to-artwork link changed. Refresh listings before converting; no Etsy changes were made.' });
      }
      if (!hasAuthorizedConverterLink({
        listingId, sourceListingId: manifest.sourceEtsyListingId,
        artworkId, reconvert, mappings: mapBefore.listings
      })) {
        return conversionReply(409, { ok:false,
          error: 'Artwork ownership could not be verified for this Etsy listing or its reposting history. No Etsy changes were made.' });
      }

      // A Render restart can happen AFTER Etsy and R2 were verified but
      // BEFORE the queue receipt is marked completed. Verify state instead of
      // treating that already-finished job as a failed duplicate.
      const alreadyApplied=prior.status==='converted'&&(
        (reconvert&&manifest.lastArtworkReconversion?.revision===String(body.revision||''))||
        (!reconvert&&Number(manifest.etsyConfiguration?.listingId)===listingId)
      );
      if(alreadyApplied){
        const session=await getEtsySession({forceRefresh:true});
        const inventory=await getListingInventory({
          listingId,keystring:session.keystring,sharedSecret:session.sharedSecret,
          accessToken:session.accessToken
        });
        const enabled=enabledInventoryProducts(inventory);
        if(!enabled.length||enabled.some(p=>!String(p.sku||'').startsWith(artworkId+'-'))||
           priceSyncPlanForInventory(inventory).changed)
          throw Error('Previously completed conversion could not be verified against current Etsy variants and pricing.');
        const recoveryListing=await getListing({
          listingId,keystring:session.keystring,sharedSecret:session.sharedSecret,
          accessToken:session.accessToken
        });
        const recoveryDescription=reviseCanvasThickness(
          String(prior.originalDescription||recoveryListing.description||''));
        await ensureConverterListingSeo(session,listingId,recoveryDescription,
          Number(recoveryListing.shop_section_id)||null);
        if(reconvert){
          const historical=Array.isArray(prior.reconversionHistory)?prior.reconversionHistory:[];
          if(!historical.some(entry=>entry.revision===body.revision)){
            const when=manifest.lastArtworkReconversion?.activatedAt||new Date().toISOString();
            mapBefore.listings[String(listingId)]={
              ...prior,lastReconvertedAt:when,
              reconversionCount:Math.max(0,Number(prior.reconversionCount)||0)+1,
              reconversionHistory:[...historical,{at:when,artworkId,
                enabledVariants:enabled.length,revision:body.revision,
                masterKey:manifest.master.key}].slice(-10),
              cropJobId:manifest.cropWorkerJobId
            };
            await saveListingConverterMap(mapBefore);
          }
        }
        return conversionReply(200,{ok:true,verified:true,recovered:true,
          listingId,artworkId,enabledVariants:enabled.length,
          reconverted:reconvert,replacementMasterActivated:reconvert,
          artworkRevision:reconvert?String(body.revision):null,
          reconversionCount:mapBefore.listings[String(listingId)].reconversionCount||0});
      }
      if(prior.status==='converted'&&!reconvert)
        return conversionReply(409,{ok:false,
          error:'This listing is already converted. Use Reconvert listing with a fresh master artwork.'});

      let replacement=null;
      if(reconvert){
        const revision=String(body.revision||'').trim();
        if(!/^[0-9a-f-]{36}$/i.test(revision))
          return conversionReply(400,{ok:false,
           error:'Upload a new master artwork and complete the new crop job before reconverting.'});
        try{
          const session=await getEtsySession({forceRefresh:true});
          replacement=await assertConverterArtworkReady({
           shopId:session.shop.shop_id,listingId,artworkId,revision
          });
        }catch(error){
          return conversionReply(409,{ok:false,
           error:'New artwork crops are not verified: '+String(error?.message||error)});
        }
      }
      const cropJobId = String(reconvert?replacement.record.jobId:(manifest.cropWorkerJobId||''));
      const cropJob = cropJobId ? await getCropJob(cropJobId) : null;
      if (!cropJob || cropJob.status !== 'completed') {
        return conversionReply(409, {
          ok: false,
          error: 'The production crop job must finish before the Etsy listing can be converted.'
        });
      }

      const session = await getEtsySession({ forceRefresh: true });
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_r') || !scopes.has('listings_w')) {
        return conversionReply(403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy with listings_r and listings_w before converting listings.'
        });
      }

      const listings = await allShopListingsForPriceSync(session);
      const listing = listings.find(item => Number(item.listing_id) === listingId);
      if (!listing) {
        return conversionReply(404, { ok: false, error: 'The Etsy listing is no longer active or draft.' });
      }
      // Capture the full original description before mutating a Gelato listing.
      // This includes the shop-section heading and its direct Etsy URL.
      const originalListing=await getListing({
        listingId,keystring:session.keystring,sharedSecret:session.sharedSecret,
        accessToken:session.accessToken
      });
      // Initial conversions capture their SEO before Etsy's first structural write.
      // A failed conversion can then recover the ORIGINAL text, not an already
      // modified description returned by Etsy on the next retry.
      const savedDescription=!reconvert&&typeof prior.originalDescription==='string'&&
        prior.originalDescription.trim()?prior.originalDescription:null;
      const originalDescription=savedDescription||String(originalListing.description||'');
      if(!originalDescription.trim())
        throw Error('Cannot safely convert a listing whose Etsy description could not be verified.');
      const originalShopSectionId=Number(
        (!reconvert&&prior.originalShopSectionId)||originalListing.shop_section_id
      )||null;
      const expectedDescription=reviseCanvasThickness(originalDescription);
      if(expectedDescription.length>13000)
        throw Error('Corrected Etsy description exceeds 13,000 characters.');
      if(!reconvert&&!savedDescription){
        const snapshotMap=await loadListingConverterMap();
        const current=snapshotMap.listings?.[String(listingId)];
        if(!current||current.artworkId!==artworkId||current.status!=='reserved')
          throw Error('Conversion reservation changed before the description could be backed up.');
        snapshotMap.listings[String(listingId)]={
          ...current,originalDescription,originalShopSectionId,
          descriptionCapturedAt:new Date().toISOString()
        };
        await saveListingConverterMap(snapshotMap);
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

      const shipping = await cachedConverterShippingProfiles(session);
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
          // Description is updated once, after all structural and taxonomy changes,
          // only when Etsy truly differs. Avoid an unnecessary initial rewrite.
          ...(originalShopSectionId?{shop_section_id:originalShopSectionId}:{}),
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
        defaultQuantity: 999,
        // A staged reconversion has its own verified dimensions; the old
        // manifest must stay active until Etsy confirms this new inventory.
        orientation: listingLayoutForReconversion(manifest,reconvert?replacement.record:null)
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

      // Do not patch the description between inventory and taxonomy writes.
      // One final verification avoids multiple sanitization round trips.
      const properties = await getCachedTaxonomyProperties(session, listingDefaults.taxonomyId);
      const attributes = await applyAllListingAttributes({
        session,
        listingId,
        body: {},
        properties
      });

      // Taxonomy property updates can also change listing fields.
      await ensureConverterListingSeo(session,listingId,expectedDescription,originalShopSectionId);

      // The choose-frame preset goes in photo slot 5. A photo problem does not
      // undo a verified conversion; it is recorded for review.
      let framePhoto;
      try{framePhoto=await placeConverterFramePhoto(listingId)}
      catch(error){framePhoto={status:'failed',error:String(error?.message||error).slice(0,240)};
        console.warn('Choose-frame photo for converted listing '+listingId+':',framePhoto.error)}

      manifest.etsyConfiguredAt = new Date().toISOString();
      manifest.etsyConfiguration = {
        listingId,
        sourceSystem: 'gelato-listing-converter',
        variants: variantInventory.products.length,
        enabledVariants: variantInventory.enabledCount,
        materials: listingDefaults.fixedAttributes?.Materials || [],
        attributes: attributes.results,
        existingMediaPreserved: framePhoto?.status!=='placed',
        framePhoto,
        existingSeoPreserved: true
      };
      await saveArtworkManifest(manifest);
      // Switch master only after Etsy variant, price and attribute verification.
      let replacementActivated=null;
      if(reconvert){
        replacementActivated=await activateConverterArtworkRevision({
         shopId:session.shop.shop_id,listingId,artworkId,
         revision:replacement.record.revision
        });
      }

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
            {at:finishedAt,artworkId,enabledVariants:variantInventory.enabledCount,
             revision:replacement?.record.revision||null,masterKey:replacement?.record.masterKey||null}
          ].slice(-10)
        } : {}),
        cropJobId,
        enabledVariants: variantInventory.enabledCount
      };
      await saveListingConverterMap(converterMap);

      return conversionReply(200, {
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
        replacementMasterActivated:reconvert?Boolean(replacementActivated):false,
        artworkRevision:replacementActivated?.revision||null,
        reconversionCount: converterMap.listings[String(listingId)].reconversionCount || 0
      });

}
let converterRunning=false;
async function runPendingListingConversions(){
 if(converterRunning)return;
 converterRunning=true;
 try{
  for(let cycle=0;cycle<30;cycle++){
   const job=await claimNextConversion();
   if(!job)break;
   const heartbeat=setInterval(()=>{
     void updateConversionJob(job.id,{status:'running',
       progress:'Applying Etsy settings and checking variants (rate limits retried automatically)'})
       .catch(error=>console.warn('[Etsy converter heartbeat]',error.message));
   },30000);
   heartbeat.unref?.();
   try{
    const result=await performListingConversion(job.request);
    await updateConversionJob(job.id,{status:'completed',progress:'Etsy conversion verified',result});
   }catch(error){
    console.error('[Etsy converter queue] listing '+job.request.listingId+': '+error.message);
    await updateConversionJob(job.id,{status:'failed',progress:'Conversion requires attention',error:error.message});
   }finally{clearInterval(heartbeat);}
   // Give Etsy at least a second between separate listings.
   await sleepMs(1300);
  }
 }catch(error){console.error('[Etsy converter queue]',error.message)}
 finally{converterRunning=false}
}
const conversionQueueTimer=setInterval(()=>{
 void runPendingListingConversions();
},9000);
conversionQueueTimer.unref?.();

// On a draft, the master artwork (never an Etsy photo) and photos the chosen
// order puts after Etsy's 20 come off the listing, making room for the photos
// before them. `order` uses R2-key tile ids. Published listings are left alone.
async function removeUnwantedDraftPhotos({session,listingId,manifest,live,order=[]}){
  const keyOf=new Map((manifest.etsyMedia?.images||[]).map(row=>[String(row.listingImageId),row.key]));
  const tileOf=image=>keyOf.has(String(image.listing_image_id))?'key:'+keyOf.get(String(image.listing_image_id)):
    'etsy:'+image.listing_image_id;
  const masterTile=manifest.master?.key?'key:'+manifest.master.key:'';
  const overflow=new Set(order.slice(ETSY_PHOTO_LIMIT));
  const remove=live.filter(image=>{const tile=tileOf(image);return tile===masterTile||overflow.has(tile)});
  if(!remove.length)return [];
  const listing=await getListing({listingId,keystring:session.keystring,
    sharedSecret:session.sharedSecret,accessToken:session.accessToken});
  if(String(listing.state)!=='draft')return [];
  for(const image of remove){
    await withEtsyListingRetry(()=>deleteListingImage({shopId:session.shop.shop_id,listingId,
      listingImageId:image.listing_image_id,keystring:session.keystring,
      sharedSecret:session.sharedSecret,accessToken:session.accessToken}),{attempts:4,baseDelayMs:220});
  }
  const removedKeys=new Set(remove.map(image=>keyOf.get(String(image.listing_image_id))).filter(Boolean));
  await updateArtworkManifest(manifest.artworkId,latest=>{
    if(latest.etsyMedia?.images)latest.etsyMedia.images=latest.etsyMedia.images.filter(row=>!removedKeys.has(row.key));
  });
  return remove;
}
// Serialize all server-side Etsy uploads and R2 manifest changes for one artwork.
// The PC worker can finish PSDs while Product Creator is closed.
const generatedMockupSyncTail=new Map();
async function syncGeneratedMockupsForArtwork({artworkId,jobId,templateIds=[],inSetup=false}){
  const previous=generatedMockupSyncTail.get(artworkId)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
    const chosen=new Set((Array.isArray(templateIds)?templateIds:[]).map(String));
    if(!chosen.size)throw Error('Select completed mockups before applying them to Etsy.');
      const manifest=await loadArtworkManifest(artworkId);
      if(!manifest?.master?.key||manifest.status!=='ready')
        throw Error('The artwork is not verified in Cloudflare R2.');
      const job=await getMockupJob(String(jobId||''));
      if(job.artworkId!==artworkId||job.sourceMasterKey!==manifest.master.key)
        throw Error('This PSD batch belongs to another artwork. No images were modified.');
      // Selected outputs belong to this verified job only.
      const outputs=job.templates.filter(t=>t.status==='completed'&&t.outputKey&&
        (!chosen.size||chosen.has(t.id))).slice(0,ETSY_PHOTO_LIMIT);
      if(!outputs.length)throw Error('No verified JPGs are ready in this batch.');
      // Persist the user's explicit selection before checking Etsy draft state,
      // so closing Product Creator will not turn selected mockups into "all".
      // Every manifest change here is a queued update of the latest manifest:
      // writing back a copy read earlier could undo a draft ID saved meanwhile.
      const selected=await updateArtworkManifest(artworkId,current=>{
        current.selectedMockupTemplates ||= {};
        current.selectedMockupTemplates[job.id]=[...chosen];
      });
      if(selected.etsyDraftListingId&&!inSetup&&inflightDraftSetups.has(artworkId)){
        return {ok:true,pendingSetup:true,message:'Selected JPGs saved in R2; they will sync after draft setup.'};
      }
      // Before the draft exists only the choice is kept; draft setup adds the
      // JPGs (in the chosen order) straight after the preset photos.
      if(!selected.etsyDraftListingId)
        return {ok:true,prepared:0,uploaded:0,pendingDraft:true,
          r2Prefix:'artworks/'+artworkId+'/',message:'Selected PSD mockups are added when the Etsy draft is created.'};
      const current=(selected.mockups||[]).slice(0,ETSY_PHOTO_LIMIT);
      const existingSource=new Set(current.map(x=>x.generatedFromKey).filter(Boolean));
      const newOutputs=outputs.filter(item=>!existingSource.has(item.outputKey));
      if(newOutputs.length>Math.max(0,ETSY_PHOTO_LIMIT-current.length))
        throw Error('There are only '+Math.max(0,ETSY_PHOTO_LIMIT-current.length)+
          ' saved artwork mockup slot(s) left, but '+newOutputs.length+
          ' selected PSD images need space. Reduce the selection or remove older mockups.');
      const planned=[];
      for(const t of outputs){
        if(existingSource.has(t.outputKey)||current.length+planned.length>=ETSY_PHOTO_LIMIT)continue;
        planned.push({t,index:current.length+planned.length});
        existingSource.add(t.outputKey);
      }
      // The R2 copies run side by side: one after another they held up the
      // first Etsy upload by several seconds.
      const added=await mapWithConcurrency(planned,6,async({t,index})=>{
        const key=mockupObjectKey(artworkId,index,'jpg');
        // The worker's 2400 px Etsy copy is kept beside the artwork's mockup.
        // While the full-size JPG is still on its way from the PC the mockup
        // is its Etsy copy; the full-size one replaces it when it arrives.
        const etsyKey=t.etsyKey?key.replace(/\.jpg$/,'.etsy.jpg'):'';
        const [,etsyCopied]=await Promise.all([copyArtworkObject(mockupFileKey(t),key),
          etsyKey?copyArtworkObject(t.etsyKey,etsyKey).then(()=>true,()=>false):false]);
        return {index,originalFilename:t.outputName,key,contentType:'image/jpeg',
          generatedFromKey:t.outputKey,sourceJobId:job.id,etsyKey:etsyCopied?etsyKey:''};
      });
      const prepared=added.length;
      const fresh=prepared?await updateArtworkManifest(artworkId,latest=>{
        const have=new Set((latest.mockups||[]).map(m=>m.generatedFromKey).filter(Boolean));
        latest.mockups=[...(latest.mockups||[]),...added.filter(m=>!have.has(m.generatedFromKey))];
      }):selected;
      // A full-size JPG that arrived while these were copied replaces its copy now.
      if(planned.some(({t})=>t.fullPending))void refreshArtworkMockupCopies(artworkId,job.id).catch(()=>{});
      const mockups=(fresh.mockups||[]).slice(0,ETSY_PHOTO_LIMIT);
      const session=await getEtsySession();
      const listingId=Number(fresh.etsyDraftListingId);
      const latestListing=await getListing({listingId,
        keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken});
      if(!['draft','active'].includes(String(latestListing.state)))
        throw Error('Selected JPGs remain saved in R2. Etsy photos cannot be updated in listing state '+String(latestListing.state)+'.');
      const readListing=()=>getEtsyListingImages({listingId,
        keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken});
      let existingPhotos=await readListing();
      // The chosen order names new mockups by template; once copied into the
      // artwork they are known by their R2 key.
      const mockupKeyFor=templateId=>{
        const output=job.templates.find(t=>t.id===templateId)?.outputKey;
        return output?mockups.find(m=>m.generatedFromKey===output)?.key||'':'';
      };
      const chosenOrder=(fresh.etsyPhotoOrder?.tiles||[]).map(id=>
        id.startsWith('generated:')&&mockupKeyFor(id.slice(10))?'key:'+mockupKeyFor(id.slice(10)):id);
      if((await removeUnwantedDraftPhotos({session,listingId,manifest:fresh,live:existingPhotos,order:chosenOrder})).length)
        existingPhotos=await readListing();
      const available=Math.max(0,ETSY_PHOTO_LIMIT-existingPhotos.length);
      const liveIds=receivedEtsyImageIds(existingPhotos);
      const savedByKey=new Map((fresh.etsyMedia?.images||[]).map(row=>[row.key,row]));
      const uploadedSource=new Set((fresh.etsyGeneratedSourceKeys||[]).filter(sourceKey=>{
        const mockup=mockups.find(item=>item.generatedFromKey===sourceKey);
        const receipt=mockup?savedByKey.get(mockup.key):null;
        return receipt?.listingImageId&&liveIds.has(String(receipt.listingImageId));
      }));
      const selectedMockups=mockups.filter(m=>m.sourceJobId===job.id&&
        m.generatedFromKey&&!uploadedSource.has(m.generatedFromKey)&&chosen.has(m.sourceJobId?job.templates.find(t=>t.outputKey===m.generatedFromKey)?.id:''));
      // Each photo goes straight to its place in the chosen order (Etsy shifts
      // the others along). Without a chosen order: the usual layout, with a
      // mockup as the Featured photo.
      const receiptKeys=new Map((fresh.etsyMedia?.images||[]).map(row=>[String(row.listingImageId),row.key]));
      const onEtsy=existingPhotos.slice().sort((a,b)=>Number(a.rank)-Number(b.rank)).map(image=>{
        const key=receiptKeys.get(String(image.listing_image_id));
        return key?'key:'+key:'etsy:'+image.listing_image_id;
      });
      const presetIds=new Set(PRESET_MEDIA.map(item=>'key:'+item.key));
      const wanted=chosenOrder.length?chosenOrder:defaultPlannedOrder({
        presets:PRESET_MEDIA.filter(item=>item.role!=='video'),
        generated:[...onEtsy.filter(id=>!presetIds.has(id)),...selectedMockups.map(m=>'key:'+m.key)]});
      const place=new Map(wanted.map((id,index)=>[id,index]));
      const placeOf=id=>place.has(id)?place.get(id):Infinity;
      // Mockups the chosen order puts after Etsy's 20 are not uploaded, and never
      // more than there is room for.
      const pastLimit=m=>place.has('key:'+m.key)&&place.get('key:'+m.key)>=ETSY_PHOTO_LIMIT;
      const pendingSelected=selectedMockups.filter(m=>!pastLimit(m))
        .sort((a,b)=>placeOf('key:'+a.key)-placeOf('key:'+b.key)).slice(0,available);
      const skipped=selectedMockups.length-pendingSelected.length;
      const rankFor=item=>{
        const id='key:'+item.key,at=placeOf(id);
        const rank=at===Infinity?onEtsy.length+1:onEtsy.filter(other=>placeOf(other)<at).length+1;
        onEtsy.splice(rank-1,0,id);
        return rank;
      };
      let uploaded=0;
      const uploadedReceipts=[];
      const {parallel}=await uploadPhotosToListing({session,listingId,altText:fresh.title||'',
        photos:pendingSelected.map(item=>({item,filename:item.originalFilename,rank:()=>rankFor(item),
          read:()=>etsyReadyImage(item.key,{etsyKey:item.etsyKey||''})})),
        onUploaded:async(photo,listingImageId)=>{
          uploaded++;
          const receipt={key:photo.item.key,rank:photo.rank,listingImageId,filename:photo.filename};
          uploadedReceipts.push(receipt);
          const imageCount=existingPhotos.length+uploaded;
          await updateArtworkManifest(artworkId,latest=>{
            latest.etsyMedia ||= {images:[],video:null};
            latest.etsyMedia.images=[...(latest.etsyMedia.images||[]).filter(row=>row.key!==receipt.key),receipt];
            latest.etsyGeneratedSourceKeys=[...new Set([...(latest.etsyGeneratedSourceKeys||[]),photo.item.generatedFromKey])];
            if(latest.etsyDraftSetup?.status==='completed'&&latest.etsyDraftSetup.media)
              latest.etsyDraftSetup.media.imageCount=imageCount;
          });
        }});
      if(uploadedReceipts.length){
        await verifyEtsyImageReceipts({receipts:uploadedReceipts,readImages:readListing});
        if(parallel){
          const idOfKey=new Map([...(fresh.etsyMedia?.images||[]),...uploadedReceipts].map(row=>[row.key,String(row.listingImageId)]));
          await ensureListingPhotoOrder({session,listingId,orderedIds:wanted.map(id=>
            id.startsWith('key:')?idOfKey.get(id.slice(4)):id.startsWith('etsy:')?id.slice(5):'').filter(Boolean)});
        }
      }
      // Image attachment is only complete after the requested subset was handled.
      await updateArtworkManifest(artworkId,latest=>{
        if(latest.selectedMockupTemplates)delete latest.selectedMockupTemplates[job.id];
      });
      return {ok:true,prepared,uploaded,skipped,verified:true,
        photoCount:existingPhotos.length+uploaded,full:existingPhotos.length+uploaded>=ETSY_PHOTO_LIMIT,
        r2Prefix:'artworks/'+artworkId+'/'};

  });
  generatedMockupSyncTail.set(artworkId,work);
  try{return await work}
  finally{if(generatedMockupSyncTail.get(artworkId)===work)generatedMockupSyncTail.delete(artworkId)}
}
// Adds the selected PSD mockups and applies the organizer's order. Draft setup
// calls this straight after the preset photos (inSetup), and again once setup
// has finished for a selection that arrived late.
// Mockups copied into an artwork while their full-size JPG was still on its way
// from the PC are its Etsy copy; each is replaced by the full-size JPG once that
// is in R2. Etsy already has its photo, so only the artwork folder changes.
async function refreshArtworkMockupCopies(artworkId,jobId){
  if(!artworkId)return;
  const [manifest,job]=await Promise.all([loadArtworkManifest(artworkId).catch(()=>null),getMockupJob(jobId).catch(()=>null)]);
  const arrived=new Set((job?.templates||[]).filter(t=>t.status==='completed'&&t.outputKey&&!t.fullPending).map(t=>t.outputKey));
  const stale=(manifest?.mockups||[]).filter(m=>m.sourceJobId===jobId&&arrived.has(m.generatedFromKey));
  await mapWithConcurrency(stale,4,async m=>{
    const [copy,full]=await Promise.all([artworkObjectInfo(m.key).catch(()=>null),artworkObjectInfo(m.generatedFromKey).catch(()=>null)]);
    if(full&&copy&&Number(copy.size)!==Number(full.size))await copyArtworkObject(m.generatedFromKey,m.key);
  });
}
async function reconcileCompletedMockupsForArtwork(artworkId,{inSetup=false}={}){
  const manifest=await loadArtworkManifest(artworkId);
  if(!manifest?.master?.key)return;
  // Recover ONLY mockups explicitly selected with Apply, never all generated
  // PSD outputs. Unselected JPGs remain safely stored in R2 for later review.
  for(const [jobId,templateIds] of Object.entries(manifest.selectedMockupTemplates||{})){
    if(!Array.isArray(templateIds)||!templateIds.length)continue;
    try{await syncGeneratedMockupsForArtwork({artworkId,jobId,templateIds,inSetup})}
    catch(error){console.error('Selected Etsy PSD catch-up failed '+artworkId+' '+jobId+':',error)}
  }
  // The photo order chosen in the organizer before the draft existed.
  try{await applyEtsyPhotoOrder(artworkId)}
  catch(error){console.error('Etsy photo order could not be applied for '+artworkId+':',error)}
}

// ---------------------------------------------------------- photo organizer
const PRESET_LABELS={'choose-option':'Preset: choose your option','choose-frame':'Preset: choose your frame',promotion:'Preset: promotion'};
async function organizerJob(jobId){
  if(!jobId)return null;
  try{return await getMockupJob(String(jobId))}catch{return null}
}
const organizerKeyForGenerated=(manifest,job)=>templateId=>{
  const output=job?.templates?.find(t=>t.id===templateId)?.outputKey;
  return output?(manifest?.mockups||[]).find(m=>m.generatedFromKey===output)?.key||'':'';
};
// Photos the organizer shows, in the order they will appear on Etsy.
async function etsyPhotoOrganizer({artworkId='',jobId='',templateIds=[]}){
  const job=await organizerJob(jobId);
  const chosen=new Set(templateIds.map(String));
  const generated=(job?.templates||[]).filter(t=>t.status==='completed'&&chosen.has(t.id)).map(t=>({
    id:'generated:'+t.id,kind:'mockup',label:t.outputName||t.name,
    thumb:'/api/mockups/jobs/'+job.id+'/thumbnail/'+t.id+'?v='+encodeURIComponent(t.finishedAt||'1')}));
  const manifest=artworkId?await loadArtworkManifest(artworkId).catch(()=>null):null;
  const saved=manifest?.etsyPhotoOrder?.tiles||[];
  const presets=(await presetMediaStatus()).items;
  // The preset video, shown fixed in the second spot as Etsy does. The browser
  // loads its first frame straight from R2.
  const videoPreset=presets.find(p=>p.role==='video'&&p.exists);
  const video=videoPreset?{label:'Preset video',src:await signedArtworkUrl(videoPreset.key,3600).catch(()=>null)}:null;
  const thumbFor=key=>'/api/etsy-photo-organizer/thumb?key='+encodeURIComponent(key);
  if(manifest?.etsyDraftListingId){
    const session=await getEtsySession();
    const live=(await getEtsyListingImages({listingId:Number(manifest.etsyDraftListingId),
      keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken}))
      .slice().sort((a,b)=>Number(a.rank)-Number(b.rank));
    const receiptById=new Map((manifest.etsyMedia?.images||[]).map(r=>[String(r.listingImageId),r]));
    const presetByKey=new Map(presets.map(p=>[p.key,p]));
    const keyForGenerated=organizerKeyForGenerated(manifest,job);
    const onEtsy=new Set();
    // The master artwork is never an Etsy photo. An older draft's master photo
    // is not shown, and saving the order removes it from that draft.
    const isMaster=image=>Boolean(manifest.master?.key)&&receiptById.get(String(image.listing_image_id))?.key===manifest.master.key;
    const tiles=live.filter(image=>!isMaster(image)).map(image=>{
      const receipt=receiptById.get(String(image.listing_image_id));
      if(receipt?.key)onEtsy.add(receipt.key);
      const preset=receipt?presetByKey.get(receipt.key):null;
      return {id:receipt?.key?'key:'+receipt.key:'etsy:'+image.listing_image_id,
        kind:preset?'preset':'photo',
        label:preset?PRESET_LABELS[preset.role]||'Preset photo':receipt?.filename||'Photo on Etsy',
        thumb:image.url_570xN||image.url_fullxfull||null,onEtsy:true};
    });
    // Selected mockups not on Etsy yet join at the end until placed.
    for(const tile of generated)if(!onEtsy.has(keyForGenerated(tile.id.slice(10))))tiles.push(tile);
    // An order saved before the draft names new mockups by their planned ids;
    // on Etsy they are known by their R2 keys.
    const savedLive=saved.map(id=>id.startsWith('generated:')&&keyForGenerated(id.slice(10))?'key:'+keyForGenerated(id.slice(10)):id);
    return {mode:'live',tiles,order:mergeOrder(savedLive,tiles.map(t=>t.id)),limit:ETSY_PHOTO_LIMIT,video};
  }
  // No draft yet: the preset photos a new draft gets, plus the chosen mockups
  // (never the master artwork).
  const manual=(manifest?.mockups||[]).filter(m=>!m.generatedFromKey&&String(m.contentType||'').startsWith('image/'));
  const presetImages=presets.filter(p=>p.exists&&p.role!=='video');
  const tiles=[
    ...manual.map(m=>({id:'key:'+m.key,kind:'mockup',label:m.originalFilename||'Mockup',thumb:thumbFor(m.key)})),
    ...presetImages.map(p=>({id:'key:'+p.key,kind:'preset',label:PRESET_LABELS[p.role]||'Preset photo',thumb:thumbFor(p.key)})),
    ...generated
  ];
  const planned=defaultPlannedOrder({presets:presetImages,
    generated:[...manual.map(m=>'key:'+m.key),...generated.map(t=>t.id)]});
  return {mode:'planned',tiles,order:mergeOrder(saved.length?saved:planned,tiles.map(t=>t.id)),limit:ETSY_PHOTO_LIMIT,video};
}
// Re-ranks the listing's photos on Etsy to the saved organizer order.
async function applyEtsyPhotoOrder(artworkId){
  const manifest=await loadArtworkManifest(artworkId);
  if(!manifest?.etsyDraftListingId)return {applied:false};
  const session=await getEtsySession();
  const listingId=Number(manifest.etsyDraftListingId);
  const read=async()=>(await getEtsyListingImages({listingId,keystring:session.keystring,
    sharedSecret:session.sharedSecret,accessToken:session.accessToken}))
    .slice().sort((a,b)=>Number(a.rank)-Number(b.rank));
  let live=await read();
  const masterKey=manifest.master?.key||'';
  const job=await organizerJob(manifest.etsyPhotoOrder?.jobId);
  const keyForGenerated=organizerKeyForGenerated(manifest,job);
  let tiles=(manifest.etsyPhotoOrder?.tiles||[]).filter(id=>id!=='master'&&id!=='key:'+masterKey)
    .map(id=>id.startsWith('generated:')&&keyForGenerated(id.slice(10))?'key:'+keyForGenerated(id.slice(10)):id);
  // A draft loses the master artwork (never an Etsy photo) and photos moved
  // after Etsy's 20; published listings are left alone.
  const removed=await removeUnwantedDraftPhotos({session,listingId,manifest,live,order:tiles});
  if(removed.length)live=await read();
  const removedIds=new Set(removed.map(image=>String(image.listing_image_id)));
  const receipts=(manifest.etsyMedia?.images||[]).filter(row=>!removedIds.has(String(row.listingImageId)));
  if(!tiles.length){
    // No order chosen: only step in when a preset photo would be Featured, and
    // then use the usual layout (mockups first, presets at their usual places).
    const presetKeys=new Map(PRESET_MEDIA.map(p=>[p.key,p]));
    const keyOf=image=>receipts.find(r=>String(r.listingImageId)===String(image.listing_image_id))?.key||'';
    if(!live.length||!presetKeys.has(keyOf(live[0])))return {applied:false};
    tiles=defaultPlannedOrder({presets:PRESET_MEDIA.filter(p=>p.role!=='video'),
      generated:live.filter(image=>!presetKeys.has(keyOf(image))).map(image=>'etsy:'+image.listing_image_id)});
  }
  const desired=desiredImageOrder({order:tiles,liveImages:live,receipts,keyForGenerated});
  const updates=rankUpdates(live.map(i=>String(i.listing_image_id)),desired);
  for(const update of updates){
    await withEtsyListingRetry(()=>setListingImageRank({shopId:session.shop.shop_id,listingId,
      listingImageId:update.listingImageId,rank:update.rank,keystring:session.keystring,
      sharedSecret:session.sharedSecret,accessToken:session.accessToken}),{attempts:6,baseDelayMs:220});
  }
  const after=(await read()).map(i=>String(i.listing_image_id));
  return {applied:true,updated:updates.length,matches:after.join(',')===desired.join(',')};
}
const organizerThumbCache=new Map();
async function organizerThumb(key){
  if(organizerThumbCache.has(key))return organizerThumbCache.get(key);
  const pending=getArtworkObject(key).then(object=>sharp(object.body,{failOn:'none',limitInputPixels:false})
    .rotate().resize(480,480,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer());
  organizerThumbCache.set(key,pending);
  pending.catch(()=>organizerThumbCache.delete(key));
  while(organizerThumbCache.size>40)organizerThumbCache.delete(organizerThumbCache.keys().next().value);
  return pending;
}

// The shop's usual listing settings: the managed shipping profile, and the most
// common values of recent active listings (the Product Creator's starting point).
function detectedListingPreset(shippingProfiles, sourceListings) {
  const managedShippingProfile = shippingProfiles.find((profile) =>
    String(profile?.title || '').trim() === String(shippingProfileDefaults.title || '').trim()
  ) || null;

  return {
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
}
// Creates the Etsy draft for an uploaded artwork and returns at once; its setup
// (photos, video, variants, attributes) goes on in the background and is
// recorded in the artwork manifest (etsyDraftSetup). Used by the Product
// Creator (POST /etsy/drafts) and the batch poster.
async function createEtsyDraft(body) {
    const draftReply=(status,payload)=>({status,payload});
    const startedAt = Date.now();
    try {
      const session = await getEtsySession();
      const scopes = new Set(String(session.scope || '').split(/\s+/).filter(Boolean));
      if (!scopes.has('listings_w')) {
        return draftReply( 403, {
          ok: false,
          needsReauthorization: true,
          error: 'Reconnect Etsy to grant listings_w.'
        });
      }

      // SEO section links are authoritative; never silently keep a default shop section.
      try{assertSeoShopSection(body.seo_section_url,body.shop_section_id)}
      catch(error){return draftReply(400,{ok:false,error:error?.message||String(error)})}
      // Fail before creating any Etsy draft rather than silently applying Art deco.
      if(canonicalWallArtStyle(body.listing_style)===null){
        return draftReply(400,{ok:false,error:'Select a valid Etsy Style before creating this draft.'});
      }
      const seoDescription = String(body.seo_description || '').trim();
      const shopSectionName = String(body.seo_section_name || '').trim();
      const shopSectionUrl = String(body.seo_section_url || '').trim();
      const descriptionParts = { seoDescription, shopSectionName, shopSectionUrl };
      body.description = listingDescription(null, listingDefaults.descriptionTemplate, descriptionParts);
      body.taxonomy_id = listingDefaults.taxonomyId;
      // The Product Creator's Auto renew choice (filled from the listing template).
      body.should_auto_renew = typeof body.should_auto_renew === 'boolean' ? body.should_auto_renew : listingDefaults.autoRenew;

      const required = ['artwork_id','title','description','taxonomy_id','shipping_profile_id','readiness_state_id'];
      const missing = required.filter((key) => body[key] === undefined || body[key] === null || body[key] === '');
      if (missing.length) return draftReply( 400, { ok:false, error:`Missing: ${missing.join(', ')}` });

      const manifest = await loadArtworkManifest(body.artwork_id);
      if (!manifest || manifest.status !== 'ready') {
        return draftReply( 400, {
          ok: false,
          error: 'The artwork upload is not complete in R2. Re-upload the master artwork and listing media before creating the Etsy draft.'
        });
      }
      // An R2 "folder" is an object prefix. Verify the real master, not just its JSON manifest.
      if(!manifest.master?.key||!(await artworkObjectExists(manifest.master.key)))
        return draftReply(409,{ok:false,error:'The master image is missing from Cloudflare R2. No Etsy draft was created.'});
      // The description from the listing template for this artwork's orientation
      // (Listings → Templates), if it has one.
      const listingTemplate = (await loadListingTemplates().catch(() => null))?.orientations?.[listingLayoutForManifest(manifest)];
      if (listingTemplate?.description_template)
        body.description = listingDescription(listingTemplate, listingDefaults.descriptionTemplate, descriptionParts);
      if(manifest.etsyDraftListingId&&manifest.etsyDraftSetup?.status==='completed'){
        return draftReply(200,{ok:true,...manifest.etsyDraftSetup,processing:false});
      }
      if(manifest.etsyDraftListingId&&inflightDraftSetups.has(body.artwork_id)){
        return draftReply(202,{ok:true,processing:true,status:'running',
          listingId:manifest.etsyDraftListingId,message:'Draft setup is already running.'});
      }
      // Repair/ensure the production crop queue independently of Etsy draft creation.
      // A crop failure must never block creation of the Etsy draft.
      let cropQueue = null;
      let cropQueueWarning = '';
      if (!manifest.fulfillmentRatiosReady || fulfillmentRatiosForOrientation(manifest.orientation, manifest.master).some(
        ratio => !manifest.fulfillmentRatios?.[ratio]?.productionReady
      )) {
        try {
          const created = await createCropJob({
            artworkId: body.artwork_id,
            masterKey: manifest.master.key,
            orientation: manifest.orientation,
            width: manifest.master.width,
            height: manifest.master.height
          });
          manifest.cropWorkerJobId = created.job.id;
          manifest.cropWorkerQueuedAt = manifest.cropWorkerQueuedAt || new Date().toISOString();
          await persistDraftManifestFields(manifest,['cropWorkerJobId','cropWorkerQueuedAt']);
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
        defaultQuantity: 999,
        orientation: listingLayoutForManifest(manifest)
      });
      body.price = variantInventory.minimumPrice;
      body.quantity = 999;

      const taxonomyPromise = getCachedTaxonomyProperties(session, body.taxonomy_id);
      let mediaPrepStartedAt = 0;
      // Start image sorting/download/optimization immediately and let it run while
      // Etsy creates/configures the draft. This removes media-prep time from the
      // critical path without performing concurrent Etsy writes.
      let mediaPrepMs = 0;
      let mediaPlanPromise = null;
      // start media preparation only once the draft has been created
      // and the configuration task is running, not during draft creation.
      const startMediaPlan=()=>{
        mediaPrepStartedAt=Date.now();
        mediaPlanPromise=prepareMediaPlan({session,manifest}).then(
          plan=>({ok:true,plan,ms:Date.now()-mediaPrepStartedAt}),
          error=>({ok:false,error,ms:Date.now()-mediaPrepStartedAt})
        );
      };

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
        await persistDraftManifestFields(manifest,['etsyDraftListingId','etsyDraftCreatedAt']);
      }
      const draftMs = Date.now() - draftStartedAt;

      // Return the Etsy draft ID immediately. Inventory, photos, video and
      // attributes continue in the server worker, not in the browser request.
      // A retry reuses manifest.etsyDraftListingId instead of duplicating Etsy listings.
      manifest.etsyDraftSetup={status:'running',listingId:draft.listing_id,
        startedAt:new Date().toISOString(),message:'Applying variants, attributes and listing media'};
      await persistDraftManifestFields(manifest,['etsyDraftSetup']);
      const setupId=body.artwork_id;
      inflightDraftSetups.add(setupId);
      void (async()=>{
        try{
          startMediaPlan();
      // Photos first, as soon as the draft exists: the preset photos, then the
      // selected PSD mockups in the organizer's order, then the video (its place
      // on Etsy does not depend on when it is added). Inventory and attributes
      // follow. A photo or video problem is reported once those are done, so it
      // never leaves the draft without its variants.
      let mediaError = null, mediaPlan = null, media = null;
      try {
        const mediaPrepared = await mediaPlanPromise;
        mediaPrepMs = mediaPrepared.ms;
        if (!mediaPrepared.ok) throw mediaPrepared.error;
        mediaPlan = mediaPrepared.plan;
        media = await uploadPreparedMediaToEtsy({
          session,
          listingId: draft.listing_id,
          manifest,
          plan: mediaPlan
        });
      } catch (error) {
        mediaError = error;
      }
      await reconcileCompletedMockupsForArtwork(setupId, { inSetup: true }).catch(
        error => console.error('Selected PSD mockups could not be added during draft setup:', error)
      );
      if (mediaPlan) {
        try {
          const videoUploaded = await uploadPreparedVideoToEtsy({ session, listingId: draft.listing_id, manifest, plan: mediaPlan });
          if (media) media.videoUploaded = videoUploaded;
        } catch (error) {
          mediaError ||= error;
        }
      }

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

      if (mediaError) throw mediaError;

      manifest.etsyConfiguredAt = new Date().toISOString();
      manifest.etsyConfiguration = {
        listingId: draft.listing_id,
        variants: variantInventory.products.length,
        materials: listingDefaults.fixedAttributes?.Materials || [],
        tags: body.tags || [],
        media,
        attributes: attributes.results
      };
      await persistDraftManifestFields(manifest,['etsyConfiguredAt','etsyConfiguration']);

      const summary = {
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
          imageCount:mediaPlan.installedPresetRoles.filter(role=>role!=='video').length,
          videoCount:mediaPlan.installedPresetRoles.includes('video')?1:0,
          missingRoles:mediaPlan.missingPresetRoles
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
      };


          manifest.etsyDraftSetup={...summary,status:'completed',
            completedAt:new Date().toISOString(),r2Prefix:'artworks/'+setupId+'/'};
          await persistDraftManifestFields(manifest,['etsyDraftSetup']);
        }catch(error){
          console.error('Etsy draft setup failed for '+setupId+':',error);
          try{
            await updateArtworkManifest(setupId,updated=>{
              updated.etsyDraftSetup={status:'failed',listingId:draft.listing_id,
                error:String(error?.message||error).slice(0,650),
                failedAt:new Date().toISOString()};
            });
          }catch(saveError){console.error('Could not record draft setup failure:',saveError);}
        }finally{
          inflightDraftSetups.delete(setupId);
          // Regular JPGs are independent of the draft's other setup steps:
          // an inventory/video problem must not strand them in Cloudflare R2.
          void queueRegularMockupEtsySync(setupId).catch(
            error=>console.error('Regular mockup catch-up after draft setup failed:',error)
          );
          // Selected PSD mockups (and the organizer's order) are added even when
          // another setup step (e.g. the video) failed: the draft exists.
          void reconcileCompletedMockupsForArtwork(setupId).catch(
            error=>console.error('PSD catch-up after Etsy draft setup failed:',error)
          );
        }
      })();
      return draftReply(201,{ok:true,processing:true,
        status:'running',listingId:draft.listing_id,state:'draft',
        title:body.title,resumed:Boolean(draft.resumed),
        r2Prefix:'artworks/'+setupId+'/',
        message:'Etsy draft created. Media, inventory and attributes are configuring in the background.'});
    } catch (error) {
      return draftReply( 500, {
        ok:false,
        error:error?.message || String(error),
        timing: { totalMs: Date.now() - startedAt }
      });
    }
}

const server = http.createServer(async (req, res) => {
  // PSD mockup batch endpoints are private and separate from Etsy fulfillment.
  const mockupUrl=new URL(req.url||'/', 'https://'+String(req.headers.host||'localhost'));
  if(mockupUrl.pathname==='/assets/crop-worker-auto.js'&&req.method==='GET'){
    if(!requireAdminApi(req,res))return;
    const js=readFileSync(new URL('./crop-worker-auto.js',import.meta.url));
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',
      'content-length':js.length,'cache-control':'private, no-store',
      'x-content-type-options':'nosniff'});
    res.end(js);return;
  }
  // The photo organizer is shared with Daily Listings.
  if(mockupUrl.pathname==='/assets/mockup-generator-client.js'||mockupUrl.pathname==='/assets/photo-organizer-client.js'){
    if(!requireAdminApi(req,res))return;
    const js=readFileSync(new URL('.'+mockupUrl.pathname.slice('/assets'.length),import.meta.url));
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',
      'content-length':js.length,'cache-control':'private, no-store',
      'x-content-type-options':'nosniff'});
    res.end(js);return;
  }
  if(await handleMockupAPI(req,res,mockupUrl,{
    authenticated:(request,response)=>isCropWorkerAuthorized(request)||requireAdminApi(request,response),
    workerAuthorized:isCropWorkerAuthorized,
    readJson:readJsonBody,sendJson,
    onMockupFullUploaded:({job})=>refreshArtworkMockupCopies(job.artworkId,job.id),
    onMockupCompleted:(verifiedJob)=>{
      if(!verifiedJob?.artworkId||!verifiedJob?.sourceMasterKey)return;
      // Generated JPGs already live in R2. Never bypass the user's right-panel
      // checkboxes; Etsy upload begins only after Apply Selected.
      console.info('PSD mockup generated for '+verifiedJob.artworkId+
        '; awaiting explicit preview selection in Product Creator.');
    }
  }))return;

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // Serve actual image bytes; browsers must not follow an ICO-to-SVG redirect.
  if ((req.method === 'GET' || req.method === 'HEAD') &&
      ['/favicon.ico','/favicon.png','/favicon-32.png','/favicon-16.png','/favicon.svg']
       .includes(url.pathname)) {
    try {
      const assets=await getFaviconAssets();
      const choice={
        '/favicon.ico':[assets.ico,'image/x-icon'],
        '/favicon.png':[assets.png,'image/png'],
        '/favicon-32.png':[assets.png32,'image/png'],
        '/favicon-16.png':[assets.png16,'image/png'],
        '/favicon.svg':[assets.svg,'image/svg+xml; charset=utf-8']
      }[url.pathname];
      const [bytes,type]=choice;
      res.writeHead(200,{
        'content-type':type,
        'content-length':bytes.length,
        'cache-control':'public, max-age=86400',
        'x-content-type-options':'nosniff'
      });
      return res.end(req.method==='HEAD'?undefined:bytes);
    }catch(error){
      console.error('[favicon] Failed to build brand icon:',error);
      return sendJson(res,500,{ok:false,error:'Favicon generation failed'});
    }
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
      logWorkerRestart(input.restart);
      return sendJson(res, 200, {
        ok: true,
        worker: recordCropWorkerHeartbeat(input),
        latestWorkerVersion: latestWorkerVersion(),
        // The mockup folder chosen in the Product Creator for this shop.
        mockupFolder: await getPcMockupFolder()
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }

  // The worker files the shared PC worker updates itself to.
  if (req.method === 'GET' && url.pathname === '/api/crop-worker/update') {
    if (!requireCropWorker(req, res)) return;
    try {
      const bundle = workerUpdateBundle();
      if (!bundle.version) throw new Error('The worker version could not be read.');
      return sendJson(res, 200, { ok: true, ...bundle });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/crop-jobs/claim') {
    if (!requireCropWorker(req, res)) return;
    try {
      const input = await readJsonBody(req);
      const workerId = String(input.workerId || '').trim();
      if (!workerId) return sendJson(res, 400, { ok: false, error: 'workerId is required' });
      recordCropWorkerHeartbeat({ workerId, busy: false, version: input.version });
      // The 4.3 worker still enlarged small artwork to fixed 300-PPI targets.
      // Do not lease any jobs to it: a 4.4 native-resolution crop worker is required.
      const version = String(input.version || '0').split('.').map(Number);
      if (version[0] < 4 || (version[0] === 4 && (version[1] < 4 || (version[1] === 4 && Number(version[2] || 0) < 2)))) {
        return sendJson(res, 426, { ok: false,
          error: 'Shared PC Crop Worker v4.4.2 is required for on-demand artwork crops. Update the worker folder and restart it.' });
      }

      const job = await claimNextCropJob(workerId);
      if (!job) return sendJson(res, 200, { ok: true, job: null });

      const uploadUrls = {};
      const targets = {};
      for (const ratio of job.ratios || FULFILLMENT_RATIOS) {
        const key = cropJobOutputKey(job, ratio);
        targets[ratio] = cropJobTarget(job, ratio);
        uploadUrls[ratio] = await signedArtworkUploadUrl(key, 'image/jpeg', 2 * 60 * 60);
      }

      recordCropWorkerHeartbeat({ workerId, busy: true, jobId: job.id });
      if (!job.size) await writeFulfillmentStatus(job.artworkId, {
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
        if (!job.size) await writeFulfillmentStatus(job.artworkId, {
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
        if (isStagedCropJob(currentJob)) {
          if (!manifest?.master?.key || !(await artworkObjectExists(currentJob.masterKey)))
            throw new Error('Staged replacement master missing while crop job was running');
        } else if (!manifest?.master?.key || manifest.master.key !== currentJob.masterKey) {
          throw new Error('Artwork master changed while crop job was running');
        }

        const assets = {};
        for (const ratio of currentJob.ratios || FULFILLMENT_RATIOS) {
          const result = input.assets?.[ratio];
          if (!result) throw new Error(`Worker did not return ${ratio} output metadata`);
          const target = cropJobTarget(currentJob, ratio);
          const width = Number(result.width || 0);
          const height = Number(result.height || 0);
          // A crop must be extracted directly from the original pixels.
          // Older workers that upscale to fixed 300-PPI targets must be updated.
          const sourceCropWidth = Number(result.sourceCropWidth || 0);
          const sourceCropHeight = Number(result.sourceCropHeight || 0);
          const sourceMasterWidth = Number(result.sourceMasterWidth || 0);
          const sourceMasterHeight = Number(result.sourceMasterHeight || 0);
          if (!sourceCropWidth || !sourceCropHeight ||
              !sourceMasterWidth || !sourceMasterHeight ||
              sourceCropWidth > sourceMasterWidth || sourceCropHeight > sourceMasterHeight ||
              width > sourceCropWidth || height > sourceCropHeight ||
              result.upscaled === true) {
            throw new Error(
              `${ratio} crop was resized beyond its source or is missing native-resolution proof. ` +
              'Update and restart the shared PC crop worker before retrying.'
            );
          }
          const scale = Math.min(1, target.width / sourceCropWidth,
            target.height / sourceCropHeight);
          const plannedWidth = Math.max(1, Math.floor(sourceCropWidth * scale));
          const plannedHeight = Math.max(1, Math.floor(sourceCropHeight * scale));
          if (width !== plannedWidth || height !== plannedHeight) {
            throw new Error(
              `${ratio} output ${width}×${height} does not match its proportional ` +
              `${plannedWidth}×${plannedHeight} master-resolution crop.`
            );
          }
          const expectedRatio = target.width / target.height;
          if (Math.abs(width / height - expectedRatio) > 1 / Math.min(width, height)) {
            throw new Error(`${ratio} crop does not match its requested aspect ratio.`);
          }
          if (!isStagedCropJob(currentJob) &&
              manifest.master?.width && manifest.master?.height &&
              (sourceMasterWidth !== Number(manifest.master.width) ||
               sourceMasterHeight !== Number(manifest.master.height))) {
            throw new Error(`${ratio} crop source dimensions differ from the R2 master.`);
          }
          const key = cropJobOutputKey(currentJob, ratio);
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
            recommendedPixelsMet: result.recommendedPixelsMet === true,
            downscaled: result.downscaled === true,
            sourceCropWidth,
            sourceCropHeight,
            upscaled: false,
            updatedAt: new Date().toISOString()
          };
        }

        if (currentJob.size) {
          const crop=assets[sizeCropRatioKey(currentJob.size)];
          if (!crop) throw Error('Size-specific output was not verified.');
          await updateArtworkManifest(currentJob.artworkId, latest=>{
            if(latest.master?.key!==currentJob.masterKey)
              throw Error('Master artwork changed before this custom crop completed.');
            latest.fulfillmentSizeCrops ||= {};
            latest.fulfillmentSizeCrops[currentJob.size]={...crop,size:currentJob.size,jobId:currentJob.id};
          });
        } else if (!isStagedCropJob(currentJob)) {
          await updateArtworkManifest(currentJob.artworkId, latest=>{
            if(latest.master?.key!==currentJob.masterKey)
              throw Error('Master artwork changed before default crops completed.');
            latest.fulfillmentRatios=assets;
            latest.fulfillmentRatioInsufficient={};
            // The ratios this job was queued for (panoramic or regular, by the master's size).
            latest.fulfillmentRatiosReady=(currentJob.ratios?.length?currentJob.ratios:
              fulfillmentRatiosForOrientation(currentJob.orientation,latest.master)).every(
              ratio=>Boolean(assets[ratio]?.productionReady));
            latest.fulfillmentRatiosUpdatedAt=new Date().toISOString();
            latest.cropWorkerJobId=currentJob.id;
          });
        }
        const job = await completeCropJob(jobId, workerId, assets);
        if (!currentJob.size && !isStagedCropJob(currentJob)) await writeFulfillmentStatus(currentJob.artworkId, {
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
        if (!job.size) await writeFulfillmentStatus(job.artworkId, {
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

  // Batch status polling replaces one R2 read per browser listing every 1.5s.
  if(req.method==='GET'&&url.pathname==='/api/listing-converter/crop-status'){
   if(!requireAdminApi(req,res))return;
   const ids=String(url.searchParams.get('ids')||'').split(',').filter(Boolean);
   if(!ids.length||ids.length>60||ids.some(id=>!/^crop_[0-9a-f-]{36}$/i.test(id)))
    return sendJson(res,400,{ok:false,error:'Provide 1 to 60 valid crop job IDs.'});
   try{return sendJson(res,200,{ok:true,jobs:await getCropJobSummaries(ids)})}
   catch(error){return sendJson(res,503,{ok:false,error:'Crop queue temporarily unavailable. Please retry.'})}
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
      // Verified R2 master pixels, not browser input, control all crop targets.
      if(!manifest.master?.orientation)
        throw Error('Master image geometry was not verified. Confirm the R2 artwork upload again.');
      const orientation=manifest.orientation;
      const size=input.size?normalizeCropSize(input.size):null;
      if(orientation==='square'&&size&&Number(size.split('x')[0])!==Number(size.split('x')[1]))
        throw Error('Square masters require square production crop sizes.');
      if(!['landscape','portrait','square'].includes(orientation))
        throw Error('Unknown master image orientation; complete R2 upload again.');
      if(size){
        const previous=manifest.fulfillmentSizeCrops?.[size];
        if(previous?.sourceMasterKey===manifest.master.key &&
           previous.productionReady && await artworkObjectExists(previous.key)){
          return sendJson(res,200,{ok:true,cached:true,size,asset:previous,
            previewUrl:await signedArtworkUrl(previous.key,3600),worker:cropWorkerStatus()});
        }
      }
      const created = await createCropJob({
        artworkId,
        masterKey: manifest.master.key,
        orientation,
        width: manifest.master.width,
        height: manifest.master.height,
        ...(size?{size}:{})
      });
      if (!size) {
        await updateArtworkManifest(artworkId,latest=>{
          if(latest.master?.key!==manifest.master.key)
            throw Error('Artwork changed before crop queue was saved.');
          latest.cropWorkerJobId=created.job.id;
          latest.cropWorkerQueuedAt=new Date().toISOString();
        });
        await writeFulfillmentStatus(artworkId, {
          status: created.job.status || 'pending',
          jobId: created.job.id,
          progress: created.job.progress || 0,
          completedRatios: created.job.completedRatios || [],
          message: created.job.message || 'Waiting for shared crop workstation'
        }).catch(() => {});
      }
      return sendJson(res,created.reused?200:201,{
        ok:true,...created,...(size?{size}:{}),worker:cropWorkerStatus()
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
      const result = await etsyReceiptToSensariaCsvFromR2(receipt, { useProductionCrop: false });
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
        productionKey: source.productionCrop ? (source.key || null) : null,
        sourceKey: source.key || manifest.master.key || null,
        production: {
          kind: spec.kind || null,
          dpi: spec.dpi || null,
          output,
          face: spec.face || null,
          mirrorBleedPx: spec.mirrorBleedPx || 0,
          safeInsetPx: spec.safeInsetPx || 0,
          template: spec.template || null,
          productionCrop: Boolean(source.productionCrop)
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


  // Review-only: no Etsy profiles or listing destinations are modified.
  if(req.method==='GET'&&url.pathname==='/international-shipping'){
    if(!requireAdminPage(req,res,'/international-shipping'))return;
    return sendHtml(res,200,renderInternationalShippingPage());
  }
  if(req.method==='GET'&&url.pathname==='/api/international-shipping/preview'){
    if(!requireAdminApi(req,res))return;
    try{
      const options={
        format:String(url.searchParams.get('format')||'FC'),
        size:String(url.searchParams.get('size')||'40x60'),
        feePercent:Number(url.searchParams.get('feePercent')??12),
        bufferPercent:Number(url.searchParams.get('bufferPercent')??15),
        maxSupplierCostUsd:Number(url.searchParams.get('maxSupplierCostUsd')??150)
      };
      const plan=internationalShippingPreview(options);
      const listingWorstCase=listingWorstCaseShippingPreview({
        country:String(url.searchParams.get('country')||'US'),
        feePercent:options.feePercent,bufferPercent:options.bufferPercent,
        maxSupplierCostUsd:options.maxSupplierCostUsd
      });
      return sendJson(res,200,{ok:true,plan,listingWorstCase,readOnly:true});
    }catch(error){
      return sendJson(res,400,{ok:false,error:String(error.message||error)});
    }
  }

  // Audits one existing listing's enabled Etsy SKUs in read-only mode. A preview
  // cannot create/update shipping profiles or change Etsy buyer charges.
  if(req.method==='GET'&&url.pathname==='/api/international-shipping/listing-audit'){
    if(!requireAdminApi(req,res))return;
    try{
      const id=Number(url.searchParams.get('listingId'));
      if(!Number.isSafeInteger(id)||id<1)
        return sendJson(res,400,{ok:false,error:'Provide an existing Etsy listing ID.'});
      const session=await getEtsySession();
      if(!String(session.scope||'').split(/\s+/).includes('listings_r'))
        return sendJson(res,403,{ok:false,error:'Etsy listings_r scope is required.'});
      const auth={keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken};
      const listing=await getListing({listingId:id,...auth});
      if(Number(listing.shop_id)!==Number(session.shop.shop_id))
        return sendJson(res,403,{ok:false,error:'This listing belongs to a different Etsy shop.'});
      const inventory=await getListingInventory({listingId:id,...auth});
      const maxSupplierCostUsd=Number(url.searchParams.get('maxSupplierCostUsd')??150);
      const feePercent=Number(url.searchParams.get('feePercent')??12);
      const bufferPercent=Number(url.searchParams.get('bufferPercent')??15);
      const usdToShopCurrency=url.searchParams.get('usdToShopCurrency')||null;
      // Do not trust a previously entered exchange rate as today's FX.
      const audit=auditListingDestination({
        inventory,country:url.searchParams.get('country')||'US',
        state:url.searchParams.get('state')||'',feePercent,bufferPercent,
        maxSupplierCostUsd,shopCurrency:session.shop.currency_code||'',
        usdToShopCurrency
      });
      return sendJson(res,200,{ok:true,readOnly:true,listingId:id,
        title:String(listing.title||'').slice(0,140),
        currentShippingProfileId:listing.shipping_profile_id||null,audit});
    }catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
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
  // Manual CSV is prepared asynchronously so the browser never waits on a
  // large R2 image render inside a single HTTP request.
  const sensariaCsvMatch=url.pathname.match(/^\/api\/orders\/([1-9]\d{0,19})\/sensaria-csv$/);
  if(sensariaCsvMatch && (req.method==='POST'||req.method==='GET')){
    if(!requireAdminApi(req,res))return;
    const id=sensariaCsvMatch[1];
    if(req.method==='GET'){
      if(url.searchParams.get('download')==='1'){
        const csv=csvJobResult(id);
        if(!csv)return sendJson(res,409,{ok:false,error:'CSV not yet ready. Wait for preparation to finish.'});
        res.writeHead(200,{
          'content-type':'text/csv; charset=utf-8',
          'content-disposition':'attachment; filename="sensaria-etsy-'+id+'.csv"',
          'cache-control':'private, no-store',
          'x-content-type-options':'nosniff'
        });
        return res.end(csv);
      }
      const job=csvJobStatus(id);
      return sendJson(res,job?200:404,job?{ok:true,job}:{
        ok:false,error:'No active preparation. Click Download Sensaria CSV to prepare this receipt.'
      });
    }
    const origin=String(req.headers.origin||'');
    const expected=(req.headers['x-forwarded-proto']||'https')+'://'+String(req.headers.host||'');
    if((origin&&origin!==expected)||req.headers['sec-fetch-site']==='cross-site')
      return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))
      return sendJson(res,415,{ok:false,error:'JSON request required.'});
    try{
      const job=startCsvJob(id,async stage=>{
        stage('Checking Etsy payment and current order details');
        const session=await getEtsySession();
        const shopId=Number(session.shop?.shop_id||0);
        if(!shopId)throw Error('Authorized Etsy shop not available.');
        const latest=await getShopReceipt({
          shopId,receiptId:id,keystring:session.keystring,
          sharedSecret:session.sharedSecret,accessToken:session.accessToken
        });
        if(!Array.isArray(latest.transactions)||!latest.transactions.length)
          latest.transactions=await receiptTransactions(session,id);
        stage('Verifying Sensaria recommendation and artwork source');
        const order=await readOrder(id);
        const {plan}=validateSensariaCsvOrder(order,latest,shopId);
        const artwork=await resolveProviderArtworkAsset({artworkId:plan.artworkId,size:plan.size});
        if(artwork.key!==plan.assetKey || !(await artworkObjectExists(artwork.key)))
          throw Error('Artwork crop changed or is missing in R2. Refresh the supplier recommendation.');
        stage('Linking the verified R2 production crop for Sensaria');
        const exported=await etsyReceiptToSensariaCsvFromR2(latest,{
          useProductionCrop:true,productionUrlExpiresIn:7*24*60*60,
          onProgress:stage
        });
        if(exported.rows.length!==1 || !exported.sources[0]?.productionCrop ||
           exported.sources[0]?.cropKey!==plan.assetKey ||
           Math.max(exported.sources[0]?.width||0,exported.sources[0]?.height||0)>17500 ||
           !exported.rows[0]?.['Product Code'] || !exported.rows[0]?.URL)
          throw Error('Sensaria GO CSV needs the verified R2 production crop and a valid product code.');
        stage('Finalizing verified CSV download');
        return exported.csv;
      });
      return sendJson(res,202,{ok:true,job,
        message:'CSV preparation started. Check status while the canvas is processed.'});
    }catch(error){
      return sendJson(res,400,{ok:false,error:String(error.message||error)});
    }
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


  // Gmail integration is an explicitly authorized, read-only mailbox connection.
  // Shipment extraction only stages tracking; no Etsy completion or notifications.
  if(req.method==='GET' && url.pathname==='/tracking/gmail/connect'){
    if(!requireAdminPage(req,res,'/tracking'))return;
    try{
      const oauth=beginGmailAuthorization();
      res.writeHead(302,{'location':oauth,'cache-control':'no-store'});
      return res.end();
    }catch(error){return sendJson(res,503,{ok:false,error:String(error.message||error)});}
  }
  if(req.method==='GET' && url.pathname==='/tracking/gmail/callback'){
    if(!requireAdminPage(req,res,'/tracking'))return;
    try{
      if(url.searchParams.get('error'))
        throw Error('Gmail authorization was declined: '+url.searchParams.get('error'));
      await finishGmailAuthorization(url.searchParams.get('state'),url.searchParams.get('code'));
      res.writeHead(302,{'location':'/tracking?gmail=connected','cache-control':'no-store'});
      return res.end();
    }catch(error){
      console.error('[gmail tracking] OAuth failed: '+String(error.message||error));
      res.writeHead(302,{'location':'/tracking?gmail=error','cache-control':'no-store'});
      return res.end();
    }
  }
  if(req.method==='GET'&&url.pathname==='/api/tracking/gmail/status'){
    if(!requireAdminApi(req,res))return;
    try{return sendJson(res,200,{ok:true,...await gmailTrackingStatus()});}
    catch(error){return sendJson(res,503,{ok:false,error:String(error.message||error)});}
  }
  if(req.method==='POST'&&
     (url.pathname==='/api/tracking/gmail/scan'||url.pathname==='/api/tracking/gmail/disconnect'||url.pathname==='/api/tracking/gmail/settings')){
    if(!requireAdminApi(req,res))return;
    const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
    const expected=String(req.headers['x-forwarded-proto']||'https')+'://'+host;
    if(!host||(origin&&origin!==expected)||req.headers['sec-fetch-site']==='cross-site')
      return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))
      return sendJson(res,415,{ok:false,error:'JSON request required.'});
    try{
      const body=await readTrackingJsonBody(req);
      if(url.pathname==='/api/tracking/gmail/disconnect'){
        if(body.confirm!=='DISCONNECT GMAIL')
          return sendJson(res,400,{ok:false,error:'Explicit disconnect confirmation is required.'});
        await disconnectGmail();
        return sendJson(res,200,{ok:true,connected:false});
      }
      // Switching automatic Etsy completion on needs Etsy's shipment permission.
      if(url.pathname==='/api/tracking/gmail/settings'){
        if(body.autoCompleteEtsy===true){
          if(body.confirm!=='COMPLETE ETSY ORDERS AUTOMATICALLY')
            return sendJson(res,400,{ok:false,error:'Confirm automatic completion: Etsy marks each order shipped and emails the buyer.'});
          const session=await getEtsySession();
          if(!new Set(String(session.scope||'').split(/\s+/)).has('transactions_w'))
            return sendJson(res,403,{ok:false,error:'Reconnect Etsy: sending tracking needs the transactions_w permission.'});
        }
        return sendJson(res,200,{ok:true,...await saveGmailTrackingSettings(body)});
      }
      const session=await getEtsySession();
      const scope=new Set(String(session.scope||'').split(/\s+/));
      if(!scope.has('transactions_r'))
        return sendJson(res,403,{ok:false,error:'Etsy transactions_r access required.'});
      const result=await scanSensariaGmail(session);
      return sendJson(res,200,{ok:true,...result});
    }catch(error){
      console.error('[gmail tracking] scan failed: '+String(error.message||error));
      return sendJson(res,502,{ok:false,error:String(error.message||error)});
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


  // Universal default template preview/apply. Every listing is re-read from
  // Etsy and cross-checked against the linked R2 master before any inventory PUT.
  async function defaultTemplatePlan(session,listingId){
    const auth={keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken};
    const [listing,inventory,map]=await Promise.all([
      getListing({listingId,...auth}),
      getListingInventory({listingId,...auth}),
      loadListingConverterMap()
    ]);
    if(Number(listing.shop_id)!==Number(session.shop.shop_id))
      throw Error('This listing does not belong to the connected Etsy shop.');
    const skuList=(inventory.products||[]).map(p=>String(p.sku||'')).filter(Boolean);
    const link=await resolveListingArtwork({
      listingId,listing:{...listing,skus:skuList},map
    });
    if(!link?.artworkId||!link.manifest?.master?.key)
      throw Error('Listing is not a verified Product Creator or converted artwork template.');
    const master=link.manifest,orientation=listingLayoutForManifest(master);
    if(!['portrait','landscape','square','panoramic'].includes(orientation))
      throw Error('Stored artwork orientation is not verified.');
    if(!(await artworkObjectExists(master.master.key)))
      throw Error('Linked artwork master is missing from R2.');
    const readinessStateId=readinessStateFromInventory(inventory);
    const plan=planDefaultTemplateInventory({
      inventory,artworkId:link.artworkId,orientation,catalog:products,
      readinessStateId,buildInventory:buildOwnSilviaInventory
    });
    const context={
      listingId:Number(listingId),artworkId:link.artworkId,
      orientation,masterKey:String(master.master.key)
    };
    return {listing,inventory,plan,
      fingerprint:templateInventoryFingerprint(inventory,context)};
  }
  if(req.method==='POST'&&url.pathname==='/api/pricing/templates-preview'){
    if(!requireAdminApi(req,res))return;
    if(!String(req.headers['content-type']||'').includes('application/json'))
      return sendJson(res,415,{ok:false,error:'JSON request required.'});
    try{
      const session=await getEtsySession({forceRefresh:true});
      if(!String(session.scope||'').split(/\s+/).includes('listings_r'))
        return sendJson(res,403,{ok:false,error:'Reconnect Etsy with listings_r permission.'});
      const body=await readJsonBody(req);
      const requested=(Array.isArray(body.listingIds)?body.listingIds:[])
        .map(Number).filter(id=>Number.isSafeInteger(id)&&id>0);
      if(requested.length>30)throw Error('Preview at most 30 specific listings at once.');
      const all=await allShopListingsForPriceSync(session);
      const selected=requested.length?
        all.filter(x=>requested.includes(Number(x.listing_id))):
        all.slice(0,250);
      const rows=[];
      for(const listing of selected){
        const id=Number(listing.listing_id);
        try{
          const {plan,fingerprint}=await defaultTemplatePlan(session,id);
          rows.push({
            listingId:id,title:String(listing.title||''),state:String(listing.state||''),
            orientation:plan.orientation,artworkId:plan.artworkId,
            fingerprint,canUpdate:Boolean(plan.changed),
            previousVariantCount:plan.previousVariantCount,
            targetVariantCount:plan.targetVariantCount,
            enabledVariantCount:plan.enabledVariantCount,
            added:plan.added,removed:plan.removed,repriced:plan.repriced
          });
        }catch(error){
          if(requested.length)rows.push({
            listingId:id,title:String(listing.title||''),canUpdate:false,
            error:String(error.message||error)
          });
          // "all" mode skips unlinked and nonstandard Etsy listings entirely.
        }
      }
      return sendJson(res,200,{
        ok:true,shopListingCount:all.length,inspectedCount:selected.length,
        partialScan:!requested.length&&all.length>250,templates:rows,
        templatesNeedingChanges:rows.filter(x=>x.canUpdate).length,
        changesApplied:false
      });
    }catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
  }
  if(req.method==='POST'&&url.pathname==='/api/pricing/templates-apply'){
    if(!requireAdminApi(req,res))return;
    if(!String(req.headers['content-type']||'').includes('application/json'))
      return sendJson(res,415,{ok:false,error:'JSON request required.'});
    const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
    if(!host||(origin&&origin!==(String(req.headers['x-forwarded-proto']||'https')+'://'+host))||
       req.headers['sec-fetch-site']==='cross-site')
      return sendJson(res,403,{ok:false,error:'Cross-site update blocked.'});
    try{
      const body=await readJsonBody(req);
      if(body.confirm!=='REBUILD SILVIA TEMPLATES')
        return sendJson(res,400,{ok:false,error:'Explicit template rebuild confirmation is required.'});
      const selected=Array.isArray(body.templates)?body.templates:[];
      if(!selected.length||selected.length>20)throw Error('Select 1–20 templates per update.');
      const seen=new Set();
      for(const row of selected){
        if(!Number.isSafeInteger(Number(row.listingId))||Number(row.listingId)<1||
           !/^[0-9a-f]{64}$/.test(String(row.fingerprint||'')))
          throw Error('Invalid listing ID or preview fingerprint.');
        if(seen.has(Number(row.listingId)))throw Error('Duplicate template selection.');
        seen.add(Number(row.listingId));
      }
      const session=await getEtsySession({forceRefresh:true});
      const scopes=new Set(String(session.scope||'').split(/\s+/).filter(Boolean));
      if(!scopes.has('listings_r')||!scopes.has('listings_w'))
        return sendJson(res,403,{ok:false,error:'Reconnect Etsy with listings_r and listings_w permissions.'});
      const shop=await allShopListingsForPriceSync(session);
      const owned=new Set(shop.map(x=>Number(x.listing_id)));
      const results=[];
      for(const selectedRow of selected){
        const id=Number(selectedRow.listingId);
        if(!owned.has(id)){
          results.push({listingId:id,error:'Listing not found among active/draft shop listings.'});continue;
        }
        try{
          const before=await defaultTemplatePlan(session,id);
          if(before.fingerprint!==selectedRow.fingerprint)
            throw Error('Listing inventory or artwork changed since preview; preview again.');
          if(!before.plan.changed){
            results.push({listingId:id,updated:false,note:'Already matches the current template.'});continue;
          }
          const auth={keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken};
          await withEtsyListingRetry(()=>updateListingInventory({
            listingId:id,inventory:before.plan.inventory,...auth
          }));
          const after=await getListingInventory({listingId:id,...auth});
          const expected=new Map(before.plan.inventory.products
            .filter(p=>p.offerings?.[0]?.is_enabled)
            .map(p=>[String(p.sku||''),moneyAmount(p.offerings[0].price)]));
          const actual=new Map((after.products||[])
            .filter(p=>(p.offerings||[]).some(o=>o.is_enabled))
            .map(p=>[String(p.sku||''),moneyAmount(p.offerings?.[0]?.price)]));
          if(expected.size!==actual.size||[...expected].some(([sku,price])=>!actual.has(sku)||
            Math.abs(Number(actual.get(sku))-Number(price))>0.005))
            throw Error('Etsy inventory was updated but not all expected SKUs/prices could be verified.');
          results.push({
            listingId:id,updated:true,verified:true,orientation:before.plan.orientation,
            addedVariants:before.plan.added.length,removedVariants:before.plan.removed.length,
            repricedVariants:before.plan.repriced.length
          });
        }catch(error){results.push({listingId:id,error:String(error.message||error)});}
      }
      return sendJson(res,200,{ok:true,results,requested:selected.length,
        verifiedUpdated:results.filter(x=>x.verified).length,
        failed:results.filter(x=>x.error).length
      });
    }catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
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

  // A full supplier catalog scan can exceed Render's synchronous HTTP timeout.
  // Launch it in the background and return small authenticated JSON status replies.
  if(req.method==='GET'&&url.pathname==='/api/suppliers/compare/start'){
    if(!requireAdminApi(req,res))return;
    try{
      const countryCode=String(url.searchParams.get('country')||'').toUpperCase().trim();
      const productCodes=String(url.searchParams.get('products')||'P,C,FC')
        .split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
      const job=startSupplierComparisonJob({countryCodes:[countryCode],productCodes,
        sensariaProducts:products},scanSupplierComparison);
      return sendJson(res,202,{ok:true,jobId:job.id,status:job.status,reused:job.reused});
    }catch(error){
      return sendJson(res,400,{ok:false,error:String(error.message||error)});
    }
  }
  const supplierJobStatus=url.pathname.match(/^\/api\/suppliers\/compare\/jobs\/([a-f0-9-]{36})$/i);
  if(req.method==='GET'&&supplierJobStatus){
    if(!requireAdminApi(req,res))return;
    const job=getSupplierComparisonJob(supplierJobStatus[1]);
    if(!job)return sendJson(res,404,{ok:false,error:'Supplier scan is no longer available. Start this country again.'});
    return sendJson(res,200,{ok:true,...job});
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
  if(req.method==='GET'&&url.pathname==='/daily-listings'){
    if(!requireAdminPage(req,res,'/daily-listings'))return;
    return sendHtml(res,200,renderDailyListingsPage());
  }
  if(req.method==='GET'&&['/ai-seo-client.js','/mockup-presets-client.js','/daily-batch-client.js','/repost-listings-client.js','/listing-fees-client.js'].includes(url.pathname)){
    if(!requireAdminApi(req,res))return;
    const js=readFileSync(new URL('.'+url.pathname,import.meta.url),'utf8');
    res.writeHead(200,{'content-type':'application/javascript; charset=utf-8',
      'cache-control':'private, no-store','x-content-type-options':'nosniff'});
    return res.end(js);
  }
  // Daily Listings → New listings (a batch of artworks).
  if(url.pathname==='/api/batch'||url.pathname.startsWith('/api/batch/')){
    if(!requireAdminApi(req,res))return;
    if(req.method==='POST'&&crossSitePost(req))return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    try{
      const deps=batchDeps(),action=url.pathname.slice('/api/batch'.length);
      if(req.method==='GET'&&action===''){
        const job=await batchStatus(deps);
        // Each artwork's small preview, straight from R2.
        if(job)await Promise.all(job.items.map(async item=>{
          item.previewUrl=item.previewKey?await signedArtworkUrl(item.previewKey,3600).catch(()=>''):'';
        }));
        return sendJson(res,200,{ok:true,job,running:batchRunning(),max:MAX_BATCH,chatGpt:aiSeoConfigured()});
      }
      if(req.method==='GET'&&action==='/presets'){
        // The preset chosen for Daily Listings, or for the Listing Reposter (?for=repost).
        const [templates,media,orders,folder,saved]=await Promise.all([listMockupTemplates(),presetMediaStatus(),loadPhotoOrders(),
          getPcMockupFolder(),getJsonObject(url.searchParams.get('for')==='repost'?REPOST_PRESET_KEY:BATCH_PRESET_KEY).catch(()=>null)]);
        const presetImages=presetImagesOf(media),room=ETSY_PHOTO_LIMIT-presetImages.length;
        const video=media.items.find(item=>item.exists&&item.role==='video');
        const ready=templates.filter(t=>t.status==='ready'),presets=mockupPresets(ready);
        const chosen=presets.find(item=>presetKey(item.name)===presetKey(saved?.name))||presets[0]||null;
        // The folder may be set on the PC (worker config) rather than in the app.
        const worker=cropWorkerStatus();
        // Without any preset folder: the folders the app does see, to spot a
        // misnamed folder or one the worker has not reported yet.
        const seen=new Map();
        if(!presets.length)for(const t of ready.filter(t=>t.source==='pc')){
          const dir=String(t.localPath||'').split('/').slice(0,-1).join('/')||'(directly in the mockup folder)';
          seen.set(dir,(seen.get(dir)||0)+1);
        }
        // Arrange photos opens at once: each preset's tiles and its order for each shape come with the list.
        return sendJson(res,200,{ok:true,folder:folder||worker.mockupFolder?.path||'',room,chosen:chosen?.name||'',limit:ETSY_PHOTO_LIMIT,
          video:video?{label:'Preset video',src:await signedArtworkUrl(video.key,3600).catch(()=>null)}:null,
          worker:{online:worker.online,folder:worker.mockupFolder?.path||'',fromConfig:worker.mockupFolder?.fromConfig===true,
            count:worker.mockupFolder?.count??null,error:worker.mockupFolder?.error||''},
          folders:[...seen].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([path,count])=>({path,count})),
          outside:ready.filter(t=>t.source==='pc').length-presets.reduce((sum,item)=>sum+item.templates.length,0),
          presets:presets.map(item=>({name:item.name,templates:item.templates.map(t=>({id:t.id,name:t.name,localPath:t.localPath,
            orientation:t.orientation||'unclassified',squareCompatible:t.squareCompatible===true})),
            tiles:presetPhotoTiles(item,presetImages),
            arrange:Object.fromEntries(Object.keys(LAYOUT_NAMES).map(layout=>{
              const plan=presetPhotoPlan(item,layout,{presetImages,orders});
              return [layout,{order:plan.order,saved:Boolean(plan.saved)}];
            }))}))});
      }
      const previewRoute=action.match(/^\/template-preview\/([A-Za-z0-9_-]{1,80})$/);
      if(req.method==='GET'&&previewRoute){
        const bytes=await templatePreview(previewRoute[1]).catch(()=>null);
        if(!bytes)return sendJson(res,404,{ok:false,error:'No preview yet.'});
        res.writeHead(200,{'content-type':'image/jpeg','content-length':bytes.length,'cache-control':'private, max-age=600'});
        return res.end(bytes);
      }
      if(req.method!=='POST')return sendJson(res,405,{ok:false,error:'Method not allowed.'});
      const body=await readJsonBody(req);
      if(action==='/photo-order'){
        const layout=String(body.layout||'');
        if(!LAYOUT_NAMES[layout])return sendJson(res,400,{ok:false,error:'Unknown shape.'});
        const [templates,media,orders]=await Promise.all([listMockupTemplates(),presetMediaStatus(),loadPhotoOrders()]);
        const preset=mockupPresets(templates).find(entry=>presetKey(entry.name)===presetKey(body.preset));
        if(!preset)return sendJson(res,400,{ok:false,error:'The mockup preset "'+String(body.preset||'(none)').slice(0,120)+'" is not a folder in the PC mockup folder any more.'});
        const known=new Set(presetPhotoPlan(preset,layout,{presetImages:presetImagesOf(media),orders}).ids);
        const order=(Array.isArray(body.order)?body.order:[]).map(String).filter(id=>known.has(id));
        const key=photoOrderKey(preset.name,layout);
        // An empty order goes back to the usual one.
        if(order.length)orders[key]={order,savedAt:new Date().toISOString()};else delete orders[key];
        await putJsonObject(BATCH_PHOTO_ORDERS_KEY,orders);
        return sendJson(res,200,{ok:true,saved:Boolean(order.length)});
      }
      if(action==='/presets'){
        const name=String(body.name||'').slice(0,120);
        if(!mockupPresets(await listMockupTemplates()).some(item=>presetKey(item.name)===presetKey(name)))
          return sendJson(res,400,{ok:false,error:'That preset is not a folder in the PC mockup folder.'});
        await putJsonObject(body.for==='repost'?REPOST_PRESET_KEY:BATCH_PRESET_KEY,{name,savedAt:new Date().toISOString()});
        return sendJson(res,200,{ok:true,chosen:name});
      }
      if(action==='/preview-url'){
        const key='batch-poster/previews/'+crypto.randomUUID()+'.jpg';
        return sendJson(res,200,{ok:true,key,uploadUrl:await signedArtworkUploadUrl(key,'image/jpeg')});
      }
      if(action==='/add'){
        if(!aiSeoConfigured())return sendJson(res,400,{ok:false,error:'ChatGPT is not connected: add OPENAI_API_KEY in Render first.'});
        const previewKey=/^batch-poster\/previews\/[0-9a-f-]{36}\.jpg$/.test(String(body.previewKey||''))?String(body.previewKey):'';
        if(!String(body.preset||'').trim())return sendJson(res,400,{ok:false,error:'Choose the mockup preset first.'});
        await addToBatch(deps,{stageId:body.stageId,filename:body.filename,contentType:body.contentType,size:body.size,previewKey,preset:body.preset,
          width:Number(body.width)||0,height:Number(body.height)||0});
        return sendJson(res,200,{ok:true,job:await batchStatus(deps),running:batchRunning()});
      }
      if(action==='/resume'){
        await resumeBatch(deps,{retryFailed:body.retryFailed===true});
        return sendJson(res,200,{ok:true,job:await batchStatus(deps),running:batchRunning()});
      }
      if(action==='/stop'){
        await stopBatch(deps);
        return sendJson(res,200,{ok:true,job:await batchStatus(deps),running:batchRunning()});
      }
      if(action==='/start-over'){
        await startOver(deps);
        return sendJson(res,200,{ok:true,job:null,running:false});
      }
      if(action==='/tick'){
        await setPublish(deps,{n:body.n,publish:body.publish});
        return sendJson(res,200,{ok:true,job:await batchStatus(deps),running:batchRunning()});
      }
      if(action==='/publish'){
        if(body.confirm!=='PUBLISH NEW LISTINGS ON ETSY')
          return sendJson(res,400,{ok:false,error:'Explicit confirmation is required: this publishes listings on Etsy.'});
        await publishBatch(deps);
        return sendJson(res,200,{ok:true,job:await batchStatus(deps),running:true});
      }
      if(action==='/new'){
        await closeBatch(deps);
        return sendJson(res,200,{ok:true,job:null,running:false});
      }
      return sendJson(res,404,{ok:false,error:'Unknown batch action.'});
    }catch(error){return sendJson(res,400,{ok:false,error:String(error?.message||error)})}
  }

  // Daily Listings → Renew listings.
  if(url.pathname==='/api/renewer'||url.pathname.startsWith('/api/renewer/')){
    if(!requireAdminApi(req,res))return;
    if(req.method==='POST'&&crossSitePost(req))return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    try{
      const action=url.pathname.slice('/api/renewer'.length);
      if(req.method==='GET'&&action===''){
        const job=await loadRenewalJob();
        if(job&&!renewalRunning()&&['finding','renewing'].includes(job.status))job.status='stopped';
        let scopes=new Set();
        try{scopes=new Set(String((await getEtsySession()).scope||'').split(/\s+/))}catch{}
        return sendJson(res,200,{ok:true,job,running:renewalRunning(),max:MAX_RENEWALS,count:DEFAULT_RENEWALS,
          chatGpt:aiSeoConfigured(),canEdit:['listings_r','listings_w','transactions_r'].every(scope=>scopes.has(scope))});
      }
      if(req.method!=='POST')return sendJson(res,405,{ok:false,error:'Method not allowed.'});
      if(action==='/stop')return sendJson(res,200,{ok:true,stopping:stopRenewal()});
      if(!['/start','/resume'].includes(action))return sendJson(res,404,{ok:false,error:'Unknown reposter action.'});
      const body=await readJsonBody(req);
      if(body.confirm!=='REPOST LISTINGS ON ETSY')
        return sendJson(res,400,{ok:false,error:'Explicit confirmation is required: this publishes new listings and deactivates the old ones.'});
      if(!aiSeoConfigured())return sendJson(res,400,{ok:false,error:'ChatGPT is not connected: add OPENAI_API_KEY in Render first.'});
      const session=await getEtsySession();
      const scopes=new Set(String(session.scope||'').split(/\s+/));
      if(!['listings_r','listings_w','transactions_r'].every(scope=>scopes.has(scope)))return sendJson(res,403,{ok:false,needsReauthorization:true,
        error:'Reconnect Etsy first (the Reconnect Etsy link on this page): reposting needs permission to read and edit listings and sales.'});
      if(action==='/resume'){
        const job=await resumeRenewal(renewalDeps(),{retryFailed:body.retryFailed===true});
        return sendJson(res,200,{ok:true,job,running:true});
      }
      // The new listings get their mockups from the preset chosen on the Listing Reposter page.
      const preset=(await getJsonObject(REPOST_PRESET_KEY).catch(()=>null))?.name||'';
      const job=await startRenewal(renewalDeps(),{count:body.count,preset});
      return sendJson(res,200,{ok:true,job,running:true});
    }catch(error){return sendJson(res,400,{ok:false,error:String(error?.message||error)})}
  }

  // Listing Fees: a month's listing fees from the Etsy payment account ledger.
  if (req.method === 'GET' && url.pathname === '/listing-fees') {
    if (!requireAdminPage(req,res,'/listing-fees')) return;
    return sendHtml(res,200,renderListingFeesPage());
  }
  if (req.method === 'GET' && url.pathname === '/api/listing-fees') {
    if (!requireAdminApi(req,res)) return;
    try{
      const min=Number(url.searchParams.get('min')),max=Number(url.searchParams.get('max'));
      if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<=0||max<=min||max-min>MAX_RANGE_SECONDS)
        return sendJson(res,400,{ok:false,error:'Choose a month.'});
      const key=min+'-'+max,cached=listingFeesCache.get(key);
      if(cached&&url.searchParams.get('fresh')!=='1'&&Date.now()-cached.at<10*60*1000)
        return sendJson(res,200,{...cached.value,cached:true,ageSeconds:Math.round((Date.now()-cached.at)/1000)});
      const session=await getEtsySession();
      if(!String(session.scope||'').split(/\s+/).includes('transactions_r'))
        return sendJson(res,403,{ok:false,error:'Reconnect Etsy first: reading fees needs permission to read your sales and payments.'});
      const entries=await ledgerEntries(page=>getShopLedgerEntries({shopId:session.shop.shop_id,keystring:session.keystring,
        sharedSecret:session.sharedSecret,accessToken:session.accessToken,...page}),{min,max});
      const value={ok:true,...summarizeFees(entries,{min,max}),entries:entries.length};
      listingFeesCache.set(key,{at:Date.now(),value});
      return sendJson(res,200,value);
    }catch(error){return sendJson(res,502,{ok:false,error:String(error?.message||error).slice(0,400)})}
  }
  if (req.method === 'GET' && url.pathname === '/listing-reposter') {
    if (!requireAdminPage(req,res,'/listing-reposter')) return;
    return sendHtml(res,200,renderRepostListingsPage());
  }
  // The single-listing reposter (your own SEO and mockups, or a replacement artwork).
  if (req.method === 'GET' && url.pathname === '/listing-reposter/one') {
    if (!requireAdminPage(req,res,'/listing-reposter/one')) return;
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
        return sendJson(res,200,{ok:true,...await prepareReplacement(session,id,body,{template:repostTemplate})});
      if(action==='finalize'){
        const result=await finalizeReplacement(session,id,body.confirm);
        // Preserve the converted listing's artwork ID linkage for the new Etsy listing.
        await relinkReposted(id,result.record.draftId);
        return sendJson(res,200,{ok:true,...result});
      }
    }catch(error){return sendJson(res,400,{ok:false,error:String(error.message||error)});}
  }

  // Silvia-only master listings: read existing Etsy records, never bulk-edit
  // automatically. The conversion queue is unchanged and remains embedded.
  if(req.method==='GET' && url.pathname==='/listings'){
    if(!requireAdminPage(req,res,'/listings'))return;
    return sendHtml(res,200,renderListingsPage());
  }
  if(req.method==='GET' && url.pathname==='/listings-client.js'){
    if(!requireAdminApi(req,res))return;
    const js=readFileSync(new URL('./listings-client.js',import.meta.url),'utf8');
    res.writeHead(200,{'content-type':'application/javascript; charset=utf-8',
      'cache-control':'private, no-store','x-content-type-options':'nosniff'});
    return res.end(js);
  }
  if(req.method==='GET' && url.pathname==='/photo-replacer-client.js'){
    if(!requireAdminApi(req,res))return;
    const js=readFileSync(new URL('./photo-replacer-client.js',import.meta.url),'utf8');
    res.writeHead(200,{'content-type':'application/javascript; charset=utf-8',
      'cache-control':'private, no-store','x-content-type-options':'nosniff'});
    return res.end(js);
  }
  // Listings → Replace a photo: one photo swapped in every listing (see photo-replacer.mjs).
  if(url.pathname==='/api/photo-replacer'||url.pathname.startsWith('/api/photo-replacer/')){
    if(!requireAdminApi(req,res))return;
    if(req.method==='POST'){
      const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
      if(!host||(origin&&origin!==String(req.headers['x-forwarded-proto']||'https')+'://'+host)||
         req.headers['sec-fetch-site']==='cross-site')
        return sendJson(res,403,{ok:false,error:'Cross-site request blocked.'});
    }
    try{
      const action=url.pathname.slice('/api/photo-replacer'.length);
      if(req.method==='GET'&&action===''){
        let job=null;try{job=await getJsonObject(PHOTO_REPLACER_JOB_KEY)}catch(error){if(!isMissingR2Object(error))throw error}
        if(job&&!photoJobRunning()&&['scanning','replacing'].includes(job.status))job.status='stopped';
        return sendJson(res,200,{ok:true,job,running:photoJobRunning()});
      }
      if(req.method==='GET'&&action==='/listing-photos'){
        const listingId=Number(url.searchParams.get('listingId'));
        if(!Number.isSafeInteger(listingId)||listingId<=0)return sendJson(res,400,{ok:false,error:'Invalid Etsy listing ID.'});
        const images=await photoReplacerImages(listingId);
        return sendJson(res,200,{ok:true,photos:images.map(image=>({listingImageId:String(image.listing_image_id),
          rank:Number(image.rank),url:photoUrl(image),width:image.full_width||null,height:image.full_height||null}))});
      }
      if(req.method!=='POST')return sendJson(res,405,{ok:false,error:'Method not allowed.'});
      const body=await readJsonBody(req);
      if(action==='/upload'){
        const type=String(body.contentType||'').toLowerCase(),size=Number(body.size);
        if(!['image/jpeg','image/png','image/webp'].includes(type))return sendJson(res,400,{ok:false,error:'Choose a JPG, PNG or WebP photo.'});
        if(!(size>0&&size<=20*1024*1024))return sendJson(res,400,{ok:false,error:'The photo must be 20 MB or smaller.'});
        const key='photo-replacer/'+crypto.randomUUID()+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[type];
        return sendJson(res,200,{ok:true,key,uploadUrl:await signedArtworkUploadUrl(key,type)});
      }
      if(action==='/scan'){
        const session=await getEtsySession();
        if(!String(session.scope||'').split(/\s+/).includes('listings_w'))
          return sendJson(res,403,{ok:false,error:'Reconnect Etsy: replacing photos needs the listings_w permission.'});
        const listingId=Number(body.listingId),slot=Number(body.slot);
        const key=String(body.newImage?.key||'');
        if(!/^photo-replacer\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)||!await artworkObjectExists(key))
          return sendJson(res,400,{ok:false,error:'Upload the new photo first.'});
        if(!Number.isSafeInteger(slot)||slot<1||slot>20)return sendJson(res,400,{ok:false,error:'Choose a photo slot from 1 to 20.'});
        const images=await photoReplacerImages(listingId);
        const chosen=images.find(image=>String(image.listing_image_id)===String(body.listingImageId));
        if(!chosen)return sendJson(res,400,{ok:false,error:'That photo is no longer on the listing. Choose it again.'});
        const reference={listingId,listingImageId:String(chosen.listing_image_id),rank:Number(chosen.rank),
          url:photoUrl(chosen),width:chosen.full_width||null,height:chosen.full_height||null};
        const presetRole=await presetRoleForPhoto(reference.url).catch(()=>null);
        const job=await scanForPhoto(photoReplacerDeps(),{reference,slot,presetRole,
          newImage:{key,filename:String(body.newImage?.filename||'photo').replace(/[^\w .()-]/g,'').slice(0,100)||'photo',
            contentType:String(body.newImage?.contentType||'image/jpeg')}});
        return sendJson(res,200,{ok:true,job,running:true});
      }
      if(action==='/replace'){
        if(body.confirm!=='REPLACE PHOTOS ON ETSY')
          return sendJson(res,400,{ok:false,error:'Explicit confirmation is required: this changes photos on Etsy.'});
        const deps=photoReplacerDeps();
        const current=await deps.loadJob();
        if(current){current.updatePreset=Boolean(body.updatePreset&&current.presetRole);await deps.saveJob(current)}
        const job=await replacePhotos(deps,{listingIds:Array.isArray(body.listingIds)?body.listingIds:[]});
        return sendJson(res,200,{ok:true,job,running:true});
      }
      if(action==='/stop')return sendJson(res,200,{ok:true,stopping:stopPhotoJob()});
      return sendJson(res,404,{ok:false,error:'Unknown photo replacer action.'});
    }catch(error){return sendJson(res,400,{ok:false,error:String(error?.message||error)})}
  }
  if(req.method==='GET'&&url.pathname==='/api/master-listings'){
    if(!requireAdminApi(req,res))return;
    try{
      const session=await getEtsySession();
      if(!String(session.scope||'').split(/\s+/).includes('listings_r'))
        return sendJson(res,403,{ok:false,error:'Etsy listings_r permission is required.'});
      const page=await masterListingPage(session,Number(url.searchParams.get('offset')||0));
      return sendJson(res,200,{ok:true,...page,count:page.listings.length});
    }catch(error){return sendJson(res,502,{ok:false,error:String(error.message||error)});}
  }
  const masterRoute=url.pathname.match(/^\/api\/master-listings\/([1-9]\d{0,19})(?:\/(details|inventory|options))?$/);
  if(masterRoute&&(req.method==='GET'||req.method==='POST')){
    if(!requireAdminApi(req,res))return;
    const id=Number(masterRoute[1]),action=masterRoute[2]||'';
    if(!Number.isSafeInteger(id))return sendJson(res,400,{ok:false,error:'Invalid Etsy listing ID.'});
    if(req.method==='POST'){
      const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
      if(!host||(origin&&origin!==String(req.headers['x-forwarded-proto']||'https')+'://'+host)||
         req.headers['sec-fetch-site']==='cross-site')
        return sendJson(res,403,{ok:false,error:'Cross-site listing update blocked.'});
      if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))
        return sendJson(res,415,{ok:false,error:'JSON is required.'});
    }
    try{
      const session=await getEtsySession({forceRefresh:req.method==='POST'});
      const scopes=new Set(String(session.scope||'').split(/\s+/));
      if(!scopes.has('listings_r')||(req.method==='POST'&&!scopes.has('listings_w')))
        return sendJson(res,403,{ok:false,error:'Etsy listings_r and listings_w permissions are required for editing.'});
      const credentials={keystring:session.keystring,sharedSecret:session.sharedSecret,
        accessToken:session.accessToken};
      const fresh=await getListing({listingId:id,...credentials});
      if(Number(fresh?.shop_id)!==Number(session.shop.shop_id))
        return sendJson(res,403,{ok:false,error:'Listing does not belong to the connected Silvia Etsy shop.'});
      if(req.method==='GET'&&!action){
        // Metadata is the fast path: inventory, shop sections, and image
        // previews load after the editor is visible instead of blocking it.
        const map=await loadListingConverterMap();
        const entry=map.listings?.[String(id)]||null;
        const linked=await resolveListingArtwork({listingId:id,listing:fresh,map});
        return sendJson(res,200,{ok:true,listingId:id,state:String(fresh.state||''),
          artworkId:linked?.artworkId||entry?.artworkId||artworkIdFromSkus(fresh.skus),
          converted:entry?.status==='converted',artworkEditable:Boolean(linked),
          artworkSource:linked?.source||null,
          fields:listingEditorFields(fresh),metadataHash:listingEditorFingerprint(fresh),
          inventoryRows:[],inventoryHash:null,sections:[],previewUrl:null,
          optionsPending:true});
      }
      if(req.method==='GET'&&action==='options'){
        const [inventoryResult,sectionsResult]=await Promise.allSettled([
          getListingInventory({listingId:id,...credentials}),
          getShopSections({shopId:session.shop.shop_id,...credentials})
        ]);
        const inventory=inventoryResult.status==='fulfilled'?inventoryResult.value:null;
        const sections=sectionsResult.status==='fulfilled'
          ?(sectionsResult.value?.results||sectionsResult.value||[]):[];
        return sendJson(res,200,{ok:true,listingId:id,
          inventoryRows:inventory?inventoryEditorRows(inventory):[],
          inventoryHash:inventory?inventoryEditorFingerprint(inventory):null,
          inventoryError:inventoryResult.status==='rejected'
            ?String(inventoryResult.reason?.message||inventoryResult.reason):null,
          sections:Array.isArray(sections)?sections:[]});
      }
      if(req.method==='POST' && action){
        const input=await readJsonBody(req);
        if(action==='details'){
          if(input.confirm!=='SAVE SILVIA LISTING')
            return sendJson(res,400,{ok:false,error:'Explicit save confirmation is required.'});
          if(input.fingerprint!==listingEditorFingerprint(fresh))
            return sendJson(res,409,{ok:false,error:'The Etsy listing changed since you opened it. Refresh before saving.'});
          const edit=validateMasterListingEdit(input,fresh);
          if(!edit.changed)return sendJson(res,200,{ok:true,changed:false,listingId:id});
          await withEtsyListingRetry(()=>updateListing({shopId:session.shop.shop_id,listingId:id,
            listing:edit.patch,...credentials}));
          const confirmed=await getListing({listingId:id,...credentials});
          const actual=listingEditorFields(confirmed);
          // Etsy sometimes normalizes line endings and HTML entities.
          if(actual.title!==edit.next.title ||
             !sameEtsyDescription(actual.description,edit.next.description) ||
             JSON.stringify([...actual.tags].sort())!==JSON.stringify([...edit.next.tags].sort()) ||
             actual.shopSectionId!==edit.next.shopSectionId)
            throw Error('Etsy accepted the save but returned different details. Refresh to review what was saved.');
          return sendJson(res,200,{ok:true,changed:true,verified:true,listingId:id});
        }
        if(action==='inventory'){
          if(input.confirm!=='SAVE SILVIA VARIANTS')
            return sendJson(res,400,{ok:false,error:'Explicit variation save confirmation is required.'});
          const existing=await getListingInventory({listingId:id,...credentials});
          if(input.fingerprint!==inventoryEditorFingerprint(existing))
            return sendJson(res,409,{ok:false,error:'Etsy variation data has changed. Refresh before saving.'});
          const updated=applyInventoryEditorChanges(existing,input.updates);
          if(!input.updates.length)return sendJson(res,200,{ok:true,updated:0});
          await withEtsyListingRetry(()=>updateListingInventory({
            listingId:id,inventory:updated,...credentials
          }));
          const verified=await getListingInventory({listingId:id,...credentials});
          if(inventoryEditorFingerprint(verified)!==inventoryEditorFingerprint(updated))
            throw Error('Etsy returned different variation prices or quantities. Refresh to inspect them.');
          return sendJson(res,200,{ok:true,updated:input.updates.length,verified:true});
        }
      }
      return sendJson(res,405,{ok:false,error:'Unsupported listing editor action.'});
    }catch(error){
      return sendJson(res,/changed|Refresh/i.test(String(error.message||error))?409:400,
        {ok:false,error:String(error.message||error)});
    }
  }

  if (req.method === 'GET' && url.pathname === '/listing-converter') {
    if (!requireAdminPage(req, res, '/listings?tab=converter')) return;
    if(url.searchParams.get('embedded')==='1'){
      // Same-origin converter tab reuses the complete, existing queue and UI,
      // but no nested admin sidebar or duplicate worker bootstrap.
      const content=renderListingConverterPage().replace('</head>',
        '<style>.app-shell{display:block!important;grid-template-columns:minmax(0,1fr)!important}'+
        '.app-sidebar{display:none!important}.shell{max-width:none!important;padding:12px 10px 30px!important}'+
        '.top h1{font-size:30px!important}</style></head>');
      res.writeHead(200,{'content-type':'text/html; charset=utf-8',
        'cache-control':'private, no-store','x-content-type-options':'nosniff'});
      return res.end(content);
    }
    return sendHtml(res, 200, renderListingConverterPage());
  }

  // Preview images are fetched only when a card scrolls into view.
  if (req.method==='GET' && url.pathname==='/api/listing-converter/listing-image'){
    if(!requireAdminApi(req,res))return;
    const listingId=Number(url.searchParams.get('listingId'));
    if(!Number.isSafeInteger(listingId)||listingId<=0)
      return sendJson(res,400,{ok:false,error:'A valid Etsy listing ID is required.'});
    try{
      const session=await getEtsySession();
      const result=await cachedConverterListingPreview(session,listingId);
      return sendJson(res,200,{ok:true,listingId,...result});
    }catch(error){
      return sendJson(res,502,{ok:false,error:'Etsy preview unavailable: '+
        String(error?.message||error).slice(0,180)});
    }
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

  // Several listings' artwork jobs at once (Listings page). It only reads
  // this app's job records and crop queue: no Etsy call per poll.
  if(req.method==='GET'&&url.pathname==='/api/listing-converter/reconvert/statuses'){
    if(!requireAdminApi(req,res))return;
    try{
      const ids=String(url.searchParams.get('listingIds')||'').split(',').filter(Boolean);
      if(!ids.length||ids.length>60||ids.some(id=>!/^[1-9]\d{0,19}$/.test(id)))
        return sendJson(res,400,{ok:false,error:'Give 1 to 60 Etsy listing IDs.'});
      const session=await getEtsySession();
      return sendJson(res,200,{ok:true,statuses:await getConverterArtworkRevisionStatuses(String(session.shop.shop_id),ids)});
    }catch(error){return sendJson(res,500,{ok:false,error:String(error.message||error)});}
  }

  // Staged reconversion requires a fresh master and a separately verified crop job.
  if ((req.method==='POST'&&(
     url.pathname==='/api/listing-converter/reconvert/reserve'||
     url.pathname==='/api/listing-converter/reconvert/crop'||
     url.pathname==='/api/listing-converter/reconvert/activate'
  ))||(req.method==='GET'&&url.pathname==='/api/listing-converter/reconvert/status')){
    if(!requireAdminApi(req,res))return;
    if(req.method==='POST'){
     const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
     if(!host||(origin&&origin!==String(req.headers['x-forwarded-proto']||'https')+'://'+host)||
        req.headers['sec-fetch-site']==='cross-site')
      return sendJson(res,403,{ok:false,error:'Cross-site reconversion request blocked.'});
     if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))
      return sendJson(res,415,{ok:false,error:'JSON is required.'});
    }
    try{
     const body=req.method==='POST'?await readJsonBody(req):{
       listingId:url.searchParams.get('listingId')
     };
     const listingId=Number(body.listingId);
     if(!Number.isSafeInteger(listingId)||listingId<=0)
      return sendJson(res,400,{ok:false,error:'Invalid Etsy listing ID.'});
     const map=await loadListingConverterMap();
     // A status read uses the cached Etsy login; changes refresh it.
     const session=await getEtsySession({forceRefresh:req.method==='POST'}),shopId=String(session.shop.shop_id);
     // Converted listings are verified through the converter map; Product
     // Creator listings through their artwork manifest and Etsy SKUs.
     const etsyListing=map.listings?.[String(listingId)]?.status==='converted'?null:
      await getListing({listingId,keystring:session.keystring,sharedSecret:session.sharedSecret,
       accessToken:session.accessToken}).catch(()=>null);
     if(etsyListing&&Number(etsyListing.shop_id)!==Number(session.shop.shop_id))
      return sendJson(res,403,{ok:false,error:'Listing does not belong to the connected Silvia Etsy shop.'});
     const linked=await resolveListingArtwork({listingId,listing:etsyListing,map});
     if(!linked||!new RegExp('^SAC\\d+$').test(linked.artworkId))
      return sendJson(res,409,{ok:false,error:'Artwork ownership could not be verified for this listing.'});
     const artworkId=linked.artworkId;
     if(req.method==='GET')
      return sendJson(res,200,{ok:true,...await getConverterArtworkRevisionStatus(shopId,listingId)});
     if(url.pathname.endsWith('/reserve')){
      const useExistingMaster=body.useExistingMaster===true;
      if(!useExistingMaster&&!body.master?.filename)
       return sendJson(res,400,{ok:false,error:'Choose a new master artwork file.'});
      const listings=await allShopListingsForPriceSync(session);
      if(!listings.some(item=>Number(item.listing_id)===listingId))
       return sendJson(res,404,{ok:false,error:'Etsy listing is not active or draft in this shop.'});
      if(useExistingMaster)
       return sendJson(res,200,{ok:true,...await reserveConverterArtworkRegeneration({
        shopId,listingId,artworkId
       })});
      return sendJson(res,200,{ok:true,...await reserveConverterArtworkRevision({
       shopId,listingId,artworkId,master:body.master,orientation:body.orientation
      })});
     }
     if(!/^[0-9a-f-]{36}$/i.test(String(body.revision||'')))
      return sendJson(res,400,{ok:false,error:'Missing artwork revision ID.'});
     if(url.pathname.endsWith('/activate')){
      // Listings editor "Re-upload artwork": Etsy variants, SKUs and prices are
      // unchanged, so the verified master + crops are promoted into the
      // artwork's R2 folder directly (same checks and rollback as reconversion).
      if(body.confirm!=='REPLACE SILVIA ARTWORK')
       return sendJson(res,400,{ok:false,error:'Explicit artwork replacement confirmation is required.'});
      const activated=await activateConverterArtworkRevision({
       shopId,listingId,artworkId,revision:String(body.revision)
      });
      const latestMap=await loadListingConverterMap();
      const entry=latestMap.listings?.[String(listingId)];
      if(entry&&!activated.alreadyActive){
       entry.artworkReplacedAt=new Date().toISOString();
       entry.artworkReplacementCount=Number(entry.artworkReplacementCount||0)+1;
       await saveListingConverterMap(latestMap);
      }
      return sendJson(res,200,{ok:true,...activated});
     }
     const queued=await startConverterArtworkCrop({
      shopId,listingId,artworkId,revision:body.revision
     });
     return sendJson(res,200,{ok:true,revision:queued.record.revision,
      job:queued.job,reused:queued.reused,worker:cropWorkerStatus()});
    }catch(error){
     return sendJson(res,400,{ok:false,error:String(error?.message||error)});
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
        orientation: String(body.orientation || 'auto').toLowerCase(),
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

  if (req.method==='GET'&&url.pathname==='/api/listing-converter/queue'){
    if(!requireAdminApi(req,res))return;
    try{return sendJson(res,200,{ok:true,jobs:await getConversionQueueSummary()})}
    catch(error){return sendJson(res,500,{ok:false,error:error.message})}
  }
  const converterQueueRoute=url.pathname.match(/^\/api\/listing-converter\/queue\/(listing_[a-f0-9-]+)(?:\/(cancel))?$/);
  if(converterQueueRoute){
    if(!requireAdminApi(req,res))return;
    const [,id,action]=converterQueueRoute;
    try{
     if(req.method==='GET'&&!action){
      const job=await getConversionJob(id);
      return sendJson(res,job?200:404,{ok:Boolean(job),job,error:job?undefined:'Conversion job not found'});
     }
     if(req.method==='POST'&&action==='cancel')
      return sendJson(res,200,{ok:true,job:await cancelConversion(id)});
    }catch(error){return sendJson(res,409,{ok:false,error:error.message})}
    return sendJson(res,405,{ok:false,error:'Method not supported'});
  }
  if (req.method === 'POST' && url.pathname === '/api/listing-converter/convert') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body=await readJsonBody(req);
      const listingId=Number(body.listingId),artworkId=String(body.artworkId||'').trim().toUpperCase();
      if(!Number.isSafeInteger(listingId)||listingId<=0||!/^(SAC)\d+$/.test(artworkId))
       throw Error('Valid listing and existing artwork ID are required.');
      if(body.reconvert===true){
       const session=await getEtsySession({forceRefresh:true});
       await assertConverterArtworkReady({shopId:session.shop.shop_id,listingId,
        artworkId,revision:body.revision});
      }
      const queued=await enqueueConversion({listingId,artworkId,
       reconvert:body.reconvert===true,revision:body.revision});
      void runPendingListingConversions();
      return sendJson(res,202,{ok:true,queued:true,...queued});
    }catch(error){
      return sendJson(res,400,{ok:false,error:error?.message||String(error)});
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
      // Presets are optional: any of the 3 image slots and the video slot, one
      // file each. Slots not sent keep what is installed.
      const roles = files.map((file) => String(file?.role || ''));
      if (!roles.length) throw new Error('Choose up to 3 preset images and 1 video.');
      const unknown = roles.find((role) => !PRESET_MEDIA.some((item) => item.role === role));
      if (unknown !== undefined) throw new Error(`Unknown preset slot: ${unknown.slice(0, 40) || '(none)'}`);
      if (new Set(roles).size !== roles.length) throw new Error('Each preset slot takes one file.');
      const uploads = await Promise.all(PRESET_MEDIA.filter((item) => roles.includes(item.role)).map(async (item) => {
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
      // The slots just uploaded must now be in R2 (all of them, for an older page).
      const body = await readJsonBody(req).catch(() => ({}));
      const roles = Array.isArray(body?.roles) ? body.roles.map(String) : [];
      const status = await presetMediaStatus();
      const uploaded = roles.length ? status.items.filter((item) => roles.includes(item.role)) : status.items;
      if (!uploaded.length || uploaded.length !== (roles.length || status.items.length) || uploaded.some((item) => !item.exists)) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Preset media upload is incomplete.',
          items: status.items
        });
      }
      // A replaced preset photo must not be served from the in-memory Etsy copy.
      for (const item of uploaded) presetEtsyImages.delete(item.key);
      if (uploaded.some((item) => item.role === 'video')) await forgetPresetVideoIds();
      return sendJson(res, 200, { ok: true, ...status });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  // Presets are optional: one can be removed. New drafts then leave that slot
  // out, and the Product Creator lets one more mockup be picked.
  if (req.method === 'POST' && url.pathname === '/api/presets/remove') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const preset = PRESET_MEDIA.find((item) => item.role === String(body?.role || ''));
      if (!preset) return sendJson(res, 400, { ok: false, error: 'Unknown preset slot.' });
      await deleteArtworkObject(preset.key);
      presetEtsyImages.delete(preset.key);
      if (preset.role === 'video') await forgetPresetVideoIds();
      return sendJson(res, 200, { ok: true, removed: preset.role, ...(await presetMediaStatus()) });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  // ChatGPT SEO: its settings, and SEO for one artwork picture.
  if (url.pathname === '/api/ai-seo/settings' && (req.method === 'GET' || req.method === 'POST')) {
    if (!requireAdminApi(req, res)) return;
    try {
      const settings = req.method === 'POST' ? await saveAiSeoSettings(await readJsonBody(req)) : await loadAiSeoSettings();
      return sendJson(res, 200, { ok: true, configured: aiSeoConfigured(), settings,
        defaults: { instructions: DEFAULT_AI_SEO_INSTRUCTIONS, model: DEFAULT_AI_SEO_MODEL } });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/ai-seo/generate') {
    if (!requireAdminApi(req, res)) return;
    try {
      const body = JSON.parse((await readRawBody(req, 6 * 1024 * 1024)).toString('utf8') || '{}');
      let picture = Buffer.from(String(body.image || '').replace(/^data:[^,]*,/, ''), 'base64');
      // No picture from the browser (e.g. a TIFF): use the master already in R2.
      if (picture.length < 100 && /^SAC\d+$/.test(String(body.artworkId || ''))) {
        const manifest = await loadArtworkManifest(String(body.artworkId));
        if (manifest?.master?.key) picture = (await getArtworkObject(manifest.master.key)).body;
      }
      if (picture.length < 100) return sendJson(res, 400, { ok: false, error: 'Choose the master artwork first.' });
      const session = await getEtsySession();
      const seo = await generateEtsySeo({ image: await seoImage(picture), orientation: String(body.orientation || ''),
        ...(await seoShopContext(session)) });
      return sendJson(res, 200, { ok: true, seo, pasteText: seoPasteText(seo) });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error?.message || String(error) });
    }
  }

  const regularMockupRoute=url.pathname.match(/^\/api\/artworks\/(SAC\d+)\/regular-mockups(?:\/(reserve|confirm|sync|status))?$/i);
  if(regularMockupRoute){
   if(!requireAdminApi(req,res))return;
   const artworkId=regularMockupRoute[1].toUpperCase(),action=regularMockupRoute[2];
   try{
    if(req.method==='POST'&&action==='reserve'){
     const body=await readJsonBody(req);
     return sendJson(res,200,{ok:true,...await reserveRegularMockups(artworkId,body.files)});
    }
    if(req.method==='POST'&&action==='confirm'){
     const saved=await confirmRegularMockups(artworkId);
     const etsySync=await queueRegularMockupEtsySync(artworkId);
     return sendJson(res,200,{ok:true,...saved,etsySync});
    }
    if(req.method==='POST'&&action==='sync'){
     return sendJson(res,200,{ok:true,...await queueRegularMockupEtsySync(artworkId)});
    }
    if(req.method==='GET'&&action==='status'){
     const manifest=await loadArtworkManifest(artworkId);
     const recorded=manifest.regularMockupSync||{};
     const state=recorded.status==='running'&&!regularMockupSyncActive.has(artworkId)
       ?'interrupted':recorded.status||'not_started';
     return sendJson(res,200,{ok:true,artworkId,...recorded,status:state,
      storedImages:(manifest.mockups||[]).length});
    }
    return sendJson(res,405,{ok:false,error:'Unsupported mockup action'});
   }catch(error){return sendJson(res,409,{ok:false,error:String(error.message||error)})}
  }

  // Etsy photo organizer: the photos in listing order, and saving a new order.
  if(url.pathname==='/api/etsy-photo-organizer'&&(req.method==='GET'||req.method==='POST')){
    if(!requireAdminApi(req,res))return;
    try{
      if(req.method==='GET'){
        const artworkId=String(url.searchParams.get('artworkId')||'').toUpperCase();
        return sendJson(res,200,{ok:true,...await etsyPhotoOrganizer({
          artworkId:/^SAC\d+$/.test(artworkId)?artworkId:'',jobId:String(url.searchParams.get('jobId')||''),
          templateIds:String(url.searchParams.get('templateIds')||'').split(',').filter(Boolean).slice(0,40)})});
      }
      const body=await readJsonBody(req);
      const artworkId=String(body.artworkId||'').toUpperCase();
      if(!/^SAC\d+$/.test(artworkId))throw Error('Create the Etsy draft first; the order is kept until then.');
      // Photos after Etsy's 20 are kept in the order (they are simply not added).
      const order=(Array.isArray(body.order)?body.order:[]).map(String).filter(id=>id.length<600).slice(0,ETSY_PHOTO_LIMIT*2);
      const templateIds=(Array.isArray(body.templateIds)?body.templateIds:[]).map(String).slice(0,40);
      await updateArtworkManifest(artworkId,current=>{
        const master=current.master?.key?'key:'+current.master.key:'';
        current.etsyPhotoOrder={tiles:order.filter(id=>id!=='master'&&id!==master),jobId:String(body.jobId||''),
          savedAt:new Date().toISOString()};
      });
      const sync=templateIds.length?await syncGeneratedMockupsForArtwork({artworkId,jobId:String(body.jobId||''),templateIds}):{ok:true};
      const manifest=await loadArtworkManifest(artworkId);
      const orderResult=manifest.etsyDraftListingId&&!sync.pendingSetup&&!sync.pendingDraft
        ?await applyEtsyPhotoOrder(artworkId):{applied:false,pending:true};
      return sendJson(res,200,{ok:true,sync,order:orderResult});
    }catch(error){return sendJson(res,409,{ok:false,error:String(error?.message||error)})}
  }
  if(req.method==='GET'&&url.pathname==='/api/etsy-photo-organizer/thumb'){
    if(!requireAdminApi(req,res))return;
    try{
      const key=String(url.searchParams.get('key')||'');
      if(!/^(presets\/listing-media\/|artworks\/SAC\d+\/)[^?#]+$/.test(key)||key.includes('..'))throw Error('Not an organizer photo.');
      const body=await organizerThumb(key);
      res.writeHead(200,{'content-type':'image/jpeg','content-length':body.length,
        'cache-control':'private, max-age=86400','x-content-type-options':'nosniff'});
      return res.end(body);
    }catch(error){return sendJson(res,404,{ok:false,error:String(error?.message||error)})}
  }

  // Master uploaded on file pick, before an artwork ID or folders exist.
  if (req.method === 'POST' && url.pathname === '/api/artworks/stage') {
    if (!requireAdminApi(req, res)) return;
    try {
      return sendJson(res, 201, { ok: true, ...(await stageMasterUpload(await readJsonBody(req))) });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });
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

  // Listing templates (Listings → Templates): the Product Creator's defaults per
  // artwork orientation.
  if (url.pathname === '/api/listing-templates' && (req.method === 'GET' || req.method === 'POST')) {
    if (!requireAdminApi(req, res)) return;
    try {
      if (req.method === 'POST') {
        const origin = String(req.headers.origin || ''), host = String(req.headers.host || '');
        const scheme = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
        if (origin && origin !== scheme + '://' + host)
          return sendJson(res, 403, { ok: false, error: 'Cross-site template change blocked.' });
        const body = await readJsonBody(req);
        const saved = await saveListingTemplate(String(body.orientation || ''), body.template);
        return sendJson(res, 200, { ok: true, ...saved, orientationsList: TEMPLATE_ORIENTATIONS });
      }
      return sendJson(res, 200, { ok: true, ...(await loadListingTemplates()), orientationsList: TEMPLATE_ORIENTATIONS,
        builtInDescription: listingDefaults.descriptionTemplate, styles: ETSY_WALL_ART_STYLES });
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

      const detectedPreset = detectedListingPreset(shipping.results || shipping || [], sourceListings);

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
        // Listings → Templates: the Product Creator fills the form from these.
        listingTemplates: (await loadListingTemplates().catch(() => ({ orientations: {} }))).orientations,
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

  const appendGeneratedPath=url.pathname.match(/^\/api\/artworks\/(SAC\d+)\/append-generated-mockups$/);
  if(req.method==='POST'&&appendGeneratedPath){
    if(!requireAdminApi(req,res))return;
    try{
      const body=await readJsonBody(req);
      const result=await syncGeneratedMockupsForArtwork({
        artworkId:appendGeneratedPath[1],jobId:String(body.jobId||''),templateIds:body.templateIds||[]
      });
      return sendJson(res,200,result);
    }catch(error){return sendJson(res,409,{ok:false,error:String(error?.message||error)})}
  }

  const draftSetupStatusPath=url.pathname.match(/^\/api\/artworks\/(SAC\d+)\/draft-setup$/);
  if(req.method==='GET'&&draftSetupStatusPath){
    if(!requireAdminApi(req,res))return;
    try{
      const artworkId=draftSetupStatusPath[1],manifest=await loadArtworkManifest(artworkId);
      if(!manifest)return sendJson(res,404,{ok:false,error:'R2 artwork record does not exist.'});
      const masterExists=Boolean(manifest.master?.key&&await artworkObjectExists(manifest.master.key));
      const stored=manifest.etsyDraftSetup||null;
      const status=stored?.status==='running'&&!inflightDraftSetups.has(artworkId)?'interrupted':(stored?.status||'not_started');
      return sendJson(res,200,{ok:true,artworkId,r2Prefix:'artworks/'+artworkId+'/',
        masterExists,listingId:manifest.etsyDraftListingId||null,
        setup:stored?{...stored,status}: {status},state:status});
    }catch(error){return sendJson(res,500,{ok:false,error:error.message})}
  }

  if (req.method === 'POST' && url.pathname === '/etsy/drafts') {
    if (!requireAdminApi(req, res)) return;
    let body;
    try { body = await readJsonBody(req); }
    catch { return sendJson(res, 400, { ok: false, error: 'The request could not be read.' }); }
    const reply = await createEtsyDraft(body);
    return sendJson(res, reply.status, reply.payload);
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
      scopes: ['transactions_r', 'transactions_w', 'listings_r', 'listings_w', 'listings_d', 'shops_r', 'shops_w']
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

// Staged masters whose Etsy draft was never created are removed after 3 days.
setTimeout(()=>void pruneStagedMasters().catch(()=>{}),60_000).unref();
setInterval(()=>void pruneStagedMasters().catch(()=>{}),12*60*60*1000).unref();

// Keep Render's edge proxy from reusing a connection Node has already closed.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 120_000;

// One-time recovery after deployment for recent drafts created before automatic
// PSD completion callbacks existed. No repeated scans or duplicate uploads.
async function recoverRecentGeneratedJpgs(){
  const threshold=Date.now()-72*60*60*1000;
  const jobs=await listMockupJobs(100);
  const recent=jobs.filter(job=>job.artworkId&&job.sourceMasterKey&&
    Date.parse(job.updatedAt||job.createdAt||'')>=threshold&&
    job.templates?.some(item=>item.status==='completed'&&item.outputKey));
  for(const job of recent){
    try{
      const manifest=await loadArtworkManifest(job.artworkId);
      if(!manifest?.etsyDraftListingId||manifest.master?.key!==job.sourceMasterKey)continue;
      const selected=manifest.selectedMockupTemplates?.[job.id];
      if(!Array.isArray(selected)||!selected.length)continue;
      await syncGeneratedMockupsForArtwork({artworkId:job.artworkId,jobId:job.id,templateIds:selected});
    }catch(error){
      console.error('Recent PSD recovery failed for '+job.artworkId+':',error);
    }
  }
}

// Gmail polls are advisory and run only after explicit OAuth connection.
// Render instances that sleep do not offer guaranteed continuous polling;
// the on-demand Scan Gmail button remains available.
const GMAIL_TRACKING_POLL_MS=15*60*1000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Silvia Sensaria bridge listening on port ${port}`);
  setTimeout(()=>{void recoverRecentGeneratedJpgs().catch(
    error=>console.error('PSD startup recovery failed:',error)
  );},30000).unref();
  // A Daily Listings batch that was running before this restart goes on.
  setTimeout(()=>{void resumeAfterRestart(batchDeps()).then(resumed=>{if(resumed)console.log('Daily Listings batch resumed after a restart.')},
    error=>console.error('Daily Listings batch could not resume after a restart:',error.message));},15000).unref();
  if(AUTO_REVIEW_ENABLED){
    setTimeout(()=>{void reconcileNewEtsyPaidOrders();},30000).unref();
    setInterval(()=>{void reconcileNewEtsyPaidOrders();},AUTO_REVIEW_INTERVAL_MS).unref();
  }
  if(gmailOAuthConfigured()){
    const poll=async()=>{
      try{
        if(!(await gmailConnectionStatus()).connected)return;
        const session=await getEtsySession();
        await scanSensariaGmail(session);
      }catch(error){console.error('[gmail tracking] scheduled scan error: '+String(error.message||error));}
    };
    setTimeout(()=>{void poll();},2*60*1000).unref();
    setInterval(()=>{void poll();},GMAIL_TRACKING_POLL_MS).unref();
  }
});
