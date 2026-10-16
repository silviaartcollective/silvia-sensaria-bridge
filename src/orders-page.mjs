export function renderOrdersPage() {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Silvia | Etsy Orders</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#242921;--muted:#787c72;--line:#ddd9d0;--soft:#e8eee7}
*{box-sizing:border-box}body{background:var(--bg);color:var(--ink);margin:0;font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
.shell{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100vh}
aside{background:#252820;color:#fff;padding:28px 20px;display:flex;flex-direction:column}
.brand{font:24px/1.1 Georgia,serif;margin-bottom:28px}.brand small{display:block;font:12px system-ui;color:#b9beb3;margin-top:8px}
nav{display:grid;gap:6px}.nav{color:#cdd1c7;padding:10px 12px;border-radius:9px;text-decoration:none}
.nav:hover,.nav.active{background:#373b33;color:#fff}
main{padding:28px 30px 55px;max-width:1650px;width:100%;margin:auto;min-width:0}
h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:38px;margin:0 0 5px}h2{font-size:22px;margin:0 0 14px}
p{color:var(--muted);margin:0 0 15px}
.toolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:17px 0}
button,.btn{font:inherit;border:1px solid var(--line);border-radius:9px;background:#fff;padding:10px 15px;cursor:pointer;text-decoration:none;color:var(--ink);font-weight:650}
.primary{background:#303a30;color:#fff;border-color:#303a30}button:disabled{opacity:.6;cursor:default}
input,select{font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;max-width:100%;background:#fff}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:19px;min-width:0}
.grid{display:grid;grid-template-columns:minmax(270px,.9fr) minmax(425px,1.6fr);gap:16px}
.order-button{display:block;text-align:left;width:100%;padding:14px 10px;border:0;border-bottom:1px solid var(--line);border-radius:0;white-space:normal;background:transparent;font-size:13px;font-weight:400}
.order-button.selected,.order-button:hover{background:var(--soft)}
.title{font-weight:700;display:block}.small{font-size:12px;color:var(--muted)}.muted{font-size:12px;color:var(--muted)}
.status{padding:11px 14px;background:var(--soft);color:#446148;border-radius:9px;margin:12px 0;white-space:pre-wrap}
.status.error{background:#faeee6;color:#a14737}.detailrow{padding:11px 0;border-bottom:1px solid var(--line)}
.detailrow strong{display:block}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
.tag{display:inline-block;font-size:11px;background:#e9ede8;padding:3px 9px;border-radius:15px;color:#45624b;margin-top:6px}
.supplier-name{display:block;margin-top:8px;color:#284332;font-size:19px;font-weight:800;letter-spacing:.04em;line-height:1.35}
.supplier-banner{background:#e8eee7;border:1px solid #cbd8ca;border-radius:11px;padding:15px 18px;margin:14px 0 10px}
.supplier-banner .eyebrow{display:block;color:#506353;font-size:12px;font-weight:700;margin-bottom:4px}
.supplier-banner strong{display:block;color:#263c2d;font-size:26px;font-weight:800;letter-spacing:.035em}
.supplier-banner .small{display:block;margin-top:4px;font-size:12px}
#sensaria-csv{background:#303a30;color:#fff;border-color:#303a30}
#sensaria-csv-status{padding:9px 0;font-size:13px;color:#446148}
.tracking-box{margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:10px;background:#fbfaf6}
.tracking-form{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.tracking-form input{flex:1 1 200px}
#tracking-saved{margin:8px 0 0}#tracking-status{margin-top:8px}#tracking-status.error{color:#a14737}
#sensaria-csv-status.error{color:#a14737}
.hidden{display:none!important}#list{max-height:74vh;overflow:auto}#order-detail{min-height:230px}
@media(max-width:1150px){.grid{grid-template-columns:1fr}#list{max-height:none}}
@media(max-width:750px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:20px 14px}h1{font-size:31px}}
</style></head><body><div class="shell"><aside><div class="brand">Silvia<br>Fulfillment<small>Etsy → Sensaria</small></div>
<nav><a class="nav" href="/">Dashboard</a><a class="nav" href="/product-creator">Product Creator</a>
<a class="nav" href="/listing-converter">Listing Converter</a><a class="nav" href="/pricing">Pricing &amp; Shipping</a>
<a class="nav" href="/custom-size">Custom Size Lookup</a><a class="nav" href="/custom-orders">Custom Orders</a>
<a class="nav active" href="/orders">All Orders</a><a class="nav" href="/tracking">Order Tracking</a>
<a class="nav" href="/description-updater">Description Updater</a><a class="nav" href="/logout">Log out</a></nav></aside>
<main><h1>All Etsy Orders</h1>
<p>Paid Etsy orders are synced and checked automatically for the best eligible supplier. Recommendations appear for review; supplier orders are never submitted without a separate approval workflow.</p>
<div class="toolbar"><button id="refresh" class="primary">Refresh orders</button><button id="sync">Sync latest paid orders now</button>
<input id="search" placeholder="Search buyer, order, or artwork" aria-label="Search orders">
<select id="filter"><option value="all">All orders</option><option value="open">Not shipped</option><option value="shipped">Shipped / completed</option><option value="custom">Custom / possible custom</option></select></div>
<div class="status" id="message">Loading staged Etsy orders…</div>
<div class="grid"><section class="card"><h2>Order inbox <span class="small" id="count"></span></h2><div id="list"></div>
<p class="muted">Use Sync to retrieve recent receipts from Etsy. Historic receipts can be imported through Custom Orders by entering their receipt ID.</p>
</section><section class="card" id="order-detail"><h2>Order details</h2>
<div id="empty">Select an order to view its details, shipment status, and tracking.</div>
<div id="details" class="hidden">
<h2 id="buyer"></h2><div id="order-meta" class="small"></div>
<div id="supplier-banner" class="supplier-banner hidden"><span class="eyebrow">Recommended fulfillment supplier</span><strong id="supplier-name">SENSARIA</strong><span class="small">Manual supplier order · Check artwork, variant and shipping before submitting</span></div>
<div class="detailrow"><strong>Artwork / items</strong><pre id="items"></pre></div>
<div class="detailrow"><strong>Shipping address</strong><pre id="address"></pre></div>
<div class="detailrow"><strong>Shipping status &amp; tracking</strong><pre id="shipment"></pre>
<div id="tracking-box" class="tracking-box">
<div id="tracking-summary" class="small">Loading supplier tracking…</div>
<pre id="tracking-saved" class="hidden"></pre>
<div id="tracking-link-form" class="tracking-form hidden">
<select id="tracking-supplier" aria-label="Supplier"><option value="sensaria">Sensaria</option><option value="prodigi">Prodigi</option><option value="artelo">Artelo</option><option value="printshrimp">PrintShrimp</option><option value="printify">Printify</option><option value="gelato">Gelato</option></select>
<input id="tracking-supplier-order" placeholder="Supplier order ID (Sensaria: leave empty to use this receipt as the PO number)" aria-label="Supplier order ID">
<button type="button" id="tracking-link">Link supplier order</button></div>
<div id="tracking-add-form" class="tracking-form hidden">
<input id="tracking-number" placeholder="Tracking number" aria-label="Tracking number" autocomplete="off">
<select id="tracking-carrier" aria-label="Carrier"><option value="">Carrier…</option><option>USPS</option><option>UPS</option><option>FedEx</option><option>DHL</option><option>Canada Post</option><option>Purolator</option><option>OnTrac</option><option>DPD</option><option>Royal Mail</option><option>Australia Post</option><option>Other</option></select>
<input id="tracking-url" placeholder="Tracking link (optional)" aria-label="Tracking link">
<button type="button" id="tracking-save" class="primary">Save tracking</button></div>
<div id="tracking-status" class="small" role="status" aria-live="polite"></div>
</div></div>
<div class="detailrow"><strong>Order totals</strong><div id="totals"></div></div>
<div class="actions"><a class="btn primary" id="review-custom" href="/custom-orders">Review as custom order</a>
<a class="btn" id="track-order" href="/tracking">Open Order Tracking</a>
<a class="btn" id="review-regular" href="/fulfillment-review">View Supplier Recommendation</a>
<button type="button" id="sensaria-csv" class="hidden">Download Sensaria CSV</button></div>
<div class="hidden" id="sensaria-csv-status" role="status" aria-live="polite"></div>
</div></section></div>
</main></div><script src="/orders-client.js" defer></script></body></html>`;
}
