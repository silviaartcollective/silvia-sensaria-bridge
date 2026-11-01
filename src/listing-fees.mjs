// Listing fees for a month, from the shop's Etsy payment account ledger: every
// listing fee and renewal Etsy charged (new listings, auto-renewals after a
// sale, renewed expired listings), with the other Etsy fees beside them.
// Amounts are in the currency's smallest unit; a fee is a debit (negative).
export const LISTING_FEE_USD = 0.2;
export const MAX_RANGE_SECONDS = 32 * 86400;
const LABELS = {
  listing: 'New listings', listing_private: 'Private listings',
  renew_sold: 'Renewed after a sale', renew_sold_auto: 'Auto-renewed after a sale',
  renew_expired: 'Renewed expired listings', renew_expired_auto: 'Auto-renewed expired listings', renew: 'Renewals',
  transaction: 'Transaction fees', transaction_quantity: 'Transaction fees (quantity)', shipping_transaction: 'Transaction fees on shipping',
  payment_processing_fee: 'Payment processing', offsite_ads_fee: 'Offsite Ads', prolist: 'Etsy Ads', shipping_label: 'Shipping labels',
  shipping_labels: 'Shipping labels', vat_tax_ep: 'Tax on Etsy fees', refund_processing_fee: 'Processing fee refunded',
  recoup: 'Balance recovered by Etsy', payment_gross: 'Sales', refund_gross: 'Refunds to buyers', disburse2: 'Deposits to your bank',
  regulatory_operating_fee: 'Regulatory operating fee', vat_transaction: 'Tax on transaction fees', vat_processing_fee: 'Tax on processing fees',
  vat_regulatory_operating_fee: 'Tax on regulatory fees', sales_tax: 'Tax paid by buyer (passed to the government)'
};
const typeOf = entry => String(entry?.ledger_type || entry?.description || 'other').trim();
export const feeLabel = type => LABELS[String(type).toLowerCase()] || String(type).replace(/_/g, ' ');
// Listing fees are Etsy's "listing…" and "renew…" entries ("Auto-renew sold"
// too, when only a description is given).
export const isListingFee = entry => /(^|[_\s-])(listing|renew)/i.test(typeOf(entry));
// A fee given back (on a refunded order): it reduces the fees, not counted as money in.
const isFeeCredit = type => /refund/i.test(type) && /fee|processing|transaction|ads|prolist|label/i.test(type);
// Sales tax the buyer paid, which Etsy passes to the government ("Tax paid by
// buyer"): not the shop's cost. Tax on Etsy's own fees (VAT/GST/HST on
// transaction, processing, regulatory fees: vat_…) is a cost and stays a fee.
const isBuyerTax = type => !/^vat|_vat|gst|hst|on_fee|seller/i.test(type) && /sales_tax|buyer|tax_collected|marketplace_tax|remit|^tax$/i.test(type);
// Money moving in or out (sales, deposits, refunds to buyers, reserves, Etsy
// recovering a negative balance, chargebacks, buyer sales tax) is not a fee.
const notAFee = type => isBuyerTax(type) || /disburse|deposit|transfer|reserve|refund|recoup|chargeback|payment$|payment_gross|sale/i.test(type);

// Every ledger entry between the two times, page after page.
export async function ledgerEntries(fetchPage, { min, max, pageSize = 100, maxPages = 200 }) {
  const entries = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await fetchPage({ minCreated: min, maxCreated: max, limit: pageSize, offset: page * pageSize });
    const results = data?.results || [];
    entries.push(...results);
    if (results.length < pageSize || (Number.isFinite(data?.count) && entries.length >= data.count)) break;
  }
  return entries;
}

export function summarizeFees(entries, { min, max, now = Date.now() / 1000 }) {
  const listing = new Map(), other = new Map(), skipped = new Map(), charges = [];
  const add = (map, type, amount, count = 1) => {
    const row = map.get(type) || { type, label: feeLabel(type), count: 0, total: 0 };
    row.count += count; row.total += amount; map.set(type, row);
  };
  let feeCredits = 0;
  let currency = '';
  for (const entry of entries) {
    const amount = Number(entry.amount) || 0, type = typeOf(entry);
    currency ||= String(entry.currency || '');
    if (isListingFee(entry)) {
      const row = listing.get(type) || { type, label: feeLabel(type), count: 0, total: 0 };
      // A charge counts one listing; a credit (a refunded fee) takes it back.
      row.count += amount < 0 ? 1 : amount > 0 ? -1 : 0;
      row.total -= amount;
      listing.set(type, row);
      charges.push([Number(entry.created_timestamp || entry.create_date) || 0, -amount, type]);
    } else if (isFeeCredit(type) && amount > 0) {
      add(other, type, -amount); feeCredits += amount;
    } else if (amount < 0 && !notAFee(type)) {
      add(other, type, -amount);
    } else {
      // Shown on the page as "not counted as fees", so every entry is accounted for.
      add(skipped, type, amount);
    }
  }
  const byType = [...listing.values()].sort((a, b) => b.total - a.total);
  const total = byType.reduce((sum, row) => sum + row.total, 0);
  const count = byType.reduce((sum, row) => sum + row.count, 0);
  // At this month's rate so far, the whole month (only while it is under way).
  const span = Math.max(1, max - min), elapsed = Math.min(span, Math.max(0, now - min));
  const projected = now < max && elapsed >= 3600 ? Math.round(total * span / elapsed) : null;
  return { currency: currency || 'USD', listing: { total, count, byType }, projected,
    other: [...other.values()].sort((a, b) => b.total - a.total), feeCredits,
    skipped: [...skipped.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
    charges: charges.sort((a, b) => a[0] - b[0]) };
}
