(() => {
'use strict';
const $ = id => document.getElementById(id);
const field = id => $(id).value;
let orders = [], selected = null, liveQuote = null;
let artworks = [];
async function loadArtworks() {
  const response = await api('/api/custom-orders/artworks');
  artworks = response.artworks || [];
  const picker = $('artwork-id');
  const saved = selected?.review?.plan?.artworkId || picker.value;
  picker.replaceChildren(new Option('Select artwork ID (required)', ''));
  for (const art of artworks) {
    if (art.masterReady) {
      picker.append(new Option(art.artworkId + (art.title ? ' — ' + art.title : '') +
        (art.orientation ? ' (' + art.orientation + ')' : ''), art.artworkId));
    }
  }
  if (saved && artworks.some(a => a.artworkId === saved && a.masterReady)) picker.value = saved;
  const count = artworks.filter(a=>a.masterReady).length;
  write('artwork-selection-status', count + ' ready artwork(s) in R2. Confirm the correct print by its SAC ID before approving.');
}

function fmt(value) { return value == null ? '—' : '$' + Number(value).toFixed(2); }
function when(value) {
  if (!value) return 'Unknown date';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown date';
}
function write(id, value) { $(id).textContent = String(value ?? ''); }
function note(message, fail = false, id = 'message') {
  const node = $(id); node.classList.remove('hidden');
  node.className = 'status' + (fail ? ' fail' : ' ok');
  node.textContent = message;
}
async function api(url, body) {
  const options = body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  };
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); } catch { throw new Error('Server did not return JSON (HTTP ' + response.status + ').'); }
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Request failed.');
  return data;
}
function btn(id, handler) {
  const button = $(id);
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try { await handler(); }
    catch (error) { note(error.message || String(error), true); }
    finally { button.disabled = false; }
  });
}
function textDiv(tag, value, className) {
  const el = document.createElement(tag);
  el.textContent = String(value ?? '');
  if (className) el.className = className;
  return el;
}
function isPossibleCustom(order) {
  return order?.classification === 'unclassified' &&
    order?.inference?.categoryHint === 'possible_custom';
}
function filterOrders() {
  const choice = field('filter');
  if (choice === 'custom') return orders.filter(o => o.classification === 'custom');
  if (choice === 'possible') return orders.filter(isPossibleCustom);
  return orders.filter(o => o.classification === 'custom' || isPossibleCustom(o));
}
function paintList() {
  const list = $('order-list'); list.replaceChildren();
  const shown = filterOrders(); write('count', shown.length + ' / ' + orders.length);
  if (!shown.length) { list.append(textDiv('p', 'No custom orders identified yet. For private listings without custom wording, open All Orders or import their receipt ID above.', 'tiny')); return; }
  for (const order of shown) {
    const box = document.createElement('button');
    box.type = 'button'; box.className = 'order-button' + (selected?.summary?.receiptId === order.receiptId ? ' selected' : '');
    box.append(textDiv('div', 'Etsy #' + order.receiptId + ' · ' + (order.buyer || 'Buyer'), 'title'));
    box.append(textDiv('div', (order.items || []).map(t => t.title).filter(Boolean).join('; ') || 'No item title available', 'tiny'));
    box.append(textDiv('div', (order.country || 'Country unknown') + ' · ' +
      order.status.replaceAll('_',' ') + ' · ' + (order.classification === 'unclassified' ? order.inference?.categoryHint || 'review' : order.classification), 'tiny'));
    box.addEventListener('click', () => openOrder(order.receiptId).catch(error => note('Could not open Etsy order #' + order.receiptId + ': ' + (error.message || String(error)), true)));
    list.append(box);
  }
}
async function loadOrders(preserve = true) {
  note('Loading saved Etsy receipts from R2…');
  const data = await api('/api/custom-orders');
  orders = data.orders || [];
  paintList();
  note('Showing ' + filterOrders().length + ' custom/possible custom orders out of ' + (data.stagedCount ?? orders.length) + ' staged Etsy receipts. Regular orders are in All Orders. No supplier orders were submitted.' +
       (data.truncated ? ' Showing the latest 120 receipts.' : ''));
  if (preserve && selected) await openOrder(selected.summary.receiptId);
}
function showPlan(review) {
  const plan = review?.plan;
  if (!plan) {
    $('saved-plan').className = 'status hidden';
    return;
  }
  note('Artwork: ' + (plan.artworkId || 'NOT LINKED') + (plan.artworkTitle ? ' (' + plan.artworkTitle + ')' : '') + '\n' +
    'Supplier: ' + plan.supplier + ' · ' + plan.productCode + ' ' + plan.size +
    ' · Quoted supplier: ' + fmt(plan.quotedSupplierUsd) +
    ' · Estimated landed: ' + fmt(plan.modeledSupplierUsd) +
    ' · Etsy fee reserve: ' + fmt(plan.estimatedEtsyFeesUsd) +
    ' · Estimated contribution: ' + fmt(plan.estimatedContributionUsd) +
    '\nQuote: ' + when(plan.quoteGeneratedAt) +
    '\nStatus: ' + String(review.status).replaceAll('_',' ') +
    '\nShipping/taxes and Etsy fee totals must be verified manually.', false, 'saved-plan');
}
function itemInfo(receipt) {
  const transactions = Array.isArray(receipt.transactions) ? receipt.transactions : [];
  if (!transactions.length) return 'No transaction details returned. Verify the order in Etsy.';
  return transactions.map(item => [
    item.title || 'Untitled', 'Qty ' + (item.quantity || 1), 'SKU ' + (item.sku || 'not set'),
    Array.isArray(item.variations) ? item.variations.map(v => (v.formatted_name || v.name || '') + ': ' + (v.formatted_value || v.value || '')).join(' · ') : '',
    item.personalization || ''
  ].filter(Boolean).join(' · ')).join('\n');
}
async function openOrder(id) {
  $('empty').classList.add('hidden'); $('detail').classList.remove('hidden');
  write('order-status', 'Loading Etsy receipt #' + id + '…');
  const data = await api('/api/custom-orders/' + encodeURIComponent(id));
  selected = data; liveQuote = null;
  $('empty').classList.add('hidden'); $('detail').classList.remove('hidden');
  const { summary, staged, review } = data, receipt = staged.receipt || {};
  $('buyer').replaceChildren(textDiv('div', 'Etsy #' + summary.receiptId + ' — ' + summary.buyer, 'title'),
    textDiv('div', when(receipt.create_timestamp || receipt.created_timestamp || staged.receivedAt), 'tiny'));
  write('item-summary', itemInfo(receipt));
  write('order-status', (summary.paid ? 'PAID' : 'NOT VERIFIED PAID') + ' · ' + (summary.status || 'needs review'));
  write('address', [receipt.name, receipt.first_line, receipt.second_line, receipt.city,
    receipt.state, receipt.zip, receipt.country_iso].filter(Boolean).join('\n') ||
    'Shipping address unavailable in Etsy API; review in Etsy before approving.');
  $('classification').value = summary.classification;
  // Artwork library loading must not block the order review; show errors locally.
  loadArtworks().catch(error => {
    note('Order loaded, but artwork library could not load: ' + (error.message || String(error)), true);
    write('artwork-selection-status', 'Artwork library unavailable. Retry with Refresh artworks.');
  });
  const hint = summary.inference || {};
  write('size-hint', 'Etsy suggestion: ' + hint.categoryHint + '. ' + hint.evidence +
    (hint.size ? ' · Detected ' + hint.size.width + ' × ' + hint.size.height + ' ' + hint.size.units : '') +
    '. Confirm all details manually; size inputs below are always in inches.');
  $('product').value = review?.plan?.productCode || hint.productCode || 'P';
  const guessed = hint.size?.units === 'in' ? hint.size : null;
  $('width').value = review?.plan?.width || guessed?.width || '';
  $('height').value = review?.plan?.height || guessed?.height || '';
  $('frame').value = review?.plan?.frame || '';
  const price = summary.merchandise, ship = summary.shipping;
  $('sale').value = review?.plan?.customerArtworkUsd ??
    (price?.currency === 'USD' ? price.amount : '');
  $('shipping').value = review?.plan?.customerShippingUsd ??
    (ship?.currency === 'USD' ? ship.amount : '0');
  write('currency-note', 'Receipt merchandise: ' + (price ? fmt(price.amount) + ' ' + price.currency : 'unavailable') +
    ' · Receipt shipping: ' + (ship ? fmt(ship.amount) + ' ' + ship.currency : 'unavailable') +
    '. Enter actual USD amounts after discounts; do not count Etsy-collected sales tax as revenue.');
  $('supplier').replaceChildren(new Option(review?.plan?.supplier || 'Run live quotes first', review?.plan?.supplier || ''));
  $('notes').value = review?.plan?.notes || '';
  $('quote-table').replaceChildren(); $('quote-status').className = 'status hidden';
  $('supplier-order-ref').value = review?.supplierOrderId || '';
  for (const id of ['address-ok', 'artwork-ok', 'supplier-ok', 'amount-ok']) $(id).checked = false;
  showPlan(review);
  $('action-result').className = 'status hidden';
  paintList();
  if (window.innerWidth < 1180) $('order-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function requestPlan() {
  if (!selected) throw new Error('Select an order.');
  return {
    artworkId: field('artwork-id'), productCode: field('product'), width: field('width'), height: field('height'),
    frame: field('frame'), salePriceUsd: field('sale'), customerShippingUsd: field('shipping'),
    supplier: field('supplier'), notes: field('notes')
  };
}
function paintQuote(result) {
  liveQuote = result;
  const suppliers = result.suppliers || {};
  const options = [new Option('Choose supplier', '')];
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const key of ['Supplier','Quoted USD','Modeled landed USD','Availability']) head.append(textDiv('th', key));
  table.append(head);
  for (const [key, record] of Object.entries(suppliers)) {
    const active = record?.eligible && Number.isFinite(Number(record?.modeledLandedUsd ?? record?.totalUsd))
      && record.totalUsd != null;
    if (active) options.push(new Option(record.provider || key, key));
    const tr = document.createElement('tr');
    const columns = [
      record?.provider || key,
      active ? fmt(record.totalUsd) : '—',
      active ? fmt(record.modeledLandedUsd ?? record.totalUsd) : '—',
      active ? 'Quoted' : (record?.reason || record?.status || 'Unavailable')
    ];
    columns.forEach((v, i) => tr.append(textDiv('td', v, i === 3 ? (active ? 'good' : 'bad') : '')));
    table.append(tr);
  }
  $('supplier').replaceChildren(...options);
  const existing = selected?.review?.plan?.supplier;
  if (existing && options.some(o => o.value === existing)) $('supplier').value = existing;
  $('quote-table').replaceChildren(table);
  note('Live supplier pricing returned for ' + result.request.size + ' · ' + result.request.countryCode +
    '. These are estimates, not checkout totals.', false, 'quote-status');
}
btn('reload-artworks', async () => { await loadArtworks(); note('Artwork list refreshed.'); });
btn('refresh', () => loadOrders());
btn('sync-etsy', async () => {
  note('Checking recent paid Etsy orders and updating the R2 inbox. Please wait…');
  const result = await api('/api/custom-orders/sync', {});
  await loadOrders(false);
  note('Imported/refreshed ' + result.imported.length + ' paid receipts.' +
    (result.failures.length ? ' ' + result.failures.length + ' receipts need manual attention: ' +
      result.failures.map(e => '#' + e.receiptId + ' ' + e.error).join('; ') : ''));
});
btn('import', async () => {
  const id = field('import-id').trim();
  if (!/^[1-9]\d+$/.test(id)) throw new Error('Enter a numeric Etsy receipt ID.');
  const data = await api('/api/custom-orders/import', { receiptId: id });
  await loadOrders(false); await openOrder(data.summary.receiptId);
  note('Imported paid Etsy receipt #' + id + '.');
});
$('filter').addEventListener('change', paintList);
btn('save-classification', async () => {
  if (!selected) return;
  const data = await api('/api/custom-orders/' + selected.summary.receiptId + '/classify', {
    classification: field('classification')
  });
  await loadOrders(); note('Classification saved as ' + data.review.classification + '.');
});
btn('quote', async () => {
  const id = selected?.summary?.receiptId;
  if (!id) throw new Error('Select a receipt.');
  note('Requesting live supplier prices. This may take a minute…');
  const plan = requestPlan();
  const data = await api('/api/custom-orders/' + id + '/quote', {
    productCode: plan.productCode, width: plan.width, height: plan.height,
    frame: plan.frame, shippingMode: Number(plan.customerShippingUsd || 0) > 0 ? 'separate' : 'included'
  });
  paintQuote(data.result); note('Live supplier quotes received.');
});
btn('save-plan', async () => {
  if (!selected) throw new Error('Select an order.');
  if (field('classification') !== 'custom') throw new Error('Save the classification as Custom before saving a plan.');
  if (!field('artwork-id')) throw new Error('Select the correct SAC artwork ID before saving this private order.');
  if (!field('supplier')) throw new Error('Get live quotes and choose a supplier.');
  note('Rechecking supplier price and saving manual plan…');
  const id = selected.summary.receiptId;
  await api('/api/custom-orders/' + id + '/plan', requestPlan());
  await loadOrders(); note('Supplier plan saved. No supplier order was created.');
});
btn('approve', async () => {
  if (!selected) throw new Error('Select an order.');
  if (!selected.review?.plan?.artworkId) throw new Error('A verified SAC artwork must be linked before approval.');
  if (!window.confirm('Approve this paid custom order for MANUAL supplier placement? This will NOT submit an order.')) return;
  const id = selected.summary.receiptId;
  await api('/api/custom-orders/' + id + '/approve', {
    confirm: 'APPROVE', addressVerified: $('address-ok').checked,
    artworkVerified: $('artwork-ok').checked, supplierVerified: $('supplier-ok').checked,
    amountVerified: $('amount-ok').checked
  });
  await loadOrders(); note('Approved for manual supplier ordering. Nothing was submitted.');
});
btn('mark-ordered', async () => {
  if (!selected) throw new Error('Select an order.');
  const supplierOrderId = field('supplier-order-ref').trim();
  if (!supplierOrderId) throw new Error('Provide the actual supplier order ID.');
  if (!window.confirm('Confirm you have already placed this order with the supplier?')) return;
  await api('/api/custom-orders/' + selected.summary.receiptId + '/mark-ordered', { supplierOrderId });
  await loadOrders(); note('Supplier order reference saved. Etsy shipping was not updated.');
});
loadOrders(false).then(async () => {
  const directId = new URLSearchParams(window.location.search).get('receipt');
  if (directId && /^[1-9]\d{0,19}$/.test(directId)) {
    try {
      if (!orders.some(o => o.receiptId === directId)) {
        await api('/api/custom-orders/import', { receiptId: directId });
        await loadOrders(false);
      }
      await openOrder(directId);
      note('Opened Etsy receipt #' + directId + ' for manual classification. No supplier action was taken.');
    } catch (error) {
      note('Unable to open Etsy receipt #' + directId + ': ' + (error.message || String(error)), true);
    }
  }
}).catch(error => note(error.message, true));
})();
