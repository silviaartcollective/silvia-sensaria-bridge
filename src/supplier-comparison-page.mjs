import { SILVIA_CURRENT_MARKETS } from './markets.mjs';

export function renderSupplierComparisonPage({ configured = {} } = {}) {
  const launchCodes = SILVIA_CURRENT_MARKETS.map(item => item.code);
  const ready = Boolean(configured.prodigi);
  const countryOptions = [
    { code: 'ALL', label: `All ${SILVIA_CURRENT_MARKETS.length} current markets` },
    ...SILVIA_CURRENT_MARKETS
  ].map(item => `<option value="${item.code}"${item.code === 'CA' ? ' selected' : ''}>${item.label}</option>`).join('');
  const providerRows = [
    ['sensaria', 'Sensaria'],
    ['prodigi', 'Prodigi'],
    ['printshrimp', 'PrintShrimp'],
    ['printify', 'Printify'],
    ['gelato', 'Gelato'],
    ['artelo', 'Artelo']
  ].map(([key, label]) => {
    const isConfigured = key === 'sensaria' ? true : Boolean(configured[key]);
    return `<div class="provider-row" data-provider="${key}"><div><strong>${label}</strong><div class="provider-detail" id="provider-detail-${key}">${isConfigured ? 'Ready to test' : 'Not configured'}</div></div><span class="pill ${isConfigured ? '' : 'warn'}" id="provider-state-${key}">${isConfigured ? 'Not tested' : 'Missing key'}</span><button class="provider-test" data-provider-test="${key}" ${isConfigured ? '' : 'disabled'}>Test</button></div>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Silvia · Supplier Comparison</title>
<style>
:root{--bg:#f5f2ec;--panel:#fff;--ink:#22231f;--muted:#74766e;--line:#dedbd3;--good:#506552;--goodbg:#e9efe8;--warn:#8f672f;--warnbg:#f5ead8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1600px;margin:auto;padding:32px 24px 48px}h1{font:500 38px Georgia,serif;margin:0 0 8px}.sub{color:var(--muted);line-height:1.55;margin:0 0 22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}.providers-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}.providers-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.provider-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:10px 11px}.provider-detail{font-size:10px;color:var(--muted);margin-top:3px;line-height:1.35}.provider-test{min-width:58px}.notice{padding:12px 14px;border-radius:10px;background:var(--goodbg);color:var(--good);font-size:12px;line-height:1.5;margin-bottom:14px}
.controls{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) auto auto auto;gap:10px;align-items:end}.field{display:grid;gap:6px}.field label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
select,button{border:1px solid var(--line);border-radius:9px;background:#fff;padding:10px 12px;font:inherit}button{font-size:12px;font-weight:700;cursor:pointer}button.primary{background:#30342d;color:#fff;border-color:#30342d}button:disabled{opacity:.45}
.status{font-size:12px;color:var(--muted);margin:13px 0}.progress-wrap{height:7px;background:#ece9e2;border-radius:999px;overflow:hidden;margin:-4px 0 13px;display:none}.progress-wrap.show{display:block}.progress-bar{height:100%;width:0;background:#5e6f5f;transition:width .25s ease}.scan-spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;vertical-align:-2px;margin-right:7px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.summary{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px}.summary span{font-size:11px;background:#f0ede7;border-radius:7px;padding:6px 8px}
.scroll{overflow:auto;max-height:720px;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse;background:#fff;font-size:12px}th,td{padding:9px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#f2efe9;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.pill{display:inline-block;padding:4px 7px;border-radius:999px;background:var(--goodbg);color:var(--good);font-size:10px}.pill.warn{background:var(--warnbg);color:var(--warn)}.note{font-size:10px;color:var(--muted);margin-top:2px}
@media(max-width:900px){.controls{grid-template-columns:1fr 1fr}.controls button{width:100%}}@media(max-width:600px){.controls{grid-template-columns:1fr}h1{font-size:31px}}

.app-shell{min-height:100vh;display:grid;grid-template-columns:238px minmax(0,1fr)}
.app-sidebar{background:#252820;color:#f8f5ee;padding:28px 20px;display:flex;flex-direction:column;min-height:100vh}
.app-sidebar .brand{font-family:Georgia,serif;font-size:24px;line-height:1.08;margin-bottom:30px}
.app-sidebar .brand small{display:block;font-size:12px;color:#b9beb3;margin-top:8px}
.app-sidebar nav{display:grid;gap:7px}
.app-sidebar .nav{padding:11px 12px;border-radius:9px;color:#cdd1c7;font-size:14px;text-decoration:none}
.app-sidebar .nav.active,.app-sidebar .nav:hover{background:#373b33;color:#fff}
.app-sidebar .foot{margin-top:auto;color:#aeb3a8;font-size:12px;line-height:1.5}
.app-shell>main{min-width:0;width:100%}
@media(max-width:720px){.app-shell{grid-template-columns:1fr}.app-sidebar{display:none}}

</style></head><body><div class="app-shell">
<aside class="app-sidebar">
  <div class="brand">Silvia<br>Fulfillment <small>Etsy → Sensaria</small></div>
  <nav>
    <a class="nav" href="/">Dashboard</a>
    <a class="nav" href="/product-creator">Product Creator</a>
    <a class="nav" href="/listing-converter">Gelato → Silvia Converter</a>
    <a class="nav" href="/shipping-profile">Shipping Profile</a>
    <a class="nav" href="/pricing">Pricing & Shipping</a>
    <a class="nav active" href="/compare">Supplier Comparison</a>
    <a class="nav" href="/custom-size">Custom Size Lookup</a>
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
<h1>Supplier Comparison</h1>
<p class="sub">Final regular-catalog comparison across Sensaria, Prodigi, PrintShrimp, Printify, Gelato and compatible Artelo poster routes for the exact Silvia Etsy sizes and destination country. Canvas and Framed Canvas remain excluded only for providers whose actual product catalog does not offer a compatible match.</p>
<div class="notice"><strong>Planning only:</strong> this page reads supplier catalogs and quote/pricing APIs. It never creates supplier orders, changes Etsy listings or enables live fulfillment. Gelato uses live product + country shipment pricing; Printify checks individual print providers and shows availability even when its public Catalog API does not expose a production cost.</div>
<section class="card">
<div class="providers-head"><div><h2 style="font:500 23px Georgia,serif;margin:0 0 5px">Provider connections</h2><div class="provider-detail">Test each live API before running the final comparison.</div></div><button id="test-all">Test all connections</button></div>
<div class="providers-grid">${providerRows}</div>
<div class="status" id="provider-status">No connection tests run yet.</div>
</section>
<section class="card">
<div class="controls">
<div class="field"><label>Country</label><select id="country">${countryOptions}</select></div>
<div class="field"><label>Product scope</label><select id="scope"><option value="ALL">All 49 variants</option><option value="P">Poster · 9</option><option value="C">Canvas · 8</option><option value="FC">Framed Canvas · 32</option></select></div>
<button class="primary" id="scan" ${ready?'':'disabled'}>Scan selected country</button>
<button id="copy" disabled>Copy results</button><button id="download" disabled>Download JSON</button>
</div>
<div class="status" id="status">${ready?'Ready to scan. Select a country or choose All markets.':'Prodigi API setup is missing; comparison cannot build the base catalog rows.'}</div>
<div class="progress-wrap" id="progress-wrap"><div class="progress-bar" id="progress-bar"></div></div>
<div class="summary" id="summary"></div>
<div class="scroll"><table><thead><tr><th>Country</th><th>Product</th><th>Size</th><th>Finish</th><th>Sensaria</th><th>Prodigi</th><th>PrintShrimp</th><th>Printify</th><th>Gelato</th><th>Artelo</th><th>Winner</th><th>Est. contribution</th><th>Saves</th><th>Eligible</th></tr></thead><tbody id="rows"><tr><td colspan="14">Run a scan.</td></tr></tbody></table></div>
</section></main>
</div>
<script>
(function(){
const scan=document.getElementById('scan'),copy=document.getElementById('copy'),download=document.getElementById('download'),country=document.getElementById('country'),scope=document.getElementById('scope'),status=document.getElementById('status'),progressWrap=document.getElementById('progress-wrap'),progressBar=document.getElementById('progress-bar'),summary=document.getElementById('summary'),rows=document.getElementById('rows'),providerStatus=document.getElementById('provider-status'),testAll=document.getElementById('test-all');
const launchCodes=${JSON.stringify(launchCodes)};const configured=${JSON.stringify(configured)};let currentRows=[],failedCountries=[];
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null||!Number.isFinite(Number(v))?'—':'$'+Number(v).toFixed(2);
function provider(record){if(!record)return '—';if(record.eligible&&record.totalUsd!=null){const adjusted=record.modeledLandedUsd??record.totalUsd;return '<strong>'+money(adjusted)+'</strong><div class="note">quoted '+money(record.totalUsd)+(record.contingencyUsd>0?' · reserve '+money(record.contingencyUsd):'')+(String(record.currency).toUpperCase()==='GBP'?' · £'+Number(record.originalTotal).toFixed(2):'')+'</div>';}return '<span class="pill '+(record.status==='error'?'warn':'')+'" title="'+esc(record.reason||'')+'">'+esc(record.status||'unavailable')+'</span>';}
function render(list,final=true){currentRows=list;const wins={Sensaria:0,Prodigi:0,Artelo:0,PrintShrimp:0,Printify:0,Gelato:0};let reviews=0;rows.innerHTML=list.map(r=>{if(wins[r.winner]!=null)wins[r.winner]++;if(r.marginStatus==='review')reviews++;const s=r.suppliers||{};return '<tr><td>'+esc(r.country||r.countryCode)+'</td><td>'+esc(r.product)+'</td><td>'+esc(r.size)+'</td><td>'+esc(r.finish)+'</td><td>'+provider(s.sensaria)+'</td><td>'+provider(s.prodigi)+'</td><td>'+provider(s.printshrimp)+'</td><td>'+provider(s.printify)+'</td><td>'+provider(s.gelato)+'</td><td>'+provider(s.artelo)+'</td><td><strong>'+esc(r.winner||'—')+'</strong></td><td>'+(r.profitScenario?money(r.profitScenario.contributionUsd)+(r.marginStatus==='review'?' <span class="pill warn">review</span>':''):'—')+'</td><td>'+money(r.savingsVsNextBestUsd)+'</td><td>'+esc(r.eligibleSupplierCount||0)+'</td></tr>';}).join('')||'<tr><td colspan="14">No rows returned.</td></tr>';
summary.innerHTML='<span>Rows: <strong>'+list.length+'</strong></span><span>Reviews: <strong>'+reviews+'</strong></span><span>Sensaria wins: <strong>'+wins.Sensaria+'</strong></span><span>Prodigi wins: <strong>'+wins.Prodigi+'</strong></span><span>PrintShrimp: <strong>'+wins.PrintShrimp+'</strong></span><span>Printify: <strong>'+wins.Printify+'</strong></span><span>Gelato: <strong>'+wins.Gelato+'</strong></span>';copy.disabled=!list.length;download.disabled=!list.length;if(final)status.textContent='Final supplier comparison complete. Live fulfillment remains unchanged.';}
async function testProvider(key){const state=document.getElementById('provider-state-'+key),detail=document.getElementById('provider-detail-'+key),button=document.querySelector('[data-provider-test="'+key+'"]');if(button)button.disabled=true;if(state){state.className='pill warn';state.textContent='Testing…'}if(detail)detail.textContent='Contacting provider API…';try{const r=await fetch('/api/providers/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:key})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Connection failed');if(state){state.className='pill';state.textContent='Connected'}let info='Connection verified';if(key==='printify')info='Connected · '+Number(d.wallArtBlueprintCount||0)+' wall-art blueprints · '+Number(d.shopCount||0)+' shop(s)';if(key==='gelato')info='Connected · '+Number(d.catalogCount||0)+' catalogs';if(key==='prodigi')info='Connected · '+Number(d.catalogVariantCount||0)+' mapped variants';if(detail)detail.textContent=info;return true;}catch(e){if(state){state.className='pill warn';state.textContent='Failed'}if(detail)detail.textContent=String(e.message||e);return false;}finally{if(button)button.disabled=false;}}
document.querySelectorAll('[data-provider-test]').forEach(btn=>btn.addEventListener('click',async()=>{providerStatus.textContent='Testing '+btn.dataset.provider+'…';const ok=await testProvider(btn.dataset.provider);providerStatus.textContent=ok?'Connection verified.':'Connection test failed. See provider row for details.';}));
testAll&&testAll.addEventListener('click',async()=>{testAll.disabled=true;providerStatus.textContent='Testing configured providers…';const keys=['sensaria','prodigi','printshrimp','printify','gelato','artelo'].filter(k=>k==='sensaria'||configured[k]);let passed=0;for(const key of keys){if(await testProvider(key))passed++;}providerStatus.textContent='Provider tests complete · '+passed+' / '+keys.length+' connected.';testAll.disabled=false;});
async function fetchCountry(code,products){const response=await fetch('/api/suppliers/compare?countries='+encodeURIComponent(code)+'&products='+encodeURIComponent(products),{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Comparison failed');return data;}
async function fetchCountryReliable(code,products){let lastError='';for(let attempt=1;attempt<=3;attempt++){try{const data=await fetchCountry(code,products);if(Array.isArray(data.rows)&&data.rows.length)return data;lastError='No rows returned';}catch(error){lastError=String(error.message||error);}if(attempt<3)await new Promise(resolve=>setTimeout(resolve,700*attempt));}throw new Error(lastError||'No rows returned');}
scan&&scan.addEventListener('click',async()=>{const idleLabel=country.value==='ALL'?'Scan all countries':'Scan selected country';scan.disabled=true;scan.innerHTML='<span class="scan-spinner"></span>Scanning…';copy.disabled=true;download.disabled=true;currentRows=[];failedCountries=[];summary.innerHTML='';const products=scope.value==='ALL'?'P,C,FC':scope.value;const codes=country.value==='ALL'?launchCodes:[country.value];const combined=[];progressWrap.classList.add('show');progressBar.style.width='2%';status.textContent='Starting supplier scan · 0 / '+codes.length+' countries…';rows.innerHTML='<tr><td colspan="14">Contacting Prodigi, PrintShrimp, Printify and Gelato; Sensaria uses the captured catalog…</td></tr>';await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));try{for(let i=0;i<codes.length;i++){const code=codes[i];status.textContent='Scanning '+code+' · '+i+' / '+codes.length+' countries complete…';try{const data=await fetchCountryReliable(code,products);combined.push(...(data.rows||[]));}catch(error){failedCountries.push(code+': '+String(error.message||error));}const done=i+1;progressBar.style.width=Math.max(3,Math.round((done/codes.length)*100))+'%';render(combined,false);status.textContent='Scanned '+done+' / '+codes.length+' countries · '+combined.length+' rows.'+(failedCountries.length?' Failed so far: '+failedCountries.join(' | '):'');}render(combined,true);progressBar.style.width='100%';if(failedCountries.length)status.textContent+=' Failed: '+failedCountries.join(' | ');}catch(error){status.textContent='Scan failed: '+String(error.message||error);rows.innerHTML='<tr><td colspan="14">The scan stopped before completion.</td></tr>';}finally{scan.disabled=false;scan.textContent=idleLabel;setTimeout(()=>{progressWrap.classList.remove('show');progressBar.style.width='0';},900);}});
copy&&copy.addEventListener('click',async()=>{const lines=[['Country','Product','Size','Finish','Winner','Winner adjusted USD','Contribution USD','Margin status'].join('\\t')];for(const r of currentRows)lines.push([r.countryCode,r.product,r.size,r.finish,r.winner,r.winnerTotalUsd??'',r.profitScenario?.contributionUsd??'',r.marginStatus].join('\\t'));await navigator.clipboard.writeText(lines.join('\\n'));status.textContent='Copied '+currentRows.length+' rows.';});
download&&download.addEventListener('click',()=>{const data={generatedAt:new Date().toISOString(),source:'Silvia Art Collective Final Supplier Comparison',expectedCountryCodes:launchCodes,failedCountries,rowCount:currentRows.length,rows:currentRows};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='silvia-final-supplier-scan-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);});
function label(){scan.textContent=country.value==='ALL'?'Scan all countries':'Scan selected country'}country&&country.addEventListener('change',label);label();
})();
</script></body></html>`;
}
