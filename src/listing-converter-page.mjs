export function renderListingConverterPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Gelato → Silvia Converter</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#20221e;--muted:#74776f;--line:#dfdcd4;--green:#536454;--green2:#e8eee7;--amber:#946b35;--amber2:#f5ead9;--red:#9b4439}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}.shell{max-width:1500px;margin:0 auto;padding:34px 24px 55px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:20px}.toplinks{display:flex;gap:10px;flex-wrap:wrap}.btn,a.btn{border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);padding:10px 13px;font:inherit;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer}.btn.primary{background:#30352e;color:#fff;border-color:#30352e}.btn:disabled{opacity:.5;cursor:not-allowed}h1{font-family:Georgia,serif;font-weight:500;font-size:38px;margin:0 0 7px}.sub{margin:0;color:var(--muted);font-size:14px;line-height:1.55}.statusbar{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:14px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:18px}.status{font-size:12px;color:var(--muted);line-height:1.5}.status.ok{color:var(--green)}.status.bad{color:var(--red)}.status.warn{color:var(--amber)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;overflow:hidden;box-shadow:0 10px 28px rgba(40,40,30,.05)}.preview{aspect-ratio:4/3;background:#ebe8e1;display:grid;place-items:center;overflow:hidden}.preview img{width:100%;height:100%;object-fit:cover}.preview .empty{font-size:12px;color:var(--muted)}.body{padding:15px}.title{font-weight:700;font-size:14px;line-height:1.4;margin-bottom:6px}.meta{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:11px}.pill{font-size:10px;padding:5px 7px;border-radius:999px;background:#f1eee8;color:var(--muted)}.pill.done{background:var(--green2);color:var(--green)}.pill.warn{background:var(--amber2);color:var(--amber)}.upload{display:grid;gap:9px;margin-top:11px}.upload input[type=file]{width:100%;font-size:12px}.progress{height:6px;background:#e7e3dc;border-radius:99px;overflow:hidden}.progress span{display:block;width:0;height:100%;background:#667867;transition:width .2s}.cardstatus{font-size:11px;line-height:1.45;color:var(--muted);min-height:34px}.cardstatus.ok{color:var(--green)}.cardstatus.bad{color:var(--red)}.cardstatus.warn{color:var(--amber)}.search{width:min(460px,100%);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit}
@media(max-width:1050px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.grid{grid-template-columns:1fr}.top{flex-direction:column}h1{font-size:31px}}
</style>
</head>
<body>
<main class="shell">
  <div class="top">
    <div>
      <h1>Gelato → Silvia listing converter</h1>
      <p class="sub">Choose the existing Etsy listing by its first mockup, upload the matching master artwork, and the app will assign the next SAC ID, store it in Cloudflare R2, run the shared cropper, replace the Gelato variants with Silvia variants/SKUs and apply the current Silvia price ladder. Existing Etsy title, description, tags, photos and video stay in place.</p>
    </div>
    <div class="toplinks"><a class="btn" href="/">Dashboard</a><a class="btn" href="/pricing">Pricing</a></div>
  </div>

  <div class="statusbar">
    <div><strong>Shared crop worker</strong><div class="status" id="worker-status">Checking worker…</div></div>
    <button class="btn primary" id="launch-worker" type="button">Launch Shared Crop Worker</button>
  </div>

  <div class="statusbar">
    <input class="search" id="search" placeholder="Search listing title or Etsy listing ID">
    <div class="status" id="list-status">Loading Etsy listings…</div>
    <button class="btn" id="refresh" type="button">Refresh listings</button>
  </div>

  <section class="grid" id="cards"></section>
</main>

<script>
const cards=document.getElementById('cards');
const listStatus=document.getElementById('list-status');
const workerStatus=document.getElementById('worker-status');
const search=document.getElementById('search');
const refresh=document.getElementById('refresh');
const launchWorker=document.getElementById('launch-worker');
let listingData=[];

const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function detectOrientation(file){
  try{
    const bitmap=await createImageBitmap(file);
    const orientation=bitmap.width===bitmap.height?'square':bitmap.width>bitmap.height?'landscape':'portrait';
    bitmap.close();
    return orientation;
  }catch{return 'portrait'}
}

async function putFile(url,file,onProgress){
  onProgress(20);
  const response=await fetch(url,{method:'PUT',headers:{'content-type':file.type||'image/jpeg'},body:file});
  if(!response.ok)throw new Error('Cloudflare upload failed ('+response.status+')');
  onProgress(65);
}

async function waitForCrop(jobId,setStatus,setProgress){
  for(let attempt=0;attempt<240;attempt+=1){
    const r=await fetch('/api/crop-jobs/'+encodeURIComponent(jobId),{cache:'no-store'});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not read crop job');
    const job=d.job||{};
    const progress=Number(job.progressPercent||job.progress||0);
    setProgress(Math.max(68,Math.min(94,progress||72)));
    if(job.status==='completed')return d;
    if(job.status==='failed')throw new Error(job.error||'Crop worker failed');
    setStatus('Cropping '+String(job.currentRatio||'production ratios')+'… '+(progress?String(progress)+'%':''));
    await sleep(1500);
  }
  throw new Error('Crop job is still running. Leave the worker open and try again.');
}

async function refreshWorker(){
  try{
    const r=await fetch('/api/crop-worker/status',{cache:'no-store'});
    const d=await r.json();
    if(!r.ok)throw new Error();
    const w=d.worker||{};
    if(w.online){
      workerStatus.className='status ok';
      workerStatus.textContent=w.busy?'Online · currently cropping':'Online · ready';
    }else{
      workerStatus.className='status warn';
      workerStatus.textContent='Offline · launch it before converting a listing';
    }
  }catch{
    workerStatus.className='status bad';
    workerStatus.textContent='Could not read crop worker status';
  }
}

launchWorker.addEventListener('click',()=>{
  window.location.href='pod-crop-worker://start';
  setTimeout(refreshWorker,1800);
});

function renderCards(){
  const q=search.value.trim().toLowerCase();
  cards.innerHTML='';
  const visible=listingData.filter(item=>!q||String(item.title||'').toLowerCase().includes(q)||String(item.listingId).includes(q));
  listStatus.textContent=visible.length+' of '+listingData.length+' Etsy listings shown';

  for(const item of visible){
    const card=document.createElement('article');
    card.className='card';
    const mapped=item.artworkId?'<span class="pill done">'+esc(item.artworkId)+'</span>':'<span class="pill warn">Gelato / not linked</span>';
    const state='<span class="pill">'+esc(item.state||'')+'</span>';
    const image=item.firstImageUrl?'<img src="'+esc(item.firstImageUrl)+'" alt="">':'<div class="empty">No listing image</div>';

    card.innerHTML=
      '<div class="preview">'+image+'</div>'+
      '<div class="body">'+
        '<div class="title">'+esc(item.title||'Untitled listing')+'</div>'+
        '<div class="meta">'+state+mapped+'<span class="pill">#'+esc(item.listingId)+'</span></div>'+
        '<div class="upload">'+
          '<input class="master" type="file" accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff" '+(item.converted?'disabled':'')+'>'+
          '<button class="btn primary convert" type="button" '+(item.converted?'disabled':'')+'>'+(item.converted?'Converted to Silvia':'Upload artwork & convert')+'</button>'+
          '<div class="progress"><span></span></div>'+
          '<div class="cardstatus '+(item.converted?'ok':'')+'">'+(item.converted?'Linked to '+esc(item.artworkId)+' · Silvia variants active.':'Select the master artwork that belongs to this listing.')+'</div>'+
        '</div>'+
      '</div>';

    const button=card.querySelector('.convert');
    if(!item.converted)button.addEventListener('click',()=>convertListing(item,card));
    cards.appendChild(card);
  }
}

async function convertListing(item,card){
  const input=card.querySelector('.master');
  const button=card.querySelector('.convert');
  const status=card.querySelector('.cardstatus');
  const bar=card.querySelector('.progress span');
  const file=input.files?.[0];

  if(!file){
    status.className='cardstatus bad';
    status.textContent='Choose the matching master artwork first.';
    return;
  }

  const confirmed=confirm(
    'Convert this Etsy listing to the Silvia system?\\n\\n'+
    item.title+'\\n\\n'+
    'The listing stays live/draft as it is. Its existing photos, video, title, description and tags stay in place. Its variants, SKUs, pricing and Silvia structural settings will be replaced after the artwork crop finishes.'
  );
  if(!confirmed)return;

  button.disabled=true;
  input.disabled=true;
  bar.style.width='5%';

  try{
    const orientation=await detectOrientation(file);
    status.className='cardstatus';
    status.textContent='Reserving the next SAC artwork ID…';

    let r=await fetch('/api/listing-converter/reserve',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({listingId:item.listingId,orientation,master:{filename:file.name,contentType:file.type||'image/jpeg',size:file.size}})
    });
    let d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not reserve artwork');
    const artworkId=d.artworkId;

    status.textContent='Uploading '+artworkId+' master to Cloudflare R2…';
    await putFile(d.upload.uploadUrl,file,p=>{bar.style.width=p+'%'});

    r=await fetch('/api/artworks/'+encodeURIComponent(artworkId)+'/complete',{method:'POST'});
    d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not finalize artwork upload');
    bar.style.width='68%';

    status.textContent='Queueing production crops for '+artworkId+'…';
    r=await fetch('/api/crop-jobs',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({artworkId,orientation})
    });
    d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not queue crop job');

    if(!d.worker?.online){
      status.className='cardstatus warn';
      status.textContent='Artwork uploaded as '+artworkId+'. The shared crop worker is offline — launch it above. Conversion will continue when the crop job finishes.';
    }

    await waitForCrop(d.job.id,text=>{status.textContent=text},p=>{bar.style.width=p+'%'});

    status.className='cardstatus';
    status.textContent='Crops ready. Replacing Gelato variants with Silvia variants and SKUs…';
    r=await fetch('/api/listing-converter/convert',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({listingId:item.listingId,artworkId})
    });
    d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not convert Etsy listing');

    bar.style.width='100%';
    status.className='cardstatus ok';
    status.textContent='Converted · '+artworkId+' · '+String(d.enabledVariants||0)+' Silvia variants verified.';
    button.textContent='Converted to Silvia';
    item.artworkId=artworkId;
    item.converted=true;
    setTimeout(loadListings,900);
  }catch(error){
    status.className='cardstatus bad';
    status.textContent=String(error.message||error);
    button.disabled=false;
    input.disabled=false;
  }
}

async function loadListings(){
  refresh.disabled=true;
  listStatus.className='status';
  listStatus.textContent='Loading Etsy listings and first mockups…';
  try{
    const r=await fetch('/api/listing-converter/listings',{cache:'no-store'});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not load listings');
    listingData=d.listings||[];
    renderCards();
  }catch(error){
    listStatus.className='status bad';
    listStatus.textContent=String(error.message||error);
  }finally{
    refresh.disabled=false;
  }
}

search.addEventListener('input',renderCards);
refresh.addEventListener('click',loadListings);
refreshWorker();
loadListings();
setInterval(refreshWorker,12000);
</script>
</body>
</html>`;
}
