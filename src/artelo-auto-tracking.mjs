// Hourly: Etsy tracking for the orders this app sent to Artelo. For each
// submission record (supplier-order-ledger.mjs) that Artelo holds, the order
// is linked in Order Tracking, Artelo is asked for its shipments, and once
// Artelo reports it shipped with a tracking number the Etsy order is marked
// shipped with it (Etsy emails the buyer), once.
//
// Off unless ARTELO_AUTO_TRACKING_ENABLED=true; ETSY_SHIPMENT_SUBMISSION_ENABLED
// =false also stops it. Orders sent to Artelo by hand, linked to another
// supplier, or shown on Etsy as shipped or canceled are left alone.
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { r2Client, r2Config } from './r2.mjs';
import { ledgerStore } from './supplier-order-ledger.mjs';
import { readTrackingRecord, linkTrackingOrder, checkSupplierTracking, sendStagedShipmentToEtsy } from './order-tracking.mjs';

export const ARTELO_TRACKING_INTERVAL_MS = 60 * 60 * 1000;
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const PER_RUN = 25;
const flag = (env, name) => String(env[name] || '').trim().toLowerCase();

export function autoTrackingSettings(env = process.env) {
  return { enabled: flag(env, 'ARTELO_AUTO_TRACKING_ENABLED') === 'true' && flag(env, 'ETSY_SHIPMENT_SUBMISSION_ENABLED') !== 'false' };
}

// Receipt IDs with a submission record, newest first.
async function listSubmissionReceipts() {
  const client = r2Client(), { bucket } = r2Config(), ids = [];
  let cursor;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'fulfillment/submissions/', ContinuationToken: cursor, MaxKeys: 1000 }));
    for (const entry of page.Contents || []) {
      const match = /^fulfillment\/submissions\/([1-9][0-9]{0,19})\.json$/.exec(entry.Key || '');
      if (match) ids.push(match[1]);
    }
    cursor = page.IsTruncated ? page.NextContinuationToken : null;
  } while (cursor && ids.length < 5000);
  return ids.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

function defaultDeps() {
  return { listReceipts: listSubmissionReceipts, ledger: ledgerStore(), readTracking: readTrackingRecord,
    link: linkTrackingOrder, check: checkSupplierTracking, send: sendStagedShipmentToEtsy, env: process.env, now: () => Date.now() };
}

// One pass. Returns what happened to each order it looked at.
export async function syncArteloTracking(session, { deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!autoTrackingSettings(d.env).enabled) return { enabled: false, results: [] };
  const results = [];
  for (const id of await d.listReceipts()) {
    if (results.length >= PER_RUN) break;
    const record = await d.ledger.read(id).catch(() => null);
    // Only orders this app sent to Artelo and Artelo confirmed with an order ID.
    if (record?.provider !== 'artelo' || !['submitted', 'accepted'].includes(record.state) || !record.supplierOrderId) continue;
    if (d.now() - Date.parse(record.updatedAt || record.createdAt) > MAX_AGE_MS) continue;
    try {
      let tracking = await d.readTracking(id);
      if (tracking && (tracking.supplier !== 'artelo' || tracking.supplierOrderId !== record.supplierOrderId)) {
        results.push({ receiptId: id, outcome: 'skipped', reason: `Order Tracking links it to ${tracking.supplier} order ${tracking.supplierOrderId}.` });
        continue;
      }
      if (tracking?.etsyStatus?.isShipped || (tracking?.shipments || []).some(s => s.etsySentAt)) continue;
      if (!tracking) tracking = await d.link(session, { receiptId: id, supplier: 'artelo', supplierOrderId: record.supplierOrderId });
      const checked = await d.check(session, id);
      if (checked.record?.etsyStatus?.isShipped) { results.push({ receiptId: id, outcome: 'already_shipped_on_etsy' }); continue; }
      const shipment = (checked.record?.shipments || []).find(s => !s.etsySentAt);
      if (!shipment) { results.push({ receiptId: id, outcome: 'waiting', artelo: checked.status }); continue; }
      const sent = await d.send(session, { receiptId: id, trackingNumber: shipment.trackingNumber, confirm: 'MARK SHIPPED ON ETSY' });
      results.push({ receiptId: id, outcome: sent.etsySubmitted ? 'marked_shipped' : 'already_on_etsy', trackingNumber: shipment.trackingNumber, carrier: shipment.carrier });
    } catch (error) {
      results.push({ receiptId: id, outcome: 'error', reason: String(error?.message || error).slice(0, 300) });
    }
  }
  return { enabled: true, results };
}
