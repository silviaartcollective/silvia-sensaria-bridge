import crypto from 'node:crypto';

const ETSY_API_BASE = 'https://api.etsy.com/v3';

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');
  return { codeVerifier, codeChallenge, state };
}

export function buildAuthorizationUrl({
  keystring,
  redirectUri,
  codeChallenge,
  state,
  scopes = ['transactions_r', 'transactions_w', 'listings_r', 'listings_w', 'shops_r', 'shops_w']
}) {
  requireValue(keystring, 'Etsy keystring');
  requireValue(redirectUri, 'Etsy redirect URI');
  requireValue(codeChallenge, 'PKCE code challenge');
  requireValue(state, 'OAuth state');

  const url = new URL('https://www.etsy.com/oauth/connect');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('client_id', keystring);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeAuthorizationCode({
  keystring,
  redirectUri,
  code,
  codeVerifier
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: requireValue(keystring, 'Etsy keystring'),
    redirect_uri: requireValue(redirectUri, 'Etsy redirect URI'),
    code: requireValue(code, 'Authorization code'),
    code_verifier: requireValue(codeVerifier, 'PKCE code verifier')
  });

  const response = await fetch(`${ETSY_API_BASE}/public/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    throw new Error(`Etsy token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function refreshEtsyToken({ keystring, refreshToken }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: requireValue(keystring, 'Etsy keystring'),
    refresh_token: requireValue(refreshToken, 'Etsy refresh token')
  });

  const response = await fetch(`${ETSY_API_BASE}/public/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    throw new Error(`Etsy token refresh failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function apiKeyHeader({ keystring, sharedSecret }) {
  return `${requireValue(keystring, 'Etsy keystring')}:${requireValue(sharedSecret, 'Etsy shared secret')}`;
}

function apiHeaders({ keystring, sharedSecret, accessToken, form = false }) {
  return {
    'x-api-key': apiKeyHeader({ keystring, sharedSecret }),
    authorization: `Bearer ${requireValue(accessToken, 'Etsy access token')}`,
    ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
  };
}

export function getUserIdFromAccessToken(accessToken) {
  const token = requireValue(accessToken, 'Etsy access token');
  const userId = String(token).split('.')[0];
  if (!/^\d+$/.test(userId)) {
    throw new Error('Could not determine Etsy user ID from access token');
  }
  return userId;
}

export async function getShopByOwnerUserId({
  userId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/users/${encodeURIComponent(userId)}/shops`,
    {
      headers: {
        'x-api-key': apiKeyHeader({ keystring, sharedSecret }),
        authorization: `Bearer ${requireValue(accessToken, 'Etsy access token')}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Etsy shop lookup failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function getShopReceipt({
  shopId,
  receiptId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );

  if (!response.ok) {
    throw new Error(`Etsy receipt fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function createReceiptShipment({
  shopId,
  receiptId,
  trackingCode,
  carrierName,
  keystring,
  sharedSecret,
  accessToken
}) {
  const body = new URLSearchParams({
    tracking_code: requireValue(trackingCode, 'Tracking code'),
    carrier_name: requireValue(carrierName, 'Carrier name')
  });

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}/tracking`,
    {
      method: 'POST',
      headers: apiHeaders({ keystring, sharedSecret, accessToken, form: true }),
      body
    }
  );

  if (!response.ok) {
    throw new Error(`Etsy tracking update failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function normalizeWebhookSignatures(value) {
  return String(value || '')
    .split(/[ ,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^v\d+[=,]/i, ''));
}

export function verifyEtsyWebhook({
  rawBody,
  webhookId,
  webhookTimestamp,
  webhookSignature,
  signingSecret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
}) {
  requireValue(rawBody, 'Webhook raw body');
  requireValue(webhookId, 'webhook-id');
  requireValue(webhookTimestamp, 'webhook-timestamp');
  requireValue(webhookSignature, 'webhook-signature');
  requireValue(signingSecret, 'Etsy webhook signing secret');

  const timestamp = Number(webhookTimestamp);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid Etsy webhook timestamp');
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new Error('Stale Etsy webhook timestamp');
  }

  const encodedSecret = String(signingSecret).replace(/^whsec_/, '');
  const secret = Buffer.from(encodedSecret, 'base64');
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedContent)
    .digest('base64');

  const expectedBuffer = Buffer.from(expected);
  const matches = normalizeWebhookSignatures(webhookSignature).some((candidate) => {
    const candidateBuffer = Buffer.from(candidate);
    return candidateBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
  });

  if (!matches) throw new Error('Invalid Etsy webhook signature');
  return true;
}


export async function getShopShippingProfiles({
  shopId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/shipping-profiles`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy shipping profiles fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}


export async function createShopShippingProfile({
  shopId,
  title,
  originCountryIso,
  destinationCountryIso,
  primaryCost = 0,
  secondaryCost = 0,
  originPostalCode,
  minDeliveryDays,
  maxDeliveryDays,
  keystring,
  sharedSecret,
  accessToken
}) {
  const body = new URLSearchParams({
    title: requireValue(title, 'Shipping profile title'),
    origin_country_iso: requireValue(originCountryIso, 'Origin country ISO'),
    destination_country_iso: requireValue(destinationCountryIso, 'Destination country ISO'),
    primary_cost: String(Number(primaryCost)),
    secondary_cost: String(Number(secondaryCost)),
    origin_postal_code: requireValue(originPostalCode, 'Origin postal code'),
    min_delivery_days: String(Number(minDeliveryDays)),
    max_delivery_days: String(Number(maxDeliveryDays))
  });

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/shipping-profiles`,
    {
      method: 'POST',
      headers: apiHeaders({ keystring, sharedSecret, accessToken, form: true }),
      body
    }
  );
  if (!response.ok) {
    throw new Error(`Etsy shipping profile creation failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function createShopShippingProfileDestination({
  shopId,
  shippingProfileId,
  destinationCountryIso,
  primaryCost = 0,
  secondaryCost = 0,
  minDeliveryDays,
  maxDeliveryDays,
  keystring,
  sharedSecret,
  accessToken
}) {
  const body = new URLSearchParams({
    destination_country_iso: requireValue(destinationCountryIso, 'Destination country ISO'),
    primary_cost: String(Number(primaryCost)),
    secondary_cost: String(Number(secondaryCost)),
    min_delivery_days: String(Number(minDeliveryDays)),
    max_delivery_days: String(Number(maxDeliveryDays))
  });

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/shipping-profiles/${encodeURIComponent(shippingProfileId)}/destinations`,
    {
      method: 'POST',
      headers: apiHeaders({ keystring, sharedSecret, accessToken, form: true }),
      body
    }
  );
  if (!response.ok) {
    throw new Error(`Etsy shipping destination creation failed for ${destinationCountryIso} (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function updateShopShippingProfileDestination({
  shopId,
  shippingProfileId,
  shippingProfileDestinationId,
  primaryCost = 0,
  secondaryCost = 0,
  minDeliveryDays,
  maxDeliveryDays,
  keystring,
  sharedSecret,
  accessToken
}) {
  const body = new URLSearchParams({
    primary_cost: String(Number(primaryCost)),
    secondary_cost: String(Number(secondaryCost)),
    min_delivery_days: String(Number(minDeliveryDays)),
    max_delivery_days: String(Number(maxDeliveryDays))
  });

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/shipping-profiles/${encodeURIComponent(shippingProfileId)}/destinations/${encodeURIComponent(shippingProfileDestinationId)}`,
    {
      method: 'PUT',
      headers: apiHeaders({ keystring, sharedSecret, accessToken, form: true }),
      body
    }
  );
  if (!response.ok) {
    throw new Error(
      `Etsy shipping destination update failed (${response.status}): ${await response.text()}`
    );
  }
  return response.json();
}

export async function deleteShopShippingProfile({
  shopId,
  shippingProfileId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/shipping-profiles/${encodeURIComponent(shippingProfileId)}`,
    {
      method: 'DELETE',
      headers: apiHeaders({ keystring, sharedSecret, accessToken })
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Etsy shipping profile rollback failed (${response.status}): ${await response.text()}`);
  }
  return true;
}

export async function getShopReadinessStateDefinitions({
  shopId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/readiness-state-definitions`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy readiness profiles fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}


export async function getShopListings({
  shopId,
  keystring,
  sharedSecret,
  accessToken,
  state = 'active',
  limit = 100,
  offset = 0
}) {
  const params = new URLSearchParams({
    state,
    limit: String(limit),
    offset: String(offset),
    sort_on: 'updated',
    sort_order: 'desc',
    legacy: 'false'
  });
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings?${params}`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy listings fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function getShopSections({
  shopId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/sections`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy shop sections fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function getShopReturnPolicies({
  shopId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/policies/return`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy return policies fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function getShopProductionPartners({
  shopId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/production-partners`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy production partners fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function createDraftListing({
  shopId,
  keystring,
  sharedSecret,
  accessToken,
  listing
}) {
  const body = new URLSearchParams();
  const values = {
    quantity: listing.quantity,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    who_made: listing.who_made || 'i_did',
    when_made: listing.when_made || 'made_to_order',
    taxonomy_id: listing.taxonomy_id,
    shipping_profile_id: listing.shipping_profile_id,
    readiness_state_id: listing.readiness_state_id,
    return_policy_id: listing.return_policy_id,
    shop_section_id: listing.shop_section_id,
    is_supply: listing.is_supply ?? false,
    should_auto_renew: listing.should_auto_renew ?? true,
    is_customizable: listing.is_customizable,
    is_taxable: listing.is_taxable,
    type: 'physical'
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') body.set(key, String(value));
  }
  if (Array.isArray(listing.tags) && listing.tags.length) {
    body.set('tags', listing.tags.map(String).join(','));
  }
  if (Array.isArray(listing.materials) && listing.materials.length) {
    body.set('materials', listing.materials.map(String).join(','));
  }
  if (Array.isArray(listing.production_partner_ids) && listing.production_partner_ids.length) {
    body.set('production_partner_ids', listing.production_partner_ids.map(String).join(','));
  }

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings?legacy=false`,
    {
      method: 'POST',
      headers: apiHeaders({ keystring, sharedSecret, accessToken, form: true }),
      body
    }
  );

  if (!response.ok) {
    throw new Error(`Etsy draft creation failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}


export async function getListingProperties({
  shopId,
  listingId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}/properties`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy listing properties fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function updateListingProperty({
  shopId,
  listingId,
  propertyId,
  valueIds,
  values,
  scaleId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const body = new URLSearchParams();
  if (Array.isArray(valueIds) && valueIds.length) {
    body.set('value_ids', valueIds.map(String).join(','));
  }
  if (Array.isArray(values) && values.length) {
    body.set('values', values.map(String).join(','));
  }
  if (scaleId !== undefined && scaleId !== null) body.set('scale_id', String(scaleId));

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}/properties/${encodeURIComponent(propertyId)}`,
    {
      method: 'PUT',
      headers: apiHeaders({ keystring, sharedSecret, accessToken, form: true }),
      body
    }
  );
  if (!response.ok) {
    throw new Error(`Etsy listing property update failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}


export async function getListingInventory({
  listingId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/listings/${encodeURIComponent(listingId)}/inventory?legacy=false`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy inventory fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function inventoryPriceDecimal(value) {
  if (value && typeof value === 'object' && Number.isFinite(Number(value.amount))) {
    const divisor = Number(value.divisor || 100);
    return Number((Number(value.amount) / divisor).toFixed(2));
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : value;
}

function cleanInventoryForUpdate(inventory) {
  return {
    products: (inventory?.products || []).map(product => ({
      sku: String(product?.sku || ''),
      offerings: (product?.offerings || []).map(offering => ({
        price: inventoryPriceDecimal(offering?.price),
        quantity: Number(offering?.quantity || 0),
        is_enabled: Boolean(offering?.is_enabled),
        ...(offering?.readiness_state_id != null
          ? { readiness_state_id: Number(offering.readiness_state_id) }
          : {})
      })),
      property_values: (product?.property_values || []).map(property => ({
        property_id: Number(property.property_id),
        property_name: String(property.property_name || ''),
        scale_id: property.scale_id == null ? null : Number(property.scale_id),
        value_ids: Array.isArray(property.value_ids)
          ? property.value_ids.map(value => Number(value)).filter(Number.isFinite)
          : [],
        values: Array.isArray(property.values) ? property.values.map(String) : []
      }))
    })),
    price_on_property: inventory?.price_on_property || [],
    quantity_on_property: inventory?.quantity_on_property || [],
    sku_on_property: inventory?.sku_on_property || [],
    readiness_state_on_property: inventory?.readiness_state_on_property || []
  };
}

export async function updateListingInventory({
  listingId,
  inventory,
  keystring,
  sharedSecret,
  accessToken
}) {
  const payload = cleanInventoryForUpdate(inventory);
  const response = await fetch(
    `${ETSY_API_BASE}/application/listings/${encodeURIComponent(listingId)}/inventory?legacy=false`,
    {
      method: 'PUT',
      headers: {
        ...apiHeaders({ keystring, sharedSecret, accessToken }),
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  if (!response.ok) {
    throw new Error(`Etsy inventory update failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}


export async function getPropertiesByTaxonomyId({
  taxonomyId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/seller-taxonomy/nodes/${encodeURIComponent(taxonomyId)}/properties`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy taxonomy properties fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}


export async function uploadListingImage({
  shopId,
  listingId,
  imageBuffer,
  filename = 'image.jpg',
  contentType = 'image/jpeg',
  rank = 1,
  altText = '',
  keystring,
  sharedSecret,
  accessToken
}) {
  const form = new FormData();
  const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' });
  form.append('image', blob, filename);
  form.append('rank', String(rank));
  form.append('overwrite', 'false');
  form.append('is_watermarked', 'false');
  if (altText) form.append('alt_text', String(altText).slice(0, 500));

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}/images`,
    {
      method: 'POST',
      headers: apiHeaders({ keystring, sharedSecret, accessToken }),
      body: form
    }
  );

  if (!response.ok) {
    throw new Error(`Etsy image upload failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}


export async function uploadListingVideo({
  shopId,
  listingId,
  videoBuffer,
  filename = 'video.mov',
  contentType = 'video/quicktime',
  keystring,
  sharedSecret,
  accessToken
}) {
  const form = new FormData();
  const blob = new Blob([videoBuffer], { type: contentType || 'video/quicktime' });
  form.append('video', blob, filename);
  form.append('name', filename);

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}/videos`,
    {
      method: 'POST',
      headers: apiHeaders({ keystring, sharedSecret, accessToken }),
      body: form
    }
  );

  if (!response.ok) {
    throw new Error(`Etsy video upload failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}


export async function updateListing({
  shopId,
  listingId,
  listing,
  keystring,
  sharedSecret,
  accessToken
}) {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(listing || {})) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length) body.set(key, value.map(String).join(','));
      continue;
    }

    body.set(key, String(value));
  }

  const response = await fetch(
    `${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}?legacy=false`,
    {
      method: 'PATCH',
      headers: apiHeaders({ keystring, sharedSecret, accessToken, form: true }),
      body
    }
  );

  if (!response.ok) {
    throw new Error(`Etsy listing update failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}
