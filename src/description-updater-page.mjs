export function renderDescriptionUpdaterPage() {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Silvia — Description Updater</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#242720;--muted:#777971;--line:#dedbd4;--green:#4d6550;--soft:#e8eee7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px Inter,system-ui,sans-serif}
.shell{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100vh}a{text-decoration:none;color:inherit}
aside{padding:28px 20px;background:#252820;color:#fff;display:flex;flex-direction:column}.brand{font:24px Georgia,serif;margin-bottom:28px}.brand small{display:block;color:#bec2b8;font:12px system-ui;margin-top:8px}nav{display:grid;gap:7px}.nav{padding:11px;border-radius:9px;color:#cdd1c7}.nav.active,.nav:hover{background:#373b33;color:#fff}.foot{margin-top:auto;color:#aeb3a8;font-size:12px}
main{max-width:1150px;margin:0 auto;width:100%;padding:34px 38px;min-width:0}h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:0 0 12px}p{line-height:1.5;color:var(--muted)}
.card{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:20px;margin:18px 0}
.example{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin:16px 0}.before,.after{padding:16px;border-radius:10px;background:#f4f1eb;line-height:1.5}.after{background:var(--soft);color:#345138}.label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
button{padding:11px 16px;border:1px solid var(--line);border-radius:9px;background:#fff;font-weight:700;cursor:pointer}button.primary{background:#30352e;color:#fff}button:disabled{opacity:.45;cursor:default}
.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.status{padding:12px 14px;background:#eee9df;border-radius:9px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;margin:12px 0}.status.ok{background:var(--soft);color:var(--green)}.status.fail{background:#fae8e2;color:#992e28}
.row{display:flex;align-items:flex-start;gap:12px;padding:13px 0;border-bottom:1px solid var(--line)}.row label{flex:1;cursor:pointer}.row strong{font-size:13px}.row small{display:block;color:var(--muted);margin-top:5px;line-height:1.55}input[type=checkbox]{width:17px;height:17px;accent-color:#4e6853}
input[type=text]{padding:11px;border:1px solid var(--line);border-radius:9px;max-width:100%;width:230px}
.muted{color:var(--muted);font-size:12px}.hidden{display:none!important}
@media(max-width:800px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:24px 18px}.example{grid-template-columns:1fr}h1{font-size:31px}}
</style></head><body><div class="shell"><aside><div class="brand">Silvia<br>Fulfillment<small>Etsy → Sensaria</small></div><nav>
<a class="nav" href="/">Dashboard</a><a class="nav" href="/product-creator">Product Creator</a>
<a class="nav" href="/listing-converter">Gelato → Silvia Converter</a><a class="nav" href="/shipping-profile">Shipping Profile</a>
<a class="nav" href="/pricing">Pricing & Shipping</a><a class="nav" href="/compare">Supplier Comparison</a>
<a class="nav" href="/custom-size">Custom Size Lookup</a><a class="nav" href="/custom-orders">Custom Orders</a>
<a class="nav active" href="/description-updater">Description Updater</a>
<a class="nav" href="/test-order">Test Order</a></nav><div class="foot">Silvia Art Collective<br>Private listing editor</div></aside>
<main><h1>Description Updater</h1><p>Correct canvas thickness across existing Etsy descriptions, while keeping the rest of each description unchanged.</p>
<section class="card"><h2>Canvas thickness correction</h2>
<div class="example"><div class="before"><div class="label">Current wording</div><span>(Thickness: 2 cm)</span></div>
<div class="after"><div class="label">Replacement</div><strong>(Thickness: 1.25" / 3.2 cm)</strong></div></div>
<p class="muted">1.25 inches is exactly 3.175 cm, rounded to 3.2 cm. Only active listings containing this exact original wording are eligible.</p>
<div class="toolbar"><button id="preview" class="primary">Scan Etsy descriptions</button><span id="count" class="muted">No scan yet</span></div>
<div class="status" id="status">Preview first. No Etsy descriptions have been changed.</div>
</section>
<section class="card hidden" id="results">
<h2>Matching listings</h2><div class="toolbar"><label><input type="checkbox" id="select-all" checked> Select all matches</label></div>
<div id="matches"></div><p class="muted">Only selected listings are updated. This action changes descriptions on Etsy immediately.</p>
<div class="toolbar"><input type="text" id="confirm" placeholder="Type UPDATE DESCRIPTIONS" autocomplete="off"><button class="primary" id="apply" disabled>Apply to selected listings</button></div>
<div class="status" id="apply-status">No changes applied.</div></section>
</main></div><script src="/description-updater-client.js" defer></script></body></html>`;
}
