import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyEtsyWebhook, receiptReferenceFromEtsyResource } from '../src/etsy-webhook.mjs';

test('verifies Etsy webhook HMAC and timestamp', () => {
  const secretBytes = Buffer.from('silvia-webhook-test-secret');
  const secret = `whsec_${secretBytes.toString('base64')}`;
  const rawBody = JSON.stringify({
    event_type: 'order.paid',
    resource_url: 'https://api.etsy.com/v3/application/shops/66947335/receipts/123456789',
    shop_id: 66947335
  });
  const webhookId = 'msg_test_123';
  const webhookTimestamp = '1790464000';
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest('base64');

  const result = verifyEtsyWebhook({
    secret,
    webhookId,
    webhookTimestamp,
    webhookSignature: `v1,${expected}`,
    rawBody,
    nowMs: Number(webhookTimestamp) * 1000
  });

  assert.equal(result.ok, true);
});

test('rejects stale Etsy webhook delivery', () => {
  const secret = `whsec_${Buffer.from('secret').toString('base64')}`;
  const result = verifyEtsyWebhook({
    secret,
    webhookId: 'msg_old',
    webhookTimestamp: '1000',
    webhookSignature: 'v1,invalid',
    rawBody: '{}',
    nowMs: 2_000_000
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale_timestamp');
});

test('extracts Etsy shop and receipt IDs only from Etsy receipt resources', () => {
  assert.deepEqual(
    receiptReferenceFromEtsyResource(
      'https://api.etsy.com/v3/application/shops/66947335/receipts/123456789'
    ),
    { shopId: 66947335, receiptId: 123456789 }
  );
  assert.throws(
    () => receiptReferenceFromEtsyResource('https://example.com/v3/application/shops/1/receipts/2'),
    /host is invalid/
  );
});
