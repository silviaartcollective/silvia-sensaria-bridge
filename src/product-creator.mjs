function esc(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

export function renderProductCreator() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Silvia Product Creator</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#20221e;--muted:#74776f;--line:#dfdcd4;--green:#536454;--green2:#e8eee7;--amber:#946b35;--amber2:#f5ead9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:inherit;text-decoration:none}.shell{min-height:100vh;display:grid;grid-template-columns:238px 1fr}
aside{background:#252820;color:#f8f5ee;padding:28px 20px;display:flex;flex-direction:column}.brand{font-family:Georgia,serif;font-size:24px;line-height:1.08;margin-bottom:30px}.brand small{display:block;font-size:12px;color:#b9beb3;margin-top:8px}
nav{display:grid;gap:7px}.nav{padding:11px 12px;border-radius:9px;color:#cdd1c7;font-size:14px}.nav.active,.nav:hover{background:#373b33;color:#fff}.foot{margin-top:auto;color:#aeb3a8;font-size:12px;line-height:1.5}
main{padding:34px 38px 48px;max-width:1200px;width:100%;margin:auto}h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:38px;margin:0 0 8px}.sub{margin:0;color:var(--muted);font-size:14px}
.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:24px}.badge{border:1px solid var(--line);background:var(--panel);padding:8px 12px;border-radius:999px;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 340px;gap:18px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:22px;box-shadow:0 10px 28px rgba(40,40,30,.05)}
h2{font-size:23px;margin:0 0 5px}.section-sub{color:var(--muted);font-size:13px;margin:0 0 18px}.form{display:grid;gap:15px}.twocol{display:grid;grid-template-columns:1fr 1fr;gap:14px}
label{display:grid;gap:7px;font-size:12px;font-weight:650}.hint{font-weight:400;color:var(--muted)}
input,textarea,select{width:100%;border:1px solid var(--line);border-radius:10px;background:#fff;padding:11px 12px;font:inherit;color:var(--ink)}textarea{min-height:160px;resize:vertical}
input:focus,textarea:focus,select:focus{outline:2px solid #cfd9cf;border-color:#9bab9b}.btn{border:0;border-radius:10px;background:#30352e;color:#fff;padding:12px 15px;font-weight:700;cursor:pointer}.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}.btn:disabled{opacity:.55;cursor:not-allowed}
.stack{display:grid;gap:10px}.status{padding:12px;border-radius:10px;background:#f7f4ee;border:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.45}.status.ok{background:var(--green2);color:var(--green)}.status.warn{background:var(--amber2);color:var(--amber)}
.chips{display:flex;flex-wrap:wrap;gap:7px}.chip{font-size:11px;padding:6px 8px;border-radius:8px;background:var(--green2);color:var(--green)}
.result{display:none;margin-top:14px;padding:14px;border-radius:10px;border:1px solid var(--line);background:#f7f4ee;font-size:13px;line-height:1.5}.result.show{display:block}
.uploadbox{border:1px dashed #cfc9be;border-radius:12px;padding:16px;background:#faf8f3;display:grid;gap:12px}.uploadrow{display:grid;grid-template-columns:1fr 1fr;gap:12px}.uploadmeta{font-size:11px;color:var(--muted);line-height:1.45}.progress{height:7px;background:#e8e3d9;border-radius:999px;overflow:hidden}.progress>span{display:block;height:100%;width:0;background:#697969;transition:width .2s ease}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
@media(max-width:900px){.grid{grid-template-columns:1fr}.twocol{grid-template-columns:1fr}}@media(max-width:720px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:24px 18px}.top{flex-direction:column}h1{font-size:32px}}
</style>
</head>
<body>
<div class="shell">
<aside>
  <div class="brand">Silvia<br>Fulfillment <small>Etsy → Sensaria</small></div>
  <nav>
    <a class="nav" href="/">Dashboard</a>
    <a class="nav active" href="/product-creator">Product Creator</a>
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
    <div><h1>Product Creator</h1><p class="sub">Create a physical Etsy draft from the Silvia fulfillment app.</p></div>
    <div class="badge" id="scope-badge">Checking Etsy permissions…</div>
  </div>

  <div class="grid">
    <section class="card">
      <h2>Listing details</h2>
      <p class="section-sub">Your structural Etsy settings are preloaded automatically. Title, SEO description and tags stay unique to each artwork.</p>
      <form class="form" id="creator-form">
        <div class="status ok" id="preset-summary">Loading Silvia Etsy defaults…</div>

        <div class="uploadbox">
          <div>
            <strong>Artwork + listing media</strong>
            <div class="uploadmeta">The app assigns the next SAC artwork ID, renames the files from that ID, uploads them to private Cloudflare R2, and queues 2:3, 3:4, 4:5, and 11:14 production crops for the Silvia workstation.</div>
          </div>
          <div class="twocol">
            <label>Artwork ID <span class="hint">assigned automatically</span><input id="artwork_id" class="mono" readonly placeholder="Assigned after upload"></label>
            <label>Orientation
              <select id="orientation"><option>Portrait</option><option>Landscape</option><option>Square</option></select>
            </label>
          </div>
          <div class="uploadrow">
            <label>Master artwork
              <input id="master_file" type="file" accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff">
            </label>
            <label>Artwork mockups
              <input id="mockup_files" type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp">
            </label>
          </div>
          <div class="uploadmeta">Upload only the artwork-specific mockups here. The 3 reusable shop mockups and 1 listing video are appended automatically from the preset library.</div>
          <div class="progress"><span id="upload-progress"></span></div>
          <div class="status" id="upload-status">Choose the master artwork and artwork mockups. They upload to R2 automatically, then attach to the Etsy draft with the preset media.</div>
          <div class="actions"><a class="btn secondary" id="launch-crop-worker" href="pod-crop-worker://start">Launch Shared Crop Worker</a></div>
          <div class="status" id="crop-worker-status">Production crops will be queued after the master artwork finishes uploading.</div>
        </div>

        <div class="uploadbox" id="preset-media-box">
          <div>
            <strong>Reusable Etsy preset media</strong>
            <div class="uploadmeta">One-time setup only. These 3 images + 1 video are stored once in R2 and automatically added to every future listing.</div>
          </div>
          <div class="uploadrow">
            <label>Install preset files once
              <input id="preset_files" type="file" multiple accept="image/jpeg,image/png,video/quicktime,video/mp4,.jpg,.jpeg,.png,.mov,.mp4">
            </label>
            <button type="button" id="install-presets-btn">Install preset media</button>
          </div>
          <div class="status" id="preset-media-status">Checking preset media…</div>
        </div>

        <div class="uploadbox">
          <label>Paste SEO Generator Output <span class="hint">optional — fills the three SEO fields below</span>
            <textarea id="seo_generator_output" placeholder="Paste the complete SEO output here..."></textarea>
          </label>
          <button class="btn secondary" id="apply-seo-btn" type="button">Apply SEO Output</button>
          <div class="uploadmeta">The creator reads SEO Title, Short SEO Description, MORE ART FROM SILVIA ART COLLECTIVE, Homestyle (1), and SEO Tags (13). Homestyle is applied automatically to the Etsy listing.</div>
        </div>
        <label>Etsy title<input id="title" maxlength="140" required placeholder="Enter the SEO title for this artwork"></label>
        <label>Short SEO Description <span class="hint">placed below ABOUT THIS ARTWORK</span><textarea id="seo_description" required placeholder="Paste the Short SEO Description from your SEO generator..."></textarea></label>
        <input id="seo_section_name" type="hidden">
        <input id="seo_section_url" type="hidden">
        <input id="homestyle" type="hidden">
        <div class="status" id="homestyle-status" style="display:none"></div>
        <label>SEO tags <span class="hint">13 comma-separated Etsy tags</span><input id="tags" placeholder="silvia wall art, neutral wall art, ..."></label>
        <div class="status ok">
          <strong>Variants are automatic and owned by this app.</strong><br>
          Etsy uses <strong>Size</strong> first and <strong>Product - Style</strong> second. Product names are Matte Paper Poster, Canvas, and Framed Canvas by frame finish. Pricing uses the approved Silvia regular CAD ladder converted to USD at 1 USD = 1.39 CAD. The whole shop's 25% Etsy sale is applied separately, and each valid variant gets a new SAC SKU. No previous Etsy listing is used as the variant template.
        </div>
        <div class="twocol">
          <label>Etsy category <span class="hint">preset</span><input id="category_name" value="Wall Decor" readonly></label>
          <label>Shipping profile
            <select id="shipping_profile_id" required><option value="">Loading…</option></select>
          </label>
        </div>
        <div class="twocol">
          <label>Processing profile
            <select id="readiness_state_id" required><option value="">Loading…</option></select>
          </label>
          <label>Shop section
            <select id="shop_section_id"><option value="">Loading…</option></select>
          </label>
        </div>
        <div class="twocol">
          <label>Return policy
            <select id="return_policy_id"><option value="">Loading…</option></select>
          </label>
          <label>Production partner
            <select id="production_partner_id"><option value="">Loading…</option></select>
          </label>
        </div>
        <div class="twocol">
          <label>Who made it
            <select id="who_made">
              <option value="i_did">I did</option>
              <option value="collective">A member of my shop</option>
              <option value="someone_else">Another company or person</option>
            </select>
          </label>
          <label>When made
            <select id="when_made">
              <option value="made_to_order">Made to order</option>
              <option value="2020_2026">2020–2026</option>
            </select>
          </label>
        </div>
        <div class="twocol">
          <label>Finished product
            <select id="is_supply"><option value="false">Yes — finished product</option><option value="true">No — supply</option></select>
          </label>
          <label>Auto renew
            <select id="should_auto_renew"><option value="true">On</option><option value="false">Off</option></select>
          </label>
        </div>
        <button class="btn" id="create-btn" type="submit" disabled>Create Etsy Draft</button>
      </form>
      <div class="result" id="result"></div>
    </section>

    <aside-card class="card">
      <h2>Planned products</h2>
      <p class="section-sub">The creator will use the Sensaria-connected catalog.</p>
      <div class="chips"><span class="chip">Matte Paper Poster</span><span class="chip">Canvas</span><span class="chip">Framed Canvas</span><span class="chip">40×60 Canvas</span></div>
      <div class="status" style="margin-top:16px">
        Fixed listing defaults from your automation: Wall Decor, Paper + Archival paper + Canvas + Wood, Art deco, Housewarming, Bathroom + Bedroom + Entryway + Kitchen & dining + Living room, Made to order 5–7 days, AI generator, Automatic renewal.
      </div>
      <div class="status" style="margin-top:12px">
        Your standard Etsy description is preset. The Short SEO Description is placed under ABOUT THIS ARTWORK, and the matching section name + link are placed under MORE ART FROM SILVIA ART COLLECTIVE.
      </div>
      <div class="status warn" id="reauth-box" style="display:none;margin-top:12px">
        Etsy needs the new listing permissions. <a href="/etsy/connect"><strong>Reconnect Etsy</strong></a>, then save the new refresh token in Render.
      </div>
      <button class="btn secondary" type="button" style="margin-top:14px;width:100%" onclick="location.href='/etsy/connect'">Reconnect Etsy</button>
    </aside-card>
  </div>
</main>
</div>

<script>
const form=document.getElementById('creator-form');
const button=document.getElementById('create-btn');
const result=document.getElementById('result');
const badge=document.getElementById('scope-badge');
const reauth=document.getElementById('reauth-box');
const shipping=document.getElementById('shipping_profile_id');
const readiness=document.getElementById('readiness_state_id');
const section=document.getElementById('shop_section_id');
const returnPolicy=document.getElementById('return_policy_id');
const productionPartner=document.getElementById('production_partner_id');
const uploadStatus=document.getElementById('upload-status');
const uploadProgress=document.getElementById('upload-progress');
const masterFileInput=document.getElementById('master_file');
const mockupFilesInput=document.getElementById('mockup_files');
const applySeoButton=document.getElementById('apply-seo-btn');
const seoGeneratorOutput=document.getElementById('seo_generator_output');
const presetFilesInput=document.getElementById('preset_files');
const installPresetsButton=document.getElementById('install-presets-btn');
const presetMediaStatus=document.getElementById('preset-media-status');
const launchCropWorkerButton=document.getElementById('launch-crop-worker');
const cropWorkerStatus=document.getElementById('crop-worker-status');

async function readJsonResponse(response,context){
  const raw=await response.text();
  if(!raw.trim())return {};
  try{return JSON.parse(raw)}catch(error){
    const looksHtml=/^\s*<!doctype html|^\s*<html/i.test(raw);
    if(looksHtml){
      const status=response.status?('HTTP '+response.status):'an unexpected response';
      throw new Error((context||'The Silvia app')+' received an HTML page instead of JSON ('+status+'). This normally means Render was restarting or returned a temporary gateway page. Wait for the current deploy to finish, then press Create Etsy Draft again; the app will resume the existing SAC draft instead of intentionally starting a new one.');
    }
    throw new Error((context||'The Silvia app')+' returned an unreadable response'+(response.status?' (HTTP '+response.status+')':'')+'.');
  }
}

function normalizedSeoLine(value){
  return String(value||'')
    .normalize('NFKC')
    .replace(/[*_#:—–-]+/g,' ')
    .replace(/\\s+/g,' ')
    .trim()
    .toLowerCase();
}

function seoLines(text){
  return String(text||'').split(/\\r?\\n/);
}

function blockAfterHeading(text,labels,stopLabels){
  const lines=seoLines(text);
  const normalizedLabels=labels.map(normalizedSeoLine);
  const normalizedStops=stopLabels.map(normalizedSeoLine);
  let start=-1;

  for(let i=0;i<lines.length;i++){
    const current=normalizedSeoLine(lines[i]);
    if(normalizedLabels.includes(current)){
      start=i+1;
      break;
    }
  }
  if(start<0)return '';

  const collected=[];
  for(let i=start;i<lines.length;i++){
    const current=normalizedSeoLine(lines[i]);
    if(current && normalizedStops.includes(current))break;
    collected.push(lines[i]);
  }
  return collected.join('\\n').trim();
}

function firstNonEmptyLine(value){
  return String(value||'').split(/\\r?\\n/).map(x=>x.trim()).find(Boolean)||'';
}

function applySeoOutput(){
  const text=seoGeneratorOutput.value.trim();
  if(!text)return;

  const title=firstNonEmptyLine(blockAfterHeading(
    text,
    ['SEO Title'],
    ['Short SEO Description','ABOUT THIS ARTWORK','MORE ART FROM SILVIA ART COLLECTIVE','Homestyle (1)','SEO Tags (13)']
  ));

  const description=blockAfterHeading(
    text,
    ['Short SEO Description','ABOUT THIS ARTWORK'],
    ['MORE ART FROM SILVIA ART COLLECTIVE','Homestyle (1)','SEO Tags (13)']
  );

  const moreArt=blockAfterHeading(
    text,
    ['MORE ART FROM SILVIA ART COLLECTIVE'],
    ['Homestyle (1)','SEO Tags (13)']
  );
  const moreArtLines=moreArt.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);
  const sectionName=moreArtLines.find(x=>!/^https?:\\/\\//i.test(x))||'';
  const sectionUrl=moreArtLines.find(x=>/^https?:\\/\\//i.test(x))||'';

  const homestyle=firstNonEmptyLine(blockAfterHeading(
    text,
    ['Homestyle (1)','Homestyle'],
    ['SEO Tags (13)']
  ));

  const tags=blockAfterHeading(
    text,
    ['SEO Tags (13)','SEO Tags'],
    []
  ).split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean).join(' ');

  if(title)document.getElementById('title').value=title.replace(/^[-•]\\s*/,'').trim();
  if(description)document.getElementById('seo_description').value=description.trim();
  if(sectionName)document.getElementById('seo_section_name').value=sectionName;
  if(sectionUrl)document.getElementById('seo_section_url').value=sectionUrl;
  if(homestyle){
    document.getElementById('homestyle').value=homestyle;
    const hs=document.getElementById('homestyle-status');
    hs.style.display='block';
    hs.className='status ok';
    hs.innerHTML='<strong>Homestyle:</strong> '+homestyle+' · will be applied automatically to Etsy';
  }
  if(tags)document.getElementById('tags').value=tags.replace(/^[-•]\\s*/,'').trim();

  if(sectionName){
    const target=Array.from(section.options).find(o=>o.textContent.trim().toLowerCase()===sectionName.toLowerCase());
    if(target)section.value=target.value;
  }
}
applySeoButton.addEventListener('click',applySeoOutput);

function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o)}
function setSelect(select,value){if(value!==undefined&&value!==null&&value!=='')select.value=String(value)}
function applyPreset(preset){
  if(!preset)return;
  setSelect(shipping,preset.shipping_profile_id);
  setSelect(readiness,preset.readiness_state_id);
  setSelect(section,preset.shop_section_id);
  setSelect(returnPolicy,preset.return_policy_id);
  setSelect(productionPartner,preset.production_partner_id);
  setSelect(document.getElementById('who_made'),preset.who_made||'i_did');
  setSelect(document.getElementById('when_made'),preset.when_made||'made_to_order');
  document.getElementById('is_supply').value=String(Boolean(preset.is_supply));
  document.getElementById('should_auto_renew').value=String(preset.should_auto_renew!==false);
}

async function mapLimit(items,limit,worker){
  const values=Array.from(items||[]);
  let cursor=0;
  async function run(){
    while(true){
      const index=cursor++;
      if(index>=values.length)return;
      await worker(values[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.max(1,Math.min(limit,values.length||1))},()=>run()));
}

async function putFile(url,file,contentType){
  let r;
  try{
    r=await fetch(url,{
      method:'PUT',
      headers:{'content-type':contentType||file.type||'application/octet-stream'},
      body:file
    });
  }catch(error){
    throw new Error('Cloudflare R2 upload could not start for '+file.name+'. This usually means the R2 CORS rule is missing or does not allow this app origin.');
  }
  if(!r.ok){
    let detail='';
    try{detail=(await r.text()).slice(0,240)}catch{}
    throw new Error('Cloudflare R2 upload failed for '+file.name+' ('+r.status+')'+(detail?' · '+detail:''));
  }
}

launchCropWorkerButton?.addEventListener('click',()=>{
  cropWorkerStatus.className='status';
  cropWorkerStatus.textContent='Crop Worker launch requested. It will claim any queued Silvia crop jobs.';
});

async function readCropJob(jobId){
  const r=await fetch('/api/crop-jobs/'+encodeURIComponent(jobId),{cache:'no-store'});
  return readJsonResponse(r,'Crop job status');
}

async function watchCropJob(jobId){
  for(let attempt=0;attempt<80;attempt++){
    try{
      const d=await readCropJob(jobId);
      const job=d.job||{};
      const worker=d.worker||{};
      if(job.status==='completed'){
        cropWorkerStatus.className='status ok';
        cropWorkerStatus.textContent='POD production crops ready: '+Object.keys(job.resultAssets||{}).join(', ')+'.';
        return;
      }
      if(job.status==='failed'){
        cropWorkerStatus.className='status warn';
        cropWorkerStatus.textContent='POD crop job failed: '+String(job.error||job.message||'unknown error');
        return;
      }
      if(job.status==='pending'&&!worker.configured){
        cropWorkerStatus.className='status warn';
        cropWorkerStatus.textContent='Crop job queued, but CROP_WORKER_TOKEN is not configured in Render yet.';
        return;
      }
      if(job.status==='pending'&&!worker.online){
        cropWorkerStatus.className='status warn';
        cropWorkerStatus.textContent='Crop job queued. Launch the Shared POD Crop Worker on your PC to generate the ratio files.';
      }else{
        cropWorkerStatus.className='status';
        cropWorkerStatus.textContent=String(job.message||'Generating POD production crops…')+' '+String(job.progress||0)+'%';
      }
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
}

async function queueCropJob(artworkId){
  const r=await fetch('/api/crop-jobs',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      artworkId,
      orientation:document.getElementById('orientation').value
    })
  });
  const d=await readJsonResponse(r,'Crop job queue');
  if(!r.ok)throw new Error(d.error||'Could not queue POD production crops');
  const job=d.job||{};
  const worker=d.worker||{};
  if(worker.online){
    cropWorkerStatus.className='status';
    cropWorkerStatus.textContent='Shared POD Crop Worker connected. Production crops queued.';
  }else if(worker.configured){
    cropWorkerStatus.className='status warn';
    cropWorkerStatus.textContent='Production crops queued. Launch the Shared POD Crop Worker on your PC.';
  }else{
    cropWorkerStatus.className='status warn';
    cropWorkerStatus.textContent='Production crops queued, but CROP_WORKER_TOKEN still needs to be configured in Render.';
  }
  if(job.id) watchCropJob(job.id);
  return d;
}

async function uploadArtworkToR2(){
  let existingId=document.getElementById('artwork_id').value.trim();

  if(existingId){
    try{
      const check=await fetch('/api/artworks/'+encodeURIComponent(existingId)+'/complete',{method:'POST'});
      if(check.ok){
        // Re-queue idempotently so an earlier upload whose crop queue failed
        // can repair itself without forcing the artwork to be uploaded again.
        try{ await queueCropJob(existingId); }catch{}
        return existingId;
      }
    }catch{}
    try{
      await fetch('/api/artworks/'+encodeURIComponent(existingId)+'/cancel',{method:'POST'});
    }catch{}
    document.getElementById('artwork_id').value='';
    existingId='';
  }

  let reservedArtworkId='';
  const master=masterFileInput.files?.[0];
  const media=Array.from(mockupFilesInput.files||[]);
  if(!master)throw new Error('Choose a master artwork file first.');

  uploadProgress.style.width='3%';
  uploadStatus.className='status';
  uploadStatus.textContent='Reserving the next artwork ID…';

  try{
    let reserve;
    try{
      reserve=await fetch('/api/artworks/reserve',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
        title:document.getElementById('title').value.trim(),
        orientation:document.getElementById('orientation').value,
        master:{filename:master.name,contentType:master.type,size:master.size},
        mockups:media.map(f=>({filename:f.name,contentType:f.type,size:f.size}))
        })
      });
    }catch(error){
      throw new Error('Could not contact the Silvia app while reserving the artwork ID.');
    }
    const data=await readJsonResponse(reserve,'Artwork reservation');
    if(!reserve.ok)throw new Error(data.error||'Could not reserve artwork ID');

    reservedArtworkId=data.artworkId;
    document.getElementById('artwork_id').value=data.artworkId;
    uploadStatus.textContent='Uploading master artwork as '+data.artworkId+'…';
    uploadProgress.style.width='10%';

    const uploads=data.uploads.mockups||[];
    const uploadTasks=[
      {file:master,uploadUrl:data.uploads.master.uploadUrl,contentType:data.uploads.master.contentType},
      ...uploads.map((item)=>{
        const file=media[item.originalIndex];
        if(!file)throw new Error('Could not match media file '+String(item.originalFilename||item.index));
        return {file,uploadUrl:item.uploadUrl,contentType:item.contentType};
      })
    ];
    let completedUploads=0;
    await mapLimit(uploadTasks,4,async(task)=>{
      await putFile(task.uploadUrl,task.file,task.contentType);
      completedUploads+=1;
      uploadStatus.textContent='Uploading artwork files '+completedUploads+' of '+uploadTasks.length+'…';
      uploadProgress.style.width=String(10+Math.round((completedUploads/uploadTasks.length)*75))+'%';
    });

    uploadStatus.textContent='Confirming files in R2…';
    const complete=await fetch('/api/artworks/'+encodeURIComponent(data.artworkId)+'/complete',{
      method:'POST',
      headers:{}
    });
    const completed=await readJsonResponse(complete,'Artwork upload confirmation');
    if(!complete.ok)throw new Error(completed.error||'Could not complete artwork upload');

    let ratioSummary='';
    try{
      uploadStatus.textContent='Queueing POD production crops…';
      uploadProgress.style.width='92%';
      const queued=await queueCropJob(data.artworkId);
      const job=queued.job||{};
      ratioSummary='<br>POD crop job: '+String(job.status||'queued')+
        (job.id?' · '+String(job.id):'')+'.';
    }catch(error){
      ratioSummary='<br>POD crop queue needs attention: '+String(error?.message||error);
    }

    uploadProgress.style.width='100%';
    uploadStatus.className='status ok';
    uploadStatus.innerHTML='<strong>'+data.artworkId+' uploaded.</strong><br>Master artwork and '+uploads.length+' media'+(uploads.length===1?'':'s')+' are stored in R2 and linked to this product.'+ratioSummary;
    return data.artworkId;
  }catch(err){
    uploadProgress.style.width='0%';
    if(reservedArtworkId){
      try{
        await fetch('/api/artworks/'+encodeURIComponent(reservedArtworkId)+'/cancel',{method:'POST'});
        document.getElementById('artwork_id').value='';
      }catch{}
    }
    uploadStatus.className='status warn';
    uploadStatus.textContent=err.message||String(err);
    throw err;
  }
}

function presetRoleForFile(file){
  const name=String(file?.name||'').toLowerCase();
  if(/\.(mov|mp4|m4v)$/.test(name))return 'video';
  if(name.includes('option'))return 'choose-option';
  if(name.includes('frame'))return 'choose-frame';
  if(name.includes('promo')||name.includes('offer'))return 'promotion';
  return '';
}

function renderPresetStatus(status){
  const items=Array.isArray(status?.items)?status.items:[];
  if(status?.configured){
    presetMediaStatus.className='status ok';
    presetMediaStatus.innerHTML='<strong>Preset media installed.</strong><br>Choose Option · Choose Frame · Promotion · Video will be added automatically to every listing.';
    installPresetsButton.style.display='none';
    presetFilesInput.style.display='none';
    return;
  }
  const missing=items.filter(x=>!x.exists).map(x=>x.role);
  presetMediaStatus.className='status warn';
  presetMediaStatus.innerHTML='<strong>One-time setup needed.</strong><br>Select the 3 preset images and 1 video you already use. Missing: '+(missing.length?missing.join(', '):'preset files')+'.';
  installPresetsButton.style.display='';
  presetFilesInput.style.display='';
}

async function installPresetMedia(){
  const files=Array.from(presetFilesInput.files||[]);
  if(files.length!==4){
    presetMediaStatus.className='status warn';
    presetMediaStatus.textContent='Select exactly the 3 preset images + 1 video.';
    return;
  }

  const mapped=[];
  for(const file of files){
    const role=presetRoleForFile(file);
    if(!role){
      presetMediaStatus.className='status warn';
      presetMediaStatus.textContent='Could not identify '+file.name+'. Use filenames containing Option, Frame, Promotion/Offer, and the video file.';
      return;
    }
    if(mapped.some(x=>x.role===role)){
      presetMediaStatus.className='status warn';
      presetMediaStatus.textContent='Two files matched '+role+'. Rename the files so each preset is clear.';
      return;
    }
    mapped.push({role,file});
  }
  if(mapped.length!==4){
    presetMediaStatus.className='status warn';
    presetMediaStatus.textContent='All four preset roles are required.';
    return;
  }

  installPresetsButton.disabled=true;
  presetMediaStatus.className='status';
  presetMediaStatus.textContent='Preparing preset media upload…';

  try{
    const reserve=await fetch('/api/presets/reserve',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        files:mapped.map(({role,file})=>({
          role,
          filename:file.name,
          contentType:file.type,
          size:file.size
        }))
      })
    });
    const data=await readJsonResponse(reserve,'Preset media reservation');
    if(!reserve.ok)throw new Error(data.error||'Could not prepare preset media upload.');

    presetMediaStatus.textContent='Uploading preset media…';
    await mapLimit(data.uploads||[],4,async(upload)=>{
      const match=mapped.find(x=>x.role===upload.role);
      if(!match)throw new Error('Could not match preset '+upload.role+'.');
      await putFile(upload.uploadUrl,match.file,upload.contentType);
    });

    const complete=await fetch('/api/presets/complete',{method:'POST'});
    const done=await readJsonResponse(complete,'Preset media confirmation');
    if(!complete.ok)throw new Error(done.error||'Preset upload did not complete.');
    renderPresetStatus(done);
  }catch(error){
    presetMediaStatus.className='status warn';
    presetMediaStatus.textContent=error.message||String(error);
  }finally{
    installPresetsButton.disabled=false;
  }
}

installPresetsButton.addEventListener('click',installPresetMedia);

async function loadOptions(){
  try{
    const r=await fetch('/etsy/listing-options',{cache:'no-store'});
    const d=await readJsonResponse(r,'Etsy listing options');
    if(!r.ok){
      if(d.needsReauthorization){badge.textContent='Listing access not granted';reauth.style.display='block'}
      else badge.textContent='Etsy setup needs attention';
      shipping.innerHTML='<option value="">Unavailable</option>';
      readiness.innerHTML='<option value="">Unavailable</option>';
      return;
    }
    badge.textContent='Etsy presets loaded';
    shipping.innerHTML='<option value="">Choose shipping profile</option>';
    readiness.innerHTML='<option value="">Choose processing profile</option>';
    section.innerHTML='<option value="">No shop section</option>';
    returnPolicy.innerHTML='<option value="">Choose return policy</option>';
    productionPartner.innerHTML='<option value="">No production partner</option>';

    for(const p of d.shippingProfiles||[]){
      option(shipping,p.shipping_profile_id,p.title||('Shipping profile '+p.shipping_profile_id));
    }
    for(const p of d.readinessProfiles||[]){
      let label=p.title||p.name||p.readiness_state||('Processing profile '+p.readiness_state_id);
      if(p.min_processing_time!==undefined&&p.max_processing_time!==undefined){
        label+=' · '+p.min_processing_time+'–'+p.max_processing_time+' '+(p.processing_time_unit||'days');
      }
      option(readiness,p.readiness_state_id,label);
    }
    for(const p of d.shopSections||[]){
      option(section,p.shop_section_id,p.title||('Section '+p.shop_section_id));
    }
    for(const p of d.returnPolicies||[]){
      const label=(p.accepts_returns?'Returns':'No returns')+' · '+(p.accepts_exchanges?'Exchanges':'No exchanges')+(p.return_deadline?(' · '+p.return_deadline+' days'):'');
      option(returnPolicy,p.return_policy_id,label);
    }
    for(const p of d.productionPartners||[]){
      option(productionPartner,p.production_partner_id,p.partner_name||('Partner '+p.production_partner_id));
    }

    applyPreset(d.detectedPreset||{});
    if(d.variantCatalog?.ownedByApp){
      badge.textContent='Etsy presets + app-owned variants loaded';
    }

    renderPresetStatus(d.presetMedia||{configured:false,items:[]});

    const fixed=d.defaults||{};
    const materials=fixed.fixedAttributes?.Materials||[];
    const summary=document.getElementById('preset-summary');
    const mockupReferenceLine=d.mockupReference
      ? '<br>Mockup template: locked listing #'+String(d.mockupReference.listingId)+' · '+String(d.mockupReference.imageCount||0)+' reference images'
      : '<br>Mockup template: waiting for a locked Etsy reference';
    if(summary){
      summary.innerHTML='<strong>Silvia listing defaults loaded</strong><br>'+
        'Category: '+String(fixed.categoryName||'Wall Decor')+' · Materials: '+String(materials.join(', '))+
        '<br>Variants: app-owned Size × Product - Style · Pricing: Silvia CAD ladder → USD · whole-shop sale: 25%'+
        mockupReferenceLine+
        '<br>Processing target: '+String(fixed.processingLabel||'Made to order')+
        ' · Renewal: Automatic';
    }
    button.disabled=false;
  }catch(e){
    badge.textContent='Could not load Etsy settings';
  }
}
loadOptions();

form.addEventListener('submit',async(e)=>{
  e.preventDefault();

  // This runs directly from the user's click, so browsers are much more likely
  // to allow the custom Windows protocol than if we wait until after uploads.
  try{ window.location.href='pod-crop-worker://start'; }catch{}

  button.disabled=true;
  result.className='result';

  try{
    if(!document.getElementById('artwork_id').value.trim()){
      button.textContent='Uploading artwork…';
      await uploadArtworkToR2();
    }

    button.textContent='Creating Etsy draft…';
    const payload={
    artwork_id:document.getElementById('artwork_id').value.trim(),
    orientation:document.getElementById('orientation').value,
    title:document.getElementById('title').value.trim(),
    seo_description:document.getElementById('seo_description').value.trim(),
    seo_section_name:document.getElementById('seo_section_name').value.trim(),
    seo_section_url:document.getElementById('seo_section_url').value.trim(),
    homestyle:document.getElementById('homestyle').value.trim(),
    tags:document.getElementById('tags').value.split(',').map(x=>x.trim()).filter(Boolean),
    taxonomy_id:1027,
    shipping_profile_id:Number(shipping.value),
    readiness_state_id:Number(readiness.value),
    shop_section_id:section.value?Number(section.value):null,
    return_policy_id:returnPolicy.value?Number(returnPolicy.value):null,
    production_partner_ids:productionPartner.value?[Number(productionPartner.value)]:[],
    who_made:document.getElementById('who_made').value,
    when_made:document.getElementById('when_made').value,
    is_supply:document.getElementById('is_supply').value==='true',
    should_auto_renew:document.getElementById('should_auto_renew').value==='true'
    };

    let r;
    try{
      r=await fetch('/etsy/drafts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    }catch(error){
      throw new Error('Could not contact the Silvia app while creating the Etsy draft.');
    }
    const d=await readJsonResponse(r,'Etsy draft creation');
    if(!r.ok){
      const suffix=d.draftCreated&&d.listingId
        ? ' Etsy already created draft '+String(d.listingId)+' before this step failed.'
        : '';
      const detail=d.error||d.message||d.reason||('Draft creation failed (HTTP '+String(r.status)+')');
      throw new Error(String(detail)+suffix);
    }
    result.className='result show';
    const variantSummary=d.variants
      ? '<br>Variants: '+String(d.variants.count||0)+' · Size → Product - Style · USD '+String(d.variants.minimumPrice||'')+'+'
      : '';
    const mediaSummary=d.media
      ? '<br>Listing media: '+String(d.media.imageCount||0)+' image'+(Number(d.media.imageCount||0)===1?'':'s')+(d.media.videoUploaded?' + video':'')
      : '';
    const warnings=[...(Array.isArray(d.variantWarnings)?d.variantWarnings:[]),...(Array.isArray(d.attributeWarnings)?d.attributeWarnings:[])];
    const warningSummary=warnings.length
      ? '<br><br><strong>Setup note:</strong> '+warnings.join(' ')
      : '';
    const sortSummary=d.mockupSort?.applied
      ? '<br>Mockup order: matched exactly to locked listing #'+String(d.mockupSort.referenceListingId||'')
      : '<br>Mockup order: kept upload/filename order'+(d.mockupSort?.reason?' · '+String(d.mockupSort.reason):'');
    const timingSummary=d.timing?.totalMs
      ? '<br>Draft setup time: '+(Number(d.timing.totalMs)/1000).toFixed(1)+' seconds'
      : '';
    const aiSummary=d.aiGenerator&&!d.aiGenerator.applied
      ? '<br><br><strong>AI generator:</strong> Etsy does not expose this checkbox through the Open API, so this one editor setting still needs your Etsy helper.'
      : '';
    result.innerHTML='<strong>Draft configured.</strong><br>Listing ID: '+String(d.listingId||'')+'<br>State: '+String(d.state||'draft')+variantSummary+mediaSummary+sortSummary+timingSummary+warningSummary+aiSummary+'<br>Open Etsy Listings to review it.';
  }catch(err){
    result.className='result show';
    result.textContent=err.message||String(err);
  }finally{
    button.disabled=false;
    button.textContent='Create Etsy Draft';
  }
});
</script>
</body></html>`;
}
