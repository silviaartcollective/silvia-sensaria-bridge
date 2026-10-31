// The supplier-order panel for one Etsy receipt, on the Orders and Supplier
// Fulfillment Review pages: Diagnose and Preview Artelo order only read;
// Submit sends that one order to Artelo once it is approved, authorized in
// Render and confirmed here. See docs/supplier-submission-safety.md.
(()=>{'use strict';
const line=(label,value)=>label+': '+(value===''||value==null?'—':value);
const money=value=>value==null||!Number.isFinite(Number(value))?'—':'$'+Number(value).toFixed(2);
async function api(path,body){
 const opts=body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)};
 const res=await fetch(path,opts);
 const data=await res.json().catch(()=>({error:'Server returned an invalid response (HTTP '+res.status+').'}));
 if(!res.ok||data.ok===false)throw Error(data.error||'Request failed (HTTP '+res.status+').');
 return data;
}
function diagnosisText(d){
 if(!d.imported)return line('Imported','no · '+(d.error||''));
 const s=d.submission,live=d.liveSubmission||{};
 return [
  line('Imported','yes · '+(d.importedAt||'')+' · '+(d.importSource||'')),
  line('Paid on Etsy',d.paid?'yes':'no'),
  line('Shipped / canceled',(d.shipped?'shipped':'not shipped')+' · '+(d.canceled?'canceled':'not canceled')),
  line('Listing / SKU',(d.listingId||'')+' · '+(d.sku||'')),
  line('Variations',(d.variations||[]).join('; ')),
  line('Product',d.product?d.product.productCode+' '+d.product.size+(d.product.frame?' '+d.product.frame:''):''),
  line('Artwork',d.artwork?d.artwork.key+' ('+d.artwork.width+'×'+d.artwork.height+', '+d.artwork.orientation+')':''),
  line('Destination',d.destination),
  line('Review status',d.reviewStatus),
  line('Selected supplier',d.plan?d.plan.provider+' · quote '+money(d.plan.quotedTotalUsd):''),
  line('Approval',d.approval?(d.approval.method||'')+' · supplier order submitted: '+(d.approval.supplierOrderSubmitted?'yes':'no'):'none'),
  line('Supplier submission',s?s.provider+' · '+s.state+(s.lastError?' · '+s.lastError:''):'none (never sent to any supplier)'),
  line('Supplier order ID',d.supplierOrderId),
  line('Live submission',(live.masterEnabled?'master on':'master off')+' · '+(live.arteloEnabled?'Artelo on':'Artelo off')+' · '+
    (live.receiptAuthorized?'receipt authorized':'receipt not authorized')+((live.ignoredVariables||[]).length?' · ignored: '+live.ignoredVariables.join(', '):'')),
  live.note||'',
  ...((d.problems||[]).length?['Problems:',...d.problems.map(p=>' • '+p)]:['No problems found.'])
 ].join('\n');
}
function previewText(p){
 const a=p.payload?.customerAddress||{},item=p.payload?.items?.[0]?.productInfo||{},c=p.expectedCost||{},pc=c.arteloPriceCheck;
 return [
  line('Artelo order reference',p.payload?.orderId),
  line('Product',[item.catalogProductId,item.paperType,item.frameStyle,item.size,item.orientation].filter(Boolean).join(' · ')),
  line('Artwork',p.artwork?p.artwork.key+' ('+p.artwork.width+'×'+p.artwork.height+')':''),
  line('Ship to',[a.name,a.street1,a.street2,a.city,a.state,a.zipcode,a.countryCode].filter(Boolean).join(', ')),
  line('Approved quote',money(c.approvedQuoteUsd)+' (with reserve '+money(c.approvedModeledUsd)+')'),
  line('Artelo price check',pc?money(pc.total)+' '+(pc.currency||'')+' = production '+money(pc.productionCost)+' + shipping '+money(pc.shippingCost)+' + tax '+money(pc.taxes):'not run'),
  line('Submission record',p.submission?p.submission.provider+' · '+p.submission.state:'none'),
  ...((p.blockers||[]).length?['Blocked:',...p.blockers.map(b=>' • '+b)]:['No blockers.']),
  ...((p.switches||[]).length?['Not authorized yet:',...p.switches.map(b=>' • '+b)]:['Authorized for this one order.'])
 ].join('\n');
}
// mount(root, { receipt: () => '<receipt id>', report: (message, isError) => {} });
// the handle's showArtelo(false) leaves only Diagnose, for orders another
// supplier fulfills.
function mount(root,{receipt,report:pageReport}){
 if(!root)return null;
 root.innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">'+
  '<button type="button" data-so="diagnose">Diagnose this order</button>'+
  '<button type="button" data-so="preview" data-artelo>Preview Artelo order</button>'+
  '<button type="button" data-so="verify" data-artelo>Check Artelo status</button></div>'+
  '<div data-so="status" role="status" aria-live="polite" style="font-size:13px;margin:4px 0"></div>'+
  '<pre data-so="out" hidden style="white-space:pre-wrap;background:#f6f5f0;padding:12px;border-radius:8px;font-size:13px;margin:8px 0"></pre>'+
  '<div data-so="submit-box" hidden><p style="color:#835d2c;background:#f6edda;padding:10px 12px;border-radius:8px;font-size:13px">'+
  'Sends this ONE order to Artelo for production and payment. It needs FULFILLMENT_LIVE_SUBMISSION_ENABLED and ARTELO_FULFILLMENT_ENABLED set to true '+
  'and this receipt listed in SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS in Render. No other order is sent, and a failed or uncertain submission is never repeated on its own.</p>'+
  '<label style="display:block;padding:6px 0;font-size:13px"><input type="checkbox" data-so="dashboard"> I checked the Artelo dashboard and it has no order for this receipt.</label>'+
  '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input data-so="confirm" type="text" autocomplete="off" aria-label="Confirmation" style="padding:9px;border:1px solid #ccc;border-radius:8px;min-width:280px">'+
  '<button type="button" data-so="submit" style="background:#303a30;color:#fff;border-color:#303a30">Submit this order to Artelo</button></div></div>';
 const el=name=>root.querySelector('[data-so="'+name+'"]');
 const out=text=>{el('out').hidden=false;el('out').textContent=text;};
 // Each message shows beside the panel and in the page's own status line.
 const report=(message,failed)=>{el('status').textContent=message;el('status').style.color=failed?'#a33':'';pageReport?.(message,failed);};
 let busy=false;
 const run=fn=>async()=>{
  if(busy)return;busy=true;
  for(const b of root.querySelectorAll('button'))b.disabled=true;
  try{await fn(receipt())}catch(error){report(String(error?.message||error),true)}
  finally{busy=false;for(const b of root.querySelectorAll('button'))b.disabled=false;}
 };
 const path=(id,action)=>'/api/fulfillment-review/'+encodeURIComponent(id)+'/'+action;
 el('diagnose').addEventListener('click',run(async id=>{
  const d=await api(path(id,'diagnose'));out(diagnosisText(d.diagnosis));report('Diagnosis loaded. Nothing was changed.');
 }));
 el('preview').addEventListener('click',run(async id=>{
  report('Checking the order and asking Artelo for its price (no order is created)…');
  const d=await api(path(id,'artelo-preview')),p=d.preview;
  out(previewText(p));
  el('submit-box').hidden=Boolean(p.blockers.length);
  el('confirm').placeholder='Type '+p.confirmation;
  report(p.ready?'Ready to submit this one order.':'Not ready to submit; see the list. Nothing was sent.',!p.ready&&p.blockers.length>0);
 }));
 el('verify').addEventListener('click',run(async id=>{
  const d=await api(path(id,'artelo-verify'),{});
  report(d.found?'Artelo has this order ('+d.record.supplierOrderId+'): '+d.record.state+'.':(d.note||'Artelo has no order with the recorded ID.'));
 }));
 el('submit').addEventListener('click',run(async id=>{
  if(!el('dashboard').checked)throw Error('Check the Artelo dashboard first and tick the box.');
  if(!window.confirm('Send receipt '+id+' to Artelo for production now? This places a real, paid order.'))return;
  const d=await api(path(id,'artelo-submit'),{confirm:el('confirm').value.trim(),arteloDashboardChecked:true});
  report('Submitted to Artelo: order '+(d.submission.supplierOrderId||'(no ID returned: check the dashboard)')+' · '+d.submission.state+'.');
  el('submit-box').hidden=true;
 }));
 const reset=()=>{el('status').textContent='';el('out').hidden=true;el('out').textContent='';el('submit-box').hidden=true;el('dashboard').checked=false;el('confirm').value='';};
 return {reset,showArtelo(on){for(const b of root.querySelectorAll('[data-artelo]'))b.hidden=!on;if(!on)el('submit-box').hidden=true;}};
}
window.SupplierOrderPanel={mount,diagnosisText,previewText};
})();
