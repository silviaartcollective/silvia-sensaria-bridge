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

test('fees given back on refunds are taken off; balance recovery and chargebacks are not fees; every entry is accounted for', () => {
  const s = summarizeFees([
    entry('transaction', -65), entry('PAYMENT_PROCESSING_FEE', -120),
    entry('REFUND_PROCESSING_FEE', 40), entry('transaction_refund', 65),
    entry('RECOUP', -1500), entry('chargeback', -2500), entry('vat_tax_ep', -12),
    entry('PAYMENT_GROSS', 2500), entry('DISBURSE2', -5000), entry('REFUND_GROSS', -800),
    entry('listing', -20)
  ], { min: 0, max: 1000, now: 2000 });
  const other = Object.fromEntries(s.other.map(row => [row.type, row.total]));
  assert.deepEqual(other, { transaction: 65, PAYMENT_PROCESSING_FEE: 120, REFUND_PROCESSING_FEE: -40, transaction_refund: -65, vat_tax_ep: 12 });
  assert.equal(s.other.reduce((sum, row) => sum + row.total, 0), 92, 'net other fees');
  assert.equal(s.feeCredits, 105);
  assert.deepEqual(s.skipped.map(row => [row.type, row.total]).sort(),
    [['DISBURSE2', -5000], ['PAYMENT_GROSS', 2500], ['RECOUP', -1500], ['REFUND_GROSS', -800], ['chargeback', -2500]].sort());
  // Each entry lands in exactly one place.
  const placed = s.listing.byType.reduce((n, r) => n + 1, 0) + s.other.reduce((n, r) => n + r.count, 0) + s.skipped.reduce((n, r) => n + r.count, 0);
  assert.equal(placed, 11);
  assert.equal(feeLabel('RECOUP'), 'Balance recovered by Etsy');
});

test('a renewal described in words is a listing fee; other entries are not', () => {
  assert.equal(isListingFee({ description: 'Auto-renew sold' }), true);
  assert.equal(isListingFee({ ledger_type: 'renew_expired_auto' }), true);
  assert.equal(isListingFee({ ledger_type: 'listing_private' }), true);
  assert.equal(isListingFee({ ledger_type: 'transaction' }), false);
  assert.equal(isListingFee({ ledger_type: 'offsite_ads_fee' }), false);
  assert.equal(isListingFee({ ledger_type: 'shipping_labels' }), false);
});

test('an order\'s fees as Etsy shows them: tax paid by the buyer is not the shop\'s cost, tax on Etsy\'s fees is', () => {
  // The US$57.43 order: transaction 3.73, processing 1.99, regulatory 0.29, tax paid by buyer 4.42, VAT on the three fees 0.72.
  for (const buyerTax of ['sales_tax', 'TAX', 'tax_paid_by_buyer', 'MARKETPLACE_TAX', 'buyer_tax']) {
    const s = summarizeFees([
      entry('PAYMENT_GROSS', 6197), entry('transaction', -373), entry('PAYMENT_PROCESSING_FEE', -199), entry('regulatory_operating_fee', -29),
      entry(buyerTax, -442), entry('vat_transaction', -44), entry('vat_processing_fee', -24), entry('vat_regulatory_operating_fee', -4)
    ], { min: 0, max: 1000, now: 2000 });
    assert.equal(s.other.reduce((sum, row) => sum + row.total, 0), 673, buyerTax);
    assert.ok(s.skipped.some(row => row.type === buyerTax && row.total === -442), buyerTax);
  }
});

test('the profit calculators reserve 12% for Etsy fees by default, as one real order cost (11.7%)', async () => {
  const { profitScenarioPolicy } = await import('../src/retail-margin.mjs');
  const saved = process.env.SAC_ETSY_FEE_RESERVE_PERCENT; delete process.env.SAC_ETSY_FEE_RESERVE_PERCENT;
  try { assert.equal(profitScenarioPolicy().etsyFeeReservePercent, 12); }
  finally { if (saved !== undefined) process.env.SAC_ETSY_FEE_RESERVE_PERCENT = saved; }
  assert.ok(Math.abs((373 + 199 + 29 + 44 + 24 + 4) / 5743 - 0.117) < 0.001);
});
