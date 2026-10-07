export function renderTestOrderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Silvia Test Order</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#20221e;--muted:#74776f;--line:#dfdcd4;--green:#536454;--green2:#e8eee7;--amber:#946b35;--amber2:#f5ead9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}.shell{max-width:980px;margin:0 auto;padding:34px 22px 50px}h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:38px;margin:0 0 8px}.sub{color:var(--muted);font-size:14px;margin:0 0 22px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:22px;box-shadow:0 10px 28px rgba(40,40,30,.05)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:grid;gap:7px;font-size:12px;font-weight:650}input,select{width:100%;border:1px solid var(--line);border-radius:10px;background:#fff;padding:11px 12px;font:inherit}.btn{margin-top:18px;border:0;border-radius:10px;background:#30352e;color:#fff;padding:12px 15px;font-weight:700;cursor:pointer}.btn:disabled{opacity:.55}.notice{margin-bottom:18px;padding:12px 14px;border-radius:10px;background:var(--amber2);color:var(--amber);font-size:12px;line-height:1.45}.result{display:none;margin-top:18px;padding:15px;border-radius:10px;background:#f7f4ee;border:1px solid var(--line);font-size:12px;line-height:1.5}.result.show{display:block}.ok{background:var(--green2);color:var(--green)}pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px;max-height:360px;overflow:auto}.toplink{display:inline-block;margin-bottom:18px;color:var(--muted);font-size:13px}@media(max-width:700px){.grid{grid-template-columns:1fr}h1{font-size:32px}}

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

</style>
</head>
<body><div class="app-shell">
<aside class="app-sidebar">
  <div class="brand">Silvia<br>Fulfillment <small>Etsy → Sensaria</small></div>
  <nav>
    <a class="nav" href="/">Dashboard</a>
    <a class="nav" href="/product-creator">Product Creator</a>
    <a class="nav" href="/listing-converter">Gelato → Silvia Converter</a>
    <a class="nav" href="/shipping-profile">Shipping Profile</a>
    <a class="nav" href="/pricing">Pricing & Shipping</a>
    <a class="nav" href="/compare">Supplier Comparison</a>
    <a class="nav active" href="/test-order">Test Order</a>
    <a class="nav" href="/#orders">Orders</a>
    <a class="nav" href="/#artworks">Artwork Library</a>
    <a class="nav" href="/#mappings">Product SKUs</a>
    <a class="nav" href="/etsy/status" target="_blank">Etsy Status</a>
    <a class="nav" href="/r2/status" target="_blank">R2 Status</a>
    <a class="nav" href="/logout">Log out</a>
  </nav>
  <div class="foot">Silvia Art Collective<br>Private fulfillment service</div>
</aside>
<main class="shell">
<h1>Dry-run test order</h1>
<p class="sub">Validate the Sensaria GO order mapping and generate a checkout/shipping-test CSV without placing an Etsy order or sending anything to manufacturing.</p>
<div class="notice"><strong>Safe test mode.</strong> References always begin with TEST-. This test resolves the SAC SKU to the real Sensaria GO Product Code and builds the exact GO Batch Upload CSV using the existing master-artwork URL. It deliberately skips the heavy production render, so Canvas and Framed Canvas tests should return quickly and can be used to check Sensaria shipping prices. Nothing is submitted automatically.</div>
<section class="card">
<div class="grid">
<label>Artwork ID<input id="artworkId" placeholder="SAC0001" value="SAC0001"></label>
<label>Product<select id="format"><option value="P">Matte Paper Poster</option><option value="C">Canvas</option><option value="FC">Framed Canvas</option></select></label>
<label>Size<select id="size"><option>8x10</option><option>11x14</option><option selected>12x16</option><option>12x18</option><option>16x20</option><option>16x24</option><option>18x24</option><option>24x36</option><option>30x40</option><option>40x60</option></select></label>
<label id="frameLabel" style="display:none">Frame<select id="frame"><option value="NAT">Natural Oak</option><option value="BRN">Dark Walnut</option><option value="BLK">Matte Black</option><option value="WHT">White</option></select></label>
<label>Orientation<select id="orientation"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
<label>Quantity<input id="quantity" type="number" min="1" max="10" value="1"></label>
</div>
<button class="btn" id="run">Generate shipping-test CSV</button>
<div class="result" id="result"></div>
</section>
<script>
const format=document.getElementById('format'),frameLabel=document.getElementById('frameLabel'),run=document.getElementById('run'),result=document.getElementById('result');
function syncFrame(){frameLabel.style.display=format.value==='FC'?'grid':'none'}format.addEventListener('change',syncFrame);syncFrame();
run.addEventListener('click',async()=>{
 run.disabled=true;result.className='result show';result.textContent='Building GO shipping-test row…';
 try{
  const payload={artworkId:document.getElementById('artworkId').value,format:format.value,size:document.getElementById('size').value,frame:document.getElementById('frame').value,orientation:document.getElementById('orientation').value,quantity:Number(document.getElementById('quantity').value||1)};
  const r=await fetch('/api/test-order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const raw=await r.text();let d;try{d=JSON.parse(raw)}catch{throw new Error('Unreadable server response (HTTP '+r.status+').')}
  if(!r.ok)throw new Error(d.error||'Test failed');
  result.className='result show ok';
  const p=d.production||{};
  const output=p.output||{};
  result.innerHTML='<strong>PASS — '+d.reference+'</strong><br>SAC SKU: '+d.sku+'<br>Sensaria GO Product Code: '+d.productCode+'<br>Shipping Type: '+d.shippingType+(d.wrapType?'<br>Wrap Type: '+d.wrapType:'')+'<br>Production spec: '+(p.kind||'')+(output.width?' · '+output.width+'×'+output.height+' px':'')+(p.dpi?' · '+p.dpi+' DPI':'')+'<br>Dry-run render: skipped (prevents Render 502 / no manufacturing submission)<br>Source R2 object: '+(d.sourceKey||'')+'<h2>Sensaria GO Batch CSV preview</h2><pre></pre>';
  result.querySelector('pre').textContent=d.csv;
 }catch(e){result.className='result show';result.textContent=e.message||String(e)}finally{run.disabled=false}
});
</script>
</main></body></html>`;
}
