import { readFileSync } from 'node:fs';

export const SENSARIA_DELIVERY_PROFILE = Object.freeze(
  JSON.parse(readFileSync(new URL('../config/sensaria-delivery-profile.json', import.meta.url), 'utf8'))
);

const EUROPE_CODES = new Set([
  'AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','NL','PL','PT','RO','SK','SI','ES','SE','GB'
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function sensariaDeliveryEstimate(countryCode, { shippingType = 'Basic' } = {}) {
  const code = String(countryCode || '').trim().toUpperCase();
  const routeKey = Object.hasOwn(SENSARIA_DELIVERY_PROFILE.routes, code)
    ? code
    : EUROPE_CODES.has(code) ? 'EUROPE' : 'OTHER';
  const route = SENSARIA_DELIVERY_PROFILE.routes[routeKey];

  return {
    provider: 'Sensaria',
    profileVersion: SENSARIA_DELIVERY_PROFILE.version,
    profileStatus: SENSARIA_DELIVERY_PROFILE.status,
    shippingType: String(shippingType || SENSARIA_DELIVERY_PROFILE.shippingType),
    destination: code,
    routeKey,
    estimateAvailable: Boolean(route?.estimateAvailable),
    planningBusinessDays: clone(route?.planningBusinessDays ?? null),
    transitBusinessDays: clone(route?.transitBusinessDays ?? null),
    productionBenchmark: SENSARIA_DELIVERY_PROFILE.production.benchmark,
    confidence: route?.confidence || 'low',
    guaranteed: false,
    customerPromiseSafe: false,
    coverage: route?.coverage || '',
    source: route?.source || '',
    assumptions: clone(SENSARIA_DELIVERY_PROFILE.assumptions)
  };
}
