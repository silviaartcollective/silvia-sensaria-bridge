// One persistent supplier-submission record per Etsy receipt
// (fulfillment/submissions/<receiptId>.json in R2): which supplier was
// authorized, every state it went through, and the supplier's order ID.
//
// States, in order: prepared → queued → submitting → submitted → accepted,
// or rejected (the supplier refused it), unknown (the request may or may not
// have reached the supplier: timeout, outage, crash) and fulfilled_elsewhere.
// The record fixes the order's one authorized supplier: another supplier is
// refused unless the record is reset from prepared or rejected.
import { getJsonObject, putJsonObject, isMissingR2Object } from './r2.mjs';

export const STATES = Object.freeze(['prepared', 'queued', 'submitting', 'submitted', 'accepted', 'rejected', 'unknown', 'fulfilled_elsewhere']);
// The moves allowed from each state. An unknown outcome only leaves through
// verification with the supplier (submitted/accepted) or an explicit
// "verified not received" (prepared); a submitted order is never resubmitted.
const MOVES = Object.freeze({
  none: ['prepared', 'fulfilled_elsewhere'],
  prepared: ['queued', 'prepared', 'fulfilled_elsewhere'],
  queued: ['submitting', 'prepared', 'fulfilled_elsewhere'],
  submitting: ['submitted', 'rejected', 'unknown'],
  submitted: ['accepted', 'submitted'],
  accepted: ['accepted'],
  rejected: ['prepared', 'fulfilled_elsewhere'],
  unknown: ['submitted', 'accepted', 'prepared', 'unknown'],
  fulfilled_elsewhere: ['fulfilled_elsewhere']
});
// A record in one of these blocks any new submission for the receipt.
export const BLOCKING = new Set(['queued', 'submitting', 'submitted', 'accepted', 'unknown', 'fulfilled_elsewhere']);

const key = receiptId => 'fulfillment/submissions/' + String(receiptId) + '.json';

export function ledgerStore({ get = getJsonObject, put = putJsonObject } = {}) {
  return {
    async read(receiptId) {
      try { return await get(key(receiptId)); }
      catch (error) { if (isMissingR2Object(error) || error?.code === 'missing') return null; throw error; }
    },
    write: (receiptId, record) => put(key(receiptId), record)
  };
}

// The record after a move, or an error when the move is not allowed.
export function transition(record, to, { provider, note = '', fields = {}, at = new Date().toISOString() } = {}) {
  if (!STATES.includes(to)) throw new Error('Unknown submission state ' + to + '.');
  const from = record?.state || 'none';
  if (!MOVES[from].includes(to))
    throw new Error(`Submission for receipt ${record?.receiptId || fields.receiptId || ''} cannot go from ${from} to ${to}.`);
  const supplier = String(provider || record?.provider || '').toLowerCase();
  if (!supplier) throw new Error('A submission record needs its supplier.');
  // A prepared or rejected order may be given to another supplier (reassigned
  // or recorded as fulfilled elsewhere); once queued it keeps its supplier.
  if (record?.provider && supplier !== record.provider && !(['prepared', 'rejected'].includes(from) && ['prepared', 'fulfilled_elsewhere'].includes(to)))
    throw new Error(`Receipt ${record.receiptId} is assigned to ${record.provider}; it cannot be sent to ${supplier}.`);
  return {
    ...(record || {}),
    ...fields,
    provider: supplier,
    state: to,
    updatedAt: at,
    createdAt: record?.createdAt || at,
    history: [...(record?.history || []), { at, from, to, provider: supplier, ...(note ? { note: String(note).slice(0, 500) } : {}) }].slice(-50)
  };
}

// Why a new submission may not start, or '' when it may.
export function blockedBy(record, provider) {
  if (!record) return '';
  if (BLOCKING.has(record.state)) {
    const labels = { queued: 'is already queued', submitting: 'is being submitted', submitted: 'was already submitted',
      accepted: 'was accepted by the supplier', unknown: 'has an unknown outcome; verify it with the supplier first',
      fulfilled_elsewhere: 'was fulfilled elsewhere' };
    return `This order ${labels[record.state]} (${record.provider}${record.supplierOrderId ? ' order ' + record.supplierOrderId : ''}).`;
  }
  if (record.provider && provider && record.provider !== String(provider).toLowerCase() && record.state !== 'rejected')
    return `This order is assigned to ${record.provider}, not ${provider}.`;
  return '';
}
