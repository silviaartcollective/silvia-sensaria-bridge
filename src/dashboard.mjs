function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderDashboard({
  mappingCount,
  mappedSizeCount,
  unresolvedSizes,
  webhookConfigured,
  r2Configured
}) {
  const unresolved = unresolvedSizes.length
    ? unresolvedSizes.map((item) => `<span class="chip warn">${esc(item)}</span>`).join('')
    : '<span class="chip">No required gaps</span>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Silvia Fulfillment Bridge</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#20221e;--muted:#74776f;--line:#dfdcd4;--green:#536454;--green2:#e8eee7;--amber:#946b35;--amber2:#f5ead9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:inherit;text-decoration:none}.shell{min-height:100vh;display:grid;grid-template-columns:238px 1fr}
aside{background:#252820;color:#f8f5ee;padding:28px 20px;display:flex;flex-direction:column}.brand{font-family:Georgia,serif;font-size:24px;line-height:1.08;margin-bottom:30px}.brand small{display:block;font-size:12px;color:#b9beb3;margin-top:8px}
nav{display:grid;gap:7px}.nav{padding:11px 12px;border-radius:9px;color:#cdd1c7;font-size:14px}.nav.active,.nav:hover{background:#373b33;color:#fff}.foot{margin-top:auto;color:#aeb3a8;font-size:12px;line-height:1.5}
main{padding:34px 38px 48px;max-width:1450px;width:100%;margin:auto}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:26px}
h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:38px;margin:0 0 7px}h2{font-size:23px;margin:0 0 5px}.sub{margin:0;color:var(--muted);font-size:14px}
.live{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:9px 13px;font-size:13px;display:flex;gap:8px;align-items:center}.dot,.s-dot{width:8px;height:8px;border-radius:50%;background:#65806a}.dot{box-shadow:0 0 0 4px #e6eee5}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:18px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:20px;box-shadow:0 10px 28px rgba(40,40,30,.05)}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:12px}.big{font-family:Georgia,serif;font-size:28px;margin-bottom:7px}.status{display:flex;gap:7px;align-items:center;color:var(--muted);font-size:12px}.status.warn .s-dot{background:#b17d3d}
.layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:18px}.section-sub{color:var(--muted);font-size:13px;margin:0 0 15px}
.row{display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:center;padding:14px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}.icon{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--green2);color:var(--green);font-weight:700}.icon.pending{background:var(--amber2);color:var(--amber)}
.row-title{font-size:14px;font-weight:650}.row-sub{font-size:12px;color:var(--muted);margin-top:3px}.pill{font-size:11px;padding:6px 9px;border-radius:999px;background:var(--green2);color:var(--green)}.pill.pending{background:var(--amber2);color:var(--amber)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.chip{padding:7px 9px;border-radius:8px;background:var(--green2);color:var(--green);font-size:12px}.chip.warn{background:var(--amber2);color:var(--amber)}
.actions{display:grid;gap:9px;margin-top:18px}.btn{display:flex;justify-content:center;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:white;font-size:13px;font-weight:650}.btn.primary{background:#30352e;color:#fff;border-color:#30352e}
.notice{margin-top:15px;padding:12px 13px;border:1px solid var(--line);border-radius:10px;background:#f7f4ee;color:var(--muted);font-size:12px;line-height:1.45}
.spinner{width:12px;height:12px;border:2px solid #d4d7d0;border-top-color:#657467;border-radius:50%;display:inline-block;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:1050px){.cards{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}}@media(max-width:720px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:24px 18px}.cards{grid-template-columns:1fr}.top{flex-direction:column}h1{font-size:32px}}
</style>
</head>
<body>
<div class="shell">
<aside>
  <div class="brand">Silvia<br>Fulfillment <small>Etsy → Sensaria</small></div>
  <nav>
    <a class="nav active" href="/">Dashboard</a>
    <a class="nav" href="/product-creator">Product Creator</a>
    <a class="nav" href="/listing-converter">Gelato → Silvia Converter</a>
    <a class="nav" href="/shipping-profile">Shipping Profile</a>
    <a class="nav" href="/pricing">Pricing & Shipping</a>
    <a class="nav" href="/compare">Supplier Comparison</a>
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
  <div class="top">
    <div><h1>Fulfillment dashboard</h1><p class="sub">Private Etsy → Sensaria production and fulfillment bridge.</p></div>
    <div class="live"><span class="dot"></span> Service live</div>
  </div>

  <section class="cards">
    <div class="card">
      <div class="eyebrow">Etsy</div><div class="big" id="etsy-title">Checking…</div>
      <div class="status" id="etsy-status"><span class="spinner"></span><span>Verifying shop</span></div>
    </div>
    <div class="card">
      <div class="eyebrow">Sensaria SKUs</div><div class="big">${mappingCount}</div>
      <div class="status"><span class="s-dot"></span><span>Manufacturing configurations loaded</span></div>
    </div>
    <div class="card" id="orders">
      <div class="eyebrow">Orders</div><div class="big">Not active</div>
      <div class="status warn"><span class="s-dot"></span><span>Webhook + test order still required</span></div>
    </div>
    <div class="card" id="artworks">
      <div class="eyebrow">Artwork storage</div>
      <div class="big" id="r2-title">${r2Configured ? 'Checking…' : 'Not configured'}</div>
      <div class="status ${r2Configured ? '' : 'warn'}" id="r2-status">${r2Configured ? '<span class="spinner"></span><span>Checking private R2 bucket</span>' : '<span class="s-dot"></span><span>R2 variables missing</span>'}</div>
    </div>
  </section>

  <section class="layout">
    <div class="card">
      <h2>Setup progress</h2><p class="section-sub">The bridge stays non-live until the full production path is verified.</p>
      <div class="row"><div class="icon">✓</div><div><div class="row-title">Render service</div><div class="row-sub">Backend deployed and responding.</div></div><span class="pill">Ready</span></div>
      <div class="row"><div class="icon">✓</div><div><div class="row-title">Etsy OAuth</div><div class="row-sub">SilviaArtCollective authorized for transaction read/write.</div></div><span class="pill">Ready</span></div>
      <div class="row"><div class="icon">✓</div><div><div class="row-title">Sensaria product SKUs</div><div class="row-sub">${mappingCount} configurations across ${mappedSizeCount} currently mapped sizes.</div></div><span class="pill">Loaded</span></div>
      <div class="row"><div class="icon ${r2Configured ? '' : 'pending'}">${r2Configured ? '✓' : '4'}</div><div><div class="row-title">Artwork production storage</div><div class="row-sub">Private Cloudflare R2 bucket for SAC masters and production files.</div></div><span class="pill ${r2Configured ? '' : 'pending'}">${r2Configured ? 'Configured' : 'Pending'}</span></div>
      <div class="row"><div class="icon pending">5</div><div><div class="row-title">Etsy order webhook</div><div class="row-sub">Receive paid Etsy orders automatically.</div></div><span class="pill ${webhookConfigured ? '' : 'pending'}">${webhookConfigured ? 'Configured' : 'Pending'}</span></div>
      <div class="row"><div class="icon pending">6</div><div><div class="row-title">Production test</div><div class="row-sub">Verify one real poster/canvas order before enabling live fulfillment.</div></div><span class="pill pending">Pending</span></div>
    </div>

    <div class="card" id="mappings">
      <h2>Manufacturing coverage</h2>
      <p class="section-sub">Sensaria FriendlySKU coverage is separate from the artwork templates.</p>
      <div class="chips"><span class="chip">Matte Poster Paper</span><span class="chip">Canvas</span><span class="chip">Framed Canvas</span><span class="chip">40×60 canvas</span></div>
      <div class="eyebrow" style="margin-top:22px">Still needs Sensaria SKU</div>
      <div class="chips">${unresolved}</div>
      <div class="actions"><a class="btn primary" href="/listing-converter">Convert existing Gelato listings</a><a class="btn" href="/test-order">Run dry test order</a><a class="btn" href="/r2/status" target="_blank">Check R2 storage</a><a class="btn" href="/etsy/status" target="_blank">Check Etsy connection</a></div>
      <div class="notice">No Etsy order is being submitted to Sensaria yet. Live fulfillment stays disabled until artwork preparation, webhooks and a test order are complete.</div>
    </div>
  </section>
</main>
</div>
<script>
(async()=>{
  const t=document.getElementById('etsy-title'),s=document.getElementById('etsy-status');
  try{const r=await fetch('/etsy/status',{cache:'no-store'}),d=await r.json();if(r.ok&&d.connected){t.textContent=d.shopName||'Connected';s.className='status';s.innerHTML='<span class="s-dot"></span><span>Connected · Shop ID '+String(d.shopId||'')+'</span>'}else throw new Error()}catch{t.textContent='Needs attention';s.className='status warn';s.innerHTML='<span class="s-dot"></span><span>Etsy connection check failed</span>'}

  const rt=document.getElementById('r2-title'),rs=document.getElementById('r2-status');
  if(rt&&rs&&rt.textContent!=='Not configured'){try{const r=await fetch('/r2/status',{cache:'no-store'}),d=await r.json();if(r.ok&&d.connected){rt.textContent=d.bucket||'Connected';rs.className='status';rs.innerHTML='<span class="s-dot"></span><span>Private R2 storage connected</span>'}else throw new Error()}catch{rt.textContent='Needs attention';rs.className='status warn';rs.innerHTML='<span class="s-dot"></span><span>R2 connection failed</span>'}}
})();
</script>
</body></html>`;
}
