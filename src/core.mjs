export const SENSARIA_HEADERS = [
  'ReferenceOrderNumber',
  'ReferenceOrderItemNumber',
  'ShippingMethod',
  'FirstName',
  'LastName',
  'ShippingLine1',
  'ShippingLine2',
  'City',
  'State/Province',
  'Zip',
  'CountryCode',
  'ShippingEmail',
  'ShippingPhone',
  'FriendlySKU',
  'OutputURL',
  'Quantity',
  'ThumbnailURL',
  'Personalize'
];

export function parseSilviaSku(sku) {
  const normalized = String(sku || '').trim().toUpperCase();
  const match = normalized.match(/^(SAC\d+)-(P|C|FC)-(\d{3,4})(?:-(BLK|WHT|NAT|BRN|DWD))?$/);
  if (!match) throw new Error(`Unsupported Silvia SKU format: ${sku}`);

  const [, artworkId, format, sizeDigits, frameRaw] = match;
  const size = sizeDigits.length === 4
    ? `${Number(sizeDigits.slice(0, 2))}x${Number(sizeDigits.slice(2))}`
    : `${Number(sizeDigits.slice(0, 1))}x${Number(sizeDigits.slice(1))}`;

  if (format !== 'FC' && frameRaw) {
    throw new Error(`Frame code is only valid for Framed Canvas: ${sku}`);
  }
  if (format === 'FC' && !frameRaw) {
    throw new Error(`Framed Canvas SKU requires a frame code: ${sku}`);
  }

  let frame = frameRaw || 'NONE';
  if (frame === 'DWD') frame = 'BRN';

  return { artworkId, format, size, frame };
}

export function productKey({ format, size, frame }) {
  return `${format}|${size}|${frame || 'NONE'}`;
}

export function resolveSensariaSku(parsed, products) {
  const key = productKey(parsed);
  const product = products[key];
  if (!product?.friendlySku) {
    throw new Error(`No Sensaria FriendlySKU configured for ${key}`);
  }
  return product.friendlySku;
}

export function resolveArtworkUrl(parsed, artworks, sizeRatios) {
  const artwork = artworks[parsed.artworkId];
  if (!artwork) throw new Error(`Artwork ${parsed.artworkId} is not configured`);
  const ratio = sizeRatios[parsed.size];
  if (!ratio) throw new Error(`No artwork ratio configured for size ${parsed.size}`);
  const url = artwork.files?.[ratio];
  if (!url) throw new Error(`Artwork ${parsed.artworkId} has no file for ratio ${ratio}`);
  return url;
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    first: parts.shift() || 'Customer',
    last: parts.join(' ') || '-'
  };
}

export function etsyReceiptToSensariaRows(receipt, context) {
  const {
    products,
    artworks,
    sizeRatios,
    defaultShippingMethod = 'Standard',
    fallbackEmail = 'support@silviaartcollective.com',
    fallbackPhone = '1111111111'
  } = context;

  const { first, last } = splitName(receipt.name);
  const reference = String(receipt.receipt_id || receipt.id || '').trim();
  if (!reference) throw new Error('Etsy receipt is missing receipt_id');

  if (!receipt.first_line || !receipt.city || !receipt.country_iso || !receipt.zip) {
    throw new Error(`Receipt ${reference} is missing required shipping address fields`);
  }

  const email = receipt.buyer_email || fallbackEmail;
  const phone = receipt.phone || fallbackPhone;

  return (receipt.transactions || []).map((transaction, index) => {
    const parsed = parseSilviaSku(transaction.sku);
    const friendlySku = resolveSensariaSku(parsed, products);
    const outputUrl = resolveArtworkUrl(parsed, artworks, sizeRatios);

    return {
      ReferenceOrderNumber: reference,
      ReferenceOrderItemNumber: `${reference}-${transaction.transaction_id || index + 1}`,
      ShippingMethod: defaultShippingMethod,
      FirstName: first,
      LastName: last,
      ShippingLine1: receipt.first_line || '',
      ShippingLine2: receipt.second_line || '',
      City: receipt.city || '',
      'State/Province': receipt.state || '',
      Zip: receipt.zip || '',
      CountryCode: String(receipt.country_iso || '').toUpperCase(),
      ShippingEmail: email,
      ShippingPhone: phone,
      FriendlySKU: friendlySku,
      OutputURL: outputUrl,
      Quantity: Number(transaction.quantity || 1),
      ThumbnailURL: outputUrl,
      Personalize: 'false'
    };
  });
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function rowsToCsv(rows) {
  const lines = [SENSARIA_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(SENSARIA_HEADERS.map((header) => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
