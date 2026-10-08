// Read-only, authenticated operational checks. Never submits a supplier order.
export function renderReadinessPage(shopName) {
  const shop = String(shopName || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${shop} · System Readiness</title>
<style>
:root{--bg:#f4f1eb;--white:#fffdfa;--ink:#242921;--muted:#686d63;--line:#e1ddd5;--green:#415b47;--warn:#a06a36;--red:#9d4038}
*{box-sizing:border-box}body{background:var(--bg);color:var(--ink);margin:0;font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
.shell{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100vh}
aside{padding:24px;background:#252820;color:white}nav{display:grid;gap:6px}.nav{color:white;text-decoration:none;padding:9px}
main{padding:34px;max-width:1480px;width:100%;min-width:0}
h1{font:normal 38px/1.15 Georgia,serif;margin:0 0 8px}h2{font:normal 22px Georgia,serif;margin:0 0 16px}
.sub{color:var(--muted);margin:0 0 23px}
.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 22px}
button,.btn{border:1px solid #c9cfc5;border-radius:8px;background:#fff;padding:10px 15px;cursor:pointer;font:inherit;color:#28352c;text-decoration:none}
.primary{background:#303a30;border-color:#303a30;color:#fff}
button:disabled{opacity:.6;cursor:wait}
.columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.card{background:var(--white);border:1px solid var(--line);border-radius:14px;padding:22px;min-width:0}
.check{display:flex;gap:14px;justify-content:space-between;align-items:center;padding:11px 0;border-top:1px solid var(--line)}
.check:first-of-type{border-top:0}
.check strong{display:block}.detail{font-size:12px;color:var(--muted);max-width:56ch;overflow-wrap:anywhere}
.result{font-weight:650;font-size:12px;border-radius:30px;padding:6px 11px;background:#e9ebe6;color:#3a5140;white-space:nowrap}
.result.warn{background:#f5ece0;color:var(--warn)}.result.error{background:#fae8e5;color:var(--red)}
.result.checking{background:#e8ebee;color:#526572}
.provider{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.provider > .actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end}
.provider button{padding:7px 10px;font-size:12px}
.note{border-left:3px solid #8a9887;padding:12px 16px;background:#e8eee7;color:#39473c;margin:22px 0 0}
#page-status{color:var(--muted)}
@media(max-width:900px){.columns{grid-template-columns:1fr}main{padding:20px 15px 55px}.shell{grid-template-columns:1fr}aside{display:none}h1{font-size:30px}}
</style></head><body><div class="shell"><aside><nav><a class="nav active" href="/readiness">System Readiness</a></nav></aside>
<main><h1>System readiness</h1><p class="sub">${shop} · Live connection diagnostics and order workflow checks.</p>
<div class="toolbar"><button class="primary" id="refresh">Refresh readiness</button>
<button id="test-all">Test all supplier connections</button><a class="btn" href="/orders">All Orders</a>
<a class="btn" href="/custom-orders">Custom Orders</a><a class="btn" href="/test-order">Dry-run Test Order</a></div>
<p id="page-status" role="status">Checking systems…</p>
<div class="columns">
<section class="card"><h2>Order infrastructure</h2>
<div class="check"><div><strong>Etsy authorization</strong><div class="detail" id="etsy-detail">Validates the linked shop and credentials</div></div><span id="etsy-result" class="result checking">Checking</span></div>
<div class="check"><div><strong>Etsy webhook configuration</strong><div class="detail" id="webhook-detail">A configured secret does not prove event delivery</div></div><span id="webhook-result" class="result checking">Checking</span></div>
<div class="check"><div><strong>Cloudflare R2</strong><div class="detail" id="r2-detail">Production artwork and staged receipt storage</div></div><span id="r2-result" class="result checking">Checking</span></div>
<div class="check"><div><strong>Artwork media presets</strong><div class="detail" id="presets-detail">Checks the preset media catalog</div></div><span id="presets-result" class="result checking">Checking</span></div>
<div class="check"><div><strong>Order inbox</strong><div class="detail" id="orders-detail">Reads staged Etsy receipts without submitting orders</div></div><span id="orders-result" class="result checking">Checking</span></div>
<div class="check"><div><strong>Tracking</strong><div class="detail" id="tracking-detail">Checks the tracking dashboard data source</div></div><span id="tracking-result" class="result checking">Checking</span></div>
</section>
<section class="card"><h2>Suppliers & fulfillment</h2>
<div class="check"><div><strong>Safety mode</strong><div class="detail" id="mode-detail">Live submission must remain off until an authorized end-to-end production test</div></div><span id="mode-result" class="result checking">Checking</span></div>
<div class="check"><div><strong>Supplier registry</strong><div class="detail" id="provider-detail">Credentials present is different from passing a connection test</div></div><span id="provider-result" class="result checking">Checking</span></div>
<div id="provider-list"></div>
</section></div>
<p class="note">Connection tests are read-only and do not place supplier orders, change Etsy listings, or enable automatic fulfillment. A successful check still does not substitute for reviewing one real paid order, its artwork, exact size, shipping quote, and tracking.</p>
</main></div>
<script>
(()=>{
 const byId=id=>document.getElementById(id);
 const providers=['Sensaria','Prodigi','Artelo','PrintShrimp','Printify','Gelato'];
 function result(id,message,kind,detail) {
   const tag=byId(id+'-result'); if(tag){tag.textContent=message;tag.className='result '+(kind||'');}
   if(detail!=null){const d=byId(id+'-detail');if(d)d.textContent=String(detail);}
 }
 async function request(url,init){
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...(init||{})});
   let data;try{data=await response.json()}catch{throw new Error('Invalid server response');}
   if(!response.ok||data.ok===false)throw new Error(data.error||'HTTP '+response.status);
   return data;
 }
 async function check(id,url,predicate,goodText,detailFn){
   result(id,'Checking','checking');
   try{const data=await request(url);const ok=predicate(data);
     result(id,ok?goodText:'Needs attention',ok?'':'warn',detailFn?detailFn(data):null);return ok;
   }catch(error){result(id,'Error','error',error.message);return false;}
 }
 function createSuppliers(){
   const host=byId('provider-list');host.replaceChildren();
   for(const name of providers){
     const row=document.createElement('div');row.className='provider';
     const label=document.createElement('strong');label.textContent=name;
     const actions=document.createElement('div');actions.className='actions';
     const badge=document.createElement('span');badge.className='result checking';badge.id='supplier-'+name;badge.textContent='Not tested';
     const button=document.createElement('button');button.type='button';button.textContent='Test connection';
     button.addEventListener('click',()=>testSupplier(name,button));
     actions.append(badge,button);row.append(label,actions);host.append(row);
   }
 }
 async function testSupplier(name,button){
   const badge=byId('supplier-'+name);button.disabled=true;badge.className='result checking';badge.textContent='Testing…';
   try{const data=await request('/api/providers/test',{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({provider:name.toLowerCase()})});
     badge.className='result '+(data.ok===true?'':'warn');
     badge.textContent=data.ok===true?'Connected':'Needs attention';
     if(data.error||data.reason)badge.title=String(data.error||data.reason);
   }catch(error){badge.className='result error';badge.textContent='Failed';badge.title=error.message;}
   finally{button.disabled=false;}
 }
 async function refresh(){
   byId('refresh').disabled=true;byId('page-status').textContent='Checking current service status…';
   const basic=await check('webhook','/api/status',d=>d.webhookConfigured===true,'Configured',d=>d.webhookConfigured?'Secret configured; receipt delivery still requires verification':'ETSY_WEBHOOK_SECRET missing');
   const tasks=[
     check('etsy','/etsy/status',d=>d.connected===true,'Connected',d=>d.shopName?d.shopName+' (Shop '+d.shopId+')':'Shop authorization could not be verified'),
     check('r2','/r2/status',d=>d.connected===true,'Connected',d=>d.connected?'R2 bucket reachable':'R2 connection unavailable'),
     check('presets','/api/presets/status',d=>d.configured===true,'Ready',d=>d.configured?'Required media are present':'Some preset media is missing or not ready'),
     check('orders','/api/orders',d=>Array.isArray(d.orders),'Available',d=>String(d.count||0)+' staged receipt(s)'+(d.truncated?' (more available)':'')),
     check('tracking','/api/tracking/orders',d=>d.ok===true,'Available',()=> 'Tracking data endpoint responded'),
   ];
   const providerState=await check('provider','/api/providers/status',d=>Boolean(d.providers),'Loaded',d=>d.providers?Object.keys(d.providers).length+' suppliers registered':'Supplier registry unavailable');
   await check('mode','/api/providers/status',d=>d.masterLiveSubmissionEnabled===false,'Review-only',d=>'Mode: '+String(d.fulfillmentMode||'unknown')+' · Live submission: '+(d.masterLiveSubmissionEnabled?'enabled':'disabled'));
   const others=await Promise.all(tasks);
   const count=others.filter(Boolean).length+Number(basic)+Number(providerState);
   byId('page-status').textContent='Read-only readiness checks completed: '+count+'/7 core checks passed. Supplier connections require individual tests.';
   byId('refresh').disabled=false;
 }
 byId('refresh').addEventListener('click',refresh);
 byId('test-all').addEventListener('click',async()=>{
   byId('test-all').disabled=true;
   try{for(const name of providers){
     const badge=byId('supplier-'+name),row=badge.closest('.provider'),button=row.querySelector('button');
     await testSupplier(name,button);
   }}finally{byId('test-all').disabled=false;}
 });
 createSuppliers();refresh();
})();
</script></body></html>`;
}
