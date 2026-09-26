import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildAuthorizationUrl, verifyEtsyWebhook } from '../src/etsy.mjs';

test('builds Etsy authorization URL with fulfillment and listing scopes', () => {
  const url = new URL(buildAuthorizationUrl({
    keystring: 'abc123',
    redirectUri: 'https://example.com/etsy/callback',
    codeChallenge: 'challenge',
    state: 'state'
  }));
  assert.equal(url.hostname, 'www.etsy.com');
  assert.equal(url.searchParams.get('client_id'), 'abc123');
  assert.equal(
    url.searchParams.get('scope'),
    'transactions_r transactions_w listings_r listings_w shops_r shops_w'
  );
});

test('verifies Etsy webhook signature and timestamp', () => {
  const secretBytes = Buffer.from('test-secret');
  const signingSecret = `whsec_${secretBytes.toString('base64')}`;
  const rawBody = JSON.stringify({ event_type: 'order.paid', shop_id: 123 });
  const webhookId = 'msg_123';
  const webhookTimestamp = '2000000000';
  const signed = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const signature = crypto.createHmac('sha256', secretBytes).update(signed).digest('base64');

  assert.equal(verifyEtsyWebhook({
    rawBody,
    webhookId,
    webhookTimestamp,
    webhookSignature: signature,
    signingSecret,
    nowSeconds: 2000000000
  }), true);
});
