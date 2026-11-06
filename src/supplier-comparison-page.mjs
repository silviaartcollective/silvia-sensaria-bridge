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
    ['artelo', 'Artelo'],
    ['printful', 'Printful'],
    ['lumaprints', 'Lumaprints'],
    ['gooten', 'Gooten']
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
.controls{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) repeat(4,auto);gap:10px;align-items:end}.field{display:grid;gap:6px}.field label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
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
    <a class="nav" href="/description-updater">Description Updater</a>
    <a class="nav" href="/tracking">Order Tracking</a>
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
<p class="sub">Final regular-catalog comparison across Sensaria, Prodigi, PrintShrimp, Printify, Gelato, Printful, Lumaprints, Gooten and compatible Artelo poster routes for the exact Silvia Etsy sizes and destination country. Canvas and Framed Canvas remain excluded only for providers whose actual product catalog does not offer a compatible match.</p>
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
<button id="retry-failed" disabled>Retry failed countries</button><button id="copy" disabled>Copy results</button><button id="download" disabled>Download JSON</button>
</div>
<div class="status" id="status">${ready?'Ready to scan. Select a country or choose All markets.':'Prodigi API setup is missing; comparison cannot build the base catalog rows.'}</div>
<div class="progress-wrap" id="progress-wrap"><div class="progress-bar" id="progress-bar"></div></div>
<div class="summary" id="summary"></div>
<div class="scroll"><table><thead><tr><th>Country</th><th>Product</th><th>Size</th><th>Finish</th><th>Sensaria</th><th>Prodigi</th><th>PrintShrimp</th><th>Printify</th><th>Gelato</th><th>Artelo</th><th>Printful</th><th>Lumaprints</th><th>Gooten</th><th>Winner</th><th>Est. contribution</th><th>Saves</th><th>Eligible</th></tr></thead><tbody id="rows"><tr><td colspan="17">Run a scan.</td></tr></tbody></table></div>
</section></main>
</div>
<script>
(function(){
const scan=document.getElementById('scan'),copy=document.getElementById('copy'),download=document.getElementById('download'),country=document.getElementById('country'),scope=document.getElementById('scope'),status=document.getElementById('status'),progressWrap=document.getElementById('progress-wrap'),progressBar=document.getElementById('progress-bar'),summary=document.getElementById('summary'),rows=document.getElementById('rows'),providerStatus=document.getElementById('provider-status'),testAll=document.getElementById('test-all');
const launchCodes=${JSON.stringify(launchCodes)};const configured=${JSON.stringify(configured)};let currentRows=[],failedCountries=[],failedCountryCodes=[],lastProducts='P,C,FC';const retryFailed=document.getElementById('retry-failed');
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null||!Number.isFinite(Number(v))?'—':'$'+Number(v).toFixed(2);
function provider(record){if(!record)return '—';if(record.eligible&&record.totalUsd!=null){const adjusted=record.modeledLandedUsd??record.totalUsd;const m=record.meta||{};const facts=[m.material||m.productName,m.canvasThicknessInches?m.canvasThicknessInches+'" deep':'',m.deliveryDays&&m.deliveryDays.min!=null?(m.deliveryDays.min===m.deliveryDays.max?m.deliveryDays.min:m.deliveryDays.min+'–'+m.deliveryDays.max)+(m.deliveryDays.businessDays?' business':'')+' days':''].filter(Boolean).join(' · ');return '<strong>'+money(adjusted)+'</strong><div class="note">quoted '+money(record.totalUsd)+(record.productCost!=null&&record.shippingCost!=null&&m.material?' ('+money(record.productCost)+' + '+money(record.shippingCost)+' ship)':'')+(record.contingencyUsd>0?' · reserve '+money(record.contingencyUsd):'')+(String(record.currency).toUpperCase()==='GBP'?' · £'+Number(record.originalTotal).toFixed(2):'')+'</div>'+(facts?'<div class="note" title="'+esc(record.basis||'')+'">'+esc(facts)+'</div>':'')+(record.estimatedProfit?'<div class="note">profit '+money(record.estimatedProfit.contributionUsd)+'</div>':'');}return '<span class="pill '+(record.status==='error'?'warn':'')+'" title="'+esc(record.reason||'')+'">'+esc(record.status||'unavailable')+'</span>';}
function render(list,final=true){currentRows=list;const wins={Sensaria:0,Prodigi:0,Artelo:0,PrintShrimp:0,Printify:0,Gelato:0,Printful:0,Lumaprints:0,Gooten:0};let reviews=0;rows.innerHTML=list.map(r=>{if(wins[r.winner]!=null)wins[r.winner]++;if(r.marginStatus==='review')reviews++;const s=r.suppliers||{};return '<tr><td>'+esc(r.country||r.countryCode)+'</td><td>'+esc(r.product)+'</td><td>'+esc(r.size)+'</td><td>'+esc(r.finish)+'</td><td>'+provider(s.sensaria)+'</td><td>'+provider(s.prodigi)+'</td><td>'+provider(s.printshrimp)+'</td><td>'+provider(s.printify)+'</td><td>'+provider(s.gelato)+'</td><td>'+provider(s.artelo)+'</td><td>'+provider(s.printful)+'</td><td>'+provider(s.lumaprints)+'</td><td>'+provider(s.gooten)+'</td><td><strong>'+esc(r.winner||'—')+'</strong>'+(r.winner&&r.comparisonStatus==='partial'?'<div class="note" title="'+esc((r.missingProviders||[]).join(', '))+' could not be checked">cheapest verified · '+esc((r.missingProviders||[]).length)+' not checked</div>':'')+'</td><td>'+(r.profitScenario?money(r.profitScenario.contributionUsd)+(r.marginStatus==='review'?' <span class="pill warn">review</span>':''):'—')+'</td><td>'+money(r.savingsVsNextBestUsd)+'</td><td>'+esc(r.eligibleSupplierCount||0)+'</td></tr>';}).join('')||'<tr><td colspan="17">No rows returned.</td></tr>';
summary.innerHTML='<span>Rows: <strong>'+list.length+'</strong></span><span>Reviews: <strong>'+reviews+'</strong></span><span>Sensaria wins: <strong>'+wins.Sensaria+'</strong></span><span>Prodigi wins: <strong>'+wins.Prodigi+'</strong></span><span>PrintShrimp: <strong>'+wins.PrintShrimp+'</strong></span><span>Printify: <strong>'+wins.Printify+'</strong></span><span>Gelato: <strong>'+wins.Gelato+'</strong></span><span>Printful: <strong>'+wins.Printful+'</strong></span><span>Lumaprints: <strong>'+wins.Lumaprints+'</strong></span><span>Gooten: <strong>'+wins.Gooten+'</strong></span>';copy.disabled=!list.length;download.disabled=!list.length;if(final)status.textContent='Final supplier comparison complete. Live fulfillment remains unchanged.';}
async function testProvider(key){const state=document.getElementById('provider-state-'+key),detail=document.getElementById('provider-detail-'+key),button=document.querySelector('[data-provider-test="'+key+'"]');if(button)button.disabled=true;if(state){state.className='pill warn';state.textContent='Testing…'}if(detail)detail.textContent='Contacting provider API…';try{const r=await fetch('/api/providers/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:key})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Connection failed');if(state){state.className='pill';state.textContent='Connected'}let info='Connection verified';if(key==='printify')info='Connected · '+Number(d.wallArtBlueprintCount||0)+' wall-art blueprints · '+Number(d.shopCount||0)+' shop(s)';if(key==='gelato')info='Connected · '+Number(d.catalogCount||0)+' catalogs';if(key==='prodigi')info='Connected · '+Number(d.catalogVariantCount||0)+' mapped variants';if(key==='printful')info='Connected · '+Number(d.storeCount||0)+' store(s)'+(d.needsStoreId?' · set PRINTFUL_STORE_ID':'');if(key==='lumaprints')info='Connected · '+Number(d.storeCount||0)+' store(s)'+(d.sandbox?' · sandbox':'');if(key==='gooten')info='Connected · '+Number(d.productCount||0)+' products · billing key '+(d.partnerBillingKeyVerified?'verified':d.partnerBillingKeyConfigured?'not verified':'not configured');if(detail)detail.textContent=info;return true;}catch(e){if(state){state.className='pill warn';state.textContent='Failed'}if(detail)detail.textContent=String(e.message||e);return false;}finally{if(button)button.disabled=false;}}
document.querySelectorAll('[data-provider-test]').forEach(btn=>btn.addEventListener('click',async()=>{providerStatus.textContent='Testing '+btn.dataset.provider+'…';const ok=await testProvider(btn.dataset.provider);providerStatus.textContent=ok?'Connection verified.':'Connection test failed. See provider row for details.';}));
testAll&&testAll.addEventListener('click',async()=>{testAll.disabled=true;providerStatus.textContent='Testing configured providers…';const keys=['sensaria','prodigi','printshrimp','printify','gelato','artelo','printful','lumaprints','gooten'].filter(k=>k==='sensaria'||configured[k]);let passed=0;for(const key of keys){if(await testProvider(key))passed++;}providerStatus.textContent='Provider tests complete · '+passed+' / '+keys.length+' connected.';testAll.disabled=false;});
async function comparisonJson(response,stage){
 const contentType=String(response.headers?.get?.('content-type')||'');
 const raw=await response.text();
 if(!contentType.toLowerCase().includes('json')){
  const html=/^\\s*<(?:!DOCTYPE|html|head|body)/i.test(raw);
  throw new Error(stage+': HTTP '+response.status+
   (html?' returned an HTML hosting/proxy page instead of JSON. The request may have timed out or been redirected.':
     ' did not return JSON. Please retry this country.'));
 }
 let data;
 try{data=JSON.parse(raw)}catch(error){
  throw new Error(stage+': malformed JSON (HTTP '+response.status+'). Retry this country.');
 }
 if(!response.ok||!data.ok)throw new Error(stage+': '+(data.error||'HTTP '+response.status));
 return data;
}
async function fetchCountry(code,products){
 const endpoint='/api/suppliers/compare';
 const params='&products='+encodeURIComponent(products);
 const started=await comparisonJson(await fetch(endpoint+'/start?country='+
  encodeURIComponent(code)+params,{cache:'no-store'}),code+' start');
 if(!started.jobId)throw new Error(code+': no background scan ID returned.');
 const startTime=Date.now();
 let consecutivePollFailures=0;
 while(Date.now()-startTime<18*60*1000){
  await new Promise(resolve=>setTimeout(resolve,2500));
  let job;
  try{
   job=await comparisonJson(await fetch(endpoint+'/jobs/'+encodeURIComponent(started.jobId),
    {cache:'no-store'}),code+' progress');
   consecutivePollFailures=0;
  }catch(error){
   consecutivePollFailures++;
   if(consecutivePollFailures>=8)throw error;
   status.textContent=code+': supplier scan still running; retrying status connection ('+
    consecutivePollFailures+'/8). No results have been discarded.';
   continue;
  }
  if(job.status==='failed')throw new Error(code+': '+String(job.error||'Background scan failed.'));
  if(job.status==='completed'){
   if(!Array.isArray(job.result?.rows)||!job.result.rows.length)
    throw new Error(code+': completed without comparison rows.');
   return job.result;
  }
  status.textContent='Scanning '+code+' in background… '+
   Math.round((Date.now()-startTime)/1000)+' seconds. Supplier APIs can take several minutes.';
 }
 throw new Error(code+': background supplier scan exceeded 18 minutes. Retry this country.');
}
async function fetchCountryReliable(code,products){
 let lastError='';
 for(let attempt=1;attempt<=2;attempt++){
  try{return await fetchCountry(code,products)}
  catch(error){lastError=String(error.message||error)}
  if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1500));
 }
 throw new Error(lastError||'Supplier scan failed.');
}
async function runSupplierComparison(codes,products,preserve=false){
 scan.disabled=true;retryFailed.disabled=true;
 if(!preserve){copy.disabled=true;download.disabled=true;currentRows=[]}
 const combined=preserve?[...currentRows]:[];
 const failures=[],failedCodes=[];
 rows.innerHTML=preserve?rows.innerHTML:'<tr><td colspan="14">Loading live supplier costs…</td></tr>';
 try{
  for(let i=0;i<codes.length;i++){
   const code=codes[i];
   status.textContent='Scanning '+code+' · '+i+' / '+codes.length+' countries processed…';
   try{
    const data=await fetchCountryReliable(code,products);
    const retained=combined.filter(row=>row.countryCode!==code);
    combined.length=0;combined.push(...retained,...data.rows);
   }catch(error){
    failedCodes.push(code);
    failures.push(code+': '+String(error.message||error));
   }
   render(combined,false);
   status.textContent='Scanned '+(i+1)+' / '+codes.length+' countries · '+
    combined.length+' rows.'+(failures.length?' Incomplete: '+failures.join(' | '):'');
  }
  currentRows=combined;
  failedCountryCodes=failedCodes;
  failedCountries=failures;
  render(combined,true);
  lastProducts=products;
  if(failedCodes.length){
   status.textContent='Supplier comparison INCOMPLETE: '+failedCodes.length+
    ' country/countries not verified ('+failedCodes.join(', ')+'). '+failures.join(' | ')+
    '. Use Retry failed countries; already completed results are kept.';
  }else status.textContent='Final supplier comparison complete: '+
    codes.length+' countries verified. Live fulfillment remains unchanged.';
 }finally{
  scan.disabled=false;
  retryFailed.disabled=!failedCountryCodes.length;
 }
}
scan&&scan.addEventListener('click',()=>runSupplierComparison(
 country.value==='ALL'?launchCodes:[country.value],
 scope.value==='ALL'?'P,C,FC':scope.value,false
));
retryFailed&&retryFailed.addEventListener('click',()=>runSupplierComparison(
 [...failedCountryCodes],lastProducts,true
));
copy&&copy.addEventListener('click',async()=>{const lines=[['Country','Product','Size','Finish','Winner','Winner adjusted USD','Contribution USD','Margin status'].join('\\t')];for(const r of currentRows)lines.push([r.countryCode,r.product,r.size,r.finish,r.winner,r.winnerTotalUsd??'',r.profitScenario?.contributionUsd??'',r.marginStatus].join('\\t'));await navigator.clipboard.writeText(lines.join('\\n'));status.textContent='Copied '+currentRows.length+' rows.';});
download&&download.addEventListener('click',()=>{const data={generatedAt:new Date().toISOString(),source:'Silvia Art Collective Final Supplier Comparison',expectedCountryCodes:launchCodes,failedCountries,failedCountryCodes,rowCount:currentRows.length,rows:currentRows};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='silvia-final-supplier-scan-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);});
function label(){scan.textContent=country.value==='ALL'?'Scan all countries':'Scan selected country'}country&&country.addEventListener('change',label);label();
})();
</script></body></html>`;
}
