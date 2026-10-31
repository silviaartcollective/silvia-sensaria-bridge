export function renderFulfillmentReviewPage(shop){
 const e=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Supplier Fulfillment Review</title><style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#282e27;--line:#dfdcd4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}
.shell{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100vh}
aside{background:#252820;padding:24px;color:white}nav a{display:block;padding:9px;color:inherit}
main{padding:36px;max-width:1100px;width:100%;margin:0 auto}h1,h2{font-family:Georgia,serif;font-weight:400}
h1{font-size:34px;margin:0}h2{font-size:23px;margin:0 0 15px}
.sub{color:#71776e;margin:6px 0 22px}.card{background:var(--panel);padding:22px;border-radius:12px;border:1px solid var(--line);margin:16px 0}
input[type=text]{padding:10px;border:1px solid #c8c9c4;border-radius:8px;font:inherit;max-width:300px;width:100%}
button{padding:11px 16px;font:inherit;border-radius:9px;border:1px solid #ccc;background:#fff;cursor:pointer}
button.primary{background:#303a30;color:#fff;border-color:#303a30}button:disabled{opacity:.55}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.note{color:#835d2c;background:#f6edda;padding:12px;border-radius:8px;margin:12px 0}
#message{white-space:pre-wrap;padding:12px;background:#eaf0e8;border-radius:8px;margin:16px 0}
#message.error{background:#f9e8e4;color:#933b31}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:9px;border-bottom:1px solid var(--line)}
.checks label{display:block;padding:8px 0}code{font-size:13px}#plan{overflow-wrap:anywhere}
@media(max-width:800px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:70px 16px 20px}}
</style></head><body><div class="shell"><aside><nav><a href="/">Dashboard</a>
<a href="/orders">All Orders</a><a class="nav active" href="/fulfillment-review">Fulfillment Review</a>
<a href="/tracking">Tracking</a></nav></aside><main>
<h1>Supplier Fulfillment Review</h1><p class="sub">__SHOP__ · Automatic live supplier recommendations · Human approval</p>
<div class="note">No supplier order is ever placed automatically. An approved Artelo order can be sent on its own from "Order status" below, only when its receipt is authorized in Render. Sensaria remains a manual CSV workflow. Live comparisons may include modeled shipping or contingency costs; verify the exact shipping address, product variant and final invoice before purchasing.</div>
<div class="card"><h2>Find an Etsy receipt</h2>
<div class="row"><input id="receipt" type="text" inputmode="numeric" placeholder="Etsy receipt ID" aria-label="Etsy receipt ID">
<button id="load">View recommendation</button><button id="prepare" class="primary">Refresh live supplier quote</button></div>
<p class="sub">Converted __PREFIX__ SKUs only. Legacy Gelato orders and multi-item orders stay in manual review.</p>
</div><div id="message" role="status">Eligible new paid orders are analyzed automatically. Open an Etsy receipt to view the recommended supplier.</div>
<section id="details" class="card" hidden><h2>Recommended supplier</h2><div id="plan"></div>
<div class="checks"><label><input type="checkbox" id="check-address"> I verified the full Etsy shipping address.</label>
<label><input type="checkbox" id="check-art"> I verified the production artwork and correct crop.</label>
<label><input type="checkbox" id="check-variant"> I verified the supplier, product, size, frame and variant.</label>
<label><input type="checkbox" id="check-price"> I verified the current supplier total and order margin.</label></div>
<button id="approve" class="primary">Approve for manual supplier placement</button>
<p class="sub">Approval does not buy anything or transmit customer details to a supplier.</p>
</section>
<section class="card"><h2>Order status</h2>
<p class="sub">Where this order is: imported, paid, recommended supplier, approval, supplier submission and supplier order ID. Diagnose and Preview only read.</p>
<div class="row"><button id="diagnose">Diagnose this order</button><button id="artelo-preview">Preview Artelo order</button><button id="artelo-verify">Check Artelo status</button></div>
<pre id="diagnosis" hidden style="white-space:pre-wrap;background:#f6f5f0;padding:12px;border-radius:8px;font-size:13px"></pre>
<div id="artelo-submit-box" hidden>
<p class="note">Sends this ONE order to Artelo for production and payment. It needs FULFILLMENT_LIVE_SUBMISSION_ENABLED and ARTELO_FULFILLMENT_ENABLED set to true and this receipt listed in SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS in Render. No other order is sent, and a failed or uncertain submission is never repeated on its own.</p>
<div class="checks"><label><input type="checkbox" id="artelo-dashboard"> I checked the Artelo dashboard and it has no order for this receipt.</label></div>
<div class="row"><input id="artelo-confirm" type="text" autocomplete="off" aria-label="Confirmation"><button id="artelo-submit" class="primary">Submit this order to Artelo</button></div>
</div>
</section></main></div><script>
(()=>{
const $=id=>document.getElementById(id),set=(id,v)=>$(id).textContent=String(v??'');
const report=(v,err)=>{$('message').textContent=v;$('message').className=err?'error':'';};
let plan=null,busy=false;
async function api(path,body){
 const opts=body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)};
 const res=await fetch(path,opts),data=await res.json().catch(()=>({error:'Invalid server response'}));
 if(!res.ok||data.ok===false)throw Error(data.error||'Request failed');
 return data;
}
async function run(fn){if(busy)return;busy=true;for(const x of document.querySelectorAll('button'))x.disabled=true;
 try{await fn()}catch(e){report(e.message||String(e),true)}finally{busy=false;for(const x of document.querySelectorAll('button'))x.disabled=false}}
function id(){const v=$('receipt').value.trim();if(!/^[1-9]\d{0,19}$/.test(v))throw Error('Enter a numeric Etsy receipt ID');return v}
function show(p){
 plan=p;$('details').hidden=!p;if(!p)return;
 const box=$('plan');box.replaceChildren();
 const headline=document.createElement('p');
 headline.textContent='Artwork '+p.artworkId+' · '+p.sku+' · '+p.countryCode+' · '+p.size+' in'+(p.frame?' · '+p.frame:'');
 const note=document.createElement('p');
 note.textContent='Lowest modeled eligible cost: '+p.provider+' ($'+p.modeledLandedUsd.toFixed(2)+' USD) · Quote $'+p.quotedTotalUsd.toFixed(2)+' USD.';
 const freshness=document.createElement('p');
 freshness.textContent='Production ratio '+p.assetRatio+' · Quote expires '+new Date(p.expiresAt).toLocaleString();
 const table=document.createElement('table');
 const head=document.createElement('tr');
 for(const label of ['Eligible provider','Quoted USD','Modeled landed USD']){const th=document.createElement('th');th.textContent=label;head.append(th)}table.append(head);
 for(const o of p.alternatives){
 const tr=document.createElement('tr');
 for(const value of [o.provider,'$'+o.quotedTotalUsd.toFixed(2),'$'+o.modeledLandedUsd.toFixed(2)]){const td=document.createElement('td');td.textContent=value;tr.append(td)}
 table.append(tr);
 }
 box.append(headline,note,freshness,table);
 for(const x of document.querySelectorAll('.checks input'))x.checked=false;
}
async function readRecommendation(){
 const d=await api('/api/fulfillment-review/'+id());
 const review=d.review||{},route=review.automaticRouting||{};
 show(review.regularPlan||null);
 if(review.status==='approved_for_manual_order'){
   $('approve').disabled=true;
   report('Approved for manual supplier placement. No supplier order has been submitted.');
 }else if(review.regularPlan){
   report(Date.now()>Date.parse(review.regularPlan.expiresAt)
     ? 'Recommendation expired. Choose Refresh live supplier quote before approval.'
     : 'Supplier recommendation prepared automatically. Verify the details before approving.');
 }else if(route.status==='manual_review'){
   report('Manual review required: '+(route.message||'Order or artwork validation failed.'),true);
 }else if(route.status==='retry'){
   report('Live supplier lookup pending retry: '+(route.message||'Temporary supplier error.'));
 }else{
   report('Paid order is awaiting automatic supplier recommendation. It will appear when the Etsy sync and live quote finish.');
 }
 return d;
}
$('load').addEventListener('click',()=>run(readRecommendation));
$('prepare').addEventListener('click',()=>run(async()=>{report('Refreshing paid receipt, verifying R2 crop and comparing suppliers…');const d=await api('/api/fulfillment-review/'+id()+'/prepare',{});
 show(d.plan);report('Quote prepared. No supplier order submitted. Verify all details before approval.');}));
$('approve').addEventListener('click',()=>run(async()=>{
 if(!plan)throw Error('Prepare a quote first');
 const checks=['address','art','variant','price'].map(k=>$('check-'+k).checked);
 if(!checks.every(Boolean))throw Error('Verify all four checks before approval.');
 if(!window.confirm('Approve '+plan.provider+' for MANUAL supplier placement? No purchase will be made.'))return;
 await api('/api/fulfillment-review/'+id()+'/approve',{confirm:'APPROVE FOR REVIEW',
 addressVerified:checks[0],artworkVerified:checks[1],variantVerified:checks[2],priceVerified:checks[3]});
 report('Approved for manual supplier placement. Nothing was purchased.');}));
// Order status: plain lines for the diagnosis and the Artelo preview.
const line=(label,value)=>label+': '+(value===''||value==null?'—':value);
function showDiagnosis(d){
 const s=d.submission;
 $('diagnosis').hidden=false;
 $('diagnosis').textContent=[
  line('Imported',d.imported?'yes · '+(d.importedAt||'')+' · '+(d.importSource||''):'no · '+(d.error||'')),
  line('Paid on Etsy',d.paid?'yes':'no'),line('Shipped / canceled',(d.shipped?'shipped':'not shipped')+' · '+(d.canceled?'canceled':'not canceled')),
  line('Listing / SKU',(d.listingId||'')+' · '+(d.sku||'')),line('Variations',(d.variations||[]).join('; ')),
  line('Product',d.product?d.product.productCode+' '+d.product.size+(d.product.frame?' '+d.product.frame:''):''),
  line('Artwork',d.artwork?d.artwork.key+' ('+d.artwork.width+'×'+d.artwork.height+', '+d.artwork.orientation+')':''),
  line('Destination',d.destination),line('Review status',d.reviewStatus),
  line('Selected supplier',d.plan?d.plan.provider+' · quote $'+d.plan.quotedTotalUsd:''),
  line('Approval',d.approval?(d.approval.method||'')+' · supplier order submitted: '+(d.approval.supplierOrderSubmitted?'yes':'no'):'none'),
  line('Supplier submission',s?s.provider+' · '+s.state+(s.lastError?' · '+s.lastError:''):'none (never sent to any supplier)'),
  line('Supplier order ID',d.supplierOrderId),
  line('Live submission',(d.liveSubmission.masterEnabled?'master on':'master off')+' · '+(d.liveSubmission.arteloEnabled?'Artelo on':'Artelo off')+' · '+(d.liveSubmission.receiptAuthorized?'receipt authorized':'receipt not authorized')+(d.liveSubmission.ignoredVariables.length?' · ignored: '+d.liveSubmission.ignoredVariables.join(', '):'')),
  d.liveSubmission.note,
  ...(d.problems.length?['Problems:',...d.problems.map(p=>' • '+p)]:['No problems found.'])
 ].join('\\n');
}
function showPreview(p){
 const a=p.payload?.customerAddress||{},item=p.payload?.items?.[0]?.productInfo||{},c=p.expectedCost||{},pc=c.arteloPriceCheck;
 $('diagnosis').hidden=false;
 $('diagnosis').textContent=[
  line('Artelo order reference',p.payload?.orderId),
  line('Product',[item.catalogProductId,item.paperType,item.frameStyle,item.size,item.orientation].filter(Boolean).join(' · ')),
  line('Artwork',p.artwork?p.artwork.key+' ('+p.artwork.width+'×'+p.artwork.height+')':''),
  line('Ship to',[a.name,a.street1,a.street2,a.city,a.state,a.zipcode,a.country].filter(Boolean).join(', ')),
  line('Approved quote','$'+c.approvedQuoteUsd+' (with reserve $'+c.approvedModeledUsd+')'),
  line('Artelo price check',pc?'$'+pc.total+' '+pc.currency+' = production $'+pc.productionCost+' + shipping $'+pc.shippingCost+' + tax $'+pc.taxes:'not run'),
  line('Submission record',p.submission?p.submission.provider+' · '+p.submission.state:'none'),
  ...(p.blockers.length?['Blocked:',...p.blockers.map(b=>' • '+b)]:['No blockers.']),
  ...(p.switches.length?['Not authorized yet:',...p.switches.map(b=>' • '+b)]:['Authorized for this one order.'])
 ].join('\\n');
 $('artelo-submit-box').hidden=Boolean(p.blockers.length);
 $('artelo-confirm').placeholder='Type '+p.confirmation;
}
$('diagnose').addEventListener('click',()=>run(async()=>{const d=await api('/api/fulfillment-review/'+id()+'/diagnose');showDiagnosis(d.diagnosis);report('Diagnosis loaded. Nothing was changed.');}));
$('artelo-preview').addEventListener('click',()=>run(async()=>{report('Checking the order and asking Artelo for its price (no order is created)…');const d=await api('/api/fulfillment-review/'+id()+'/artelo-preview');showPreview(d.preview);report(d.preview.ready?'Ready to submit this one order.':'Not ready to submit; see the list below. Nothing was sent.',!d.preview.ready&&d.preview.blockers.length>0);}));
$('artelo-verify').addEventListener('click',()=>run(async()=>{const d=await api('/api/fulfillment-review/'+id()+'/artelo-verify',{});report(d.found?'Artelo has this order ('+d.record.supplierOrderId+'): '+d.record.state+'.':(d.note||'Artelo has no order with the recorded ID.'));}));
$('artelo-submit').addEventListener('click',()=>run(async()=>{
 if(!$('artelo-dashboard').checked)throw Error('Check the Artelo dashboard first and tick the box.');
 if(!window.confirm('Send receipt '+id()+' to Artelo for production now? This places a real, paid order.'))return;
 const d=await api('/api/fulfillment-review/'+id()+'/artelo-submit',{confirm:$('artelo-confirm').value.trim(),arteloDashboardChecked:true});
 report('Submitted to Artelo: order '+(d.submission.supplierOrderId||'(no ID returned: check the dashboard)')+' · '+d.submission.state+'.');
 $('artelo-submit-box').hidden=true;}));
const preset=new URLSearchParams(location.search).get('receipt');
if(preset&&/^[1-9]\d{0,19}$/.test(preset)){
 $('receipt').value=preset;$('load').click();
 let attempts=0;const tick=setInterval(async()=>{
   if(++attempts>12||plan){clearInterval(tick);return;}
   try{const data=await readRecommendation();if(data.review?.automaticRouting?.status==='manual_review')clearInterval(tick);}
   catch{if(attempts>5)clearInterval(tick);}
 },10000);
}
})();
</script></body></html>`.replaceAll('__SHOP__',e(shop)).replaceAll('__PREFIX__','SAC');
}
