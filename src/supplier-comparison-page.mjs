import { SILVIA_CURRENT_MARKETS } from './markets.mjs';

export function renderSupplierComparisonPage({ configured = {} } = {}) {
  const launchCodes = SILVIA_CURRENT_MARKETS.map(item => item.code);
  const ready = Boolean(configured.prodigi && configured.printshrimp);
  const countryOptions = [
    { code: 'ALL', label: `All ${SILVIA_CURRENT_MARKETS.length} current markets` },
    ...SILVIA_CURRENT_MARKETS
  ].map(item => `<option value="${item.code}"${item.code === 'ALL' ? ' selected' : ''}>${item.label}</option>`).join('');

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
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}.notice{padding:12px 14px;border-radius:10px;background:var(--goodbg);color:var(--good);font-size:12px;line-height:1.5;margin-bottom:14px}
.controls{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) auto auto auto;gap:10px;align-items:end}.field{display:grid;gap:6px}.field label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
select,button{border:1px solid var(--line);border-radius:9px;background:#fff;padding:10px 12px;font:inherit}button{font-size:12px;font-weight:700;cursor:pointer}button.primary{background:#30342d;color:#fff;border-color:#30342d}button:disabled{opacity:.45}
.status{font-size:12px;color:var(--muted);margin:13px 0}.progress-wrap{height:7px;background:#ece9e2;border-radius:999px;overflow:hidden;margin:-4px 0 13px;display:none}.progress-wrap.show{display:block}.progress-bar{height:100%;width:0;background:#5e6f5f;transition:width .25s ease}.scan-spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;vertical-align:-2px;margin-right:7px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.summary{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px}.summary span{font-size:11px;background:#f0ede7;border-radius:7px;padding:6px 8px}
.scroll{overflow:auto;max-height:720px;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse;background:#fff;font-size:12px}th,td{padding:9px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#f2efe9;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.pill{display:inline-block;padding:4px 7px;border-radius:999px;background:var(--goodbg);color:var(--good);font-size:10px}.pill.warn{background:var(--warnbg);color:var(--warn)}.note{font-size:10px;color:var(--muted);margin-top:2px}
@media(max-width:900px){.controls{grid-template-columns:1fr 1fr}.controls button{width:100%}}@media(max-width:600px){.controls{grid-template-columns:1fr}h1{font-size:31px}}
</style></head><body><main>
<h1>Supplier Comparison</h1>
<p class="sub">Compare Sensaria, Prodigi and PrintShrimp for the exact Silvia Etsy catalog by destination. Artelo is shown as ineligible because the current mapping is framed-poster-only, a product family this shop does not sell.</p>
<div class="notice"><strong>Planning only:</strong> quoted supplier cost and contingency are shown separately. PrintShrimp uses authenticated GBP API pricing and Matte paper; 12×16 uses the documented 30×40cm alias when needed. A scan never changes Etsy listings or submits supplier orders.</div>
<section class="card">
<div class="controls">
<div class="field"><label>Country</label><select id="country">${countryOptions}</select></div>
<div class="field"><label>Product scope</label><select id="scope"><option value="ALL">All 49 variants</option><option value="P">Poster · 9</option><option value="C">Canvas · 8</option><option value="FC">Framed Canvas · 32</option></select></div>
<button class="primary" id="scan" ${ready?'':'disabled'}>Scan all countries</button>
<button id="copy" disabled>Copy results</button><button id="download" disabled>Download JSON</button>
</div>
<div class="status" id="status">${ready?'Ready to scan.':'Prodigi and/or PrintShrimp API setup is missing.'}</div>
<div class="progress-wrap" id="progress-wrap"><div class="progress-bar" id="progress-bar"></div></div>
<div class="summary" id="summary"></div>
<div class="scroll"><table><thead><tr><th>Country</th><th>Product</th><th>Size</th><th>Finish</th><th>Sensaria</th><th>Prodigi</th><th>Artelo</th><th>PrintShrimp</th><th>Winner</th><th>Est. contribution</th><th>Saves</th><th>Eligible</th></tr></thead><tbody id="rows"><tr><td colspan="12">Run a scan.</td></tr></tbody></table></div>
</section></main>
<script>
(function(){
const scan=document.getElementById('scan'),copy=document.getElementById('copy'),download=document.getElementById('download'),country=document.getElementById('country'),scope=document.getElementById('scope'),status=document.getElementById('status'),progressWrap=document.getElementById('progress-wrap'),progressBar=document.getElementById('progress-bar'),summary=document.getElementById('summary'),rows=document.getElementById('rows');
const launchCodes=${JSON.stringify(launchCodes)};let currentRows=[],failedCountries=[];
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null||!Number.isFinite(Number(v))?'—':'$'+Number(v).toFixed(2);
function provider(record){if(!record)return '—';if(record.eligible&&record.totalUsd!=null){const adjusted=record.modeledLandedUsd??record.totalUsd;return '<strong>'+money(adjusted)+'</strong><div class="note">quoted '+money(record.totalUsd)+(record.contingencyUsd>0?' · reserve '+money(record.contingencyUsd):'')+(String(record.currency).toUpperCase()==='GBP'?' · £'+Number(record.originalTotal).toFixed(2):'')+'</div>';}return '<span class="pill '+(record.status==='error'?'warn':'')+'" title="'+esc(record.reason||'')+'">'+esc(record.status||'unavailable')+'</span>';}
function render(list,final=true){currentRows=list;const wins={Sensaria:0,Prodigi:0,Artelo:0,PrintShrimp:0};let reviews=0;rows.innerHTML=list.map(r=>{if(wins[r.winner]!=null)wins[r.winner]++;if(r.marginStatus==='review')reviews++;const s=r.suppliers||{};return '<tr><td>'+esc(r.country||r.countryCode)+'</td><td>'+esc(r.product)+'</td><td>'+esc(r.size)+'</td><td>'+esc(r.finish)+'</td><td>'+provider(s.sensaria)+'</td><td>'+provider(s.prodigi)+'</td><td>'+provider(s.artelo)+'</td><td>'+provider(s.printshrimp)+'</td><td><strong>'+esc(r.winner||'—')+'</strong></td><td>'+(r.profitScenario?money(r.profitScenario.contributionUsd)+(r.marginStatus==='review'?' <span class="pill warn">review</span>':''):'—')+'</td><td>'+money(r.savingsVsNextBestUsd)+'</td><td>'+esc(r.eligibleSupplierCount||0)+'</td></tr>';}).join('')||'<tr><td colspan="12">No rows returned.</td></tr>';
summary.innerHTML='<span>Rows: <strong>'+list.length+'</strong></span><span>Reviews: <strong>'+reviews+'</strong></span><span>Sensaria wins: <strong>'+wins.Sensaria+'</strong></span><span>Prodigi wins: <strong>'+wins.Prodigi+'</strong></span><span>PrintShrimp wins: <strong>'+wins.PrintShrimp+'</strong></span>';copy.disabled=!list.length;download.disabled=!list.length;if(final)status.textContent='Comparison complete. Live fulfillment remains unchanged.';}
async function fetchCountry(code,products){const response=await fetch('/api/suppliers/compare?countries='+encodeURIComponent(code)+'&products='+encodeURIComponent(products),{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Comparison failed');return data;}
scan&&scan.addEventListener('click',async()=>{const idleLabel=country.value==='ALL'?'Scan all countries':'Scan selected country';scan.disabled=true;scan.innerHTML='<span class="scan-spinner"></span>Scanning…';copy.disabled=true;download.disabled=true;currentRows=[];failedCountries=[];summary.innerHTML='';const products=scope.value==='ALL'?'P,C,FC':scope.value;const codes=country.value==='ALL'?launchCodes:[country.value];const combined=[];progressWrap.classList.add('show');progressBar.style.width='2%';status.textContent='Starting supplier scan · 0 / '+codes.length+' countries…';rows.innerHTML='<tr><td colspan="12">Contacting Prodigi and PrintShrimp for live supplier costs…</td></tr>';await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));try{for(let i=0;i<codes.length;i+=2){const batch=codes.slice(i,i+2);status.textContent='Scanning '+batch.join(' + ')+' · '+Math.min(i,codes.length)+' / '+codes.length+' countries complete…';const results=await Promise.all(batch.map(async code=>{try{return{code,data:await fetchCountry(code,products)}}catch(error){return{code,error:String(error.message||error),data:{rows:[]}}}}));for(const result of results){combined.push(...(result.data.rows||[]));if(result.error)failedCountries.push(result.code+': '+result.error);}const done=Math.min(i+batch.length,codes.length);progressBar.style.width=Math.max(3,Math.round((done/codes.length)*100))+'%';render(combined,false);status.textContent='Scanned '+done+' / '+codes.length+' countries · '+combined.length+' rows.';}render(combined,true);progressBar.style.width='100%';if(failedCountries.length)status.textContent+=' Failed: '+failedCountries.join(' | ');}catch(error){status.textContent='Scan failed: '+String(error.message||error);rows.innerHTML='<tr><td colspan="12">The scan stopped before completion.</td></tr>';}finally{scan.disabled=false;scan.textContent=idleLabel;setTimeout(()=>{progressWrap.classList.remove('show');progressBar.style.width='0';},900);}});
copy&&copy.addEventListener('click',async()=>{const lines=[['Country','Product','Size','Finish','Winner','Winner adjusted USD','Contribution USD','Margin status'].join('\\t')];for(const r of currentRows)lines.push([r.countryCode,r.product,r.size,r.finish,r.winner,r.winnerTotalUsd??'',r.profitScenario?.contributionUsd??'',r.marginStatus].join('\\t'));await navigator.clipboard.writeText(lines.join('\\n'));status.textContent='Copied '+currentRows.length+' rows.';});
download&&download.addEventListener('click',()=>{const data={generatedAt:new Date().toISOString(),source:'Silvia Art Collective Supplier Comparison',expectedCountryCodes:launchCodes,failedCountries,rowCount:currentRows.length,rows:currentRows};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='silvia-supplier-scan-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);});
function label(){scan.textContent=country.value==='ALL'?'Scan all countries':'Scan selected country'}country&&country.addEventListener('change',label);label();
})();
</script></body></html>`;
}
