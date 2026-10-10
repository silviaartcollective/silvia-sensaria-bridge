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
<h1>Supplier Fulfillment Review</h1><p class="sub">__SHOP__ · Paid Etsy orders · Prepared quotes · Human approval</p>
<div class="note">Review mode only. No supplier orders are placed from this page. Sensaria remains a manual CSV workflow. Live comparisons may include modeled shipping or contingency costs; verify the exact shipping address, product variant and final invoice before purchasing.</div>
<div class="card"><h2>Find an Etsy receipt</h2>
<div class="row"><input id="receipt" type="text" inputmode="numeric" placeholder="Etsy receipt ID" aria-label="Etsy receipt ID">
<button id="load">Load receipt</button><button id="prepare" class="primary">Prepare supplier comparison</button></div>
<p class="sub">Converted __PREFIX__ SKUs only. Legacy Gelato orders and multi-item orders stay in manual review.</p>
</div><div id="message" role="status">Enter a receipt ID, or open this page from All Orders.</div>
<section id="details" class="card" hidden><h2>Recommended supplier</h2><div id="plan"></div>
<div class="checks"><label><input type="checkbox" id="check-address"> I verified the full Etsy shipping address.</label>
<label><input type="checkbox" id="check-art"> I verified the production artwork and correct crop.</label>
<label><input type="checkbox" id="check-variant"> I verified the supplier, product, size, frame and variant.</label>
<label><input type="checkbox" id="check-price"> I verified the current supplier total and order margin.</label></div>
<button id="approve" class="primary">Approve for manual supplier placement</button>
<p class="sub">Approval does not buy anything or transmit customer details to a supplier. A submission workflow will be added only after provider-specific production testing.</p>
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
$('load').addEventListener('click',()=>run(async()=>{const d=await api('/api/fulfillment-review/'+id());show(d.review?.regularPlan||null);
 report(d.review?.regularPlan?'Existing plan loaded. Check approval state and quote time.':'Receipt loaded. Select Prepare supplier comparison to check current providers.');}));
$('prepare').addEventListener('click',()=>run(async()=>{report('Reading paid receipt, verifying R2 crop and comparing suppliers…');const d=await api('/api/fulfillment-review/'+id()+'/prepare',{});
 show(d.plan);report('Quote prepared. No supplier order submitted. Verify all details before approval.');}));
$('approve').addEventListener('click',()=>run(async()=>{
 if(!plan)throw Error('Prepare a quote first');
 const checks=['address','art','variant','price'].map(k=>$('check-'+k).checked);
 if(!checks.every(Boolean))throw Error('Verify all four checks before approval.');
 if(!window.confirm('Approve '+plan.provider+' for MANUAL supplier placement? No purchase will be made.'))return;
 await api('/api/fulfillment-review/'+id()+'/approve',{confirm:'APPROVE FOR REVIEW',
 addressVerified:checks[0],artworkVerified:checks[1],variantVerified:checks[2],priceVerified:checks[3]});
 report('Approved for manual supplier placement. Nothing was purchased.');}));
const preset=new URLSearchParams(location.search).get('receipt');
if(preset&&/^[1-9]\d{0,19}$/.test(preset)){$('receipt').value=preset;$('load').click();}
})();
</script></body></html>`.replaceAll('__SHOP__',e(shop)).replaceAll('__PREFIX__','SAC');
}
