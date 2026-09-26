import { silviaVariantSku } from './variants.mjs';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeFrame(value) {
  const v = clean(value, 'NAT').toUpperCase();
  const aliases = {
    NATURAL: 'NAT', OAK: 'NAT',
    WALNUT: 'BRN', BROWN: 'BRN', DARK: 'BRN',
    BLACK: 'BLK', WHITE: 'WHT'
  };
  return aliases[v] || v;
}

export function buildTestReceipt(input = {}) {
  const artworkId = clean(input.artworkId || input.artwork_id).toUpperCase();
  if (!/^SAC\d+$/.test(artworkId)) throw new Error('Choose a valid SAC artwork ID.');

  const format = clean(input.format, 'P').toUpperCase();
  if (!['P', 'C', 'FC'].includes(format)) throw new Error('Unsupported test product format.');

  const size = clean(input.size).toLowerCase();
  if (!/^\d{1,2}x\d{1,2}$/.test(size)) throw new Error('Choose a valid size.');

  const frame = format === 'FC' ? normalizeFrame(input.frame) : 'NONE';
  if (format === 'FC' && !['NAT', 'BRN', 'BLK', 'WHT'].includes(frame)) {
    throw new Error('Choose a valid framed-canvas finish.');
  }

  const productKey = `${format}|${size}|${frame}`;
  const sku = silviaVariantSku(artworkId, productKey);
  const orientation = clean(input.orientation, 'portrait').toLowerCase() === 'landscape'
    ? 'landscape'
    : 'portrait';
  const quantity = Math.max(1, Math.min(10, Number(input.quantity || 1) || 1));
  const reference = clean(input.reference, `TEST-${Date.now()}`).toUpperCase();
  if (!reference.startsWith('TEST-')) throw new Error('Test references must start with TEST-.');

  return {
    meta: { artworkId, format, size, frame, orientation, quantity, sku, reference },
    receipt: {
      receipt_id: reference,
      name: clean(input.name, 'Test Customer'),
      first_line: clean(input.first_line, '100 Test Street'),
      second_line: clean(input.second_line),
      city: clean(input.city, 'Kamloops'),
      state: clean(input.state, 'BC'),
      zip: clean(input.zip, 'V2C 1A1'),
      country_iso: clean(input.country_iso, 'CA').toUpperCase(),
      buyer_email: clean(input.buyer_email, 'test@example.com'),
      phone: clean(input.phone, '2505550100'),
      transactions: [{
        transaction_id: '1',
        sku,
        quantity,
        orientation
      }]
    }
  };
}
