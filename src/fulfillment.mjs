import { readFileSync } from 'node:fs';
import { parseSilviaSku, productKey } from './core.mjs';
import { loadArtworkManifest } from './artwork-storage.mjs';
import { resolveProviderArtworkAsset } from './fulfillment-assets.mjs';
import { ensureSensariaUploadAsset, SENSARIA_MAX_UPLOAD_PX } from './sensaria-upload-asset.mjs';
import { signedArtworkUrl } from './r2.mjs';
import { productionSpecFor } from './production.mjs';

const goProducts = JSON.parse(
  readFileSync(new URL('../config/go-products.json', import.meta.url), 'utf8')
);

export const SENSARIA_GO_BATCH_HEADERS = [
  'PO Number',
  'URL',
  'URL2',
  'Product Code',
  'Wrap Type',
  'Wrap Color',
  'Quantity',
  'Shipping Type',
  'Branding Set Name',
  'First Name',
  'Last Name',
  'Company Name',
  'Country',
  'Address line 1',
  'Address line 2',
  'City',
  'State',
  'Zip',
  'Email',
  'Phone',
  'Coupon Code'
];

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    first: parts.shift() || 'Customer',
    last: parts.join(' ') || '-'
  };
}

function resolveGoProduct(parsed) {
  const key = productKey(parsed);
  const product = goProducts[key];
  if (!product?.productCode) {
    throw new Error(`No Sensaria GO Product Code configured for ${key}`);
  }
  return { key, ...product };
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function goRowsToCsv(rows) {
  const lines = [SENSARIA_GO_BATCH_HEADERS.join(',')];
  for (const row of rows || []) {
    lines.push(SENSARIA_GO_BATCH_HEADERS.map((header) => csvEscape(row?.[header])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

async function sourceForTransaction({ parsed, transaction, productionUrlExpiresIn, useProductionCrop, sensariaMaxUploadPx, onProgress }) {
  // Etsy transaction variations do not include a reliable artwork orientation.
  // Resolve orientation from the master saved in R2, not a portrait default.
  const master = await loadArtworkManifest(parsed.artworkId);
  if (!master?.master?.key || !['portrait','landscape'].includes(master.orientation)) {
    throw new Error('Artwork ' + parsed.artworkId + ' has no verified master orientation.');
  }
  const orientation = master.orientation;
  if (transaction.orientation && transaction.orientation !== orientation) {
    throw new Error('Receipt orientation disagrees with the saved artwork master.');
  }
  const spec = productionSpecFor({
    format: parsed.format,
    size: parsed.size,
    orientation
  });

  if (useProductionCrop) {
    // Sensaria GO receives the stored R2 production crop for this size (the
    // same file the supplier recommendation verified). Canvas edges are made
    // by Sensaria from the "Mirror" Wrap Type, so nothing is rendered here.
    onProgress('Signing the ' + parsed.size + ' production crop from Cloudflare R2');
    const crop = await resolveProviderArtworkAsset({
      artworkId: parsed.artworkId,
      size: parsed.size,
      expiresIn: productionUrlExpiresIn
    });
    if (crop.orientation !== orientation) {
      throw new Error('Artwork ' + parsed.artworkId + ' crop orientation disagrees with the saved master.');
    }
    // Sensaria rejects files over 17,500 px; oversized crops get a cached,
    // capped copy of the same crop. Smaller crops are linked as they are.
    const upload = await ensureSensariaUploadAsset({
      artworkId: parsed.artworkId,
      size: parsed.size,
      crop,
      expiresIn: productionUrlExpiresIn,
      maxPx: sensariaMaxUploadPx,
      onProgress
    });
    return {
      key: upload.key,
      cropKey: crop.key,
      url: upload.url,
      spec,
      ratio: crop.ratio,
      width: upload.width,
      height: upload.height,
      capped: upload.capped,
      productionCrop: true
    };
  }

  // Dry-run / shipping-check mode only needs a valid R2 image URL to validate
  // Product Code, address, Wrap Type, Shipping Type and checkout pricing.
  const manifest = await loadArtworkManifest(parsed.artworkId);
  if (!manifest?.master?.key) {
    throw new Error(`Artwork ${parsed.artworkId} has no master file configured`);
  }
  return {
    key: manifest.master.key,
    url: await signedArtworkUrl(manifest.master.key, productionUrlExpiresIn),
    spec,
    productionCrop: false
  };
}

export async function etsyReceiptToSensariaRowsFromR2(receipt, {
  shippingType = process.env.SENSARIA_GO_SHIPPING_TYPE || 'Basic',
  brandingSetName = process.env.SENSARIA_GO_BRANDING_SET_NAME || '',
  companyName = process.env.SENSARIA_GO_COMPANY_NAME || '',
  couponCode = '',
  fallbackEmail = 'support@silviaartcollective.com',
  fallbackPhone = '1111111111',
  productionUrlExpiresIn = 7 * 24 * 60 * 60,
  useProductionCrop = true,
  sensariaMaxUploadPx = SENSARIA_MAX_UPLOAD_PX,
  onProgress = () => {}
} = {}) {
  const { first, last } = splitName(receipt.name);
  const reference = String(receipt.receipt_id || receipt.id || '').trim();
  if (!reference) throw new Error('Etsy receipt is missing receipt_id');

  if (!receipt.first_line || !receipt.city || !receipt.country_iso || !receipt.zip) {
    throw new Error(`Receipt ${reference} is missing required shipping address fields`);
  }

  const email = receipt.buyer_email || fallbackEmail;
  const phone = receipt.phone || fallbackPhone;
  const transactions = receipt.transactions || [];
  const rows = [];
  const sources = [];

  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = transactions[index];
    const parsed = parseSilviaSku(transaction.sku);
    const goProduct = resolveGoProduct(parsed);
    const source = await sourceForTransaction({
      parsed,
      transaction,
      productionUrlExpiresIn,
      useProductionCrop,
      sensariaMaxUploadPx,
      onProgress
    });

    sources.push({
      artworkId: parsed.artworkId,
      format: parsed.format,
      size: parsed.size,
      orientation: source.spec.orientation,
      key: source.key,
      cropKey: source.cropKey || null,
      ratio: source.ratio || null,
      width: source.width || null,
      height: source.height || null,
      capped: Boolean(source.capped),
      productionCrop: source.productionCrop,
      spec: source.spec
    });

    rows.push({
      'PO Number': reference,
      URL: source.url,
      URL2: '',
      'Product Code': goProduct.productCode,
      'Wrap Type': goProduct.wrapType || '',
      'Wrap Color': '',
      Quantity: Number(transaction.quantity || 1),
      'Shipping Type': String(shippingType || 'Basic'),
      'Branding Set Name': String(brandingSetName || ''),
      'First Name': first,
      'Last Name': last,
      'Company Name': String(companyName || ''),
      Country: String(receipt.country_iso || '').toUpperCase(),
      'Address line 1': receipt.first_line || '',
      'Address line 2': receipt.second_line || '',
      City: receipt.city || '',
      State: receipt.state || '',
      Zip: receipt.zip || '',
      Email: email,
      Phone: phone,
      'Coupon Code': String(couponCode || '')
    });
  }

  Object.defineProperty(rows, 'sources', {
    value: sources,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return rows;
}

export async function etsyReceiptToSensariaCsvFromR2(receipt, options = {}) {
  const rows = await etsyReceiptToSensariaRowsFromR2(receipt, options);
  return {
    headers: SENSARIA_GO_BATCH_HEADERS,
    rows,
    sources: rows.sources || [],
    csv: goRowsToCsv(rows)
  };
}
