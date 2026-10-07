function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderShippingProfilePage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Silvia Shipping Profile</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#20221e;--muted:#74776f;--line:#dfdcd4;--green:#536454;--green2:#e8eee7;--amber:#946b35;--amber2:#f5ead9;--red:#934d45;--red2:#f7e7e4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:inherit;text-decoration:none}.shell{min-height:100vh;display:grid;grid-template-columns:238px 1fr}
aside{background:#252820;color:#f8f5ee;padding:28px 20px;display:flex;flex-direction:column}.brand{font-family:Georgia,serif;font-size:24px;line-height:1.08;margin-bottom:30px}.brand small{display:block;font-size:12px;color:#b9beb3;margin-top:8px}
nav{display:grid;gap:7px}.nav{padding:11px 12px;border-radius:9px;color:#cdd1c7;font-size:14px}.nav.active,.nav:hover{background:#373b33;color:#fff}.foot{margin-top:auto;color:#aeb3a8;font-size:12px;line-height:1.5}
main{padding:34px 38px 48px;max-width:1180px;width:100%;margin:auto}h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:38px;margin:0 0 8px}h2{font-size:23px;margin:0 0 5px}.sub{margin:0;color:var(--muted);font-size:14px}
.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:24px}.badge{border:1px solid var(--line);background:var(--panel);padding:8px 12px;border-radius:999px;font-size:12px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:22px;box-shadow:0 10px 28px rgba(40,40,30,.05)}
.section-sub{color:var(--muted);font-size:13px;margin:0 0 18px}.form{display:grid;gap:15px}.twocol{display:grid;grid-template-columns:1fr 1fr;gap:14px}
label{display:grid;gap:7px;font-size:12px;font-weight:650}.hint{font-weight:400;color:var(--muted)}input{width:100%;border:1px solid var(--line);border-radius:10px;background:#fff;padding:11px 12px;font:inherit;color:var(--ink)}
input:focus{outline:2px solid #cfd9cf;border-color:#9bab9b}.btn{border:0;border-radius:10px;background:#30352e;color:#fff;padding:12px 15px;font-weight:700;cursor:pointer}.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}.btn:disabled{opacity:.55;cursor:not-allowed}
.status{padding:12px;border-radius:10px;background:#f7f4ee;border:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.5}.status.ok{background:var(--green2);color:var(--green)}.status.warn{background:var(--amber2);color:var(--amber)}.status.error{background:var(--red2);color:var(--red)}
.market-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.market{display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:10px;padding:10px;background:#fff;font-size:13px}.market input{width:auto;margin:0}
.actions{display:flex;gap:10px;flex-wrap:wrap}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.list{display:grid;gap:8px}.item{padding:10px;border-radius:9px;background:#f7f4ee;border:1px solid var(--line);font-size:12px;line-height:1.45}
@media(max-width:920px){.grid{grid-template-columns:1fr}.market-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:720px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:24px 18px}.top{flex-direction:column}.market-grid,.twocol{grid-template-columns:1fr}h1{font-size:32px}}
</style>
</head>
<body>
<div class="shell">
<aside>
  <div class="brand">Silvia<br>Fulfillment <small>Etsy → Sensaria</small></div>
  <nav>
    <a class="nav" href="/">Dashboard</a>
    <a class="nav" href="/product-creator">Product Creator</a>
    <a class="nav" href="/listing-converter">Gelato → Silvia Converter</a>
    <a class="nav active" href="/shipping-profile">Shipping Profile</a>
    <a class="nav" href="/pricing">Pricing & Shipping</a>
    <a class="nav" href="/compare">Supplier Comparison</a>
    <a class="nav" href="/custom-size">Custom Size Lookup</a>
    <a class="nav" href="/description-updater">Description Updater</a>
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
    <div><h1>Etsy shipping profile</h1><p class="sub">Create the Silvia free-shipping profile directly in Etsy and use it automatically for new app-created listings.</p></div>
    <div class="badge" id="scope-badge">Checking Etsy permissions…</div>
  </div>

  <div class="grid">
    <section class="card">
      <h2>Silvia Sensaria Free Shipping</h2>
      <p class="section-sub">The preset below intentionally excludes Everywhere Else and the high-cost markets we removed. All selected destinations are free shipping on Etsy; Sensaria shipping remains your fulfillment cost.</p>

      <form id="profile-form" class="form">
        <label>Profile title
          <input id="title" value="Silvia Sensaria Free Shipping" maxlength="100" readonly>
        </label>

        <div class="twocol">
          <label>Ships from
            <input value="Canada" readonly>
          </label>
          <label>Origin postal code
            <input id="origin_postal_code" class="mono" placeholder="Enter your Canadian postal code" required>
          </label>
        </div>

        <div class="twocol">
          <label>Canada delivery time <span class="hint">transit only</span>
            <input id="domestic_days" value="2–6 business days" readonly>
          </label>
          <label>International delivery time <span class="hint">transit only</span>
            <input id="international_days" value="2–6 business days" readonly>
          </label>
        </div>

        <div>
          <div style="font-size:12px;font-weight:650;margin-bottom:8px">Destinations</div>
          <div class="market-grid" id="market-grid"></div>
        </div>

        <div class="status">
          <strong>Pricing:</strong> Free shipping to every selected destination. This profile controls what the buyer sees on Etsy; it does not change Sensaria's actual shipping charge.
        </div>

        <div class="actions">
          <button class="btn" id="create-btn" type="submit" disabled>Create Etsy Shipping Profile</button>
          <button class="btn secondary" id="select-all" type="button">Select all preset markets</button>
        </div>
        <div class="status" id="result">Loading the Etsy profile status…</div>
      </form>

    </section>

    <section class="card">
      <h2>App behavior</h2>
      <p class="section-sub">Once created, this profile becomes the default shipping profile for new Silvia drafts made by Product Creator.</p>
      <div class="list">
        <div class="item"><strong>No Everywhere Else.</strong><br>Only the checked countries are included.</div>
        <div class="item"><strong>Existing Etsy listings are not changed.</strong><br>This controls new listings created by the app. You can bulk-apply the new profile to older listings in Etsy later if wanted.</div>
        <div class="item"><strong>shops_w permission required.</strong><br>If the badge says reconnect, use the button below and save the new Etsy refresh token in Render.</div>
      </div>
      <button class="btn secondary" type="button" style="width:100%;margin-top:14px" onclick="location.href='/etsy/connect'">Reconnect Etsy</button>
    </section>
  </div>
</main>
</div>

<script>
const badge=document.getElementById('scope-badge');
const result=document.getElementById('result');
const createButton=document.getElementById('create-btn');
const marketGrid=document.getElementById('market-grid');
const titleInput=document.getElementById('title');
const postalInput=document.getElementById('origin_postal_code');
let preset=[];

function escHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))}
function renderMarkets(items){
  preset=items||[];
  marketGrid.innerHTML=preset.map(x=>'<label class="market"><input type="checkbox" name="market" value="'+escHtml(x.countryIso)+'" checked><span>'+escHtml(x.name)+'</span></label>').join('');
}
function selectedMarkets(){return Array.from(document.querySelectorAll('input[name="market"]:checked')).map(x=>x.value)}
document.getElementById('select-all').addEventListener('click',()=>document.querySelectorAll('input[name="market"]').forEach(x=>x.checked=true));

async function load(){
  try{
    const r=await fetch('/api/shipping-profile',{cache:'no-store'});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not load shipping profile settings.');
    titleInput.value=d.defaults?.title||titleInput.value;
    if(d.shopPostalCode)postalInput.value=d.shopPostalCode;
    renderMarkets(d.defaults?.destinations||[]);
    const scopes=new Set(String(d.scopes||'').trim().split(' ').map(x=>x.trim()).filter(Boolean));
    if(!scopes.has('shops_w')){
      badge.textContent='Reconnect Etsy · shops_w needed';
      result.className='status warn';
      result.innerHTML='Etsy is connected, but the current token does not include <strong>shops_w</strong>.<br><br><strong>Current token scopes:</strong> <span class="mono">'+escHtml(d.scopes||'(none returned)')+'</span><br><br>Reconnect Etsy, save the new refresh token in Render, then return here.';
      createButton.disabled=true;
      return;
    }
    badge.textContent='Etsy shop access ready';
    createButton.disabled=false;
    const domestic=d.defaults?.domesticDelivery||{minDays:2,maxDays:6};
    const international=d.defaults?.internationalDelivery||{minDays:2,maxDays:6};
    document.getElementById('domestic_days').value=domestic.minDays+'–'+domestic.maxDays+' business days';
    document.getElementById('international_days').value=international.minDays+'–'+international.maxDays+' business days';

    if(d.managedProfile){
      result.className='status ok';
      result.innerHTML='<strong>Managed profile already exists.</strong><br>'+escHtml(d.managedProfile.title)+' · Profile ID '+escHtml(d.managedProfile.shipping_profile_id)+'. Press Update to sync the existing Etsy profile to the current Silvia shipping settings.';
      createButton.textContent='Update Etsy Shipping Profile';
      createButton.disabled=false;
    }else{
      result.className='status';
      result.textContent='Ready to create the profile in Etsy.';
      createButton.textContent='Create Etsy Shipping Profile';
    }
  }catch(error){
    badge.textContent='Etsy setup needs attention';
    result.className='status error';
    result.textContent=error.message||String(error);
  }
}

document.getElementById('profile-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const destinations=selectedMarkets();
  if(!destinations.length){result.className='status error';result.textContent='Select at least one destination.';return;}
  createButton.disabled=true;
  const updating=createButton.textContent.includes('Update');
  createButton.textContent=updating?'Updating Etsy…':'Creating in Etsy…';
  result.className='status';
  result.textContent=(updating?'Updating the existing shipping profile for ':'Creating the shipping profile and ')+destinations.length+' destinations…';
  try{
    const r=await fetch('/api/shipping-profile',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        title:'Silvia Sensaria Free Shipping',
        origin_postal_code:postalInput.value.trim(),
        destinations
      })
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not create Etsy shipping profile.');
    result.className='status ok';
    if(d.updatedExisting){
      result.innerHTML='<strong>Existing shipping profile updated.</strong><br>Profile ID '+escHtml(d.shippingProfileId)+' · '+escHtml(d.destinationCount)+' destinations · free shipping · 2–6 business day transit.';
      createButton.textContent='Updated';
    }else{
      result.innerHTML='<strong>Shipping profile created.</strong><br>Profile ID '+escHtml(d.shippingProfileId)+' · '+escHtml(d.destinationCount)+' destinations · free shipping. Product Creator will now select it automatically.';
      createButton.textContent='Created';
    }
  }catch(error){
    result.className='status error';
    result.textContent=error.message||String(error);
    createButton.disabled=false;
    createButton.textContent=updating?'Update Etsy Shipping Profile':'Create Etsy Shipping Profile';
  }
});


load();
</script>
</body>
</html>`;
}
