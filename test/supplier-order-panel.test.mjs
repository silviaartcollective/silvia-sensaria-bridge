import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { renderFulfillmentReviewPage } from '../src/fulfillment-review-page.mjs';
import { renderOrdersPage } from '../src/orders-page.mjs';

const clientSource = readFileSync(new URL('../src/supplier-order-client.js', import.meta.url), 'utf8');
const ordersSource = readFileSync(new URL('../src/orders-client.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// Just enough DOM for the page scripts: elements by id (or data-so name),
// click listeners, classList "hidden" and the attributes the scripts set.
function fakeElement(name) {
  const classes = new Set(), listeners = {};
  return {
    name, value: '', textContent: '', className: '', hidden: false, disabled: false, checked: false,
    placeholder: '', href: '', innerHTML: '', style: {}, children: [],
    classList: { toggle: (c, on) => (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c), add: c => classes.add(c),
      remove: c => classes.delete(c), contains: c => classes.has(c) },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    click() { for (const fn of listeners.click || []) fn(); },
    append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; },
    scrollIntoView() {}
  };
}
function fakeSandbox({ search = '', responses = {} } = {}) {
  const elements = new Map(), requests = [];
  const byName = name => { if (!elements.has(name)) elements.set(name, fakeElement(name)); return elements.get(name); };
  const panelRoot = byName('supplier-order-panel');
  const panelEl = name => byName('so:' + name);
  panelRoot.querySelector = selector => panelEl(selector.match(/data-so="([^"]+)"/)[1]);
  panelRoot.querySelectorAll = selector => selector === '[data-artelo]' ? [panelEl('preview'), panelEl('verify')]
    : ['diagnose', 'preview', 'verify', 'submit'].map(panelEl);
  const sandbox = {
    document: { getElementById: byName, querySelectorAll: () => [], createElement: () => fakeElement('new'), body: fakeElement('body') },
    location: { search }, URLSearchParams, AbortSignal, Date, JSON, Number, String, Error, Promise, Boolean, Array, Object,
    setTimeout, setInterval: () => 0, clearInterval: () => {}, confirmAnswer: true,
    async fetch(path, opts = {}) {
      requests.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
      const key = Object.keys(responses).find(k => path.split('?')[0].endsWith(k));
      const data = key ? responses[key] : { ok: true };
      return { ok: data.ok !== false, status: data.ok === false ? 400 : 200, json: async () => data };
    }
  };
  sandbox.window = sandbox;
  sandbox.window.innerWidth = 1400;
  sandbox.confirm = () => sandbox.confirmAnswer;
  vm.createContext(sandbox);
  return { sandbox, byName, panelEl, requests, run: source => vm.runInContext(source, sandbox) };
}
const inlineScript = html => html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('Fulfillment Review accepts a typed receipt ID such as 4217901308 and the ?receipt= preset', async () => {
  const html = renderFulfillmentReviewPage('Test Shop');
  // The page script sits in a template literal, where \d would reach the browser as "d".
  assert.ok(!html.includes('[1-9]d{0,19}'));
  const page = fakeSandbox({ search: '?receipt=4217901308', responses: { '/4217901308': { ok: true, review: {} } } });
  page.run(inlineScript(html));
  await tick();
  assert.deepEqual(page.requests.map(r => r.path), ['/api/fulfillment-review/4217901308']);
  assert.notEqual(page.byName('message').className, 'error');

  page.byName('receipt').value = ' #4217901308 ';
  page.byName('load').click();
  await tick();
  assert.equal(page.requests.at(-1).path, '/api/fulfillment-review/4217901308');

  page.byName('receipt').value = '42179x01308';
  page.byName('load').click();
  await tick();
  assert.equal(page.byName('message').textContent, 'Enter a numeric Etsy receipt ID');
  assert.equal(page.requests.length, 2);
});

test('Fulfillment Review and Orders both load the one shared supplier-order panel', () => {
  const review = renderFulfillmentReviewPage('Test Shop');
  assert.ok(review.includes('<div id="supplier-order-panel"></div>'));
  assert.ok(review.includes('<script src="/supplier-order-client.js"></script><script>'));
  assert.ok(review.includes("window.SupplierOrderPanel?.mount($('supplier-order-panel'),{receipt:id,report})"));
  // The submit call lives only in the shared client now.
  assert.ok(!review.includes('/artelo-submit'));
  const orders = renderOrdersPage();
  assert.ok(orders.includes('<div id="supplier-order-panel"></div>'));
  assert.ok(orders.indexOf('/supplier-order-client.js') < orders.indexOf('/orders-client.js'));
  assert.equal((clientSource.match(/'artelo-submit'/g) || []).length, 1);
  assert.doesNotThrow(() => new vm.Script(clientSource));
  assert.doesNotThrow(() => new vm.Script(ordersSource));
});

const preview = {
  ready: true, blockers: [], switches: [], confirmation: 'SUBMIT 4217901308 TO ARTELO',
  payload: { orderId: 'SAC-4217901308', customerAddress: { name: 'Ada', city: 'Austin', country: 'US' },
    items: [{ productInfo: { catalogProductId: 'IndividualArtPrint', paperType: 'MattePoster', frameStyle: 'Unframed', size: 'TwelveByEighteen', orientation: 'Vertical' } }] },
  artwork: { key: 'art/1.jpg', width: 3600, height: 5400 },
  expectedCost: { approvedQuoteUsd: 21, approvedModeledUsd: 23, arteloPriceCheck: { total: 21.5, currency: 'USD', productionCost: 14, shippingCost: 6, taxes: 1.5 } }
};

test('the panel previews, then submits only with the dashboard check, the typed confirmation and a confirm', async () => {
  const page = fakeSandbox({ responses: {
    '/artelo-preview': { ok: true, preview },
    '/artelo-submit': { ok: true, submission: { supplierOrderId: 'A-77', state: 'submitted' } }
  } });
  page.run(clientSource);
  const messages = [];
  const panel = page.sandbox.SupplierOrderPanel.mount(page.byName('supplier-order-panel'), { receipt: () => '4217901308', report: (m, e) => messages.push([m, Boolean(e)]) });

  page.panelEl('preview').click();
  await tick();
  assert.equal(page.requests[0].path, '/api/fulfillment-review/4217901308/artelo-preview');
  assert.equal(page.requests[0].method, 'GET');
  assert.match(page.panelEl('out').textContent, /Artelo price check: \$21\.50 USD/);
  assert.equal(page.panelEl('submit-box').hidden, false);
  assert.equal(page.panelEl('confirm').placeholder, 'Type SUBMIT 4217901308 TO ARTELO');

  page.panelEl('submit').click();
  await tick();
  assert.equal(page.requests.length, 1, 'nothing is sent before the dashboard check');
  assert.deepEqual(messages.at(-1), ['Check the Artelo dashboard first and tick the box.', true]);
  assert.equal(page.panelEl('status').textContent, 'Check the Artelo dashboard first and tick the box.');

  page.panelEl('dashboard').checked = true;
  page.panelEl('confirm').value = ' SUBMIT 4217901308 TO ARTELO ';
  page.sandbox.confirmAnswer = false;
  page.panelEl('submit').click();
  await tick();
  assert.equal(page.requests.length, 1, 'nothing is sent when the confirm dialog is declined');

  page.sandbox.confirmAnswer = true;
  page.panelEl('submit').click();
  await tick();
  assert.deepEqual(page.requests[1], { path: '/api/fulfillment-review/4217901308/artelo-submit', method: 'POST',
    body: { confirm: 'SUBMIT 4217901308 TO ARTELO', arteloDashboardChecked: true } });
  assert.match(messages.at(-1)[0], /order A-77 · submitted/);
  assert.equal(page.panelEl('submit-box').hidden, true);

  panel.showArtelo(false);
  assert.equal(page.panelEl('preview').hidden, true);
  assert.equal(page.panelEl('verify').hidden, true);
  assert.equal(page.panelEl('diagnose').hidden, false);
  panel.reset();
  assert.equal(page.panelEl('out').hidden, true);
  assert.equal(page.panelEl('dashboard').checked, false);
});

function ordersPage(supplier, status = 'approved_for_manual_order') {
  const page = fakeSandbox({ search: '?receipt=4217901308', responses: {
    '/api/orders': { ok: true, orders: [{ receiptId: '4217901308', buyer: 'Ada', status, supplier, items: [] }] },
    '/api/custom-orders/4217901308': { ok: true, staged: { receipt: { receipt_id: 4217901308, name: 'Ada' } }, summary: { buyer: 'Ada' },
      review: { classification: 'regular', status, regularPlan: { supplier, provider: supplier[0].toUpperCase() + supplier.slice(1) } } }
  } });
  page.run(clientSource);
  page.run(ordersSource);
  return page;
}

test('the Orders page names whichever supplier the order has and offers that supplier\'s order step', async () => {
  for (const [supplier, csv, artelo, note] of [
    ['sensaria', true, false, /Download the Sensaria CSV/],
    ['artelo', false, true, /Preview the Artelo order below/],
    ['prodigi', false, false, /Place this order in the Prodigi dashboard; the app cannot submit it there yet/]
  ]) {
    const page = ordersPage(supplier);
    await tick(); await tick();
    assert.equal(page.byName('supplier-banner').classList.contains('hidden'), false, supplier);
    assert.equal(page.byName('supplier-name').textContent, supplier.toUpperCase());
    assert.match(page.byName('supplier-note').textContent, note);
    assert.equal(page.byName('sensaria-csv').classList.contains('hidden'), !csv, supplier);
    assert.equal(page.byName('supplier-order-row').classList.contains('hidden'), false);
    assert.equal(page.panelEl('preview').hidden, !artelo, supplier);
    assert.equal(page.panelEl('diagnose').hidden, false);
    // Opening an order only reads it.
    assert.ok(page.requests.every(r => r.method === 'GET'), supplier);
  }
  const awaiting = ordersPage('artelo', 'awaiting_supplier_approval');
  await tick(); await tick();
  assert.match(awaiting.byName('supplier-note').textContent, /Approve this supplier on Fulfillment Review first/);
});
