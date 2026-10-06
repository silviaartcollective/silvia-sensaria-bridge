export function renderPricingPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Silvia Pricing</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#20221e;--muted:#74776f;--line:#dfdcd4;--green:#536454;--green2:#e8eee7;--amber:#946b35;--amber2:#f5ead9;--red:#9b4439}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}.shell{max-width:1650px;margin:0 auto;padding:34px 22px 50px}h1{font-family:Georgia,serif;font-weight:500;font-size:38px;margin:0 0 8px}h2{font-family:Georgia,serif;font-weight:500}.sub{color:var(--muted);font-size:14px;margin:0 0 22px}.toplink{display:inline-block;margin-bottom:18px;color:var(--muted);font-size:13px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:20px;box-shadow:0 10px 28px rgba(40,40,30,.05);margin-bottom:18px}.controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap}label{display:grid;gap:7px;font-size:12px;font-weight:650}select{min-width:330px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:10px 12px;font:inherit}.notice{padding:12px 14px;border-radius:10px;background:var(--amber2);color:var(--amber);font-size:12px;line-height:1.5;margin-bottom:18px}.status{font-size:12px;color:var(--muted);line-height:1.5;max-width:900px}.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:16px 0}.kpi{background:#f7f4ee;border:1px solid var(--line);border-radius:10px;padding:13px}.kpi b{display:block;font-family:Georgia,serif;font-size:22px;margin-top:4px}.muted{color:var(--muted);font-size:11px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th{background:#f1eee8;position:sticky;top:0;z-index:1}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2),th:nth-child(7),td:nth-child(7){text-align:left}.scroll{overflow:auto;max-height:690px}.good,.ok{color:#496b51}.bad{color:var(--red)}.market-note{padding:10px 12px;background:#f7f4ee;border:1px solid var(--line);border-radius:10px;margin-top:12px;font-size:12px;line-height:1.5;color:var(--muted)}.btn{border:0;border-radius:10px;background:#30352e;color:#fff;padding:11px 14px;font-weight:700;cursor:pointer}.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}.btn:disabled{opacity:.55;cursor:not-allowed}.sync-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}.sync-list{margin-top:12px;display:grid;gap:8px}.sync-item{padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:#f7f4ee;font-size:12px;line-height:1.5}.sync-item b{font-weight:700}@media(max-width:800px){.kpis{grid-template-columns:1fr 1fr}h1{font-size:32px}select{min-width:260px}}
</style>
</head>
<body><main class="shell">
<a class="toplink" href="/">← Dashboard</a>
<h1>Silvia pricing & profitability</h1>
<p class="sub">Current Silvia CAD price ladder → Etsy USD, current shop sale, free customer shipping, Sensaria fulfillment, and destination planning tax.</p>
<div class="notice"><strong>Important:</strong> Silvia now uses free shipping on Etsy. Sensaria Basic shipping is absorbed by Silvia and reduces profit. Tax outside the verified British Columbia example is a planning assumption only; actual Sensaria supplier tax can differ.</div>

<section class="card">
  <div class="controls">
    <label>Profitability destination
      <select id="market"><option value="CA">Loading markets…</option></select>
    </label>
    <div class="status" id="market-status">Loading current market assumptions…</div>
  </div>

  <div class="kpis">
    <div class="kpi"><span class="muted">Customer shipping</span><b>FREE</b></div>
    <div class="kpi"><span class="muted">Shop sale</span><b id="sale-kpi">—</b></div>
    <div class="kpi"><span class="muted">Sensaria zone</span><b id="zone-kpi">—</b></div>
    <div class="kpi"><span class="muted">Planning tax</span><b id="tax-kpi">—</b></div>
    <div class="kpi"><span class="muted">CAD / USD</span><b id="fx-kpi">1.39</b></div>
  </div>

  <div class="market-note" id="tax-note"></div>

  <div class="scroll">
  <table>
    <thead><tr>
      <th>Product</th><th>Size</th><th>Regular CAD</th><th id="sale-cad-head">Sale CAD</th><th>Regular USD</th><th id="sale-usd-head">Sale USD</th>
      <th>Shipping group</th><th>Product cost</th><th>Sensaria ship</th><th>Pre-tax fulfillment</th><th>Pre-tax profit</th><th>Pre-tax margin</th>
      <th>Planning tax</th><th>True fulfillment</th><th>After-tax profit USD</th><th>After-tax profit CAD</th><th>After-tax margin</th>
    </tr></thead>
    <tbody id="rows"><tr><td colspan="17">Loading…</td></tr></tbody>
  </table>
  </div>
</section>

<section class="card">
  <h2 style="margin:0 0 6px">Existing Etsy listing prices</h2>
  <p class="sub" style="margin-bottom:12px">Preview which active and draft Silvia listings differ from the current app price ladder. Nothing changes until you explicitly apply the sync.</p>
  <div class="sync-actions">
    <button class="btn secondary" id="preview-prices" type="button">Preview existing listings</button>
    <button class="btn secondary" id="select-all-prices" type="button" disabled>Select all needing changes</button>
    <button class="btn secondary" id="clear-prices" type="button" disabled>Clear selection</button>
    <button class="btn" id="apply-prices" type="button" disabled>Update selected listings</button>
    <div class="status" id="price-sync-status">No live Etsy prices have been changed.</div>
  </div>
  <div class="sync-list" id="price-sync-list"></div>
</section>
</main>

<script>
const market=document.getElementById('market');
const rows=document.getElementById('rows');
const marketStatus=document.getElementById('market-status');
const taxNote=document.getElementById('tax-note');
const zoneKpi=document.getElementById('zone-kpi');
const taxKpi=document.getElementById('tax-kpi');
const fxKpi=document.getElementById('fx-kpi');
const saleKpi=document.getElementById('sale-kpi');
const saleCadHead=document.getElementById('sale-cad-head');
const saleUsdHead=document.getElementById('sale-usd-head');
const previewPrices=document.getElementById('preview-prices');
const applyPrices=document.getElementById('apply-prices');
const selectAllPrices=document.getElementById('select-all-prices');
const clearPrices=document.getElementById('clear-prices');
const priceSyncStatus=document.getElementById('price-sync-status');
const priceSyncList=document.getElementById('price-sync-list');

const moneyUsd=v=>v==null||!Number.isFinite(Number(v))?'n/a':'$'+Number(v).toFixed(2);
const moneyCad=v=>v==null||!Number.isFinite(Number(v))?'n/a':'CA$'+Number(v).toFixed(2);
const pct=v=>v==null||!Number.isFinite(Number(v))?'n/a':(Number(v)*100).toFixed(1)+'%';
const name=f=>f==='P'?'Poster':f==='C'?'Canvas':'Framed Canvas';
const marginClass=v=>v==null?'':Number(v)<0.25?'bad':Number(v)>=0.45?'good':'';

let initialized=false;

function fillMarkets(config,selected){
  if(initialized)return;
  const markets=config?.profitability?.markets||[];
  market.innerHTML='';
  for(const item of markets){
    const option=document.createElement('option');
    option.value=item.key;
    option.textContent=item.label;
    if(item.key===selected)option.selected=true;
    market.appendChild(option);
  }
  initialized=true;
}

function render(data){
  fillMarkets(data.config,data.market?.key||'CA');
  const m=data.market||{};
  zoneKpi.textContent=m.zone||data.zone||'—';
  taxKpi.textContent=Number.isFinite(Number(m.planningTaxRate))?(Number(m.planningTaxRate)*100).toFixed(1)+'%':'—';
  fxKpi.textContent=String(data.config?.cadPerUsd||'1.39');
  const salePercent=Number(data.config?.saleDiscountPercent||0);
  saleKpi.textContent=salePercent.toFixed(0)+'%';
  saleCadHead.textContent=salePercent.toFixed(0)+'% Sale CAD';
  saleUsdHead.textContent=salePercent.toFixed(0)+'% Sale USD';
  marketStatus.innerHTML='<strong>'+String(m.label||'Selected market')+'</strong> · '+String(m.taxStatus||'tax status unavailable');
  taxNote.textContent=m.taxNote||'No planning-tax note is available for this destination.';

  rows.innerHTML=(data.rows||[]).map(x=>{
    const afterClass=marginClass(x.profitAfterTaxMargin);
    return '<tr>'+
      '<td>'+name(x.format)+'</td>'+
      '<td>'+x.size.replace('x','×')+'</td>'+
      '<td>'+moneyCad(x.regularPriceCad)+'</td>'+
      '<td>'+moneyCad(x.salePriceCad)+'</td>'+
      '<td>'+moneyUsd(x.regularPriceUsd)+'</td>'+
      '<td>'+moneyUsd(x.salePriceUsd)+'</td>'+
      '<td>'+x.shippingGroup+'</td>'+
      '<td>'+moneyUsd(x.productCostUsd)+'</td>'+
      '<td>'+moneyUsd(x.shippingCostUsd)+'</td>'+
      '<td>'+moneyUsd(x.totalFulfillmentCostBeforeTaxUsd)+'</td>'+
      '<td>'+moneyUsd(x.profitBeforeTaxUsd)+'</td>'+
      '<td class="'+marginClass(x.profitBeforeTaxMargin)+'">'+pct(x.profitBeforeTaxMargin)+'</td>'+
      '<td>'+moneyUsd(x.sensariaTaxUsd)+'</td>'+
      '<td>'+moneyUsd(x.trueFulfillmentCostUsd)+'</td>'+
      '<td>'+moneyUsd(x.profitAfterTaxUsd)+'</td>'+
      '<td>'+moneyCad(x.profitAfterTaxUsd==null?null:x.profitAfterTaxUsd*Number(data.config?.cadPerUsd||1.39))+'</td>'+
      '<td class="'+afterClass+'">'+pct(x.profitAfterTaxMargin)+'</td>'+
    '</tr>';
  }).join('');
}

function selectedPriceListingIds(){
  return Array.from(document.querySelectorAll('input[name="price-listing"]:checked'))
    .map(input=>Number(input.value))
    .filter(Number.isFinite);
}

function updatePriceSelectionControls(){
  const enabled=Array.from(document.querySelectorAll('input[name="price-listing"]:not(:disabled)'));
  const selected=selectedPriceListingIds();
  applyPrices.disabled=selected.length===0;
  selectAllPrices.disabled=enabled.length===0;
  clearPrices.disabled=selected.length===0;
  applyPrices.textContent=selected.length
    ? 'Update selected listings ('+selected.length+')'
    : 'Update selected listings';
}

function renderPricePreview(d){
  priceSyncList.innerHTML='';
  const listings=d.listings||[];
  priceSyncStatus.className='status';
  priceSyncStatus.innerHTML=
    '<strong>'+String(d.shopListingCount??d.listingCount??listings.length)+'</strong> Etsy listings found · '+
    '<strong>'+String(d.listingsWithChanges||0)+'</strong> need price updates · '+
    '<strong>'+String(d.variantChangeCount||0)+'</strong> variant prices would change · '+
    String(d.unrecognizedListingCount||0)+' listings could not be mapped automatically.';

  for(const item of listings){
    const div=document.createElement('div');
    div.className='sync-item';

    const checkbox=document.createElement('input');
    checkbox.type='checkbox';
    checkbox.name='price-listing';
    checkbox.value=String(item.listingId);
    checkbox.disabled=!item.canUpdate;
    checkbox.checked=Boolean(item.canUpdate);
    checkbox.style.marginRight='10px';
    checkbox.addEventListener('change',updatePriceSelectionControls);

    const wrapper=document.createElement('label');
    wrapper.style.display='flex';
    wrapper.style.alignItems='flex-start';
    wrapper.style.gap='2px';
    wrapper.style.fontWeight='400';
    wrapper.appendChild(checkbox);

    const content=document.createElement('span');
    if(item.error){
      content.innerHTML='<b>#'+String(item.listingId)+' · '+String(item.title||'Untitled')+'</b> · '+String(item.state||'')+
        '<br><span class="bad">'+String(item.error)+'</span>';
    }else if(!item.recognized){
      const reasons=(item.skipped||[]).slice(0,3).map(x=>String(x.reason||'Unrecognized variation')).join(' · ');
      content.innerHTML='<b>#'+String(item.listingId)+' · '+String(item.title||'Untitled')+'</b> · '+String(item.state||'')+
        '<br><span class="bad">Not mapped automatically.</span> '+String(item.note||'')+
        (reasons?'<br>'+reasons:'');
    }else if(item.changeCount>0){
      const examples=(item.changes||[]).slice(0,5).map(x=>
        String(x.size||'')+' '+String(x.style||'')+' · $'+Number(x.currentUsd).toFixed(2)+' → $'+Number(x.targetUsd).toFixed(2)
      ).join('<br>');
      content.innerHTML='<b>#'+String(item.listingId)+' · '+String(item.title||'Untitled')+'</b> · '+String(item.state||'')+
        '<br><strong>'+String(item.changeCount)+' variant prices need changes</strong>'+
        (examples?'<br>'+examples:'');
    }else{
      content.innerHTML='<b>#'+String(item.listingId)+' · '+String(item.title||'Untitled')+'</b> · '+String(item.state||'')+
        '<br><span class="good">Already matches the current price ladder.</span>';
    }

    wrapper.appendChild(content);
    div.appendChild(wrapper);
    priceSyncList.appendChild(div);
  }

  updatePriceSelectionControls();
}

async function previewExistingPrices(){
  previewPrices.disabled=true;
  applyPrices.disabled=true;
  priceSyncStatus.className='status';
  priceSyncStatus.textContent='Checking active and draft Etsy listings…';
  priceSyncList.innerHTML='';

  try{
    const r=await fetch('/api/pricing/listings-preview',{cache:'no-store'});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not preview Etsy prices');
    renderPricePreview(d);
  }catch(error){
    priceSyncStatus.className='status bad';
    priceSyncStatus.textContent=String(error.message||error);
  }finally{
    previewPrices.disabled=false;
  }
}

previewPrices.addEventListener('click',previewExistingPrices);

selectAllPrices.addEventListener('click',()=>{
  document.querySelectorAll('input[name="price-listing"]:not(:disabled)').forEach(input=>{input.checked=true});
  updatePriceSelectionControls();
});

clearPrices.addEventListener('click',()=>{
  document.querySelectorAll('input[name="price-listing"]').forEach(input=>{input.checked=false});
  updatePriceSelectionControls();
});

applyPrices.addEventListener('click',async()=>{
  const listingIds=selectedPriceListingIds();
  if(!listingIds.length)return;
  const confirmed=confirm('Update '+listingIds.length+' selected Silvia Etsy listing'+(listingIds.length===1?'':'s')+' to the current app price ladder?\\n\\nOnly the checked listings will be changed. The 25% Etsy sale remains separate.');
  if(!confirmed)return;

  applyPrices.disabled=true;
  previewPrices.disabled=true;
  priceSyncStatus.className='status';
  priceSyncStatus.textContent='Updating existing Etsy listing prices…';

  try{
    const r=await fetch('/api/pricing/sync-listings',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({confirm:'UPDATE SILVIA PRICES',listingIds})
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not update Etsy prices');

    priceSyncStatus.className='status ok';
    priceSyncStatus.innerHTML='<strong>Price sync complete.</strong> '+String(d.updatedListings||0)+' of '+String(d.requestedListings||listingIds.length)+' selected listings updated · '+String(d.updatedVariants||0)+' variant prices changed.';
    await previewExistingPrices();
  }catch(error){
    priceSyncStatus.className='status bad';
    priceSyncStatus.textContent=String(error.message||error);
  }finally{
    previewPrices.disabled=false;
  }
});

async function load(){
  rows.innerHTML='<tr><td colspan="17">Loading…</td></tr>';

  try{
    const r=await fetch('/api/pricing?market='+encodeURIComponent(market.value||'CA'),{cache:'no-store'});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Pricing failed');
    render(d);
  }catch(error){
    rows.innerHTML='<tr><td colspan="17" class="bad">'+String(error.message||error)+'</td></tr>';
  }
}

market.addEventListener('change',load);
load();
</script>
</body>
</html>`;
}
