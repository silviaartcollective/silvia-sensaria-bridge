import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SENSARIA_DELIVERY_PROFILE,
  sensariaDeliveryEstimate
} from '../src/delivery-estimates.mjs';

test('Sensaria provisional profile is explicitly non-guaranteed', () => {
  assert.equal(SENSARIA_DELIVERY_PROFILE.status, 'provisional');
  assert.equal(SENSARIA_DELIVERY_PROFILE.customerPromiseSafe, false);
});

test('Canada, US and Australia use the temporary 3-5 business-day planning window', () => {
  for (const countryCode of ['CA', 'US', 'AU']) {
    const estimate = sensariaDeliveryEstimate(countryCode);
    assert.equal(estimate.estimateAvailable, true);
    assert.deepEqual(estimate.planningBusinessDays, [3, 5]);
    assert.deepEqual(estimate.transitBusinessDays, [1, 2]);
    assert.equal(estimate.confidence, 'medium');
    assert.equal(estimate.guaranteed, false);
    assert.equal(estimate.customerPromiseSafe, false);
  }
});

test('Europe remains unrated until Sensaria supplies a numeric transit range', () => {
  for (const countryCode of ['GB', 'DE', 'ES', 'PL']) {
    const estimate = sensariaDeliveryEstimate(countryCode);
    assert.equal(estimate.routeKey, 'EUROPE');
    assert.equal(estimate.estimateAvailable, false);
    assert.equal(estimate.planningBusinessDays, null);
    assert.equal(estimate.confidence, 'low');
  }
});

test('unknown destinations do not invent a delivery estimate', () => {
  const estimate = sensariaDeliveryEstimate('JP');
  assert.equal(estimate.routeKey, 'OTHER');
  assert.equal(estimate.estimateAvailable, false);
  assert.equal(estimate.planningBusinessDays, null);
});
