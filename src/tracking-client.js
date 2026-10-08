(() => {
'use strict';
const $=id=>document.getElementById(id);
let csvText='', previewRows=[],busy=false;
function textNode(tag,value,cls='') {
  const el=document.createElement(tag);el.textContent=String(value??'');
  if(cls)el.className=cls;return el;
}
function message(str,error=false) {
  $('message').textContent=String(str);
  $('message').className='status '+(error?'error':'success');
}
async function api(path,data) {
  const res=await fetch(path,data==null?{cache:'no-store'}:{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)
  });
  const out=await res.json().catch(()=>({error:'Server response was not JSON'}));
  if(!res.ok||out.ok===false)throw new Error(out.error||('HTTP '+res.status));
  return out;
}
async function run(fn) {
  if(busy)return;busy=true;
  for(const b of document.querySelectorAll('button')) b.disabled=true;
  try{await fn();}catch(e){message(e.message||String(e),true);}
  finally{busy=false;$('stage-csv').disabled=!previewRows.length;
    for(const b of document.querySelectorAll('button:not(#stage-csv)'))b.disabled=false;}
}
function labelStatus(r) {
  const shipments=r.shipments||[];
  const etsy=r.etsyStatus||{};
  if(etsy.shipments?.length)return 'Tracking already on Etsy';
  if(shipments.length)return 'Tracking staged / not sent';
  if(etsy.isShipped)return 'Etsy shipped (check for existing label)';
  return r.lastCheckAt?'Awaiting supplier tracking':'Linked / awaiting tracking';
}
async function refresh() {
  const payload=await api('/api/tracking/orders');
  const root=$('orders');root.replaceChildren();
  if(!payload.records?.length){root.append(textNode('p','No linked orders yet. Add a verified Etsy receipt and supplier order ID.'));return;}
  const table=document.createElement('table'),head=document.createElement('tr');
  ['Etsy receipt','Supplier','Supplier order ID','Shipping status','Tracking numbers','Action'].forEach(v=>head.append(textNode('th',v)));table.append(head);
  for(const entry of payload.records){
    const tr=document.createElement('tr');
    tr.append(textNode('td','#'+entry.receiptId,'mono'),
      textNode('td',entry.supplier),textNode('td',entry.supplierOrderId,'mono'),
      textNode('td',labelStatus(entry)));
    const sh=document.createElement('td');
    const codes=(entry.shipments||[]).map(s=>s.carrier+' '+s.trackingNumber+(s.etsySentAt?' (sent)':' (review only)'));
    const etsy=(entry.etsyStatus?.shipments||[]).map(s=>s.carrier+' '+s.trackingNumber+' (already in Etsy)');
    sh.textContent=[...codes,...etsy].join('\n')||'—';
    tr.append(sh);
    const actions=document.createElement('td');
    const check=textNode('button','Select');check.type='button';
    check.addEventListener('click',()=>{
      $('check-receipt').value=entry.receiptId;$('receipt').value=entry.receiptId;
      $('supplier').value=entry.supplier;$('supplier-id').value=entry.supplierOrderId;
      message('Selected Etsy #'+entry.receiptId+'. Use Check API tracking or Refresh Etsy shipment status.');
    });
    actions.append(check);tr.append(actions);table.append(tr);
  }root.append(table);
}
$('refresh').addEventListener('click',()=>run(async()=>{await refresh();message('Linked orders refreshed.');}));
$('link').addEventListener('click',()=>run(async()=>{
  const receiptId=$('receipt').value.trim(),supplier=$('supplier').value,supplierOrderId=$('supplier-id').value.trim();
  if(!receiptId||!supplierOrderId)throw new Error('Enter both Etsy receipt and supplier order IDs.');
  const result=await api('/api/tracking/link',{receiptId,supplier,supplierOrderId});
  $('check-receipt').value=result.record.receiptId;
  await refresh();
  message('Verified and saved Etsy #'+receiptId+' → '+supplier+' order '+supplierOrderId+'.');
}));
$('check-api').addEventListener('click',()=>run(async()=>{
  const receiptId=$('check-receipt').value.trim();
  if(!receiptId)throw new Error('Enter a linked Etsy receipt ID.');
  const result=await api('/api/tracking/check-supplier',{receiptId});
  await refresh();
  message('Supplier status: '+result.status+'\n'+(result.results||[]).map(v=>v.trackingNumber+': '+(v.queued?'staged for review':v.reason)).join('\n')+
    '\nNothing was sent to Etsy.');
}));
$('check-etsy').addEventListener('click',()=>run(async()=>{
  const receiptId=$('check-receipt').value.trim();
  if(!receiptId)throw new Error('Enter a linked Etsy receipt ID.');
  const result=await api('/api/tracking/check-etsy',{receiptId});
  await refresh();
  const etsy=result.record?.etsyStatus||{};
  message('Etsy #'+receiptId+': '+(etsy.isShipped?'Already marked shipped':'Not yet marked shipped')+
    '\nExisting tracking: '+(etsy.shipments||[]).map(v=>v.carrier+' '+v.trackingNumber).join(', ')+
    '\nNo shipping notifications were sent.');
}));
$('csv').addEventListener('change',()=>{
  previewRows=[];csvText='';$('stage-csv').disabled=true;
  $('csv-preview').replaceChildren();
});
$('preview-csv').addEventListener('click',()=>run(async()=>{
  const file=$('csv').files?.[0];
  if(!file)throw new Error('Choose a Sensaria exported shipment report CSV.');
  if(file.size>1500000)throw new Error('CSV over 1.5 MB. Export a shorter date range.');
  csvText=await file.text();
  const out=await api('/api/tracking/csv-preview',{csv:csvText});
  previewRows=out.rows||[];
  const root=$('csv-preview');root.replaceChildren();
  if(!previewRows.length){root.append(textNode('p','No shipped tracking rows matched linked Sensaria orders.'));
    message('No matched tracking. '+(out.skipped||[]).length+' row(s) skipped. Check supplier order links.',true);return;}
  const table=document.createElement('table'),head=document.createElement('tr');
  ['Use','Etsy receipt','Supplier order','Shipment','Tracking number','Carrier — confirm','Shipping date'].forEach(v=>head.append(textNode('th',v)));table.append(head);
  for(const r of previewRows){
    const tr=document.createElement('tr');const cell=document.createElement('td');
    const checked=document.createElement('input');checked.type='checkbox';checked.checked=true;checked.className='csv-pick';
    checked.dataset.receipt=r.receiptId;checked.dataset.tracking=r.trackingNumber;cell.append(checked);tr.append(cell);
    tr.append(textNode('td','#'+r.receiptId),textNode('td',r.supplierOrderId),textNode('td',r.shipmentId||'—'),textNode('td',r.trackingNumber,'mono'));
    const c=document.createElement('td');const select=document.createElement('select');
    select.className='csv-carrier';select.dataset.receipt=r.receiptId;select.dataset.tracking=r.trackingNumber;
    const names=['','USPS','UPS','FedEx','DHL','Canada Post','Purolator','DPD','OnTrac','Other'];
    names.forEach(v=>select.append(new Option(v||'Confirm carrier…',v)));
    select.value=names.includes(r.carrier)?r.carrier:'';
    c.append(select);tr.append(c);
    tr.append(textNode('td',r.shippingDate||'—'));table.append(tr);
  }root.append(table);
  message('Found '+previewRows.length+' linked tracking row(s); '+(out.skipped||[]).length+
    ' row(s) skipped. Confirm each carrier before staging. No Etsy orders have changed.');
}));
$('stage-csv').addEventListener('click',()=>run(async()=>{
  if(!csvText||!previewRows.length)throw new Error('Preview a Sensaria CSV before staging.');
  const selected=[...document.querySelectorAll('.csv-pick:checked')].map(box=>{
    const receiptId=box.dataset.receipt,trackingNumber=box.dataset.tracking;
    const carrier=[...document.querySelectorAll('.csv-carrier')].find(x=>
      x.dataset.receipt===receiptId&&x.dataset.tracking===trackingNumber)?.value||'';
    return {receiptId,trackingNumber,carrier};
  });
  if(!selected.length)throw new Error('Select at least one shipment.');
  if(selected.some(r=>!r.carrier))throw new Error('Confirm the carrier for every selected shipment.');
  if(!window.confirm('Stage '+selected.length+' verified Sensaria shipments in this app?\n\nNO tracking will be submitted to Etsy, and NO customer notifications will be sent.'))return;
  const result=await api('/api/tracking/csv-import',{csv:csvText,selected,confirm:'IMPORT TRACKING'});
  await refresh();
  message('Staged: '+result.saved+'. Duplicates: '+result.duplicates+'. Needs attention: '+result.failed+
    '\n'+(result.errors||[]).map(e=>'#'+e.receiptId+': '+e.error).join('\n')+
    '\nNothing was sent to Etsy.');
  previewRows=[];csvText='';$('csv').value='';$('csv-preview').replaceChildren();
}));
refresh().catch(error=>message(error.message||String(error),true));
})();