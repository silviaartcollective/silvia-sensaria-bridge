export function renderCustomSizeLookupPage() {
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
<div class="notice"><strong>Read-only:</strong> this lookup never creates an Etsy listing or supplier order. Prodigi, Printify, Gelato, PrintShrimp and compatible Artelo poster routes are queried for this exact request. All ISO destination countries are selectable, even outside the shop's normal Etsy shipping markets. Sensaria uses the full captured catalog plus the captured shipping-zone table.</div>

<section class="card">
  <div class="lookup">
    <label>Destination country
      <select id="country"></select>
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
  <div class="status" id="status">Ready. Choose the customer's destination country. Provider availability is checked independently of the shop's normal Etsy shipping markets.</div>
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
</main></div>
<script>
(function(){
const country=document.getElementById('country'),product=document.getElementById('product'),width=document.getElementById('width'),height=document.getElementById('height'),frame=document.getElementById('frame'),frameLabel=document.getElementById('frame-label'),button=document.getElementById('lookup'),status=document.getElementById('status'),hero=document.getElementById('hero'),winner=document.getElementById('winner'),winnerCost=document.getElementById('winner-cost'),winnerDetail=document.getElementById('winner-detail'),customerPrice=document.getElementById('customer-price'),regularPrice=document.getElementById('regular-price'),priceDetail=document.getElementById('price-detail'),saleDetail=document.getElementById('sale-detail'),tableWrap=document.getElementById('table-wrap'),rows=document.getElementById('rows'),empty=document.getElementById('empty');
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null||!Number.isFinite(Number(v))?'—':'
function syncFrame(){frameLabel.style.display=product.value==='FC'?'grid':'none'}product.addEventListener('change',syncFrame);syncFrame();
function statusPill(r){const s=String(r?.status||'unavailable');const cls=r?.eligible?'':' '+(s==='error'?'bad':'warn');return '<span class="pill'+cls+'">'+esc(s)+'</span>';}
function render(data){
 const suppliers=data.suppliers||{};const ranking=new Map((data.ranking||[]).map(x=>[x.provider,x.rank]));const order=['Sensaria','Prodigi','PrintShrimp','Printify','Gelato','Artelo'];
 const byProvider=Object.fromEntries(Object.values(suppliers).map(r=>[r.provider,r]));
 rows.innerHTML=order.map(name=>{const r=byProvider[name]||{};const rank=ranking.get(name);const detail=[r.reason,r.basis,r.meta?.sku?'SKU '+r.meta.sku:'',r.meta?.printProvider?'Printify: '+r.meta.printProvider:'',r.meta?.deliveryDays?.min!=null?'Delivery '+r.meta.deliveryDays.min+'–'+r.meta.deliveryDays.max+' days':''].filter(Boolean).join(' · ');return '<tr><td class="rank">'+(rank||'—')+'</td><td><strong>'+esc(name)+'</strong></td><td>'+statusPill(r)+'</td><td>'+money(r.productCost)+'</td><td>'+money(r.shippingCost)+'</td><td>'+money(r.totalUsd)+'</td><td>'+money(r.modeledLandedUsd)+'</td><td class="detail">'+esc(detail||'—')+'</td></tr>';}).join('');
 tableWrap.classList.add('show');empty.style.display='none';
 if(data.winner){hero.classList.add('show');winner.textContent=data.winner.provider;winnerCost.textContent=money(data.winner.modeledLandedUsd);winnerDetail.textContent=data.winner.savingsVsNextBestUsd!=null?'Saves '+money(data.winner.savingsVsNextBestUsd)+' vs next best':'Only one eligible provider';if(data.pricing){customerPrice.textContent=money(data.pricing.minimumCustomerPriceUsd);regularPrice.textContent=money(data.pricing.regularPriceBeforeShopSaleUsd);priceDetail.textContent='≈ CA$'+Number(data.pricing.minimumCustomerPriceCad||0).toFixed(2)+' · configured safety floor';saleDetail.textContent=data.pricing.shopSaleDiscountPercent+'% current shop sale assumption';}else{customerPrice.textContent='—';regularPrice.textContent='—';priceDetail.textContent='';saleDetail.textContent='';}}else{hero.classList.remove('show');}
}
button.addEventListener('click',async()=>{button.disabled=true;button.innerHTML='<span class="spinner"></span>Checking providers…';status.className='status';status.textContent='Looking up the exact request across connected providers…';try{const body={countryCode:country.value.trim().toUpperCase(),productCode:product.value,width:Number(width.value),height:Number(height.value),frame:product.value==='FC'?frame.value:''};const r=await fetch('/api/custom-size/lookup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Lookup failed');render(d);status.textContent=d.winner?'Lookup complete · '+d.request.size+' '+d.request.product+' to '+d.request.countryCode+' · best option: '+d.winner.provider+'.':'Lookup complete, but no provider returned a fully priced eligible option.';}catch(e){status.className='status bad';status.textContent=String(e.message||e);}finally{button.disabled=false;button.textContent='Find best option';}});
})();
</script></body></html>`;
}
+Number(v).toFixed(2);
const COUNTRY_DATA=[["AF","Afghanistan"],["AL","Albania"],["DZ","Algeria"],["AS","American Samoa"],["AD","Andorra"],["AO","Angola"],["AI","Anguilla"],["AQ","Antarctica"],["AG","Antigua and Barbuda"],["AR","Argentina"],["AM","Armenia"],["AW","Aruba"],["AU","Australia"],["AT","Austria"],["AZ","Azerbaijan"],["BS","Bahamas"],["BH","Bahrain"],["BD","Bangladesh"],["BB","Barbados"],["BY","Belarus"],["BE","Belgium"],["BZ","Belize"],["BJ","Benin"],["BM","Bermuda"],["BT","Bhutan"],["BO","Bolivia"],["BA","Bosnia and Herzegovina"],["BW","Botswana"],["BV","Bouvet Island"],["BR","Brazil"],["IO","British Indian Ocean Territory"],["VG","British Virgin Islands"],["BN","Brunei Darussalam"],["BG","Bulgaria"],["BF","Burkina Faso"],["BI","Burundi"],["CV","Cabo Verde"],["KH","Cambodia"],["CM","Cameroon"],["CA","Canada"],["BQ","Caribbean Netherlands"],["KY","Cayman Islands"],["CF","Central African Republic"],["TD","Chad"],["CL","Chile"],["CN","China"],["CX","Christmas Island"],["CC","Cocos (Keeling) Islands"],["CO","Colombia"],["KM","Comoros"],["CG","Congo"],["CD","Congo, The Democratic Republic of the"],["CK","Cook Islands"],["CR","Costa Rica"],["HR","Croatia"],["CU","Cuba"],["CW","Curaçao"],["CY","Cyprus"],["CZ","Czechia"],["CI","Côte d'Ivoire"],["DK","Denmark"],["DJ","Djibouti"],["DM","Dominica"],["DO","Dominican Republic"],["EC","Ecuador"],["EG","Egypt"],["SV","El Salvador"],["GQ","Equatorial Guinea"],["ER","Eritrea"],["EE","Estonia"],["SZ","Eswatini"],["ET","Ethiopia"],["FK","Falkland Islands (Malvinas)"],["FO","Faroe Islands"],["FJ","Fiji"],["FI","Finland"],["FR","France"],["GF","French Guiana"],["PF","French Polynesia"],["TF","French Southern Territories"],["GA","Gabon"],["GM","Gambia"],["GE","Georgia"],["DE","Germany"],["GH","Ghana"],["GI","Gibraltar"],["GR","Greece"],["GL","Greenland"],["GD","Grenada"],["GP","Guadeloupe"],["GU","Guam"],["GT","Guatemala"],["GG","Guernsey"],["GN","Guinea"],["GW","Guinea-Bissau"],["GY","Guyana"],["HT","Haiti"],["HM","Heard Island and McDonald Islands"],["VA","Holy See (Vatican City State)"],["HN","Honduras"],["HK","Hong Kong"],["HU","Hungary"],["IS","Iceland"],["IN","India"],["ID","Indonesia"],["IR","Iran"],["IQ","Iraq"],["IE","Ireland"],["IM","Isle of Man"],["IL","Israel"],["IT","Italy"],["JM","Jamaica"],["JP","Japan"],["JE","Jersey"],["JO","Jordan"],["KZ","Kazakhstan"],["KE","Kenya"],["KI","Kiribati"],["KW","Kuwait"],["KG","Kyrgyzstan"],["LA","Laos"],["LV","Latvia"],["LB","Lebanon"],["LS","Lesotho"],["LR","Liberia"],["LY","Libya"],["LI","Liechtenstein"],["LT","Lithuania"],["LU","Luxembourg"],["MO","Macao"],["MG","Madagascar"],["MW","Malawi"],["MY","Malaysia"],["MV","Maldives"],["ML","Mali"],["MT","Malta"],["MH","Marshall Islands"],["MQ","Martinique"],["MR","Mauritania"],["MU","Mauritius"],["YT","Mayotte"],["MX","Mexico"],["FM","Micronesia"],["MD","Moldova"],["MC","Monaco"],["MN","Mongolia"],["ME","Montenegro"],["MS","Montserrat"],["MA","Morocco"],["MZ","Mozambique"],["MM","Myanmar"],["NA","Namibia"],["NR","Nauru"],["NP","Nepal"],["NL","Netherlands"],["NC","New Caledonia"],["NZ","New Zealand"],["NI","Nicaragua"],["NE","Niger"],["NG","Nigeria"],["NU","Niue"],["NF","Norfolk Island"],["KP","North Korea"],["MK","North Macedonia"],["MP","Northern Mariana Islands"],["NO","Norway"],["OM","Oman"],["PK","Pakistan"],["PW","Palau"],["PS","Palestine"],["PA","Panama"],["PG","Papua New Guinea"],["PY","Paraguay"],["PE","Peru"],["PH","Philippines"],["PN","Pitcairn"],["PL","Poland"],["PT","Portugal"],["PR","Puerto Rico"],["QA","Qatar"],["RO","Romania"],["RU","Russia"],["RW","Rwanda"],["RE","Réunion"],["BL","Saint Barthélemy"],["SH","Saint Helena, Ascension and Tristan da Cunha"],["KN","Saint Kitts and Nevis"],["LC","Saint Lucia"],["MF","Saint Martin (French part)"],["PM","Saint Pierre and Miquelon"],["VC","Saint Vincent and the Grenadines"],["WS","Samoa"],["SM","San Marino"],["ST","Sao Tome and Principe"],["SA","Saudi Arabia"],["SN","Senegal"],["RS","Serbia"],["SC","Seychelles"],["SL","Sierra Leone"],["SG","Singapore"],["SX","Sint Maarten (Dutch part)"],["SK","Slovakia"],["SI","Slovenia"],["SB","Solomon Islands"],["SO","Somalia"],["ZA","South Africa"],["GS","South Georgia and the South Sandwich Islands"],["KR","South Korea"],["SS","South Sudan"],["ES","Spain"],["LK","Sri Lanka"],["SD","Sudan"],["SR","Suriname"],["SJ","Svalbard and Jan Mayen"],["SE","Sweden"],["CH","Switzerland"],["SY","Syria"],["TW","Taiwan"],["TJ","Tajikistan"],["TZ","Tanzania"],["TH","Thailand"],["TL","Timor-Leste"],["TG","Togo"],["TK","Tokelau"],["TO","Tonga"],["TT","Trinidad and Tobago"],["TN","Tunisia"],["TM","Turkmenistan"],["TC","Turks and Caicos Islands"],["TV","Tuvalu"],["TR","Türkiye"],["VI","U.S. Virgin Islands"],["UG","Uganda"],["UA","Ukraine"],["AE","United Arab Emirates"],["GB","United Kingdom"],["US","United States"],["UM","United States Minor Outlying Islands"],["UY","Uruguay"],["UZ","Uzbekistan"],["VU","Vanuatu"],["VE","Venezuela"],["VN","Vietnam"],["WF","Wallis and Futuna"],["EH","Western Sahara"],["YE","Yemen"],["ZM","Zambia"],["ZW","Zimbabwe"],["AX","Åland Islands"]];
country.innerHTML=COUNTRY_DATA.map(([code,name])=>'<option value="'+code+'">'+esc(name)+' ('+code+')</option>').join('');
country.value='CA';
function syncFrame(){frameLabel.style.display=product.value==='FC'?'grid':'none'}product.addEventListener('change',syncFrame);syncFrame();
function statusPill(r){const s=String(r?.status||'unavailable');const cls=r?.eligible?'':' '+(s==='error'?'bad':'warn');return '<span class="pill'+cls+'">'+esc(s)+'</span>';}
function render(data){
 const suppliers=data.suppliers||{};const ranking=new Map((data.ranking||[]).map(x=>[x.provider,x.rank]));const order=['Sensaria','Prodigi','PrintShrimp','Printify','Gelato','Artelo'];
 const byProvider=Object.fromEntries(Object.values(suppliers).map(r=>[r.provider,r]));
 rows.innerHTML=order.map(name=>{const r=byProvider[name]||{};const rank=ranking.get(name);const detail=[r.reason,r.basis,r.meta?.sku?'SKU '+r.meta.sku:'',r.meta?.printProvider?'Printify: '+r.meta.printProvider:'',r.meta?.deliveryDays?.min!=null?'Delivery '+r.meta.deliveryDays.min+'–'+r.meta.deliveryDays.max+' days':''].filter(Boolean).join(' · ');return '<tr><td class="rank">'+(rank||'—')+'</td><td><strong>'+esc(name)+'</strong></td><td>'+statusPill(r)+'</td><td>'+money(r.productCost)+'</td><td>'+money(r.shippingCost)+'</td><td>'+money(r.totalUsd)+'</td><td>'+money(r.modeledLandedUsd)+'</td><td class="detail">'+esc(detail||'—')+'</td></tr>';}).join('');
 tableWrap.classList.add('show');empty.style.display='none';
 if(data.winner){hero.classList.add('show');winner.textContent=data.winner.provider;winnerCost.textContent=money(data.winner.modeledLandedUsd);winnerDetail.textContent=data.winner.savingsVsNextBestUsd!=null?'Saves '+money(data.winner.savingsVsNextBestUsd)+' vs next best':'Only one eligible provider';if(data.pricing){customerPrice.textContent=money(data.pricing.minimumCustomerPriceUsd);regularPrice.textContent=money(data.pricing.regularPriceBeforeShopSaleUsd);priceDetail.textContent='≈ CA$'+Number(data.pricing.minimumCustomerPriceCad||0).toFixed(2)+' · configured safety floor';saleDetail.textContent=data.pricing.shopSaleDiscountPercent+'% current shop sale assumption';}else{customerPrice.textContent='—';regularPrice.textContent='—';priceDetail.textContent='';saleDetail.textContent='';}}else{hero.classList.remove('show');}
}
button.addEventListener('click',async()=>{button.disabled=true;button.innerHTML='<span class="spinner"></span>Checking providers…';status.className='status';status.textContent='Looking up the exact request across connected providers…';try{const body={countryCode:country.value.trim().toUpperCase(),productCode:product.value,width:Number(width.value),height:Number(height.value),frame:product.value==='FC'?frame.value:''};const r=await fetch('/api/custom-size/lookup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Lookup failed');render(d);status.textContent=d.winner?'Lookup complete · '+d.request.size+' '+d.request.product+' to '+d.request.countryCode+' · best option: '+d.winner.provider+'.':'Lookup complete, but no provider returned a fully priced eligible option.';}catch(e){status.className='status bad';status.textContent=String(e.message||e);}finally{button.disabled=false;button.textContent='Find best option';}});
})();
</script></body></html>`;
}
