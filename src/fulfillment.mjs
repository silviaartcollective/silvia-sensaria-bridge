import { readFileSync } from 'node:fs';
import { parseSilviaSku, productKey } from './core.mjs';
import { ensureProductionAsset, loadArtworkManifest } from './artwork-storage.mjs';
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

async function sourceForTransaction({ parsed, transaction, productionUrlExpiresIn, renderProduction }) {
  const orientation = transaction.orientation || 'portrait';
  const spec = productionSpecFor({
    format: parsed.format,
    size: parsed.size,
    orientation
  });

  if (renderProduction) {
    const production = await ensureProductionAsset({
      artworkId: parsed.artworkId,
      format: parsed.format,
      size: parsed.size,
      orientation,
      urlExpiresIn: productionUrlExpiresIn
    });
    return {
      key: production.key,
      url: production.url,
      spec: production.spec,
      rendered: true
    };
  }

  // Dry-run / shipping-check mode deliberately avoids rendering the enormous
  // 300-DPI canvas asset inside the web request. GO still receives a valid R2
  // image URL, which is enough to validate Product Code, address, Wrap Type,
  // Shipping Type and checkout/shipping pricing without manufacturing anything.
  const manifest = await loadArtworkManifest(parsed.artworkId);
  if (!manifest?.master?.key) {
    throw new Error(`Artwork ${parsed.artworkId} has no master file configured`);
  }
  return {
    key: manifest.master.key,
    url: await signedArtworkUrl(manifest.master.key, productionUrlExpiresIn),
    spec,
    rendered: false
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
  renderProduction = true
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
      renderProduction
    });

    sources.push({
      artworkId: parsed.artworkId,
      format: parsed.format,
      size: parsed.size,
      orientation: transaction.orientation || 'portrait',
      key: source.key,
      rendered: source.rendered,
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
