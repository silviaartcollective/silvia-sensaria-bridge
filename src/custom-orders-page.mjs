export function renderCustomOrdersPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Silvia · Custom Orders</title>
<style>
:root{--bg:#f5f2ec;--panel:#fffdfa;--ink:#22251f;--muted:#72776e;--line:#e0ddd6;--green:#425c46;--soft:#e8eee7;--warning:#906e41;--warnbg:#f6eddf}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px Inter,system-ui,-apple-system,Segoe UI,sans-serif}button,input,select,textarea{font:inherit}a{text-decoration:none;color:inherit}
.shell{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100vh}
aside{background:#252820;color:#f8f5ee;padding:28px 20px;display:flex;flex-direction:column}
.brand{font:24px/1.1 Georgia,serif;margin-bottom:30px}.brand small{display:block;font:12px system-ui;color:#b9beb3;margin-top:8px}
nav{display:grid;gap:7px}.nav{padding:11px 12px;border-radius:9px;color:#cdd1c7;font-size:14px}.nav.active,.nav:hover{background:#373b33;color:white}
.foot{margin-top:auto;color:#afb6a9;font-size:12px;line-height:1.5}
main{padding:28px 30px 48px;max-width:1650px;width:100%;margin:auto;min-width:0}
h1,h2,h3{font-family:Georgia,serif;font-weight:500}h1{font-size:37px;margin:0 0 5px}h2{font-size:21px;margin:0 0 12px}h3{font-size:17px;margin:20px 0 10px}p{line-height:1.6}
.sub{color:var(--muted);margin:0 0 20px}.notice{background:var(--soft);color:#415a46;border:1px solid #cddccc;border-radius:10px;padding:13px 15px;margin:14px 0 20px;line-height:1.55}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
input,textarea,select{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px;min-height:39px;color:var(--ink);max-width:100%}
textarea{min-height:72px;width:100%;resize:vertical}
button,.btn{border:1px solid var(--line);background:#fff;padding:10px 14px;border-radius:9px;cursor:pointer;white-space:nowrap;color:var(--ink);font-weight:650}
button.primary,.btn.primary{background:#31382f;color:white;border-color:#31382f}
button:disabled{cursor:default;opacity:.5}
.grid{display:grid;grid-template-columns:minmax(260px,.85fr) minmax(460px,1.5fr);gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;min-width:0}
.row{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding:12px 0;align-items:flex-start}
.order-button{display:block;width:100%;background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;text-align:left;padding:15px 9px;white-space:normal}
.order-button:hover,.order-button.selected{background:var(--soft)}
.tiny{font-size:11px;color:var(--muted);line-height:1.5}.title{font-weight:700;font-size:13px}.badge{font-size:10px;padding:4px 7px;border-radius:99px;background:var(--soft);color:var(--green);display:inline-block}
.badge.warn{background:var(--warnbg);color:var(--warning)}
.field{display:grid;gap:5px}.field label{font-size:11px;font-weight:650;color:var(--muted)}.fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
.actions{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0}
.status{padding:10px 12px;border-radius:9px;background:#f4f1eb;color:#4e5049;margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.status.fail{background:#fff0e8;color:#9d3829}.status.ok{background:var(--soft);color:var(--green)}
.divider{border-top:1px solid var(--line);margin:20px 0}.hidden{display:none!important}
.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 8px;border-bottom:1px solid var(--line);text-align:left}th{font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}td.good{color:var(--green)}td.bad{color:var(--warning)}
.checks label{display:block;margin:9px 0}.checks input{min-height:auto;margin-right:7px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;line-height:1.6}
@media(max-width:1180px){.grid{grid-template-columns:1fr}}@media(max-width:750px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:20px 15px}.fields{grid-template-columns:1fr 1fr}}@media(max-width:450px){.fields{grid-template-columns:1fr}h1{font-size:29px}}
</style></head><body>
<div class="shell"><aside>
<div class="brand">Silvia<br>Fulfillment<small>Etsy → Sensaria</small></div>
<nav><a class="nav" href="/">Dashboard</a><a class="nav" href="/product-creator">Product Creator</a>
<a class="nav" href="/listing-converter">Gelato → Silvia Converter</a><a class="nav" href="/shipping-profile">Shipping Profile</a>
<a class="nav" href="/pricing">Pricing & Shipping</a><a class="nav" href="/compare">Supplier Comparison</a>
<a class="nav" href="/custom-size">Custom Size Lookup</a><a class="nav active" href="/custom-orders">Custom Orders</a><a class="nav" href="/orders">All Orders</a>
    <a class="nav" href="/description-updater">Description Updater</a>
<a class="nav" href="/test-order">Test Order</a><a class="nav" href="/etsy/status">Etsy Status</a>
<a class="nav" href="/r2/status">R2 Status</a><a class="nav" href="/logout">Log out</a></nav>
<div class="foot">Silvia Art Collective<br>Private fulfillment service</div>
</aside><main>
<h1>Custom Orders</h1>
<p class="sub">Custom and private Etsy order review, with manual artwork assignment and supplier approval.</p>
<div class="notice"><b>Manual fulfillment only.</b> Saving a plan or approving an order does not create a supplier order, charge a card, or mark an Etsy order shipped. Check the Etsy order and final destination price before placing an order with a supplier.</div>
<div class="toolbar"><button id="refresh" class="primary">Refresh orders</button><button id="sync-etsy">Sync 15 latest paid Etsy orders</button>
<input id="import-id" placeholder="Etsy receipt ID" inputmode="numeric" aria-label="Etsy receipt ID">
<button id="import">Import paid receipt</button>
<select id="filter" aria-label="Filter custom orders"><option value="custom_and_possible">Custom &amp; possible custom</option><option value="custom">Confirmed custom only</option><option value="possible">Possible custom only</option></select><a class="btn" href="/orders">View All Orders</a></div>
<div class="status" id="message">Loading staged paid orders…</div>
<div class="grid">
<section class="card"><h2>Order inbox <span class="tiny" id="count"></span></h2><div id="order-list">Loading…</div>
<p class="tiny">This inbox shows confirmed custom orders and potential custom/private listings only. Regular purchases belong in All Orders. If a private listing is not recognized automatically, open it from All Orders or import its Etsy receipt ID here.</p>
</section>
<section class="card" id="order-review"><h2>Order review</h2>
<div id="empty">Select a custom order above, or open an unrecognized private order from All Orders.</div>
<div id="detail" class="hidden">
<div id="buyer" class="row"></div><div class="row"><div id="item-summary"></div><div id="order-status"></div></div>
<h3>Customer shipping details</h3><pre id="address"></pre>
<div class="fields"><div class="field"><label>Order classification</label><select id="classification"><option value="unclassified">Needs classification</option><option value="custom">Custom private order</option><option value="regular">Regular Etsy order</option></select></div><div class="field" style="align-self:end"><button id="save-classification">Save classification</button></div></div>
<div class="divider"></div><h3>Artwork assignment (required)</h3>
<p class="tiny">Private custom Etsy listings may not contain a SAC artwork ID. Select the correct artwork from your Silvia R2 library before planning fulfillment. We never guess the artwork.</p>
<div class="fields">
<div class="field" style="grid-column:span 2"><label>Artwork ID from Silvia library</label><select id="artwork-id"><option value="">Loading artwork library…</option></select></div>
<div class="field" style="align-self:end"><button id="reload-artworks" type="button">Refresh artworks</button></div>
</div>
<p class="tiny" id="artwork-selection-status">No artwork selected.</p>
<div class="divider"></div><h3>Custom size and supplier quote</h3>
<p class="tiny" id="size-hint"></p>
<div class="fields">
<div class="field"><label>Product</label><select id="product"><option value="P">Poster</option><option value="C">Canvas</option><option value="FC">Framed canvas</option></select></div>
<div class="field"><label>Width (inches)</label><input id="width" type="number" min="1" max="120" step=".01"></div>
<div class="field"><label>Height (inches)</label><input id="height" type="number" min="1" max="120" step=".01"></div>
<div class="field"><label>Frame color (framed canvas)</label><select id="frame"><option value="">Select frame</option><option>Black</option><option>White</option><option>Natural</option><option>Brown</option></select></div>
<div class="field"><label>Actual artwork price (USD)</label><input id="sale" type="number" min="0" step=".01" placeholder="Enter actual sold price"></div>
<div class="field"><label>Customer shipping paid (USD)</label><input id="shipping" type="number" min="0" step=".01" value="0"></div>
</div>
<p class="tiny" id="currency-note">Enter actual Etsy amounts in USD; do not use the lookup's suggested retail price.</p>
<div class="actions"><button id="quote" class="primary">Get live supplier quotes</button><a class="btn" href="/custom-size" target="_blank">Open Custom Size Lookup</a></div>
<div class="status hidden" id="quote-status"></div><div class="table-wrap" id="quote-table"></div>
<div class="fields"><div class="field"><label>Chosen supplier</label><select id="supplier"><option value="">Run live quotes first</option></select></div></div>
<div class="field"><label>Internal notes (optional)</label><textarea id="notes" placeholder="Crop, artwork reference, shipping or supplier instructions"></textarea></div>
<div class="actions"><button id="save-plan" class="primary">Save supplier plan &amp; estimated profit</button></div>
<div class="status hidden" id="saved-plan"></div><div class="divider"></div>
<h3>Manual fulfillment approval</h3>
<div class="checks"><label><input type="checkbox" id="address-ok">I verified the buyer's shipping address in Etsy.</label>
<label><input type="checkbox" id="artwork-ok">I verified the correct artwork, crop, size and orientation.</label>
<label><input type="checkbox" id="supplier-ok">I verified the supplier product, availability, and final shipping/tax costs.</label>
<label><input type="checkbox" id="amount-ok">I verified actual Etsy amounts and estimated margin.</label></div>
<div class="actions"><button id="approve" class="primary">Approve for manual supplier placement</button></div>
<p class="tiny">Approval records your decision only. You must place the supplier order yourself. Plans must be quoted within the past 24 hours.</p>
<h3>Record supplier placement</h3>
<div class="toolbar"><input id="supplier-order-ref" placeholder="Supplier order/reference ID" aria-label="Supplier order reference">
<button id="mark-ordered">Mark manually ordered</button></div>
<div class="status hidden" id="action-result"></div></div>
</section></div>
</main></div><script src="/custom-orders-client.js" defer></script></body></html>`;
}
