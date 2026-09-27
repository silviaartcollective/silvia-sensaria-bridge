import crypto from 'node:crypto';

function requiredText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function signatureCandidates(headerValue) {
  return String(headerValue || '')
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const comma = entry.indexOf(',');
      return comma >= 0 ? entry.slice(comma + 1) : entry;
    })
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function webhookSecretBytes(secret) {
  const value = requiredText(secret, 'Etsy webhook signing secret');
  const encoded = value.startsWith('whsec_') ? value.slice('whsec_'.length) : value;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw new Error('Etsy webhook signing secret is invalid');
  return bytes;
}

function safeEqualBase64(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyEtsyWebhook({
  secret,
  webhookId,
  webhookTimestamp,
  webhookSignature,
  rawBody,
  toleranceSeconds = 300,
  nowMs = Date.now()
}) {
  const id = requiredText(webhookId, 'webhook-id');
  const timestampText = requiredText(webhookTimestamp, 'webhook-timestamp');
  const signature = requiredText(webhookSignature, 'webhook-signature');
  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp)) throw new Error('webhook-timestamp is invalid');

  const skewSeconds = Math.abs((Number(nowMs) / 1000) - timestamp);
  if (skewSeconds > Number(toleranceSeconds)) {
    return { ok: false, reason: 'stale_timestamp', skewSeconds };
  }

  const signedContent = `${id}.${timestampText}.${String(rawBody ?? '')}`;
  const expected = crypto
    .createHmac('sha256', webhookSecretBytes(secret))
    .update(signedContent, 'utf8')
    .digest('base64');

  const matched = signatureCandidates(signature).some((candidate) =>
    safeEqualBase64(candidate, expected)
  );

  return matched
    ? { ok: true, webhookId: id, timestamp, skewSeconds }
    : { ok: false, reason: 'invalid_signature', skewSeconds };
}

export function receiptReferenceFromEtsyResource(resourceUrl) {
  const url = new URL(requiredText(resourceUrl, 'Etsy webhook resource_url'));
  if (!['api.etsy.com', 'openapi.etsy.com'].includes(url.hostname)) {
    throw new Error('Etsy webhook resource_url host is invalid');
  }

  const match = url.pathname.match(/\/v3\/application\/shops\/(\d+)\/receipts\/(\d+)\/?$/);
  if (!match) throw new Error('Etsy webhook resource_url is not a shop receipt URL');

  return {
    shopId: Number(match[1]),
    receiptId: Number(match[2])
  };
}
