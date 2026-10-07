import { readFileSync } from 'node:fs';

const ISO_COUNTRIES = JSON.parse(
  readFileSync(new URL('../config/iso-countries.json', import.meta.url), 'utf8')
);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderCustomSizeLookupPage() {
  const countryOptions = ISO_COUNTRIES.map(([code, name]) =>
    `<option value="${escapeHtml(code)}"${code === 'CA' ? ' selected' : ''}>${escapeHtml(name)} (${escapeHtml(code)})</option>`
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Silvia · Custom Size Lookup</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#20221e;--muted:#74776f;--line:#dfdcd4;--green:#536454;--green2:#e8eee7;--amber:#946b35;--amber2:#f5ead9;--red:#934d45;--red2:#f7e7e4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:inherit;text-decoration:none}.app-shell{min-height:100vh;display:grid;grid-template-columns:238px minmax(0,1fr)}
aside{background:#252820;color:#f8f5ee;padding:28px 20px;display:flex;flex-direction:column;min-height:100vh}.brand{font-family:Georgia,serif;font-size:24px;line-height:1.08;margin-bottom:30px}.brand small{display:block;font-size:12px;color:#b9beb3;margin-top:8px}
nav{display:grid;gap:7px}.nav{padding:11px 12px;border-radius:9px;color:#cdd1c7;font-size:14px}.nav.active,.nav:hover{background:#373b33;color:#fff}.foot{margin-top:auto;color:#aeb3a8;font-size:12px;line-height:1.5}
main{min-width:0;width:100%;max-width:1500px;margin:auto;padding:34px 30px 50px}h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:38px;margin:0 0 8px}.sub{margin:0 0 22px;color:var(--muted);font-size:14px;line-height:1.55}
.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:20px;margin-bottom:18px;box-shadow:0 10px 28px rgba(40,40,30,.05)}
.lookup{display:grid;grid-template-columns:1.1fr 1.4fr 1fr 1fr 1.2fr auto;gap:11px;align-items:end}
label{display:grid;gap:7px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
input,select,button{border:1px solid var(--line);border-radius:10px;background:#fff;padding:11px 12px;font:inherit;color:var(--ink)}
button{cursor:pointer;font-weight:700}button.primary{background:#30352e;color:#fff;border-color:#30352e}button:disabled{opacity:.5;cursor:not-allowed}
.notice{padding:12px 14px;border-radius:10px;background:var(--green2);color:var(--green);font-size:12px;line-height:1.5;margin-bottom:18px}
.status{font-size:12px;color:var(--muted);line-height:1.5;margin-top:13px}.status.bad{color:var(--red)}
.hero{display:none;grid-template-columns:1.2fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px}.hero.show{display:grid}.metric{background:#f7f4ee;border:1px solid var(--line);border-radius:11px;padding:13px}.metric small{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}.metric strong{font:500 22px Georgia,serif}.metric .detail{font-size:10px;color:var(--muted);margin-top:4px}
.table-wrap{display:none;overflow:auto;border:1px solid var(--line);border-radius:11px}.table-wrap.show{display:block}table{width:100%;border-collapse:collapse;background:#fff;font-size:12px}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}th{background:#f1eee8;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}td.detail{white-space:normal;min-width:250px;max-width:390px;color:var(--muted);line-height:1.4}
.offers{margin-top:9px;padding:9px;border:1px solid var(--line);border-radius:8px;background:#fcfaf6;color:var(--ink)}
.offers summary{cursor:pointer;font-weight:700;font-size:11px}
.offers p{font-size:11px;color:var(--muted);margin:7px 0}
.offers-scroll{max-width:100%;overflow-x:auto}
table.offer-table{min-width:650px;font-size:11px;margin-top:10px}
table.offer-table th,table.offer-table td{padding:7px;white-space:normal;max-width:210px}
table.offer-table th{font-size:9px}
.pill{display:inline-block;padding:4px 7px;border-radius:999px;background:var(--green2);color:var(--green);font-size:10px}.pill.warn{background:var(--amber2);color:var(--amber)}.pill.bad{background:var(--red2);color:var(--red)}
.rank{font-weight:700}.spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;vertical-align:-2px;margin-right:7px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:1100px){.lookup{grid-template-columns:repeat(3,1fr)}.hero{grid-template-columns:1fr 1fr}}@media(max-width:720px){.app-shell{grid-template-columns:1fr}aside{display:none}main{padding:24px 16px}.lookup{grid-template-columns:1fr}.hero{grid-template-columns:1fr}h1{font-size:32px}}
</style></head>
<body><div class="app-shell">
<aside>
  <div class="brand">Silvia<br>Fulfillment <small>Etsy → Sensaria</small></div>
  <nav>
    <a class="nav" href="/">Dashboard</a>
    <a class="nav" href="/product-creator">Product Creator</a>
    <a class="nav" href="/listing-converter">Gelato → Silvia Converter</a>
    <a class="nav" href="/shipping-profile">Shipping Profile</a>
    <a class="nav" href="/pricing">Pricing & Shipping</a>
    <a class="nav" href="/compare">Supplier Comparison</a>
    <a class="nav active" href="/custom-size">Custom Size Lookup</a>
    <a class="nav" href="/test-order">Test Order</a>
    <a class="nav" href="/#orders">Orders</a>
    <a class="nav" href="/#artworks">Artwork Library</a>
    <a class="nav" href="/#mappings">Product SKUs</a>
    <a class="nav" href="/etsy/status" target="_blank">Etsy Status</a>
    <a class="nav" href="/r2/status" target="_blank">R2 Status</a>
    <a class="nav" href="/logout">Log out</a>
  </nav>
  <div class="foot">Silvia Art Collective<br>Private fulfillment service</div>
</aside>
<main>
<h1>Custom Size Lookup</h1>
<p class="sub">Enter the customer's destination, exact requested size and product. The app checks the connected providers specifically for that request and ranks the available options by estimated landed cost.</p>
<div class="notice"><strong>Read-only:</strong> this lookup never creates an Etsy listing or supplier order. Prodigi, Printify, Gelato, PrintShrimp and compatible Artelo poster routes are checked for this exact request. The destination list includes the full ISO country list, including countries outside the shop's normal Etsy shipping profile. Sensaria uses the captured full catalog plus captured shipping zones.</div>

<section class="card">
  <div class="lookup">
    <label>Destination country
      <select id="country">${countryOptions}</select>
    </label>
    <label>Product
      <select id="product">
        <option value="P">Poster</option>
        <option value="C" selected>Canvas</option>
        <option value="FC">Framed Canvas</option>
      </select>
    </label>
    <label>Width (in)
      <input id="width" type="number" min="1" max="120" step="0.1" value="20">
    </label>
    <label>Height (in)
      <input id="height" type="number" min="1" max="120" step="0.1" value="28">
    </label>
    <label id="frame-label" style="display:none">Frame
      <select id="frame">
        <option>Black</option>
        <option>White</option>
        <option>Natural</option>
        <option>Brown</option>
      </select>
    </label>
    <button class="primary" id="lookup">Find best option</button>
  </div>
  <div class="status" id="status">Ready. Choose the customer's destination country. Provider availability is checked independently of the shop's normal Etsy shipping profile.</div>
</section>

<section class="hero" id="hero">
  <div class="metric"><small>Best provider</small><strong id="winner">—</strong><div class="detail" id="winner-detail"></div></div>
  <div class="metric"><small>Estimated landed cost</small><strong id="winner-cost">—</strong><div class="detail">USD planning estimate</div></div>
  <div class="metric"><small>Minimum customer price</small><strong id="customer-price">—</strong><div class="detail" id="price-detail"></div></div>
  <div class="metric"><small>Regular price before shop sale</small><strong id="regular-price">—</strong><div class="detail" id="sale-detail"></div></div>
</section>

<section class="card">
  <h2 style="margin:0 0 5px">Provider results</h2>
  <p class="sub" style="margin-bottom:14px">Availability and price are for the exact request above. Hover/status detail explains why a provider is not ranked.</p>
  <div class="table-wrap" id="table-wrap">
    <table><thead><tr><th>Rank</th><th>Provider</th><th>Status</th><th>Product</th><th>Shipping</th><th>Quoted total</th><th>Planning total</th><th>Details</th></tr></thead>
    <tbody id="rows"></tbody></table>
  </div>
  <div class="status" id="empty">Run a lookup to see provider results.</div>
</section>
<section class="card" id="printify-library-card" style="display:none">
 <h2 style="margin:0 0 8px">Printify Production Price Library</h2>
 <p class="sub" style="margin:0 0 14px">Some Printify canvas or poster printers do not expose production cost in their catalog. This tool temporarily creates <strong>unpublished private test products in Printify</strong>, captures actual supplier variant costs, saves them in the app, and removes test drafts after they are safely saved. Nothing is published to Etsy or ordered.</p>
 <button class="primary" id="build-printify-library" type="button">Capture missing Printify prices for this size</button>
 <p class="status" id="printify-library-status">Runs up to four product/provider combinations at a time. Repeat if additional providers remain.</p>
</section>
</main></div>
<script>
(function(){
const country=document.getElementById('country'),product=document.getElementById('product'),width=document.getElementById('width'),height=document.getElementById('height'),frame=document.getElementById('frame'),frameLabel=document.getElementById('frame-label'),button=document.getElementById('lookup'),status=document.getElementById('status'),hero=document.getElementById('hero'),winner=document.getElementById('winner'),winnerCost=document.getElementById('winner-cost'),winnerDetail=document.getElementById('winner-detail'),customerPrice=document.getElementById('customer-price'),regularPrice=document.getElementById('regular-price'),priceDetail=document.getElementById('price-detail'),saleDetail=document.getElementById('sale-detail'),tableWrap=document.getElementById('table-wrap'),rows=document.getElementById('rows'),empty=document.getElementById('empty'),libraryCard=document.getElementById('printify-library-card'),libraryButton=document.getElementById('build-printify-library'),libraryStatus=document.getElementById('printify-library-status');
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null||!Number.isFinite(Number(v))?'—':'$'+Number(v).toFixed(2);
function syncFrame(){frameLabel.style.display=product.value==='FC'?'grid':'none'}product.addEventListener('change',syncFrame);syncFrame();
function statusPill(r){const s=String(r?.status||'unavailable');const cls=r?.eligible?'':' '+(s==='error'?'bad':'warn');return '<span class="pill'+cls+'">'+esc(s)+'</span>';}
function offerBreakdown(record){
 if(record.provider!=='Printify')return '';
 const offers=Array.isArray(record.meta?.offers)?record.meta.offers:[];
 const scan=record.meta?.scan||{};
 const summary='Scanned '+(scan.wallArtBlueprints??'—')+' wall-art products and '+(scan.blueprintProvidersScanned??'—')+' print-provider combinations; '+(scan.exactSizeMatches??0)+' exact-size variants, '+offers.length+' shippable matches.';
 const errorCount=Array.isArray(scan.catalogErrors)?scan.catalogErrors.length:0;
 const errors=errorCount?'<p>'+errorCount+' Printify catalog request(s) failed; not all options could be checked.</p>':'';
 if(!offers.length)return '<div class="offers"><p>'+esc(summary)+'</p>'+errors+'</div>';
 const head='<thead><tr><th>Printify product</th><th>Brand</th><th>Print provider</th><th>Variant</th><th>Production</th><th>Shipping</th><th>Quote total</th></tr></thead>';
 const body=offers.map(o=>'<tr><td>'+esc(o.product||'—')+'</td><td>'+esc(o.brand||'—')+'</td><td>'+esc(o.printProvider||'—')+'</td><td>'+esc(o.variantTitle||'—')+'</td><td>'+money(o.productionUsd)+'</td><td>'+money(o.shippingUsd)+'</td><td>'+money(o.quotedTotalUsd)+'</td></tr>').join('');
 return '<details class="offers"><summary>View all '+offers.length+' Printify product / print-provider matches</summary><p>'+esc(summary)+'</p>'+errors+'<div class="offers-scroll"><table class="offer-table">'+head+'<tbody>'+body+'</tbody></table></div></details>';
}
function render(data){
 const suppliers=data.suppliers||{};const ranking=new Map((data.ranking||[]).map(x=>[x.provider,x.rank]));const fallback=['Sensaria','Prodigi','PrintShrimp','Printify','Gelato','Artelo'];
 const byProvider=Object.fromEntries(Object.values(suppliers).map(r=>[r.provider,r]));
 const order=fallback.slice().sort((a,b)=>{const ra=ranking.get(a),rb=ranking.get(b);if(ra!=null&&rb!=null)return ra-rb;if(ra!=null)return -1;if(rb!=null)return 1;return fallback.indexOf(a)-fallback.indexOf(b);});
 const printifyRow=byProvider.Printify||{};
 const missingOffers=(printifyRow.meta?.offers||[]).filter(item=>item.productionUsd==null);
 libraryCard.style.display=missingOffers.length?'block':'none';
 libraryStatus.textContent=missingOffers.length
   ? missingOffers.length+' Printify size/provider matches need a production cost. Captured costs remain available for future lookups.'
   : 'All Printify matching offers have production prices, or no shippable provider exists.';
 rows.innerHTML=order.map(name=>{const r=byProvider[name]||{};const rank=ranking.get(name);const detail=[r.reason,r.basis,r.meta?.sku?'SKU '+r.meta.sku:'',r.meta?.printProvider?'Printify: '+r.meta.printProvider:'',r.meta?.deliveryDays?.min!=null?'Delivery '+r.meta.deliveryDays.min+'–'+r.meta.deliveryDays.max+' days':''].filter(Boolean).join(' · ');return '<tr><td class="rank">'+(rank||'—')+'</td><td><strong>'+esc(name)+'</strong></td><td>'+statusPill(r)+'</td><td>'+money(r.productCost)+'</td><td>'+money(r.shippingCost)+'</td><td>'+money(r.totalUsd)+'</td><td>'+money(r.modeledLandedUsd)+'</td><td class="detail">'+esc(detail||'—')+offerBreakdown(r)+'</td></tr>';}).join('');
 tableWrap.classList.add('show');empty.style.display='none';
 if(data.winner){hero.classList.add('show');winner.textContent=data.winner.provider;winnerCost.textContent=money(data.winner.modeledLandedUsd);winnerDetail.textContent=data.winner.savingsVsNextBestUsd!=null?'Saves '+money(data.winner.savingsVsNextBestUsd)+' vs next best':'Only one eligible provider';if(data.pricing){customerPrice.textContent=money(data.pricing.minimumCustomerPriceUsd);regularPrice.textContent=money(data.pricing.regularPriceBeforeShopSaleUsd);priceDetail.textContent='≈ CA$'+Number(data.pricing.minimumCustomerPriceCad||0).toFixed(2)+' · configured safety floor';saleDetail.textContent=data.pricing.shopSaleDiscountPercent+'% current shop sale assumption';}else{customerPrice.textContent='—';regularPrice.textContent='—';priceDetail.textContent='';saleDetail.textContent='';}}else{hero.classList.remove('show');}
}
libraryButton.addEventListener('click',async()=>{
 const hasConfirmed=window.confirm('Create up to four temporary UNPUBLISHED Printify pricing drafts for this exact size and destination? The app will capture actual production costs, save them to its price library and delete the test drafts if saved. No Etsy or supplier orders will be created.');
 if(!hasConfirmed)return;
 libraryButton.disabled=true;
 libraryStatus.textContent='Creating private price-check drafts and capturing production costs. Please keep this page open…';
 try {
   const body={
     countryCode:country.value,productCode:product.value,
     width:Number(width.value),height:Number(height.value),
     frame:product.value==='FC'?frame.value:'',
     maxDrafts:4,
     confirm:'CREATE_UNPUBLISHED_PRINTIFY_PRICING_DRAFTS'
   };
   const response=await fetch('/api/printify/pricing-library/build',{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify(body)
   });
   const data=await response.json();
   if(!response.ok||!data.ok)throw Error(data.error||'Unable to capture Printify prices');
   const successes=data.created||[];
   const failures=data.errors||[];
   const saved=successes.filter(item=>item.savedInR2).length;
   const retained=successes.filter(item=>item.retainedDraftId).length;
   const warning=successes.filter(item=>item.warning).map(item=>item.printProvider+': '+item.warning).slice(0,3);
   libraryStatus.textContent='Captured '+data.captured+' variant production costs from '+successes.length+' product/provider models. Saved to R2: '+saved+'. Unpublished drafts retained: '+retained+'. Remaining provider models: '+data.pendingProviderPairsEstimate+'.'+(failures.length?' Failures: '+failures.map(item=>item.printProvider+': '+item.error).join(' | '):'')+(warning.length?' Notes: '+warning.join(' | '):'');
   // Refresh quotes and provider ranking using the newly saved prices.
   button.click();
 } catch(error) {
   libraryStatus.textContent='Price capture could not finish: '+String(error?.message||error);
 } finally {
   libraryButton.disabled=false;
 }
});
button.addEventListener('click',async()=>{button.disabled=true;button.innerHTML='<span class="spinner"></span>Checking providers…';status.className='status';status.textContent='Looking up the exact request across connected providers…';try{const body={countryCode:country.value.trim().toUpperCase(),productCode:product.value,width:Number(width.value),height:Number(height.value),frame:product.value==='FC'?frame.value:''};const r=await fetch('/api/custom-size/lookup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Lookup failed');render(d);status.textContent=d.winner?'Lookup complete · '+d.request.size+' '+d.request.product+' to '+d.request.countryCode+' · best option: '+d.winner.provider+'.':'Lookup complete, but no provider returned a fully priced eligible option.';}catch(e){status.className='status bad';status.textContent=String(e.message||e);}finally{button.disabled=false;button.textContent='Find best option';}});
})();
</script></body></html>`;
}
