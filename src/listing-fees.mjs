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
  payment_processing_fee: 'Payment processing', offsite_ads_fee: 'Offsite Ads', prolist: 'Etsy Ads', shipping_label: 'Shipping labels'
};
const typeOf = entry => String(entry?.ledger_type || entry?.description || 'other').trim();
export const feeLabel = type => LABELS[String(type).toLowerCase()] || String(type).replace(/_/g, ' ');
// Listing fees are Etsy's "listing…" and "renew…" entries.
export const isListingFee = entry => /^(listing|renew)/i.test(typeOf(entry));
// Money moving in or out (sales, deposits, refunds, reserves) is not a fee.
const notAFee = type => /disburse|deposit|transfer|reserve|refund|payment$|payment_gross|sale/i.test(type);

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
  const listing = new Map(), other = new Map(), charges = [];
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
    } else if (amount < 0 && !notAFee(type)) {
      const row = other.get(type) || { type, label: feeLabel(type), count: 0, total: 0 };
      row.count++; row.total -= amount;
      other.set(type, row);
    }
  }
  const byType = [...listing.values()].sort((a, b) => b.total - a.total);
  const total = byType.reduce((sum, row) => sum + row.total, 0);
  const count = byType.reduce((sum, row) => sum + row.count, 0);
  // At this month's rate so far, the whole month (only while it is under way).
  const span = Math.max(1, max - min), elapsed = Math.min(span, Math.max(0, now - min));
  const projected = now < max && elapsed >= 3600 ? Math.round(total * span / elapsed) : null;
  return { currency: currency || 'USD', listing: { total, count, byType }, projected,
    other: [...other.values()].sort((a, b) => b.total - a.total), charges: charges.sort((a, b) => a[0] - b[0]) };
}
