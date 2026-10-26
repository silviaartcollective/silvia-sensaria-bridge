import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerEntries, summarizeFees, isListingFee, feeLabel } from '../src/listing-fees.mjs';

const entry = (type, amount, at = 1000, extra = {}) => ({ ledger_type: type, amount, currency: 'USD', created_timestamp: at, ...extra });

test('listing fees are Etsy\'s listing and renewal charges; a refunded fee is taken back', () => {
  const s = summarizeFees([
    entry('listing', -20, 100), entry('listing', -20, 200), entry('listing', -20, 300), entry('listing', 20, 400),
    entry('renew_sold_auto', -20, 500), entry('renew_expired', -20, 600),
    entry('transaction', -65), entry('PAYMENT_PROCESSING_FEE', -120), entry('offsite_ads_fee', -300),
    // Sales, deposits and refunds are money moving, not fees.
    entry('PAYMENT_GROSS', 2500), entry('DISBURSE2', -5000), entry('REFUND_GROSS', -800)
  ], { min: 0, max: 1000, now: 2000 });
  assert.equal(s.listing.total, 80);
  assert.equal(s.listing.count, 4);
  assert.deepEqual(s.listing.byType.map(row => [row.label, row.count, row.total]),
    [['New listings', 2, 40], ['Auto-renewed after a sale', 1, 20], ['Renewed expired listings', 1, 20]]);
  assert.deepEqual(s.other.map(row => [row.type, row.total]), [['offsite_ads_fee', 300], ['PAYMENT_PROCESSING_FEE', 120], ['transaction', 65]]);
  assert.deepEqual(s.charges.map(([at, cents]) => [at, cents]), [[100, 20], [200, 20], [300, 20], [400, -20], [500, 20], [600, 20]]);
  assert.equal(s.projected, null); // the month is over
  assert.equal(isListingFee({ description: 'renew_sold' }), true);
  assert.equal(feeLabel('something_new'), 'something new');
});

test('a month under way is projected at its rate so far', () => {
  const day = 86400, min = 0, max = 30 * day;
  const s = summarizeFees(Array.from({ length: 40 * 10 }, (_, i) => entry('listing', -20, i)), { min, max, now: 10 * day });
  assert.equal(s.listing.total, 8000);
  assert.equal(s.projected, 24000);
});

test('every page of the ledger is read', async () => {
  const all = Array.from({ length: 230 }, (_, i) => entry('listing', -20, i));
  const asked = [];
  const entries = await ledgerEntries(async ({ minCreated, maxCreated, limit, offset }) => {
    asked.push([minCreated, maxCreated, limit, offset]);
    return { count: all.length, results: all.slice(offset, offset + limit) };
  }, { min: 5, max: 9 });
  assert.equal(entries.length, 230);
  assert.deepEqual(asked, [[5, 9, 100, 0], [5, 9, 100, 100], [5, 9, 100, 200]]);
});
