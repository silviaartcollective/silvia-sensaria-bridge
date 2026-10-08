export function renderListingReposterPage(shop='Art Shop'){
const e=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Listing Reposter</title>
<style>
:root{--bg:#f5f2ed;--paper:#fffdfa;--ink:#252a23;--muted:#70746a;--line:#dedcd3;--green:#374737}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--bg);font:14px/1.5 system-ui,sans-serif}
.shell{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100vh}aside{padding:24px;background:#252820;color:#fff}.nav{display:block;color:#e5e8df;padding:11px;text-decoration:none}
main{padding:32px;min-width:0;max-width:1400px;width:100%;margin:0 auto}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:36px;margin:0}h2{font-size:23px;margin:0 0 12px}
.sub{color:var(--muted);margin:7px 0 23px}.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;margin:15px 0}
.flex{display:flex;align-items:center;justify-content:space-between;gap:13px;flex-wrap:wrap}
button,.button{padding:10px 14px;border:1px solid var(--line);background:#fff;color:#30392c;border-radius:8px;font:inherit;cursor:pointer;text-decoration:none}
button.primary{background:var(--green);color:white;border-color:var(--green)}button:disabled{opacity:.55;cursor:wait}
input:not([type=file]),textarea,select{width:100%;border:1px solid #ccc9c0;background:white;border-radius:7px;padding:10px;color:var(--ink);font:inherit}
textarea{min-height:150px;resize:vertical}label{font-size:12px;font-weight:650;display:block;margin:12px 0 6px}
small,.muted{color:var(--muted);font-size:12px}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:11px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{white-space:nowrap}
.alert{background:#fff7e8;border:1px solid #e8d9bb;padding:12px 15px;border-radius:8px;color:#625235}
.message{white-space:pre-wrap;overflow-wrap:anywhere;padding:13px;background:#e8efe8;color:#35513c;border-radius:8px;margin:18px 0}
.message.error{background:#ffebe6;color:#953c32}.formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
.imageGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:10px}
.imageGrid img{width:100%;height:125px;object-fit:cover;border:1px solid var(--line);border-radius:7px}
.actions{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0}.hidden{display:none!important}
@media(max-width:800px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:22px 13px}.formgrid{grid-template-columns:1fr}.imageGrid{grid-template-columns:repeat(3,1fr)}h1{font-size:30px}}
</style></head><body><div class="shell"><aside><nav><a class="nav active" href="/listing-reposter">Listing Reposter</a></nav></aside>
<main><div class="flex"><div><h1>Listing Reposter</h1><p class="sub">__SHOP__ · Safely refresh zero-sale listings while retaining their product details.</p></div><a class="button" href="/">Dashboard</a></div>
<div class="card flex" style="gap:14px"><div><strong>PC Crop Worker</strong>
<p id="crop-worker-status" class="muted">Checking connection…</p></div>
<button id="refresh-worker">Check worker</button></div>
<div class="alert"><strong>Renewals are estimates.</strong> Etsy verifies sales, but does not expose an exact renewal counter. Candidates are listings approximately 240–479 days old. Confirm 2–3 actual renewals in Etsy Shop Manager. Etsy listing fees may apply. The original stays active until a new listing has been published and verified.</div>
<div class="card"><div class="flex"><h2>Repost candidates</h2><div class="actions"><button id="scan" class="primary">Scan listings</button>
<input id="lookup" placeholder="Etsy listing ID" style="width:160px"><button id="by-id">Open listing</button></div></div>
<p class="muted" id="scan-note">Find older listings and verify their Etsy transaction count. The scan does not change Etsy.</p>
<div class="tablewrap"><table><thead><tr><th>Listing</th><th>Age / estimated cycles</th><th>Sales</th><th>Assessment</th><th></th></tr></thead>
<tbody id="rows"><tr><td colspan="5">Scan to discover candidates.</td></tr></tbody></table></div></div>
<section id="editor" class="card hidden"><div class="flex"><div><h2 id="listing-name">Editor</h2><div id="listing-info" class="muted"></div></div><button id="close">Close</button></div>
<div class="formgrid"><div><label for="title">New SEO title</label><input id="title" maxlength="140"></div>
<div><label for="tags">SEO tags — comma separated, max 13</label><input id="tags"></div></div>
<label for="description">New description</label><textarea id="description"></textarea>
<div class="flex"><h2>Mockups</h2><span class="muted">Original images are preserved unless you select replacements.</span></div>
<div id="photos" class="imageGrid"></div>
<div class="formgrid"><div><label for="mockup-mode">Mockup selection</label><select id="mockup-mode">
<option value="keep">Keep original Etsy mockups</option><option value="replace">Replace with new JPEG mockups</option></select></div>
<div id="upload-wrap" class="hidden"><label for="mockups">New JPEGs (1–10, each max 20MB)</label><input id="mockups" type="file" accept="image/jpeg" multiple></div></div>
<div class="card"><h2>Artwork & production files</h2>
<p class="muted">Both choices keep the exact same artwork ID and original SAC/JAC variant SKUs. Replacing the artwork updates the stored source and fulfillment ratio files only after the PC cropper completes and the new Etsy listing is verified.</p>
<label for="artwork-mode">Artwork source</label>
<select id="artwork-mode"><option value="keep">Keep existing artwork and production files</option>
<option value="replace">Replace artwork source and re-crop for every size</option></select>
<div id="artwork-upload-wrap" class="hidden">
<label for="artwork-upload">New source artwork · JPG, PNG, WebP or TIFF (up to 200MB)</label>
<input id="artwork-upload" type="file" accept="image/jpeg,image/png,image/webp,image/tiff">
<div class="actions"><button id="crop-start" type="button">Upload artwork & queue PC crops</button>
<button id="crop-check" type="button">Refresh crop progress</button></div>
<p id="crop-progress" class="muted">No new artwork queued.</p>
<div class="alert">If the artwork changes, update your mockups so the Etsy photos accurately show the new design. The old production files are preserved as a backup.</div>
</div>
</div>
<label for="renewals">Verify actual renewals in Etsy before reposting</label>
<select id="renewals"><option value="">Choose verified count…</option><option value="2">2 renewals</option><option value="3">3 renewals</option></select>
<div class="actions"><button class="primary" id="prepare">Prepare replacement draft</button>
<button id="finalize" class="hidden">Publish new listing and deactivate old</button>
<a id="new-link" class="button hidden" href="#" target="_blank" rel="noopener">View replacement in Etsy</a></div>
<p id="prepared-status" class="muted"></p></section>
<div class="message" id="message" role="status">Ready to scan your shop.</div></main></div>
<script>
(()=>{
const $=id=>document.getElementById(id);
const api=async(path,body)=>{
 const r=await fetch(path,body===undefined?{cache:'no-store',credentials:'same-origin'}:{
  method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)
 });
 const d=await r.json().catch(()=>({error:'Unexpected response format'}));
 if(!r.ok||d.ok===false)throw Error(d.error||'HTTP '+r.status);
 return d;
};
let selected=null,busy=false;
let cropState=null;
const message=(t,error=false)=>{$('message').textContent=String(t);$('message').className='message'+(error?' error':'');};
async function run(fn){
 if(busy)return;busy=true;for(const b of document.querySelectorAll('button'))b.disabled=true;
 try{await fn()}catch(e){message(e.message||String(e),true)}
 finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;
  if(selected?.replacement)$('prepare').disabled=true}
}
const td=(tr,v)=>{const c=document.createElement('td');c.textContent=String(v);tr.append(c);return c};
async function scan(){
 message('Checking Etsy listing age and transaction counts…');
 const d=await api('/api/reposter/candidates');const root=$('rows');root.replaceChildren();
 for(const v of d.items){
 const tr=document.createElement('tr');td(tr,v.title+' (#'+v.listingId+')');
 td(tr,v.ageDays+' days / approx. '+v.estimatedRenewals);
 td(tr,v.salesVerified?v.salesCount:'Not verified');
 td(tr,v.status==='review_renewals'?'Ready to repost · confirm renewals':'Not ready');
 const cell=document.createElement('td'),b=document.createElement('button');
 b.textContent='Edit';b.addEventListener('click',()=>run(()=>open(v.listingId)));cell.append(b);tr.append(cell);root.append(tr);
 }
 if(!d.items.length){const tr=document.createElement('tr');td(tr,'No approximate 2–3-cycle candidates found.');root.append(tr);}
 $('scan-note').textContent='Scanned '+d.scanned+' listings; '+d.matchedAge+' matched the age range.'+
  (d.limitReached?' Scan limit reached; some listings may not be shown.':'');
 message('Scan complete. Only listings with verified zero sales can be prepared.');
}
async function workerStatus(){
 try{
  const d=await api('/api/crop-worker/status');const w=d.worker||{};
  $('crop-worker-status').textContent=w.online?
   (w.busy?'Connected · processing '+(w.jobId||'crop job'):'Connected · idle')+
   ' · '+(w.workerId||'PC worker'):
   (w.configured?'Offline · Start worker/start-worker.cmd on your PC.':'Not configured · Set CROP_WORKER_TOKEN in Render first.');
  $('crop-worker-status').style.color=w.online?'#3e7652':'#aa6938';
 }catch(e){$('crop-worker-status').textContent='Worker status unavailable: '+e.message;}
}
async function cropProgress(){
 if(!selected)return;
 try {
  const d=await api('/api/reposter/'+selected.listing.listing_id+'/artwork/status'),r=d.revision||{};
  cropState=r;
  $('crop-progress').textContent=!r.exists?'No replacement source uploaded.':
   'Artwork '+r.artworkId+' · '+r.status+' · '+(r.progress||0)+'% · '+
   (r.message||'')+(r.upscaledRatios?.length?' · Upscaled: '+r.upscaledRatios.join(', '):'');
  if(r.ready)$('crop-progress').textContent+=' · Verified: ready for draft';
 }catch(e){$('crop-progress').textContent='Crop check failed: '+e.message;}
}
async function uploadAndCrop(){
 if(!selected?.managedArtworkId)throw Error('This listing needs converted SAC/JAC SKUs before replacing its production artwork.');
 const file=$('artwork-upload').files?.[0];
 if(!file)throw Error('Select your new master artwork first.');
 if(file.size>200*1024*1024 || file.size<1024)throw Error('Master must be 1KB–200MB.');
 const id=selected.listing.listing_id;
 message('Reserving a new immutable artwork revision. Existing source stays unchanged.');
 const reservation=await api('/api/reposter/'+id+'/artwork/reserve',{
  file:{name:file.name,size:file.size,type:file.type}
 });
 const up=await fetch(reservation.uploadUrl,{method:'PUT',headers:{'content-type':file.type},body:file});
 if(!up.ok)throw Error('Master artwork upload failed (HTTP '+up.status+'). Retry the same upload reservation rather than creating another listing.');
 const result=await api('/api/reposter/'+id+'/artwork/crop',{});
 message('Master stored. PC crop job '+result.job.id+' is queued. Keep the PC worker running; existing artwork is unchanged.');
 await cropProgress();await workerStatus();
}
async function open(id){
 const d=await api('/api/reposter/'+encodeURIComponent(id));selected=d;
 $('editor').classList.remove('hidden');
 $('listing-name').textContent=d.listing.title||'Listing #'+id;
 $('listing-info').textContent='#'+id+' · '+d.assessment.ageDays+' days · '+d.assessment.salesCount+
 ' sales · '+d.assessment.estimatedRenewals+' estimated four-month cycles';
 $('title').value=d.listing.title||'';$('tags').value=(d.listing.tags||[]).join(', ');
 $('description').value=d.listing.description||'';$('renewals').value='';
 $('mockup-mode').value='keep';$('upload-wrap').classList.add('hidden');$('mockups').value='';
 $('artwork-mode').value='keep';$('artwork-upload-wrap').classList.add('hidden');
 const root=$('photos');root.replaceChildren();
 for(const p of d.images){const img=document.createElement('img');img.src=p.url;img.alt=p.alt||'Listing photo';img.loading='lazy';root.append(img);}
 const draft=d.replacement;
 $('prepared-status').textContent=draft?'Existing draft #'+draft.draftId+' — '+draft.status:
  'Preparing creates a draft only. The original remains active.';
 $('finalize').classList.toggle('hidden',!draft||!['prepared','published'].includes(draft.status));
 $('new-link').classList.toggle('hidden',!draft?.draftId);
 if(draft?.draftId){$('new-link').href='https://www.etsy.com/your/shops/me/tools/listings';
 $('new-link').textContent='Open Etsy Shop Manager · Draft #'+draft.draftId;}
 $('prepare').disabled=!!draft;
 $('artwork-mode').disabled=!!draft;
 if(!d.managedArtworkId){
  $('artwork-mode').querySelector('option[value="replace"]').disabled=true;
 }else{$('artwork-mode').querySelector('option[value="replace"]').disabled=false;}
 if(draft?.artworkMode==='replace'||draft?.seo?.artworkMode==='replace'){
  $('artwork-mode').value='replace';$('artwork-upload-wrap').classList.remove('hidden');
 }else if(d.artworkRevision?.exists && !draft){
  $('artwork-mode').value='replace';$('artwork-upload-wrap').classList.remove('hidden');
  $('mockup-mode').value='replace';$('upload-wrap').classList.remove('hidden');
 }
 if(draft?.seo){$('title').value=draft.seo.title||'';
 $('description').value=draft.seo.description||'';
 $('tags').value=(draft.seo.tags||[]).join(', ');}
 if(d.assessment.status!=='review_renewals')message('Not eligible: this listing needs zero verified sales and an estimated 2–3 renewal cycles.',true);
 else message('Verify renewal count, update SEO or mockups, then prepare the new draft.');
 await cropProgress();await workerStatus();
 $('editor').scrollIntoView({block:'start',behavior:'smooth'});
}
function values(){return {title:$('title').value.trim(),description:$('description').value.trim(),
 tags:$('tags').value.split(',').map(v=>v.trim()).filter(Boolean),
 confirmedRenewals:Number($('renewals').value),mockupMode:$('mockup-mode').value,artworkMode:$('artwork-mode').value};}
async function prepare(){
 if(!selected)throw Error('Select a listing.');
 const id=selected.listing.listing_id,p=values();
 if(![2,3].includes(p.confirmedRenewals))throw Error('Confirm the actual renewal count.');
 if(p.artworkMode==='replace'){
  if(p.mockupMode!=='replace')throw Error('Upload new Etsy mockups so listing photos match the replacement artwork.');
  await cropProgress();
  if(!cropState?.ready)throw Error('PC cropper has not finished and verified all production files.');
 }
 p.mockups=[];
 if(p.mockupMode==='replace'){
 const files=[...$('mockups').files];
 if(!files.length||files.length>10||files.some(f=>f.type!=='image/jpeg'||f.size>20000000))
   throw Error('Select 1–10 JPEG images under 20MB each.');
 const data=await api('/api/reposter/'+id+'/uploads/reserve',{files:files.map(f=>({name:f.name,size:f.size,type:f.type}))});
 for(let i=0;i<files.length;i++){
   const response=await fetch(data.uploads[i].uploadUrl,{method:'PUT',headers:{'content-type':'image/jpeg'},body:files[i]});
   if(!response.ok)throw Error('Unable to upload '+files[i].name+': HTTP '+response.status);
   p.mockups.push({key:data.uploads[i].key});
 }
 }
 message('Preparing replacement as a draft. The original listing will remain available.');
 const r=await api('/api/reposter/'+id+'/prepare',p);
 message('Draft #'+r.record.draftId+' prepared and verified. Review before publishing. The original remains active.');
 await open(id);
}
async function finalize(){
 if(!selected)throw Error('Select a listing.');
 if(!window.confirm('Publish the replacement and deactivate the original Etsy listing?\\n\\nThis may incur Etsy listing fees. Confirm you reviewed the replacement draft.'))return;
 const id=selected.listing.listing_id;
 message('Publishing replacement, checking it is live, then deactivating the original…');
 const r=await api('/api/reposter/'+id+'/finalize',{confirm:'PUBLISH AND DEACTIVATE'});
 message('Replacement #'+r.record.draftId+' published; original #'+id+' verified inactive.');
 await open(id);
}
$('scan').addEventListener('click',()=>run(scan));
$('by-id').addEventListener('click',()=>run(async()=>{
 const id=$('lookup').value.trim();if(!/^[1-9]\d+$/.test(id))throw Error('Enter a numeric Etsy listing ID.');await open(id);
}));
$('prepare').addEventListener('click',()=>run(prepare));
$('finalize').addEventListener('click',()=>run(finalize));
$('close').addEventListener('click',()=>$('editor').classList.add('hidden'));
$('mockup-mode').addEventListener('change',()=>$('upload-wrap').classList.toggle('hidden',$('mockup-mode').value!=='replace'));
$('artwork-mode').addEventListener('change',()=>{
  const isNew=$('artwork-mode').value==='replace';
  $('artwork-upload-wrap').classList.toggle('hidden',!isNew);
  if(isNew){$('mockup-mode').value='replace';$('upload-wrap').classList.remove('hidden');}
 });
$('crop-start').addEventListener('click',()=>run(uploadAndCrop));
$('crop-check').addEventListener('click',()=>run(cropProgress));
$('refresh-worker').addEventListener('click',()=>run(workerStatus));
workerStatus();
setInterval(()=>{workerStatus();if(selected?.artworkRevision?.exists||cropState?.exists)cropProgress();},10000);
})();
</script></body></html>`.replaceAll('__SHOP__',e(shop));
}
