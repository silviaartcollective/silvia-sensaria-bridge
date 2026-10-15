(() => {
'use strict';
const $=id=>document.getElementById(id);
let orders=[], selectedId='', loadingDetail=0;
function text(value){return String(value ?? '');}
function set(id,value){$(id).textContent=text(value);}
function report(message,failed=false){set('message',message);$('message').className='status'+(failed?' error':'');}
async function api(path,body) {
  const opts=body===undefined?{cache:'no-store'}:{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
  };
  const response=await fetch(path,opts);
  let result;try{result=await response.json();}catch{throw new Error('Server returned invalid JSON (HTTP '+response.status+').');}
  if(!response.ok||result.ok===false)throw new Error(result.error||'Request failed (HTTP '+response.status+')');
  return result;
}
function formatMoney(value){
  if(value?.amount==null)return 'Not provided';
  return Number(value.amount).toFixed(2)+' '+(value.currency||'');
}
function isShipped(receipt){
  return receipt.is_shipped===true||receipt.was_shipped===true||
    (Array.isArray(receipt.shipments)&&receipt.shipments.length>0);
}
function candidate(order){
  return order.classification==='custom'||
    (order.classification==='unclassified'&&order.inference?.categoryHint==='possible_custom');
}
function pickOrders(){
  const query=$('search').value.trim().toLowerCase(),filter=$('filter').value;
  return orders.filter(order=>{
    if(filter==='custom'&&!candidate(order))return false;
    if(filter==='shipped'&&!order.shipped)return false;
    if(filter==='open'&&order.shipped)return false;
    if(!query)return true;
    return [order.receiptId,order.buyer,...(order.items||[]).map(i=>i.title)]
      .some(v=>text(v).toLowerCase().includes(query));
  });
}
function renderOrders(){
  const list=$('list');list.replaceChildren();
  const matching=pickOrders();
  set('count',matching.length+' / '+orders.length);
  if(!matching.length){const el=document.createElement('p');el.textContent='No orders match these filters.';list.append(el);return;}
  for(const o of matching){
    const btn=document.createElement('button');btn.type='button';
    btn.className='order-button'+(o.receiptId===selectedId?' selected':'');
    const headline=document.createElement('span');headline.className='title';
    headline.textContent='Etsy #'+o.receiptId+' · '+(o.buyer||'Customer');
    const item=document.createElement('span');item.className='small';
    item.textContent=(o.items||[]).map(i=>i.title).filter(Boolean).join('; ')||'Item details unavailable';
    const status=document.createElement('span');status.className='tag';
    const progress=o.status==='awaiting_supplier_approval'
      ? ' · Recommended: '+(o.supplier||'Available')
      : o.status==='approved_for_manual_order'?' · Approved for manual order'
      : o.automaticRouting?.status==='manual_review'?' · Needs manual review'
      : o.automaticRouting?.status==='retry'?' · Supplier retry pending'
      : candidate(o)?' · Custom candidate':' · Auto-checking supplier';
    status.textContent=(o.shipped?'Shipped / completed':'Order received')+progress;
    btn.append(headline,item,status);
    if(o.status==='awaiting_supplier_approval' || o.status==='approved_for_manual_order'){
      const supplier=String(o.supplier||'').trim();
      if(supplier.toLowerCase()==='sensaria'){
        const name=document.createElement('strong');
        name.className='supplier-name';name.textContent='SENSARIA';
        btn.append(name);
      }
    }
    btn.addEventListener('click',()=>{
      openOrder(o.receiptId).catch(error=>report('Could not load Etsy order #'+o.receiptId+': '+(error.message||String(error)),true));
    });
    list.append(btn);
  }
}
async function loadOrders(quiet=false){
  if(!quiet)report('Loading saved paid Etsy orders…');
  const data=await api('/api/orders');
  orders=(data.orders||[]).filter(o=>!o.error);
  renderOrders();
  if(!quiet)report('Loaded '+orders.length+' paid Etsy receipts. No supplier orders or Etsy shipments were changed.'+
    (data.truncated?' Displaying the latest 120 staged receipts.':'')+' Automatic supplier recommendations are enabled for eligible orders.');
}
async function openOrder(id){
  const current=++loadingDetail;selectedId=id;renderOrders();
  $('empty').classList.add('hidden');$('details').classList.remove('hidden');
  set('buyer','Loading order #'+id+'…');set('items','Loading…');
  const data=await api('/api/custom-orders/'+encodeURIComponent(id));
  if(current!==loadingDetail)return;
  const receipt=data.staged?.receipt||{},review=data.review||{},summary=data.summary||{};
  set('buyer','Etsy #'+id+' · '+(summary.buyer||'Customer'));
  const shipped=isShipped(receipt);
  const created=receipt.create_timestamp||receipt.created_timestamp||receipt.created_at;
  const date=created?(typeof created==='number'?new Date(created*1000):new Date(created)).toLocaleString():'Date unavailable';
  set('order-meta',date+' · '+(shipped?'Shipped / completed':'Not yet shipped')+
    ' · '+(review.classification||'Not classified'));
  const plan=review.regularPlan||{};
  const sensaria=String(plan.supplier||'').toLowerCase()==='sensaria' &&
    review.classification==='regular' &&
    ['awaiting_supplier_approval','approved_for_manual_order'].includes(review.status) &&
    !shipped && !receipt.was_canceled && !receipt.is_canceled;
  $('supplier-banner').classList.toggle('hidden',!sensaria);
  $('sensaria-csv').classList.toggle('hidden',!sensaria);
  $('sensaria-csv').disabled=false;
  $('supplier-name').textContent=sensaria?'SENSARIA':String(plan.supplier||'');
  const quoteExpired=Number.isFinite(Date.parse(plan.expiresAt)) &&
    Date.now()>Date.parse(plan.expiresAt);
  $('sensaria-csv-status').className= sensaria && quoteExpired ? '' : 'hidden';
  $('sensaria-csv-status').textContent=sensaria && quoteExpired
    ? 'The earlier supplier price estimate has expired. You can still download the CSV, but confirm the current Sensaria cost before manually placing the order.'
    : '';
  const items=Array.isArray(receipt.transactions)?receipt.transactions:[];
  set('items',items.length?items.map(item=>
    (item.title||'Untitled')+' · Quantity '+(item.quantity||1)+
    (item.sku?' · SKU '+item.sku:'')+
    (Array.isArray(item.variations)?'\n'+item.variations.map(v=>(v.formatted_name||v.name||'')+
      ': '+(v.formatted_value||v.value||'')).join('; '):'')
  ).join('\n\n'):'Transaction details are not available in this saved receipt.');
  set('address',[receipt.name,receipt.first_line,receipt.second_line,receipt.city,
    receipt.state,receipt.zip,receipt.country_iso].filter(Boolean).join('\n')||
    'Address unavailable. Verify the order in Etsy.');
  const shipments=Array.isArray(receipt.shipments)?receipt.shipments:[];
  set('shipment',(shipped?'Etsy status: Shipped / completed':'Etsy status: Not yet shipped')+
    '\n'+(shipments.length?shipments.map(s=>(
      'Carrier: '+(s.carrier_name||s.carrier||'Not supplied')+
      '\nTracking: '+(s.tracking_code||s.tracking_number||'Not supplied')
    )).join('\n\n'):'No tracking in the saved receipt. Use Order Tracking to check the latest data.'));
  const currencyAmount=v=>{
    if(v?.amount==null)return 'Not available';
    return (Number(v.amount)/Number(v.divisor||100)).toFixed(2)+' '+(v.currency_code||'');
  };
  set('totals','Artwork: '+currencyAmount(receipt.total_price)+' · Shipping: '+
    currencyAmount(receipt.total_shipping_cost));
  $('review-custom').href='/custom-orders?receipt='+encodeURIComponent(id);
  $('track-order').href='/tracking';
  $('review-regular').href='/fulfillment-review?receipt='+encodeURIComponent(id);
  if(window.innerWidth<1150)$('order-detail').scrollIntoView({behavior:'smooth',block:'start'});
}
// Generate the production image asynchronously; report each stage and
// provide bounded retries rather than leaving the button spinning indefinitely.
async function prepareSensariaCsv(receiptId,notify){
  const id=String(receiptId);
  async function decoded(response){
    const result=await response.json().catch(()=>null);
    if(!result)throw Error('Server returned invalid JSON (HTTP '+response.status+').');
    if(!response.ok || result.ok===false)
      throw Error(result.error||'CSV preparation failed (HTTP '+response.status+').');
    return result;
  }
  let response=await fetch('/api/orders/'+encodeURIComponent(id)+'/sensaria-csv',{
    method:'POST',headers:{'content-type':'application/json'},body:'{}',
    cache:'no-store',signal:AbortSignal.timeout(20000)
  });
  await decoded(response);
  const started=Date.now(),deadline=started+4*60*1000+15000;
  while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,2500));
    response=await fetch('/api/orders/'+encodeURIComponent(id)+'/sensaria-csv',{
      cache:'no-store',signal:AbortSignal.timeout(15000)
    });
    const status=(await decoded(response)).job;
    if(status?.status==='failed')
      throw Error(status.error||'Artwork preparation failed. Retry after checking R2.');
    if(status?.status==='completed'){
      notify('Canvas prepared. Downloading verified Sensaria GO CSV…');
      const downloaded=await fetch('/api/orders/'+encodeURIComponent(id)+'/sensaria-csv?download=1',{
        cache:'no-store',signal:AbortSignal.timeout(30000)
      });
      if(!downloaded.ok){
        let reason;
        try{reason=(await downloaded.json()).error;}catch{}
        throw Error(reason||'CSV download failed (HTTP '+downloaded.status+').');
      }
      const blob=await downloaded.blob();
      if(!blob.size||!blob.type.includes('csv'))
        throw Error('Server returned an empty or invalid CSV.');
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='sensaria-etsy-'+id+'.csv';
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      return;
    }
    const elapsed=Math.max(0,Math.round((Date.now()-started)/1000));
    notify((status?.stage||'Preparing artwork')+' · '+elapsed+' seconds elapsed.');
  }
  throw Error('CSV preparation exceeded the wait limit. You may retry the same order without placing a supplier order.');
}
$('sensaria-csv').addEventListener('click',async()=>{
  const id=String(selectedId),button=$('sensaria-csv'),notice=$('sensaria-csv-status');
  notice.className='';
  if(!/^[1-9]\d{0,19}$/.test(id)){
    notice.className='error';
    notice.textContent='Select a valid Etsy receipt before downloading its CSV.';
    return;
  }
  button.disabled=true;
  notice.textContent='Starting Sensaria artwork preparation…';
  try{
    await prepareSensariaCsv(id,message=>{notice.textContent=message;});
    notice.textContent='Sensaria CSV downloaded. Verify the current cost, canvas artwork, and address before manually ordering.';
  }catch(error){
    notice.className='error';
    notice.textContent=String(error.message||error);
  }finally{
    button.disabled=false;
  }
});
$('search').addEventListener('input',renderOrders);
$('filter').addEventListener('change',renderOrders);
$('refresh').addEventListener('click',async()=>{
  const b=$('refresh');b.disabled=true;
  try{await loadOrders();if(selectedId)await openOrder(selectedId);}
  catch(error){report(error.message||String(error),true);}
  finally{b.disabled=false;}
});
$('sync').addEventListener('click',async()=>{
  const b=$('sync');b.disabled=true;
  try {
    report('Syncing the 15 latest paid Etsy receipts…');
    const data=await api('/api/custom-orders/sync',{});
    await loadOrders(true);
    report('Synced '+(data.imported||[]).length+' Etsy receipts.'+
      ((data.failures||[]).length?' '+data.failures.length+' receipts could not be imported.':'')+
      ' No supplier orders or Etsy shipping updates were submitted.');
  }catch(error){report(error.message||String(error),true);}
  finally{b.disabled=false;}
});
loadOrders().then(()=>{
  const id=new URLSearchParams(window.location.search).get('receipt');
  if(id&&/^[1-9]\d{0,19}$/.test(id))openOrder(id).catch(error=>report(error.message||String(error),true));
}).catch(error=>report(error.message||String(error),true));
})();