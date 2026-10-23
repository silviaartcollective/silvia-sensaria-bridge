(()=>{'use strict';
const el=id=>document.getElementById(id);
let listings=[],selectedId=0,current=null,dirty=false,converterLoaded=false,masterLoaded=false,templatesLoaded=false,listLoadGeneration=0;
const fields=['edit-title','edit-description','edit-tags','edit-section'];
function notice(id,message,error=false){const node=el(id);node.className='notice'+(error?' error':'');node.textContent=message;}
function clearNotice(id){el(id).className='notice hidden';el(id).textContent='';}
async function request(path,body){
 const res=await fetch(path,body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('Server returned an invalid response (HTTP '+res.status+').');}
 if(!res.ok||!data.ok)throw Error(data.error||'Request failed (HTTP '+res.status+').');
 return data;
}
function showTab(tab){
 const converter=tab==='converter';
 for(const name of ['master','converter','templates','photos']){
  el(name+'-panel').classList.toggle('hidden',name!==tab);
  const b=el('tab-'+name);const active=name===tab;
  b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));
 }
 if(tab==='photos')window.photoReplacer?.open();
 if(tab==='templates'&&!templatesLoaded){
  templatesLoaded=true;
  void loadTemplates();
 }
 const link=new URL(location.href);link.searchParams.set('tab',tab);
 history.replaceState({},'',link);
 if(converter&&!converterLoaded){
  el('converter-frame').src='/listing-converter?embedded=1';
  converterLoaded=true;
 }
 if(tab==='master'&&!masterLoaded){
   masterLoaded=true;
   void loadListings();
 }
}
// Keep the old converter comfortably scrollable inside its Listings tab.
const converterFrame=el('converter-frame');
function resizeConverterFrame(){
 if(!converterLoaded||el('converter-panel').classList.contains('hidden'))return;
 try{
  const doc=converterFrame.contentDocument;
  const height=Math.max(doc?.documentElement?.scrollHeight||0,doc?.body?.scrollHeight||0,950);
  converterFrame.style.height=Math.min(16000,height+36)+'px';
 }catch{converterFrame.style.height='1100px';}
}
converterFrame.addEventListener('load',resizeConverterFrame);
setInterval(resizeConverterFrame,3500);
el('tab-master').addEventListener('click',()=>showTab('master'));
el('tab-converter').addEventListener('click',()=>showTab('converter'));
el('tab-templates').addEventListener('click',()=>showTab('templates'));
el('tab-photos').addEventListener('click',()=>showTab('photos'));
function filteredList(){
 const q=el('listing-search').value.trim().toLowerCase();
 return listings.filter(o=>!q||String(o.listingId).includes(q)||
  String(o.title||'').toLowerCase().includes(q)||String(o.artworkId||'').toLowerCase().includes(q));
}
// Each card shows the listing's first Etsy photo, like the converter. Photos
// load as cards near the screen, four at a time, from the converter's cached
// preview route; they are kept across list refreshes.
const previews=new Map(),previewQueue=[],previewPending=new Set();
let previewsActive=0;
function showPreview(box,id){
 const known=previews.get(id);box.replaceChildren();
 if(known?.url){
  const img=document.createElement('img');img.src=known.url;img.alt='';img.loading='lazy';img.decoding='async';
  box.append(img);return;
 }
 const empty=document.createElement('div');empty.className='empty';
 empty.textContent=!known?'Loading photo…':known.error?'Etsy photo unavailable':'No listing photo';
 box.append(empty);
}
function pumpPreviews(){
 while(previewsActive<4&&previewQueue.length){
  const id=previewQueue.shift();previewsActive++;
  void request('/api/listing-converter/listing-image?listingId='+encodeURIComponent(id))
   .then(data=>previews.set(id,{url:data.firstImageUrl||null}),error=>previews.set(id,{url:null,error:String(error.message||error)}))
   .finally(()=>{
    previewPending.delete(id);previewsActive--;
    const box=el('listing-items').querySelector('[data-listing-id="'+id+'"] .preview');
    if(box)showPreview(box,id);
    pumpPreviews();
   });
 }
}
function queuePreview(id){
 if(previews.has(id)||previewPending.has(id))return;
 previewPending.add(id);previewQueue.push(id);pumpPreviews();
}
const previewObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
 for(const entry of entries){
  if(!entry.isIntersecting)continue;
  previewObserver.unobserve(entry.target);queuePreview(Number(entry.target.dataset.listingId));
 }
},{rootMargin:'400px 0px'}):null;
function listedDate(timestamp){
 const t=Number(timestamp);if(!t||t>=Number.MAX_SAFE_INTEGER)return '';
 return new Date(t<1e12?t*1000:t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
}
function renderList(){
 const box=el('listing-items');box.replaceChildren();
 if(previewObserver)previewObserver.disconnect();
 const rows=filteredList();
 const visible=rows.slice(0,120);
 el('listing-count').textContent=rows.length+' matching · '+listings.length+
   ' loaded from Etsy'+(rows.length>120?' · Showing first 120; use search to narrow results':'');
 for(const row of visible){
  const id=Number(row.listingId),card=document.createElement('article');
  card.className='listing-card'+(id===selectedId?' selected':'');card.dataset.listingId=String(id);
  const preview=document.createElement('div');preview.className='preview';showPreview(preview,id);
  const body=document.createElement('div');body.className='card-body';
  const title=document.createElement('div');title.className='card-title';title.textContent=row.title||'Untitled';
  const pills=document.createElement('div');pills.className='pills';
  const pill=(text,kind='')=>{const span=document.createElement('span');span.className='pill'+(kind?' '+kind:'');span.textContent=text;pills.append(span);};
  pill(row.state||'unknown',row.state==='draft'?'draft':'');
  if(row.artworkId)pill(row.artworkId,'ok');
  pill('#'+id);
  if(row.converted)pill('Converted');
  body.append(title,pills);
  const listed=listedDate(row.originalCreationTimestamp);
  if(listed){const meta=document.createElement('div');meta.className='muted';meta.textContent='Originally listed: '+listed;body.append(meta);}
  const actions=document.createElement('div');actions.className='card-actions';
  const edit=document.createElement('button');edit.type='button';edit.className='primary';edit.textContent='Edit listing';
  const etsy=document.createElement('a');etsy.className='btn';etsy.href='https://www.etsy.com/listing/'+id;
  etsy.target='_blank';etsy.rel='noopener noreferrer';etsy.textContent='View on Etsy ↗';
  actions.append(edit,etsy);body.append(actions);
  if(row.artworkId)body.append(artworkArea(row));
  card.append(preview,body);
  card.addEventListener('click',event=>{if(!event.target.closest('a,.card-artwork'))chooseListing(id,row.title);});
  box.append(card);
  if(!previews.has(id)){if(previewObserver)previewObserver.observe(card);else queuePreview(id);}
 }
}
function markSelected(){
 for(const card of el('listing-items').querySelectorAll('.listing-card'))
  card.classList.toggle('selected',Number(card.dataset.listingId)===selectedId);
}
// The editor opens in a drawer over the cards, which keep their place.
function showEditor(open){
 el('editor-drawer').classList.toggle('hidden',!open);el('editor-backdrop').classList.toggle('hidden',!open);
 document.body.classList.toggle('drawer-open',open);
}
function chooseListing(id,title){
 if(dirty&&id!==selectedId&&!confirm('Discard unsaved edits to this listing?'))return;
 el('drawer-title').textContent=title||'Listing #'+id;
 showEditor(true);el('editor-drawer').scrollTop=0;
 openListing(id).catch(error=>{
  el('editor').classList.add('hidden');el('editor-empty').classList.remove('hidden');
  el('editor-empty').textContent='Could not open Etsy listing #'+id+': '+String(error.message||error);
 });
}
function closeEditor(){
 if(dirty&&!confirm('Discard unsaved edits to this listing?'))return;
 dirty=false;showEditor(false);
}
el('close-editor').addEventListener('click',closeEditor);
el('editor-backdrop').addEventListener('click',closeEditor);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el('editor-drawer').classList.contains('hidden'))closeEditor();});
async function loadListings(){
 const generation=++listLoadGeneration;
 el('reload-list').disabled=true;
 el('listing-count').textContent='Loading the first 100 active and draft Etsy listings…';
 listings=[];renderList();
 const byId=new Map();
 try{
  for(let offset=0;offset<=4900;offset+=100){
   const data=await request('/api/master-listings?offset='+offset);
   if(generation!==listLoadGeneration)return;
   for(const item of data.listings||[])byId.set(Number(item.listingId),item);
   listings=[...byId.values()].sort((a,b)=>{
     const ta=Number(a.originalCreationTimestamp)||Number.MAX_SAFE_INTEGER;
     const tb=Number(b.originalCreationTimestamp)||Number.MAX_SAFE_INTEGER;
     return ta-tb||Number(a.listingId)-Number(b.listingId);
   });
   renderList();
   if(!data.hasMore){void resumeArtworkJobs();break;}
   el('listing-count').textContent='Loaded '+listings.length+' listings · loading more in the background…';
   // Yield between pages so input and rendering remain responsive.
   await new Promise(resolve=>setTimeout(resolve,60));
  }
 }catch(error){
  if(generation===listLoadGeneration)
   el('listing-count').textContent='Loaded '+listings.length+' listings · '+String(error.message||error);
 }finally{
  if(generation===listLoadGeneration)el('reload-list').disabled=false;
 }
}
function renderInventory(data){
 const body=el('variants-body');body.replaceChildren();
 const rows=data.inventoryRows||[],count=rows.reduce((n,p)=>n+p.offerings.length,0);
 el('variants-count').textContent=count+' variation offerings. SKU fields are read-only.';
 el('save-variants').disabled=!data.inventoryHash||!count;
 el('variant-error').className=data.inventoryError?'notice warn':'notice warn hidden';
 el('variant-error').textContent=data.inventoryError||'';
 for(const p of rows)for(const offering of p.offerings){
  const tr=document.createElement('tr');tr.dataset.product=String(p.index);
  tr.dataset.offering=String(offering.offeringIndex);
  const name=document.createElement('td');
  const sku=document.createElement('strong');sku.textContent=p.sku||'(no SKU)';
  const subt=document.createElement('div');subt.className='muted';subt.textContent=p.variations||'Default';
  name.append(sku,subt);
  const cell=(type,value,attributes={})=>{
    const td=document.createElement('td'),input=document.createElement('input');
    input.type=type;if(type==='checkbox')input.checked=Boolean(value);else input.value=String(value);
    for(const [key,v] of Object.entries(attributes))input.setAttribute(key,String(v));
    input.addEventListener('change',()=>{dirty=true;});
    td.append(input);return td;
  };
  tr.append(name,cell('number',offering.price,{min:0.2,max:100000,step:0.01,'aria-label':'Price for '+p.sku}),
   cell('number',offering.quantity,{min:0,max:999,step:1,'aria-label':'Quantity for '+p.sku}),
   cell('checkbox',offering.enabled,{'aria-label':'Enabled for '+p.sku}));
  body.append(tr);
 }
}
async function openListing(id){
 selectedId=Number(id);dirty=false;markSelected();
 el('editor').classList.add('hidden');el('editor-empty').classList.remove('hidden');
 el('editor-empty').textContent='Loading Etsy listing #'+id+'…';
 clearNotice('details-status');clearNotice('variant-status');
 const data=await request('/api/master-listings/'+encodeURIComponent(id));
 if(selectedId!==Number(id))return;
 current=data;el('editor-empty').classList.add('hidden');el('editor').classList.remove('hidden');
 const f=data.fields;
 el('editor-heading').textContent='Editing #'+id;
 el('editor-info').textContent=['Etsy '+data.state,data.artworkId,data.converted?'Converted listing':''].filter(Boolean).join(' · ');
 el('open-etsy').href='https://www.etsy.com/listing/'+id;
 el('edit-title').value=f.title||'';el('edit-description').value=f.description||'';
 el('edit-tags').value=(f.tags||[]).join(', ');
 const section=el('edit-section');section.replaceChildren();
 const none=document.createElement('option');none.value='0';none.textContent='No shop section';section.append(none);
 for(const entry of data.sections||[]){
  const option=document.createElement('option');option.value=String(entry.shop_section_id);option.textContent=entry.title||('Section '+entry.shop_section_id);
  section.append(option);
 }
 if(f.shopSectionId && ![...section.options].some(o=>o.value===String(f.shopSectionId))){
  const o=document.createElement('option');o.value=String(f.shopSectionId);o.textContent='Current section #'+f.shopSectionId;section.append(o);
 }
 section.value=String(f.shopSectionId||0);
 resetArtworkSection(data);
 el('listing-preview').classList.add('hidden');
 if(data.previewUrl){
  const img=el('listing-preview');img.src=data.previewUrl;img.classList.remove('hidden');
 }
 renderInventory(data);
 if(data.optionsPending){
  el('variants-count').textContent='Loading Etsy variations and shop sections…';
  void request('/api/master-listings/'+encodeURIComponent(id)+'/options').then(options=>{
    if(selectedId!==Number(id)||current!==data)return;
    current.inventoryRows=options.inventoryRows||[];
    current.inventoryHash=options.inventoryHash||null;
    current.inventoryError=options.inventoryError||null;
    const currentSection=el('edit-section').value;
    const section=el('edit-section');section.replaceChildren();
    const none=document.createElement('option');
    none.value='0';none.textContent='No shop section';section.append(none);
    for(const entry of options.sections||[]){
      const option=document.createElement('option');
      option.value=String(entry.shop_section_id);
      option.textContent=entry.title||('Section '+entry.shop_section_id);
      section.append(option);
    }
    if(currentSection&&![...section.options].some(o=>o.value===currentSection)){
      const existing=document.createElement('option');
      existing.value=currentSection;existing.textContent='Current section #'+currentSection;
      section.append(existing);
    }
    section.value=currentSection;
    renderInventory(current);
  }).catch(error=>{
    if(selectedId!==Number(id)||current!==data)return;
    el('variants-count').textContent='Could not load Etsy variations.';
    notice('variant-status',String(error.message||error),true);
  });
  void request('/api/listing-converter/listing-image?listingId='+encodeURIComponent(id)).then(image=>{
    if(selectedId!==Number(id)||current!==data||!image.firstImageUrl)return;
    const img=el('listing-preview');img.src=image.firstImageUrl;
    img.classList.remove('hidden');
  }).catch(()=>{});
 }
}
// ---- Production artwork: re-upload a master or regenerate the crops from the
// stored one, from each card or the editor. Several listings can run at once:
// uploads go two at a time, crops queue on the PC worker (one job at a time,
// oldest first), and one status request covers every running job.
const artworkJobs=new Map(),artworkFiles=new Map();
const ARTWORK_ACCEPT='image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let uploadsActive=0;const uploadWaiters=[];
async function uploadSlot(task){
 while(uploadsActive>=2)await new Promise(resolve=>uploadWaiters.push(resolve));
 uploadsActive++;
 try{return await task();}finally{uploadsActive--;uploadWaiters.shift()?.();}
}
async function fileFingerprint(file){
 if(!globalThis.crypto?.subtle)throw Error('Secure browser file verification is unavailable. Open this app over HTTPS.');
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
async function fileOrientation(file){
 try{const b=await createImageBitmap(file);const o=b.width===b.height?'square':b.width>b.height?'landscape':'portrait';b.close();return o;}
 catch{return 'auto';}
}
async function uploadToR2(url,file,contentType){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const res=await fetch(url,{method:'PUT',headers:{'content-type':contentType||file.type||'image/jpeg'},body:file});
   if(res.ok)return;
   if(![408,429,500,502,503,504].includes(res.status)||attempt===2)throw Error('Cloudflare upload failed ('+res.status+')');
  }catch(error){if(attempt===2)throw error;}
  await pause(1200*(2**attempt));
 }
}
const jobBusy=job=>Boolean(job)&&!['done','error'].includes(job.phase)&&!job.awaitingFinish;
function jobProgress(job){
 if(!job)return 0;
 return {starting:3,checking:3,uploading:10,queued:15,cropping:15+Math.round(.75*(Number(job.progress)||0)),
  ready:90,activating:95,done:100}[job.phase]??0;
}
function buttonLabel(job,file){
 return job?.awaitingFinish?'Apply new crops':jobBusy(job)?'Working…':file?'Re-upload artwork':'Regenerate crops';
}
function fillArtworkArea(wrap,id,artworkId){
 const job=artworkJobs.get(id),file=artworkFiles.get(id),busy=jobBusy(job);
 wrap.replaceChildren();
 const note=document.createElement('div');note.className='muted';
 note.textContent='Choose a new master to replace the artwork, or leave it empty to regenerate the crops from the master stored in R2. '+artworkId+' is kept.';
 const pick=document.createElement('div');pick.className='pick';
 const input=document.createElement('input');input.type='file';input.accept=ARTWORK_ACCEPT;input.className='hidden';
 const choose=document.createElement('button');choose.type='button';choose.textContent=file?'Change file':'Choose new master…';choose.disabled=busy;
 const name=document.createElement('span');name.className='muted file-name';name.textContent=file?file.name:'No file chosen';
 pick.append(input,choose,name);
 if(file&&!busy){
  const clear=document.createElement('button');clear.type='button';clear.className='link';clear.textContent='Clear';
  clear.addEventListener('click',()=>{artworkFiles.delete(id);paintArtwork(id);});pick.append(clear);
 }
 choose.addEventListener('click',()=>input.click());
 input.addEventListener('change',()=>{const chosen=input.files?.[0];if(chosen)artworkFiles.set(id,chosen);paintArtwork(id);});
 const go=document.createElement('button');go.type='button';go.className='go';go.textContent=buttonLabel(job,file);go.disabled=busy;
 go.addEventListener('click',()=>startArtwork(id,artworkId));
 const bar=document.createElement('div');bar.className='bar';const fill=document.createElement('div');
 fill.style.width=jobProgress(job)+'%';bar.append(fill);
 const status=document.createElement('div');status.className='muted artwork-status'+(job?.phase==='error'?' error':'');
 status.textContent=job?.message||'';status.setAttribute('role','status');
 wrap.append(note,pick,go,bar,status);
}
function artworkArea(row){
 const id=Number(row.listingId),wrap=document.createElement('div');
 wrap.className='card-artwork';wrap.dataset.artwork=String(id);wrap.dataset.artworkId=String(row.artworkId);
 // Its buttons redraw the area, so a click is stopped here: by the time it
 // reaches the card, the clicked button is no longer inside it.
 wrap.addEventListener('click',event=>event.stopPropagation());
 fillArtworkArea(wrap,id,String(row.artworkId));
 return wrap;
}
function paintDrawer(){
 if(!current?.artworkId||el('artwork-section').classList.contains('hidden'))return;
 const job=artworkJobs.get(selectedId),file=artworkFiles.get(selectedId),busy=jobBusy(job);
 const button=el('artwork-replace');
 button.textContent=job?.awaitingFinish?'Apply new crops':busy?'Working…':file?'Re-upload '+file.name:'Regenerate crops from stored master';
 button.disabled=busy;el('artwork-file').disabled=busy;
 if(job?.message)notice('artwork-status',job.message,job.phase==='error');else clearNotice('artwork-status');
}
function paintArtwork(id){
 const wrap=el('listing-items').querySelector('[data-artwork="'+id+'"]');
 if(wrap)fillArtworkArea(wrap,id,wrap.dataset.artworkId);
 if(id===selectedId)paintDrawer();
}
function setJob(job,phase,message){job.phase=phase;job.message=message;paintArtwork(job.listingId);}
function failJob(job,error){
 job.awaitingFinish=false;
 setJob(job,'error','Not replaced: '+String(error?.message||error)+' The current artwork is unchanged; click again to resume.');
}
function startArtwork(id,artworkId){
 const existing=artworkJobs.get(id);
 if(existing?.awaitingFinish){void finishArtwork(existing);return;}
 if(jobBusy(existing))return;
 const file=artworkFiles.get(id)||null;
 const ok=confirm(file
  ?'Replace the artwork for '+artworkId+' with '+file.name+'?\n\nThe new master is uploaded and cropped on the PC worker. After the crops are verified, '+artworkId+'\'s master, crops and manifest in R2 are overwritten. Etsy photos, SKUs and prices are not changed.'
  :'Regenerate the production crops for '+artworkId+' from the master already stored in R2?\n\nNo upload is needed. After the new crops are verified, '+artworkId+'\'s crops and manifest in R2 are overwritten. Etsy photos, SKUs and prices are not changed.');
 if(!ok)return;
 const job={listingId:id,artworkId,file:file?file.name:null,phase:'starting',message:'Starting…',progress:0};
 artworkJobs.set(id,job);paintArtwork(id);
 void runArtwork(job,file);
}
async function runArtwork(job,file){
 const {listingId,artworkId}=job;
 try{
  let reserved;
  if(file){
   setJob(job,'checking','Checking '+file.name+'…');
   const [sha256,orientation]=await Promise.all([fileFingerprint(file),fileOrientation(file)]);
   reserved=await request('/api/listing-converter/reconvert/reserve',{listingId,artworkId,orientation,
    master:{filename:file.name,contentType:file.type||'image/jpeg',size:file.size,sha256}});
   if(!reserved.uploadAlreadyPresent){
    setJob(job,'uploading','Waiting for another upload to finish…');
    await uploadSlot(async()=>{
     setJob(job,'uploading','Uploading '+file.name+' to Cloudflare R2…');
     await uploadToR2(reserved.upload.uploadUrl,file,reserved.upload.contentType);
    });
   }
  }else{
   setJob(job,'starting','Copying the stored master for '+artworkId+' inside R2…');
   reserved=await request('/api/listing-converter/reconvert/reserve',{listingId,artworkId,useExistingMaster:true});
  }
  job.revision=reserved.revision;
  setJob(job,'queued','Queueing new production crops…');
  const started=await request('/api/listing-converter/reconvert/crop',{listingId,artworkId,revision:job.revision});
  if(started.job?.status==='completed'){await finishArtwork(job);return;}
  job.waitingSince=Date.now();
  setJob(job,'queued',started.worker&&!started.worker.online
   ?'Queued · start the PC crop worker (Launch PC crop worker, above); this page finishes automatically.'
   :'Queued for the PC crop worker.');
  void pollArtwork();
 }catch(error){failJob(job,error);}
}
async function finishArtwork(job){
 job.awaitingFinish=false;
 setJob(job,'activating','Crops verified. Writing the new files into '+job.artworkId+'\'s R2 folder…');
 try{
  await request('/api/listing-converter/reconvert/activate',{listingId:job.listingId,artworkId:job.artworkId,
   revision:job.revision,confirm:'REPLACE SILVIA ARTWORK'});
  artworkFiles.delete(job.listingId);
  setJob(job,'done',(job.file?'Artwork replaced':'Crops regenerated')+' for '+job.artworkId+'. Sensaria CSVs and supplier orders now use the new files.');
 }catch(error){failJob(job,error);}
}
// One status request for every waiting job, every 4 seconds.
let artworkPolling=false;
async function pollArtwork(){
 if(artworkPolling)return;artworkPolling=true;
 let failures=0;
 try{
  for(;;){
   const waiting=[...artworkJobs.values()].filter(job=>job.phase==='queued'&&job.revision&&job.waitingSince||job.phase==='cropping');
   if(!waiting.length)return;
   await pause(4000);
   let statuses;
   try{
    statuses=(await request('/api/listing-converter/reconvert/statuses?listingIds='+waiting.map(job=>job.listingId).join(','))).statuses||{};
    failures=0;
   }catch(error){
    if(++failures>=5){for(const job of waiting)failJob(job,error);}
    continue;
   }
   for(const job of waiting){
    if(job.phase!=='queued'&&job.phase!=='cropping')continue;
    const status=statuses[job.listingId];
    if(!status?.exists||status.revision!==job.revision){failJob(job,Error('This artwork job was replaced or removed.'));continue;}
    if(status.ready){void finishArtwork(job);continue;}
    if(status.status==='failed'||status.status==='completed'){
     failJob(job,Error(status.message||'The crop worker could not make the new crops.'));continue;
    }
    if(Date.now()-job.waitingSince>3*60*60*1000){failJob(job,Error('Crops are still not finished after 3 hours. Check the PC crop worker.'));continue;}
    job.progress=Number(status.progress)||0;
    if(status.status==='pending')
     setJob(job,'queued',status.queuePosition>1?'Queued · #'+status.queuePosition+' in line for the PC crop worker.':'Queued · next for the PC crop worker.');
    else setJob(job,'cropping','Cropping on the PC worker'+(status.currentRatio?' · '+status.currentRatio:'')+' · '+job.progress+'%');
   }
  }
 }finally{artworkPolling=false;}
}
// After a reload, jobs still on their way show on their cards again.
let artworkResumed=false;
async function resumeArtworkJobs(){
 if(artworkResumed)return;artworkResumed=true;
 const ids=listings.filter(row=>row.artworkId).map(row=>Number(row.listingId)).filter(id=>!artworkJobs.has(id));
 for(let i=0;i<ids.length;i+=60){
  let statuses;
  try{statuses=(await request('/api/listing-converter/reconvert/statuses?listingIds='+ids.slice(i,i+60).join(','))).statuses||{};}
  catch{return;}
  for(const [key,status] of Object.entries(statuses)){
   const id=Number(key);
   if(!status?.exists||!status.jobId||['activated','failed'].includes(status.status)||artworkJobs.has(id))continue;
   const job={listingId:id,artworkId:status.artworkId,revision:status.revision,
    file:status.source==='existing-master'?null:status.filename||null,progress:Number(status.progress)||0,waitingSince:Date.now()};
   // A run started in the last day finishes as if the page had stayed open;
   // an older one waits for a click.
   const recent=Date.now()-Date.parse(status.queuedAt||0)<24*60*60*1000;
   if(status.ready&&recent){artworkJobs.set(id,job);void finishArtwork(job);continue;}
   if(status.ready){job.phase='ready';job.awaitingFinish=true;job.message='Crops from an earlier run are ready. Click Apply new crops to use them.';}
   else if(status.status==='completed'){continue;}
   else{job.phase=status.status==='pending'?'queued':'cropping';job.message='Started earlier · '+(status.status==='pending'?'queued for the PC crop worker.':'cropping on the PC worker.');}
   artworkJobs.set(id,job);paintArtwork(id);
  }
 }
 void pollArtwork();
}
function resetArtworkSection(data){
 const show=Boolean(data?.artworkEditable&&data?.artworkId);
 el('artwork-section').classList.toggle('hidden',!show);
 el('artwork-file').value='';
 if(show)paintDrawer();
}
el('artwork-file').addEventListener('change',()=>{
 const file=el('artwork-file').files?.[0];
 if(file)artworkFiles.set(selectedId,file);else artworkFiles.delete(selectedId);
 paintArtwork(selectedId);
});
el('artwork-replace').addEventListener('click',()=>{if(current?.artworkId)startArtwork(selectedId,String(current.artworkId));});
fields.forEach(id=>el(id).addEventListener('input',()=>{dirty=true;}));
el('listing-search').addEventListener('input',renderList);
el('reload-list').addEventListener('click',()=>loadListings());
el('save-details').addEventListener('click',async()=>{
 if(!current)return;
 const id=selectedId,btn=el('save-details');btn.disabled=true;
 notice('details-status','Validating Etsy listing and saving the edited details…');
 try{
  const result=await request('/api/master-listings/'+id+'/details',{
    confirm:'SAVE SILVIA LISTING',fingerprint:current.metadataHash,
    title:el('edit-title').value,description:el('edit-description').value,
    tags:el('edit-tags').value.split(','),shopSectionId:Number(el('edit-section').value)
  });
  await openListing(id);
  notice('details-status',result.changed?'Etsy listing details saved and verified.':'No changes were necessary.');
  await loadListings();
 }catch(error){notice('details-status',String(error.message||error),true);}
 finally{btn.disabled=false;}
});
el('save-variants').addEventListener('click',async()=>{
 if(!current?.inventoryHash)return;
 const updates=[],original=current.inventoryRows||[],btn=el('save-variants'),id=selectedId;
 for(const tr of el('variants-body').querySelectorAll('tr')){
  const pi=Number(tr.dataset.product),oi=Number(tr.dataset.offering);
  const p=original[pi],before=p?.offerings?.[oi],inputs=tr.querySelectorAll('input');
  if(!p||!before||inputs.length!==3){notice('variant-status','Variation data changed. Refresh the listing.',true);return;}
  const price=Number(inputs[0].value),quantity=Number(inputs[1].value),enabled=inputs[2].checked;
  if(before.price!==price||before.quantity!==quantity||before.enabled!==enabled)
   updates.push({productIndex:pi,offeringIndex:oi,productId:p.productId,sku:p.sku,price,quantity,enabled});
 }
 if(!updates.length){notice('variant-status','No variation changes to save.');return;}
 if(!confirm('Save '+updates.length+' variation change(s) to the live Etsy listing?'))return;
 btn.disabled=true;notice('variant-status','Saving '+updates.length+' variation change(s) to Etsy…');
 try{
  const result=await request('/api/master-listings/'+id+'/inventory',{
   confirm:'SAVE SILVIA VARIANTS',fingerprint:current.inventoryHash,updates
  });
  await openListing(id);
  notice('variant-status','Etsy saved and verified '+result.updated+' variation change(s).');
 }catch(error){notice('variant-status',String(error.message||error),true);}
 finally{btn.disabled=false;}
});
// ---- Templates: the Product Creator's defaults for each artwork orientation.
const TEMPLATE_NAMES={portrait:'Vertical',landscape:'Horizontal',square:'Square',panoramic:'Panoramic'};
const TEMPLATE_SELECTS=['listing_style','shipping_profile_id','readiness_state_id','shop_section_id','return_policy_id',
 'production_partner_id','who_made','when_made','is_supply','should_auto_renew'];
let templates={},builtInDescription='',templateOrientation='portrait',templateDirty=false;
const addOption=(select,value,label)=>{const o=document.createElement('option');o.value=String(value);o.textContent=label;select.append(o);};
const orientationButtons=()=>[...document.querySelectorAll('#templates-panel .orient-tabs button')];
async function loadTemplates(){
 const [saved,options]=await Promise.all([request('/api/listing-templates'),
  request('/etsy/listing-options').catch(error=>({error:String(error.message||error)}))]).catch(error=>[null,{error:String(error.message||error)}]);
 if(!saved){el('tpl-loading').className='notice error';el('tpl-loading').textContent='Templates could not be loaded: '+options.error;return;}
 templates=saved.orientations||{};builtInDescription=saved.builtInDescription||'';
 for(const style of saved.styles||[])addOption(el('tpl-listing_style'),style,style);
 for(const p of options.shippingProfiles||[])addOption(el('tpl-shipping_profile_id'),p.shipping_profile_id,p.title||'Shipping profile '+p.shipping_profile_id);
 for(const p of options.readinessProfiles||[]){
  let label=p.title||p.name||p.readiness_state||'Processing profile '+p.readiness_state_id;
  if(p.min_processing_time!==undefined&&p.max_processing_time!==undefined)
   label+=' · '+p.min_processing_time+'–'+p.max_processing_time+' '+(p.processing_time_unit||'days');
  addOption(el('tpl-readiness_state_id'),p.readiness_state_id,label);
 }
 for(const p of options.shopSections||[])addOption(el('tpl-shop_section_id'),p.shop_section_id,p.title||'Section '+p.shop_section_id);
 for(const p of options.returnPolicies||[])addOption(el('tpl-return_policy_id'),p.return_policy_id,
  (p.accepts_returns?'Returns':'No returns')+' · '+(p.accepts_exchanges?'Exchanges':'No exchanges')+(p.return_deadline?' · '+p.return_deadline+' days':''));
 for(const p of options.productionPartners||[])addOption(el('tpl-production_partner_id'),p.production_partner_id,p.partner_name||'Partner '+p.production_partner_id);
 el('tpl-loading').classList.toggle('hidden',!options.error);
 if(options.error){el('tpl-loading').className='notice warn';el('tpl-loading').textContent='Etsy settings could not be loaded ('+options.error+'). Saved choices are kept; refresh to pick new ones.';}
 el('tpl-form').classList.remove('hidden');
 showTemplate(templateOrientation);
 showTemplatesUpdated(saved.updatedAt);
}
function showTemplatesUpdated(at){
 el('tpl-updated').textContent=at?'Last saved '+new Date(at).toLocaleString():'Not saved yet';
}
function showTemplate(orientation){
 templateOrientation=orientation;
 fillTemplateForm(templates[orientation]||{});
 templateDirty=false;
 el('tpl-save').textContent='Save '+TEMPLATE_NAMES[orientation]+' template';
 for(const button of orientationButtons()){
  const name=button.dataset.orientation,saved=Object.keys(templates[name]||{}).length>0;
  button.classList.toggle('active',name===orientation);button.setAttribute('aria-pressed',String(name===orientation));
  button.replaceChildren(TEMPLATE_NAMES[name]);
  if(saved){const dot=document.createElement('span');dot.className='dot';dot.title='Saved template';button.append(dot);}
 }
}
function fillTemplateForm(template){
 for(const field of TEMPLATE_SELECTS){
  const select=el('tpl-'+field),value=template[field]===undefined?'':String(template[field]);
  if(value&&![...select.options].some(o=>o.value===value))addOption(select,value,'Saved setting #'+value+' (not found on Etsy)');
  select.value=value;
 }
 el('tpl-tags').value=(template.tags||[]).join(', ');
 el('tpl-description').value=template.description_template||'';
}
function readTemplateForm(){
 const template={};
 for(const field of TEMPLATE_SELECTS){const value=el('tpl-'+field).value;if(value!=='')template[field]=value;}
 const tags=el('tpl-tags').value.split(',').map(tag=>tag.trim()).filter(Boolean);
 if(tags.length)template.tags=tags;
 if(el('tpl-description').value.trim())template.description_template=el('tpl-description').value;
 return template;
}
for(const button of orientationButtons())button.addEventListener('click',()=>{
 const next=button.dataset.orientation;
 if(next===templateOrientation)return;
 if(templateDirty&&!confirm('Discard unsaved changes to the '+TEMPLATE_NAMES[templateOrientation]+' template?'))return;
 clearNotice('tpl-status');showTemplate(next);
});
for(const type of ['input','change'])el('tpl-form').addEventListener(type,event=>{if(event.target.id!=='tpl-copy-from')templateDirty=true;});
el('tpl-builtin').addEventListener('click',()=>{
 if(el('tpl-description').value.trim()&&!confirm('Replace this description with the built-in one?'))return;
 el('tpl-description').value=builtInDescription;templateDirty=true;
});
el('tpl-copy-from').addEventListener('change',event=>{
 const from=event.target.value;event.target.value='';
 if(!from||from===templateOrientation)return;
 fillTemplateForm(templates[from]||{});templateDirty=true;
 notice('tpl-status','Copied from the '+TEMPLATE_NAMES[from]+' template. Save to keep it for '+TEMPLATE_NAMES[templateOrientation]+'.');
});
el('tpl-save').addEventListener('click',async()=>{
 const orientation=templateOrientation,btn=el('tpl-save');btn.disabled=true;
 notice('tpl-status','Saving the '+TEMPLATE_NAMES[orientation]+' template…');
 try{
  const saved=await request('/api/listing-templates',{orientation,template:readTemplateForm()});
  templates=saved.orientations||templates;showTemplatesUpdated(saved.updatedAt);
  if(templateOrientation===orientation)showTemplate(orientation);
  notice('tpl-status','Saved. The Product Creator now fills new '+TEMPLATE_NAMES[orientation].toLowerCase()+' listings with it.');
 }catch(error){notice('tpl-status',String(error.message||error),true);}
 finally{btn.disabled=false;}
});

const tab=new URL(location.href).searchParams.get('tab');
showTab(['converter','templates','photos'].includes(tab)?tab:'master');
})();