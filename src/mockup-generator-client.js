// Product Creator UI for the shared PC Crop + Mockup Worker.
// The browser uploads inputs and previews results; PSDs are rendered by the shared PC worker.
const panel=document.getElementById('mockup-generator-panel');
if(panel){
const $=id=>document.getElementById(id);
const create=(tag,label='',attrs={})=>{
 const el=document.createElement(tag);el.textContent=label;
 for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
 return el;
};
const owner=crypto.randomUUID();
let templates=[],jobs=[],job=null,preparing=false,requested=false,ready=false;
let activeJobId=null,currentArtworkId='',activeMasterSignature='',lastAppliedBatchId='',appliedCount=0;
let defaultSelectionLoaded=false;
let initialLoad=Promise.resolve(),selectionVersion=0,attachTimer=null,attaching=false;
let previewRenderKey='';
let detectedArtworkOrientation=null,lastAutoOrientation=null;
let orientationDetection=Promise.resolve();
function templateFitsOrientation(template,orientation){
 const stored=String(template?.orientation||'unclassified').toLowerCase();
 return orientation==='square'?stored==='square'||template?.squareCompatible===true:
  stored===orientation;
}
function showOrientation(){
 const label=detectedArtworkOrientation||'not yet detected';
 $('mg-orientation-status').textContent='Artwork: '+label+
  '. Only compatible saved templates are selected automatically. '+
  'For older PSDs, assign their frame orientation below; square use requires explicit compatibility.';
}
async function inspectArtworkOrientation(file){
 if(!file){detectedArtworkOrientation=null;showOrientation();return}
 try{
  const bitmap=await createImageBitmap(file);
  const width=bitmap.width,height=bitmap.height;
  bitmap.close();
  detectedArtworkOrientation=width===height?'square':width>height?'landscape':'portrait';
  showOrientation();
  await loadTemplates();
 }catch{
  $('mg-orientation-status').textContent='Artwork orientation will be verified from the stored R2 master after upload. Do not use mismatched PSD templates.';
 }
}

// Etsy shows 20 photos and up to 20 mockups can be picked (the master artwork
// is never an Etsy photo). With the preset photos that can be more than 20: the
// organizer shows which ones make it. Every compatible template is generated and
// nothing is ticked until the customer picks; "Select first 20" ticks the first
// 20 finished JPGs.
const ETSY_MOCKUP_SLOTS=20;
const selectionByJob=new Map();
const selectionFor=id=>{
 if(!selectionByJob.has(id))selectionByJob.set(id,{chosen:new Set()});
 return selectionByJob.get(id);
};
const firstSlots=j=>new Set(j.templates.filter(t=>t.status==='completed').slice(0,ETSY_MOCKUP_SLOTS).map(t=>t.id));
const isSelected=(id,itemId)=>selectionFor(id).chosen.has(itemId);
function setSelected(id,itemId,checked){
 const selection=selectionFor(id);
 if(checked&&!selection.chosen.has(itemId)&&selection.chosen.size>=ETSY_MOCKUP_SLOTS){
  message('Up to '+ETSY_MOCKUP_SLOTS+' mockups can be picked (Etsy shows 20 photos). Untick one first.',true);
  return false;
 }
 if(checked)selection.chosen.add(itemId);else selection.chosen.delete(itemId);
 return true;
}
let lastStatus='',lastWorker={};
function message(text,warning=false){
 lastStatus=String(text);
 const element=$('mg-progress');element.textContent=lastStatus;element.classList.toggle('warn',warning);
}
const failure=error=>message(error?.message||String(error),true);
function act(fn){Promise.resolve().then(fn).catch(failure)}
async function api(route,method='GET',body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
 try{
  const result=await fetch('/api/mockups/'+route,{method,cache:'no-store',signal:controller.signal,
   ...(method==='GET'?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body||{})})});
  const data=await result.json().catch(()=>({error:'Invalid server response'}));
  if(!result.ok||data.ok!==true)throw Error(data.error||'Mockup request failed (HTTP '+result.status+')');
  return data;
 }catch(error){
  if(error?.name==='AbortError')throw Error('Mockup request timed out; check the app and try again.');
  throw error;
 }finally{clearTimeout(timer)}
}
async function upload(url,file,type){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),360000);
 try{
  const response=await fetch(url,{method:'PUT',headers:{'content-type':type},body:file,signal:controller.signal});
  if(!response.ok)throw Error('R2 upload failed (HTTP '+response.status+').');
 }catch(error){
  if(error?.name==='AbortError')throw Error('File upload took over six minutes. Check your connection and retry.');
  throw error;
 }finally{clearTimeout(timer)}
}
function progress(done,total){$('mg-progress-bar').style.width=(total?Math.round(100*done/total):0)+'%'}
function markRequested(){requested=true;ready=false;panel.dataset.generationRequested='true';panel.dataset.generationReady='false'}
function fileSignature(file){return file?file.name+'|'+file.size+'|'+file.lastModified:''}
function currentBatch(){
 return !!job&&job.id===activeJobId&&activeMasterSignature===fileSignature($('master_file').files?.[0])&&
  (!job.artworkId||job.artworkId===currentArtworkId);
}
function clearCurrentBatch(){
 job=null;activeJobId=null;currentArtworkId='';activeMasterSignature='';
 lastAppliedBatchId='';appliedCount=0;requested=false;ready=false;
 selectionVersion++;
 if(attachTimer){clearTimeout(attachTimer);attachTimer=null}
 if(panel.dataset.generationReady==='true')$('mockup_files').value='';
 panel.dataset.generationReady='false';panel.dataset.generationRequested='false';
 $('artwork_id').value=''; // Changing master must not reuse a previous listing's R2 upload.
 $('mg-download-all').hidden=true;progress(0,0);previewRenderKey='';
 renderResults();renderPreviews();
 $('mg-pause').disabled=true;
 message('New master selected. Previous batches are archived; fresh mockups queue after this artwork uploads.');
}
// PSD generation is optional; draft submission must never wait for the worker.
// The PSDs of this batch that produced no JPG yet, and the folder PSDs left out
// of it, each with the reason, so nothing goes missing without explanation.
function notGenerated(){
 if(!job)return [];
 const rows=job.templates.filter(t=>t.status!=='completed').map(t=>({name:t.name,id:t.id,status:t.status,
  reason:t.status==='needs_mapping'?'Choose its artwork layer: it has more than one possible one.':
   t.status==='failed'?(t.error||'Failed on the PC.')+' Fix the PSD or use Retry failed.':
   t.status==='processing'?'Rendering on the PC now'+(t.progress?' · '+t.progress:'')+'. A large PSD takes a while the first time.':
   'Waiting for the PC worker.'}));
 const inBatch=new Set(job.templates.map(t=>t.id));
 const art=job.artworkOrientation&&job.artworkOrientation!=='unclassified'?job.artworkOrientation:detectedArtworkOrientation;
 for(const t of templates.filter(t=>t.source==='pc'&&t.status==='ready'&&!inBatch.has(t.id)))
  rows.push({name:t.localPath,id:t.id,status:'left-out',reason:t.orientation==='unclassified'
   ?'Not in this batch: not sorted yet. Put it in a Vertical, Horizontal or Square folder, or choose its orientation in the saved templates list.'
   :!art||templateFitsOrientation(t,art)?'Not in this batch: it was added to the folder or sorted after the batch started. Queue the mockups again to include it.'
   :'Not in this batch: it is a '+({portrait:'vertical',landscape:'horizontal',square:'square'}[t.orientation]||t.orientation)+' template.'});
 return rows;
}
function renderPreviews(){
 const completed=job?job.templates.filter(t=>t.status==='completed'):[];
 const missing=notGenerated();
 const signature=(job?.id||'none')+'|'+completed.map(t=>t.id+':'+(t.finishedAt||'')).join(';')+
  '|'+missing.map(row=>row.id+':'+row.status+':'+row.reason).join(';')+
  '|'+completed.map(t=>isSelected(job.id,t.id)?'1':'0').join('')+'|'+attaching+
  '|'+currentBatch()+'|'+lastAppliedBatchId+'|'+appliedCount;
 // Do not continuously tear down and re-download thumbnails on each 6-second poll.
 if(signature===previewRenderKey)return;
 previewRenderKey=signature;
 const list=$('mg-preview-list');const savedScrollTop=list.scrollTop;list.replaceChildren();
 const selected=job?completed.filter(t=>isSelected(job.id,t.id)).length:0;
 $('mg-preview-count').textContent=completed.length+' ready';
 $('mg-selection-status').textContent=!job
  ?'Waiting for this artwork’s generated JPGs. Previous batches are stored under troubleshooting.'
  :!currentBatch()
   ?'Archived batch: these JPGs cannot be applied to a different artwork.'
   :lastAppliedBatchId===job.id
    ?appliedCount+' JPGs selected for Etsy syncing. Confirm the result in generation status.'
    :selected+' of '+completed.length+' JPGs selected. Click Apply selected to listing when ready.';
 $('mg-apply-selected').disabled=!currentBatch()||!selected||attaching;
 $('mg-select-all').disabled=!job;
 $('mg-deselect-all').disabled=!job;
 if(!completed.length){
  list.append(create('p','Finished JPGs will appear here while your PC worker generates them.',{class:'mg-preview-empty'}));
  showNotGenerated(missing);
  return;
 }
 for(const template of completed){
  const row=create('label','',{class:'mg-preview-item'});
  const checkbox=create('input','',{type:'checkbox',value:template.id,
   'aria-label':'Select generated mockup '+template.outputName});
  checkbox.checked=isSelected(job.id,template.id);
  checkbox.addEventListener('change',()=>{
   setSelected(job.id,template.id,checkbox.checked);selectionChanged();
  });
  const image=create('img','',{src:'/api/mockups/jobs/'+job.id+'/thumbnail/'+template.id+'?v='+
    encodeURIComponent(template.finishedAt||'1'),alt:'Generated '+template.outputName,
    loading:'lazy',decoding:'async'});
  const description=create('span',template.outputName);
  description.append(create('small',template.dimensions
   ?template.dimensions.width+' × '+template.dimensions.height:'Ready JPG'));
  row.append(checkbox,image,description);list.append(row);
 }
 showNotGenerated(missing);
 list.scrollTop=savedScrollTop; // Keep review position while new JPGs finish generating.
}
function showNotGenerated(missing){
 const box=$('mg-not-generated');
 box.hidden=!missing.length;box.replaceChildren();
 if(!missing.length)return;
 box.append(create('strong','Not generated ('+missing.length+')'));
 for(const row of missing){
  const item=create('div','',{class:'mg-not-generated-item'});
  item.append(create('b',row.name),create('span',row.reason));
  if(row.status==='needs_mapping'){
   const choose=create('button','Choose artwork layer',{type:'button',class:'btn secondary'});
   choose.addEventListener('click',()=>act(async()=>{await mappingPrompt();$('mg-mapping').scrollIntoView({behavior:'smooth',block:'center'})}));
   item.append(choose);
  }
  box.append(item);
 }
}
function selectionChanged(){
 // Selection is a review step: changing a checkbox must not silently upload JPGs.
 selectionVersion++;markRequested();
 if(attachTimer){clearTimeout(attachTimer);attachTimer=null}
 lastAppliedBatchId='';appliedCount=0;
 const completed=job?job.templates.filter(t=>t.status==='completed'):[];
 const selected=job?completed.filter(t=>isSelected(job.id,t.id)).length:0;
 // Keep mounted thumbnails and scroll offset while selecting individual images.
 for(const checkbox of $('mg-preview-list').querySelectorAll('input[type=checkbox]'))
  checkbox.checked=!!job&&isSelected(job.id,checkbox.value);
 $('mg-selection-status').textContent=selected+' of '+completed.length+
  ' JPGs selected. Review the previews, then click Apply selected to listing.';
 $('mg-apply-selected').disabled=!currentBatch()||!selected||attaching;
 // Allow a later server update to reconcile selections without stale state.
 previewRenderKey=(job?.id||'none')+'|'+completed.map(t=>t.id+':'+(t.finishedAt||'')).join(';')+
  '|'+completed.map(t=>isSelected(job.id,t.id)?'1':'0').join('')+'|'+attaching+
  '|'+currentBatch()+'|'+lastAppliedBatchId+'|'+appliedCount;
}
async function syncGeneratedJpgs(batchId,templateIds){
 const artworkId=$('artwork_id').value.trim();
 if(!artworkId||job?.artworkId!==artworkId)return;
 // Server-to-server R2 copies avoid reuploading large generated JPGs from the browser.
 for(let attempt=0;attempt<90;attempt++){
  try{
   const response=await fetch('/api/artworks/'+encodeURIComponent(artworkId)+'/append-generated-mockups',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jobId:batchId,templateIds})
   });
   const data=await response.json();
   if(response.status===409&&/setup is still running/i.test(data.error||'')){
    message('Waiting for Etsy draft configuration before adding generated JPGs…');
    await new Promise(resolve=>setTimeout(resolve,5000));
    continue;
   }
   if(!response.ok||!data.ok)throw Error(data.error||'PSD mockup sync failed');
   message(data.pendingDraft
    ?'Selected generated JPGs remain saved in R2 until an Etsy draft exists.'
    :data.pendingSetup
     ?'Selected JPGs saved. Etsy draft setup is still running; uploads will resume automatically.'
     :data.verified===true
      ?'Etsy confirmed '+data.uploaded+' selected mockup(s) ('+data.photoCount+'/20 photos).'
      :'Mockups remain saved in R2. Etsy verification has not completed; check the draft before publishing.',
     data.verified!==true&&!data.pendingDraft&&!data.pendingSetup);
   return;
  }catch(error){failure(error);return}
 }
 message('Etsy setup is still busy. Click Apply selected to listing to retry the mockup sync.',true);
}
// "Apply selected to listing" opens the photo organizer: every Etsy photo in
// listing order, to arrange before anything is uploaded.
async function useResults(){
 if(!currentBatch())throw Error('These mockups were created for a different artwork. Create a fresh batch for this master.');
 if(attaching)return;
 const batchId=job.id;
 const selected=job.templates.filter(t=>t.status==='completed'&&isSelected(batchId,t.id)).slice(0,ETSY_MOCKUP_SLOTS);
 if(!selected.length){markRequested();throw Error('Select at least one generated JPG.')}
 const artworkId=job.artworkId||$('artwork_id').value.trim();
 if(!job.artworkId&&artworkId)await linkBatchToArtwork(batchId,artworkId).catch(()=>{});
 await openOrganizer(batchId,selected.map(t=>t.id));
}

// ------------------------------------------------------------ photo organizer
// Laid out like Etsy's "Photo and video" editor: square tiles in rows of six,
// the first photo Featured, and the preset video fixed in the second spot, where
// Etsy shows it. Photos are dragged (mouse, pen or touch) or moved with the
// arrow keys; the other tiles slide out of the way.
let organizer=null;
const VIDEO_TILE='video';
let tileNodes=new Map(),drag=null;
async function openOrganizer(batchId,templateIds){
 const artworkId=job?.artworkId||$('artwork_id').value.trim();
 const query=new URLSearchParams({jobId:batchId,templateIds:templateIds.join(',')});
 if(artworkId)query.set('artworkId',artworkId);
 message('Loading the Etsy photo order…');
 const response=await fetch('/api/etsy-photo-organizer?'+query,{cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.ok)throw Error(data.error||'Could not load the Etsy photos (HTTP '+response.status+').');
 organizer={batchId,templateIds,tiles:new Map(data.tiles.map(t=>[t.id,t])),order:[...data.order],
  mode:data.mode,limit:data.limit||20,video:data.video?(typeof data.video==='object'?data.video:{}):null};
 const modal=$('mg-org-modal');
 if(modal.parentElement!==document.body)document.body.append(modal);
 modal.hidden=false;modal.scrollTop=0;document.body.classList.add('mg-org-open');
 renderOrganizer();
 tileNodes.get(organizer.order[0])?.focus({preventScroll:true});
 message('Arrange the Etsy photos, then save the order.');
}
function closeOrganizer(){
 finishDrag();
 organizer=null;tileNodes=new Map();
 $('mg-org-modal').hidden=true;document.body.classList.remove('mg-org-open');
 $('mg-org-list').replaceChildren();
 renderPreviews();
}
// Tile ids in grid order: the photos, with the video in the second spot.
function organizerDisplay(){
 const ids=[...organizer.order];
 if(organizer.video)ids.splice(Math.min(1,ids.length),0,VIDEO_TILE);
 return ids;
}
function photoTile(id){
 const tile=organizer.tiles.get(id)||{label:id};
 const node=create('div','',{class:'mg-org-tile',role:'listitem',tabindex:'0',title:tile.label||''});
 if(tile.thumb)node.append(create('img','',{src:tile.thumb,alt:'',draggable:'false'}));
 else node.append(create('div',tile.label||'Photo',{class:'mg-org-blank'}));
 node.append(create('b','Featured',{class:'mg-org-badge'}),create('span',tile.label||'',{class:'mg-org-caption'}));
 node.addEventListener('pointerdown',event=>pressTile(event,id,node));
 node.addEventListener('keydown',event=>keyMove(event,id));
 return node;
}
function videoTile(){
 const label=organizer.video.label||'Preset video';
 const node=create('div','',{class:'mg-org-tile mg-org-video',role:'listitem',
  'aria-label':label+', Featured video. Etsy shows it second.',title:label+': Etsy shows it in the second spot.'});
 if(organizer.video.src){
  const video=create('video','',{src:organizer.video.src+'#t=0.5',preload:'metadata',muted:'',playsinline:'','aria-hidden':'true'});
  video.muted=true;video.addEventListener('error',()=>video.remove());
  node.append(video);
 }
 node.append(create('span','',{class:'mg-org-play','aria-hidden':'true'}),create('b','Featured',{class:'mg-org-badge'}),
  create('span',label,{class:'mg-org-caption'}));
 return node;
}
function renderOrganizer(){
 if(!organizer)return;
 tileNodes=new Map(organizer.order.map(id=>[id,photoTile(id)]));
 if(organizer.video)tileNodes.set(VIDEO_TILE,videoTile());
 const list=$('mg-org-list');
 list.replaceChildren();
 const count=organizer.order.length,over=Math.max(0,count-organizer.limit),remaining=organizer.limit-count;
 // Etsy shows 20 photos: photos moved below this line are not added.
 if(over)list.append(create('div','Etsy shows '+organizer.limit+' photos · the '+over+' below this line '+
  (over===1?'is':'are')+' not added',{class:'mg-org-limit',role:'separator'}));
 if(remaining>0)list.append(create('div',remaining+' more photo'+(remaining===1?'':'s')+' can be added',
  {class:'mg-org-slot','aria-hidden':'true'}));
 placeTiles();
 refreshTiles();
 $('mg-org-count').textContent=Math.min(count,organizer.limit)+' of '+organizer.limit+' photos'+
  (organizer.video?' and 1 video':'')+(over?' · '+over+' more below the line':'');
 $('mg-org-status').textContent=(over?'Drag the photos you want into the first '+organizer.limit+'. ':'')+
  (organizer.mode==='live'?'Saving re-orders the photos on the Etsy draft.':
  'Nothing is uploaded yet. This order is used when the Etsy draft is created.');
 $('mg-org-save').textContent=organizer.mode==='live'?'Save order to Etsy':'Save order';
}
// Puts the tiles in the page in the current order, with Etsy's 20-photo line
// after the 20th photo.
function placeTiles(){
 const list=$('mg-org-list'),line=list.querySelector('.mg-org-limit'),end=list.querySelector('.mg-org-slot');
 let photos=0;
 for(const id of organizerDisplay()){
  list.insertBefore(tileNodes.get(id),end);
  if(id!==VIDEO_TILE&&++photos===organizer.limit&&line)list.insertBefore(line,end);
 }
}
// The Featured badge on the first photo; photos past Etsy's 20 are dimmed.
function markTiles(){
 organizer.order.forEach((id,index)=>{
  const node=tileNodes.get(id);
  node.querySelector('.mg-org-badge').hidden=index!==0;
  node.classList.toggle('over',index>=organizer.limit);
 });
}
function refreshTiles(){
 markTiles();
 const total=organizer.order.length;
 organizer.order.forEach((id,index)=>{
  tileNodes.get(id).setAttribute('aria-label','Photo '+(index+1)+' of '+total+(index===0?', Featured':'')+
   (index>=organizer.limit?', not added (Etsy shows '+organizer.limit+')':'')+': '+(organizer.tiles.get(id)?.label||'Photo'));
 });
}
// Puts the tiles in the current order; moved tiles slide from where they were.
function arrange(){
 const list=$('mg-org-list'),nodes=[...tileNodes.values()];
 const animate=!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const before=new Map(nodes.map(node=>[node,node.getBoundingClientRect()]));
 placeTiles();
 refreshTiles();
 if(!animate)return;
 for(const node of nodes){node.style.transition='none';node.style.transform=''}
 const moved=[];
 for(const node of nodes){
  const was=before.get(node),now=node.getBoundingClientRect();
  const dx=was.left-now.left,dy=was.top-now.top;
  if(Math.abs(dx)<1&&Math.abs(dy)<1)continue;
  node.style.transform='translate('+dx+'px,'+dy+'px)';moved.push(node);
 }
 void list.offsetWidth;
 for(const node of moved){node.style.transition='transform .18s ease';node.style.transform=''}
}
function moveTo(id,to){
 const from=organizer.order.indexOf(id);
 to=Math.max(0,Math.min(organizer.order.length-1,to));
 if(from<0||from===to)return false;
 organizer.order.splice(from,1);organizer.order.splice(to,0,id);
 arrange();
 return true;
}
function announce(id){
 const index=organizer.order.indexOf(id);
 $('mg-org-live').textContent=(organizer.tiles.get(id)?.label||'Photo')+' moved to photo '+(index+1)+
  (index===0?', the Featured photo.':'.');
}
function keyMove(event,id){
 if(!organizer||drag)return;
 const from=organizer.order.indexOf(id);
 const columns=getComputedStyle($('mg-org-list')).gridTemplateColumns.split(' ').length||6;
 const target={ArrowLeft:from-1,ArrowRight:from+1,ArrowUp:from-columns,ArrowDown:from+columns,
  Home:0,End:organizer.order.length-1}[event.key];
 if(target===undefined)return;
 event.preventDefault();
 if(moveTo(id,target))announce(id);
 tileNodes.get(id).focus({preventScroll:false});
}
// The photo itself is dragged: it lifts the moment it is pressed, follows the
// pointer and lands the moment it is let go. While dragging nothing in the page
// is measured or re-laid out: every tile is its own layer (see the CSS), the
// other tiles slide to their new spots with transforms from spot positions
// measured at the press, and at most one update runs per frame. The tiles take
// their new order in the page on release.
function pressTile(event,id,node){
 if(!organizer||drag||event.button!==0)return;
 event.preventDefault(); // no text selection or native image drag
 node.focus({preventScroll:true});
 const list=$('mg-org-list'),display=organizerDisplay();
 for(const tile of tileNodes.values()){tile.style.transition='';tile.style.transform=''}
 const box=list.getBoundingClientRect();
 drag={id,node,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,
  frame:0,start:[...organizer.order],box,box0:box,
  home:new Map(display.map((tileId,slot)=>[tileId,slot])),
  slots:display.map(tileId=>{const tile=tileNodes.get(tileId);return {x:tile.offsetLeft,y:tile.offsetTop}})};
 list.classList.add('sorting');node.classList.add('dragging');document.body.classList.add('mg-org-dragging');
 node.style.transform='translate3d(0,0,0) scale(1.04)';
 window.addEventListener('pointermove',dragMove);
 window.addEventListener('pointerup',dragEnd);
 window.addEventListener('pointercancel',dragEnd);
}
function dragMove(event){
 if(!drag||event.pointerId!==drag.pointerId)return;
 drag.x=event.clientX;drag.y=event.clientY;
 if(!drag.frame)drag.frame=requestAnimationFrame(dragFrame);
}
function dragFrame(){
 if(!drag)return;
 drag.frame=0;
 // Follows the pointer, also while the dialog scrolls under it.
 const dx=drag.x-drag.startX-(drag.box.left-drag.box0.left),dy=drag.y-drag.startY-(drag.box.top-drag.box0.top);
 drag.node.style.transform='translate3d('+dx+'px,'+dy+'px,0) scale(1.04)';
 const modal=$('mg-org-modal');
 if(drag.y<60)modal.scrollTop-=14;else if(drag.y>innerHeight-60)modal.scrollTop+=14;
 // The spot nearest the dragged photo; the video's spot is fixed.
 const home=drag.slots[drag.home.get(drag.id)];
 const id=organizerDisplay()[nearestSlot(home.x+dx,home.y+dy)];
 if(id===undefined||id===VIDEO_TILE||id===drag.id)return;
 const from=organizer.order.indexOf(drag.id),to=organizer.order.indexOf(id);
 organizer.order.splice(from,1);organizer.order.splice(to,0,drag.id);
 slideTiles();
}
function nearestSlot(x,y){
 let best=0,distance=Infinity;
 drag.slots.forEach((slot,index)=>{
  const d=(slot.x-x)**2+(slot.y-y)**2;
  if(d<distance){distance=d;best=index}
 });
 return best;
}
// Shows the other tiles at their new spots (relative to where they sit in the page).
function slideTiles(){
 organizerDisplay().forEach((id,slot)=>{
  if(id===drag.id)return;
  const tile=tileNodes.get(id),from=drag.slots[drag.home.get(id)],to=drag.slots[slot];
  const dx=to.x-from.x,dy=to.y-from.y;
  tile.style.transform=dx||dy?'translate3d('+dx+'px,'+dy+'px,0)':'';
 });
 markTiles();
}
function dragEnd(event){
 if(!drag||event.pointerId!==drag.pointerId)return;
 const {id,start}=drag,moved=event.type==='pointerup'&&start.join()!==organizer.order.join();
 finishDrag();
 if(moved)announce(id);
 tileNodes.get(id)?.focus({preventScroll:true});
}
function finishDrag(){
 window.removeEventListener('pointermove',dragMove);
 window.removeEventListener('pointerup',dragEnd);
 window.removeEventListener('pointercancel',dragEnd);
 if(!drag)return;
 const {node,frame,start}=drag;
 drag=null;
 if(frame)cancelAnimationFrame(frame);
 // Lands at once: the tiles take their new order in the page and lose their
 // transforms in the same frame.
 const list=$('mg-org-list');
 list.classList.remove('sorting');node.classList.remove('dragging');document.body.classList.remove('mg-org-dragging');
 for(const tile of tileNodes.values())tile.style.transform='';
 if(!organizer)return;
 if(start.join()!==organizer.order.join())placeTiles();
 refreshTiles();
}
function cancelDrag(){
 if(!drag)return false;
 if(organizer)organizer.order=drag.start;
 finishDrag();
 return true;
}
async function saveOrderToServer(artworkId,{batchId,templateIds,order}){
 const response=await fetch('/api/etsy-photo-organizer',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({artworkId,jobId:batchId,templateIds,order})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.ok)throw Error(data.error||'Could not save the Etsy photo order (HTTP '+response.status+').');
 return data;
}
async function saveOrganizer(){
 if(!organizer||attaching)return;
 const {batchId,templateIds,order}=organizer;
 const artworkId=job?.artworkId||$('artwork_id').value.trim();
 lastAppliedBatchId=batchId;appliedCount=templateIds.length;
 ready=true;requested=true;
 panel.dataset.generationRequested='true';panel.dataset.generationReady='true';
 if(!artworkId){
  // No artwork ID or folders until the Etsy draft is created: keep the choice
  // and order, and add the photos in this order once the draft's artwork exists.
  pendingApply={batchId,templateIds,order:[...order]};
  closeOrganizer();
  message('Photo order saved. These '+templateIds.length+' mockups are added in this order when you create the Etsy draft.');
  return;
 }
 attaching=true;$('mg-org-save').disabled=true;
 message('Saving the photo order to Etsy…');
 try{
  const data=await saveOrderToServer(artworkId,{batchId,templateIds,order});
  closeOrganizer();
  message(data.sync?.pendingSetup||data.sync?.pendingDraft||data.order?.pending
   ?'Order saved. The photos are added and arranged as soon as the Etsy draft is ready.'
   :data.order?.applied&&data.order.matches===false
    ?'Photos saved to Etsy, but Etsy did not confirm the full order. Open the listing to check.'
    :'Etsy photos saved in this order.');
 }finally{attaching=false;$('mg-org-save').disabled=false}
}
async function loadTemplates(){
 templates=(await api('templates')).templates;
 showPcFolderStatus(lastWorker);
 const selected=new Set([...$('mg-templates').querySelectorAll('input.mg-template-choice:checked')].map(x=>x.value));
 if(detectedArtworkOrientation&&lastAutoOrientation!==detectedArtworkOrientation){
  selected.clear();
  // Generate every compatible mockup (each takes about a second); up to 20
  // are chosen for Etsy afterwards.
  for(const t of templates.filter(t=>t.status==='ready'&&templateFitsOrientation(t,detectedArtworkOrientation)))
   selected.add(t.id);
  lastAutoOrientation=detectedArtworkOrientation;
 }
 defaultSelectionLoaded=true;
 const box=$('mg-templates');box.replaceChildren();
 $('mg-saved-count').textContent='('+templates.filter(t=>t.status==='ready').length+')';
 for(const template of templates){
  const row=create('label'),cb=create('input','',{type:'checkbox',value:template.id,class:'mg-template-choice'});
  const compatible=!detectedArtworkOrientation||templateFitsOrientation(template,detectedArtworkOrientation);
  cb.disabled=template.status!=='ready'||!compatible;
  cb.checked=!cb.disabled&&selected.has(template.id);
  const title=create('span',(template.source==='pc'?template.localPath:template.name)+(template.mapping?' · mapped':' · map Smart Object'));
  // From the mockup folder on the PC: used straight from the file.
  if(template.source==='pc')title.append(create('span','PC',{class:'mg-pc-tag',title:'In the mockup folder on the PC'}));
  const orientation=create('select','',{'aria-label':'Template orientation for '+template.name});
  for(const [id,label] of [['unclassified','Unclassified'],['portrait','Vertical'],['landscape','Horizontal'],['square','Square']]){
   const opt=create('option',label,{value:id});
   orientation.append(opt);
  }
  orientation.value=template.orientation||'unclassified';
  orientation.addEventListener('change',()=>act(async()=>{
   await api('templates/'+template.id+'/update','POST',{orientation:orientation.value});
   await loadTemplates();
  }));
  const square=create('input','',{type:'checkbox',
   'aria-label':'Square-compatible Smart Object for '+template.name});
  square.checked=template.squareCompatible===true;
  square.addEventListener('change',()=>act(async()=>{
   await api('templates/'+template.id+'/update','POST',{squareCompatible:square.checked});
   await loadTemplates();
  }));
  const squareLabel=create('span','Square-safe');
  row.append(cb,title,orientation,square,squareLabel);
  box.append(row);
 }
 if(!templates.length)box.append(create('p','No PSD templates saved yet. Upload vertical or horizontal PSDs above.'));
 // Folder PSDs without an orientation yet are left out of batches: say which.
 const unsorted=templates.filter(t=>t.source==='pc'&&t.status==='ready'&&t.orientation==='unclassified');
 if(detectedArtworkOrientation&&unsorted.length)
  message(unsorted.length+' PSD'+(unsorted.length===1?'':'s')+' in the mockup folder '+(unsorted.length===1?'is':'are')+
   ' not sorted yet and left out: '+unsorted.slice(0,6).map(t=>t.localPath).join(', ')+(unsorted.length>6?'…':'')+
   '. Put them in a Vertical, Horizontal or Square folder, or choose their orientation in the saved templates list.',true);
 if(detectedArtworkOrientation&&!templates.some(t=>t.status==='ready'&&templateFitsOrientation(t,detectedArtworkOrientation)))
  message('No '+detectedArtworkOrientation+'-compatible templates yet. Upload them or classify saved PSDs before generating.',true);
}
// Permanent PSD upload is not dependent on a master artwork or the PC renderer.
// Browser uploads up to two large PSDs at once; saved R2 templates survive refresh.
let libraryUploadPromise=null,libraryUploadAgain=false,libraryUploadTimer=null;
const libraryInputs=['mg-psds','mg-psds-horizontal'];
const selectedLibraryFiles=()=>[
 ...[...$('mg-psds').files].map(file=>({file,orientation:'portrait',inputId:'mg-psds'})),
 ...[...$('mg-psds-horizontal').files].map(file=>({file,orientation:'landscape',inputId:'mg-psds-horizontal'}))
];
const libraryFileSignature=files=>files.map(f=>[f.name,f.size,f.lastModified].join(':')).join('|');
async function uploadTemplateSelection(){
 const snapshot=selectedLibraryFiles(),status=$('mg-library-upload-status');
 if(!snapshot.length)return [];
 const collection=$('mg-collection').value.trim()||'Default Collection';
 const signatures=new Map(libraryInputs.map(id=>[id,libraryFileSignature([...$(id).files])]));
 const seen=new Set();
 const pending=snapshot.filter(({file,orientation})=>{
  const fingerprint=[orientation,collection,file.name,file.size].join('|');
  if(seen.has(fingerprint))return false;
  seen.add(fingerprint);return true;
 });
 let index=0,processed=0;
 const added=[],already=[],errors=[];
 $('mg-save-templates').disabled=true;
 const progress=()=>{
  status.classList.toggle('warn',errors.length>0);
  status.textContent='Saving permanent PSD templates: '+processed+'/'+pending.length+
   ' checked, '+added.length+' uploaded, '+already.length+' already saved'+
   (errors.length?', '+errors.length+' failed':'')+
   '. Keep this page open until saving finishes.';
  $('mg-saved-count').textContent='('+templates.filter(t=>t.status==='ready').length+')';
 };
 progress();
 const worker=async()=>{
  while(index<pending.length){
   const {file,orientation}=pending[index++];
   try{
    const previous=templates.find(t=>t.status==='ready'&&t.name===file.name&&
     Number(t.size)===file.size&&t.orientation===orientation&&t.collection===collection);
    if(previous){already.push(previous);continue}
    const reserved=await api('templates','POST',{name:file.name,size:file.size,
     orientation,collection});
    await upload(reserved.uploadUrl,file,'application/octet-stream');
    const confirmed=await api('templates/'+reserved.template.id+'/confirm','POST');
    templates.push(confirmed.template);added.push(confirmed.template);
   }catch(error){errors.push(file.name+': '+String(error?.message||error))}
   finally{processed++;progress()}
  }
 };
 await Promise.all([worker(),worker()]);
 const successful=[...added,...already];
 for(const inputId of libraryInputs){
  const original=signatures.get(inputId),current=libraryFileSignature([...$(inputId).files]);
  const grouped=pending.filter(item=>item.inputId===inputId);
  if(original&&original===current&&grouped.every(item=>
    successful.some(t=>t.name===item.file.name&&Number(t.size)===item.file.size&&
      t.orientation===item.orientation)))$(inputId).value='';
 }
 await loadTemplates();
 let count=[...$('mg-templates').querySelectorAll('input.mg-template-choice:checked')].length;
 for(const cb of $('mg-templates').querySelectorAll('input.mg-template-choice')){
  if(!cb.checked&&!cb.disabled&&successful.some(t=>t.id===cb.value)){
   cb.checked=true;count++;
  }
 }
 if(added.length)$('mg-saved-details').open=true;
 status.classList.toggle('warn',!!errors.length);
 status.textContent=added.length+' new PSDs permanently saved; '+already.length+
  ' previously saved. Total library: '+templates.filter(t=>t.status==='ready').length+
  '. '+(errors.length?'Failed: '+errors.slice(0,3).join('; ')+'. Click Save to retry.':
   'You can now generate mockups for a matching artwork. No reupload is needed later.');
 if(errors.length)throw Error(errors.length+' template uploads failed; saved templates were preserved.');
 return added.map(t=>t.id);
}
async function uploadTemplates(){
 if(libraryUploadPromise){libraryUploadAgain=true;return libraryUploadPromise}
 libraryUploadPromise=(async()=>{
  let created=[],passes=0;
  do{
   libraryUploadAgain=false;
   created.push(...await uploadTemplateSelection());
   passes++;
  }while(libraryUploadAgain&&selectedLibraryFiles().length&&passes<5);
  return created;
 })();
 try{return await libraryUploadPromise}
 finally{libraryUploadPromise=null;$('mg-save-templates').disabled=false}
}
function scheduleTemplateLibraryUpload(){
 if(libraryUploadTimer)clearTimeout(libraryUploadTimer);
 const count=selectedLibraryFiles().length;
 if(!count)return;
 $('mg-library-upload-status').textContent=count+
  ' vertical/horizontal PSD files selected; permanent storage starts shortly.';
 libraryUploadTimer=setTimeout(()=>{
  libraryUploadTimer=null;
  void uploadTemplates().catch(error=>{
   const status=$('mg-library-upload-status');status.classList.add('warn');
   status.textContent+=' '+String(error?.message||error);
  });
 },1100);
}
async function loadJobs(){
 jobs=(await api('jobs')).jobs;
 const list=$('mg-jobs');list.replaceChildren();
 for(const saved of jobs.slice(0,40)){
  const row=create('div','',{class:'mg-item'});
  const label=create('span');
  label.append(create('strong',saved.filename),create('small',
   saved.status+' · '+saved.templates.filter(t=>t.status==='completed').length+'/'+saved.templates.length));
  const button=create('button',job?.id===saved.id?'Selected':'Open',{type:'button'});
  button.addEventListener('click',()=>act(()=>showJob(saved.id)));
  row.append(label,button);list.append(row);
 }
}
async function workerStatus(){
 try{
  const response=await fetch('/api/crop-worker/status',{cache:'no-store'});
  const data=await response.json(),worker=data.worker||{};
  lastWorker=worker;
  const version=String(worker.version||'0').split('.').map(Number);
  const fixed=worker.online&&worker.mockups===true&&
   (version[0]>4||(version[0]===4&&version[1]>=5));
  // Outdated, downloading, waiting to install, updating or a failed update.
  const text=worker.updateText&&(fixed||worker.updating)?worker.updateText:fixed
   ?'Shared PC Crop + Mockup Worker v'+worker.version+' online'+(worker.busy?' · processing':' · idle')
   :worker.online&&worker.mockups===true
    ?'PC worker v'+(worker.version||'unknown')+' still uses Photoshop/Photopea. Update the worker folder, run setup-worker.cmd and restart (v4.5.0 renders PSDs on its own).'
    :worker.online?'Old crop-only worker online. Update the PC worker folder, run setup-worker.cmd and restart.'
    :worker.configured?'Shared PC worker offline · use Launch Shared Crop Worker above'
    :'Shared PC worker not configured in Render';
  $('mg-worker-status').textContent=text;
  showPcFolderStatus(worker);
  $('mg-worker-status').style.color=fixed&&!worker.updateText?'#477153':'#a46b3d';
  return fixed;
 }catch{
  $('mg-worker-status').textContent='Could not check PC worker connection';
  return false;
 }
}
// ------------------------------------------------ mockup folder on the PC
let pcFolderSaved='';
async function loadPcFolder(){
 try{pcFolderSaved=(await api('pc-folder')).folder||'';$('mg-pc-folder').value=pcFolderSaved;showPcFolderStatus(lastWorker)}
 catch{} // older servers have no folder setting
}
function showPcFolderStatus(worker){
 const status=$('mg-pc-folder-status'),found=worker?.mockupFolder;
 status.classList.remove('warn');
 if(found?.fromConfig){status.textContent='The PC worker uses '+found.path+' (set in its config.local.json) · '+found.count+' PSD'+(found.count===1?'':'s')+'.';return}
 if(!pcFolderSaved){status.textContent='Optional. Leave empty to upload PSDs below instead.';return}
 if(!worker?.online){status.textContent='Saved. The PC worker reads the folder once it is online.';return}
 if(!found||found.path!==pcFolderSaved){status.textContent='Saved. The PC worker picks it up within a few seconds.';return}
 if(found.error){status.classList.add('warn');status.textContent=found.error+' Check the path on the PC.';return}
 // How the PSDs were sorted: by their Vertical, Horizontal or Square subfolder.
 const pc=templates.filter(t=>t.source==='pc'&&t.status==='ready'),count=kind=>pc.filter(t=>t.orientation===kind).length;
 const sorted=[[count('portrait'),'vertical'],[count('landscape'),'horizontal'],[count('square'),'square'],
  [count('unclassified'),'not sorted yet']].filter(([n])=>n).map(([n,label])=>n+' '+label).join(', ');
 status.textContent='The PC worker sees '+found.count+' PSD'+(found.count===1?'':'s')+' in this folder'+
  (sorted?' ('+sorted+')':'')+'. New and edited ones appear below within 15 seconds; templates uploaded earlier are hidden while the folder is in use.';
}
async function savePcFolder(){
 pcFolderSaved=(await api('pc-folder','POST',{folder:$('mg-pc-folder').value})).folder||'';
 $('mg-pc-folder').value=pcFolderSaved;
 showPcFolderStatus(lastWorker);
 message(pcFolderSaved?'Mockup folder saved. Its PSDs appear in the saved templates list within a few seconds.':'Mockup folder cleared.');
 // The worker reports the folder on its next scan; refresh the list after it.
 setTimeout(()=>{void loadTemplates().then(()=>workerStatus()).catch(()=>{})},20000);
}
function renderResults(){
 const list=$('mg-results');list.replaceChildren();
 if(!job)return;
 for(const t of job.templates){
  const row=create('div','',{class:'mg-item'}),caption=create('span');
  caption.append(create('strong',t.outputName),create('small',
    t.status+(t.progress?' · '+t.progress:'')+(t.error?' — '+t.error:'')));
  row.append(caption);
  if(t.status==='completed'){
   row.append(create('a','Download JPG',{href:'/api/mockups/jobs/'+job.id+'/download/'+t.id+'?direct=1',download:t.outputName}));
   const remove=create('button','Delete JPG',{type:'button'});
   remove.addEventListener('click',()=>act(async()=>{
    if(!confirm('Delete '+t.outputName+'?'))return;
    await api('jobs/'+job.id+'/download/'+t.id,'DELETE');await showJob(job.id);
   }));
   row.append(remove);
  }
  list.append(row);
 }
}
async function mappingPrompt(){
 const blocked=job?.templates.find(t=>t.status==='needs_mapping');
 const box=$('mg-mapping');
 if(!blocked){box.hidden=true;return}
 let template=templates.find(t=>t.id===blocked.id);
 if(!template?.smartObjects?.length){
  await loadTemplates();
  template=templates.find(t=>t.id===blocked.id);
 }
 // Older saved templates stored their smart objects without `kind`.
 const objects=(template?.smartObjects||[]).filter(t=>(t.kind==='smart'||!t.kind)&&t.visible);
 if(!objects.length){box.hidden=true;return}
 box.hidden=false;
 $('mg-map-file').textContent=blocked.name+' — select the artwork Smart Object (hidden layers remain hidden).';
 const select=$('mg-map-select');select.replaceChildren();
 for(const t of objects)select.append(create('option',t.name+' ['+t.path+']',{value:t.path}));
 if(objects.length===1)select.value=objects[0].path;
}
async function showJob(id,{quiet=false}={}){
 const previous=job?.status;
 job=(await api('jobs/'+id)).job;
 const count=job.templates.filter(t=>t.status==='completed').length;
 progress(count,job.templates.length);
 const zip=$('mg-download-all');
 zip.href='/api/mockups/jobs/'+job.id+'/download-all';zip.hidden=!count;
 renderResults();renderPreviews();
 const active=job.templates.find(t=>t.status==='processing');
 if(!currentBatch()){
  message('Viewing saved batch for '+job.filename+'. These JPGs cannot attach to the current artwork.');
  $('mg-generate').disabled=preparing;
  $('mg-pause').disabled=job.status==='completed'||job.paused;
  if(!quiet)await mappingPrompt();
  return job;
 }
 const failed=job.templates.filter(t=>['failed','needs_mapping'].includes(t.status));
 if(active){
  const age=Date.now()-Date.parse(active.progressAt||active.startedAt||job.createdAt);
  const stalled=Number.isFinite(age)&&age>70000&&/inspect/i.test(active.progress||'');
  message(active.name+' — '+(active.progress||'Processing on PC')+
    (Number.isFinite(age)&&age>0?' · '+Math.floor(age/1000)+'s since update':'')+
    ' ('+count+'/'+job.templates.length+')'+
    (stalled?' · Inspection is taking too long. Check the PC worker log if no error appears.':''),stalled);
 }
 else if(job.status==='completed')message('All '+count+' mockups generated on the PC. Select your Etsy images.');
 else if(job.paused)message('Paused after current PSD · '+count+'/'+job.templates.length+' ready');
 else if(failed.length){
  // Show why, not just how many, so the reason is visible without expanding the list.
  const first=failed[0];
  message(failed.length+' mockups need attention · '+count+'/'+job.templates.length+' ready · '+
   first.name+': '+(first.status==='needs_mapping'?'choose the artwork layer':first.error||'failed'),true);
 }
 else{
  // Say why this batch is waiting when the worker is busy elsewhere.
  const w=lastWorker,elsewhere=w.online&&w.busy&&w.jobId!==job.id;
  message((elsewhere
   ?(w.jobId?'PC worker is finishing another job first':'PC worker is busy with '+(w.activeApp||'another shop')+'; this batch is next')
   :'Waiting for shared PC worker')+' · '+count+'/'+job.templates.length+' ready');
 }
 $('mg-generate').disabled=preparing;
 $('mg-pause').disabled=!job||job.status==='completed'||job.paused;
 if(!quiet||failed.some(t=>t.status==='needs_mapping'))await mappingPrompt();
 // Keep finished JPGs visible for review; only the Apply button attaches them.
 return job;
}
// The shared PC worker listens on this computer for artwork from this browser.
const LOCAL_WORKER='http://127.0.0.1:47823';
async function handToWorker(created,file){
 const token=created.localUpload?.token;
 if(!token)return false;
 const query=new URLSearchParams({job:created.job.id,key:created.job.artworkKey,
  size:String(created.job.artworkSize),filename:created.job.filename,token});
 try{
  const response=await fetch(LOCAL_WORKER+'/artwork?'+query,{method:'PUT',body:file,
   headers:{'content-type':'application/octet-stream'},signal:AbortSignal.timeout(180000)});
  return response.ok;
 }catch{return false} // worker not running here, or the browser blocked it: upload to R2
}
let jobCreation=null,pendingApply=null,pendingApplySaved=Promise.resolve();
async function linkBatchToArtwork(batchId,artworkId){
 if(!batchId||!artworkId)return;
 if(!(job?.id===batchId&&job.artworkId===artworkId)){
  job=(await api('jobs/'+batchId+'/link-artwork','POST',{artworkId})).job;
  await showJob(batchId,{quiet:true});
 }
 // Mockups chosen (and arranged) before the draft existed are added now.
 if(pendingApply?.batchId===batchId){
  const pending=pendingApply;pendingApply=null;
  pendingApplySaved=pending.order?saveOrderToServer(artworkId,pending):syncGeneratedJpgs(batchId,pending.templateIds);
  await pendingApplySaved;
 }
}
// Called by the Product Creator just before it creates the Etsy draft: the
// mockups chosen and arranged for it are saved first, so draft setup adds them
// straight after the preset photos instead of racing the draft.
window.mockupSelectionBeforeDraft=async artworkId=>{
 await (jobCreation||Promise.resolve()).catch(()=>{});
 if(activeJobId&&artworkId)await linkBatchToArtwork(activeJobId,artworkId).catch(failure);
 await pendingApplySaved.catch(()=>{});
};
function createJob(options){
 if(jobCreation)return jobCreation;
 jobCreation=createJobNow(options).finally(()=>{jobCreation=null});
 return jobCreation;
}
async function createJobNow({artworkId='',automatic=false}={}){
 if(preparing)return;
 if(automatic&&!$('mg-auto-queue').checked)return;
 preparing=true;$('mg-generate').disabled=true;
 try{
  await initialLoad;
  await orientationDetection;
  const art=$('master_file').files?.[0];
  if(!art)throw Error('Choose the master artwork above first.');
  await uploadTemplates();
  const ids=[...$('mg-templates').querySelectorAll('input.mg-template-choice:checked')].map(x=>x.value);
  if(!ids.length)throw Error('Choose saved PSD templates or upload new ones.');
  markRequested();
  const signature=fileSignature(art);
  // Never reuse a prior batch by filename and byte count alone.
  const uploaded=artworkId||$('artwork_id').value.trim();
  let freshJob;
  if(uploaded){
   message('Queueing new PSD mockups from the confirmed R2 master '+uploaded+'…');
   freshJob=(await api('jobs/from-artwork','POST',{
    artworkId:uploaded,templateIds:ids,fitMode:'cover'
   })).job;
   currentArtworkId=uploaded;
  }else{
   // Start rendering now: the PC worker on this computer takes the file
   // directly (a local copy), while the master still uploads to R2 for Etsy.
   const result=await api('jobs','POST',{filename:art.name,size:art.size,templateIds:ids,fitMode:'cover'});
   message('Handing the artwork to the PC worker on this computer…');
   const local=await handToWorker(result,art);
   if(!local){
    message('Uploading the master artwork for this new PC batch…');
    await upload(result.uploadUrl,art,'application/octet-stream');
   }
   await api('jobs/'+result.job.id+'/artwork-confirm','POST',{local});
   freshJob=(await api('jobs/'+result.job.id)).job;
   if(local)message('Artwork handed to the PC worker; mockups are rendering.');
  }
  job=freshJob;activeJobId=job.id;activeMasterSignature=signature;
  await showJob(job.id);await loadJobs();await workerStatus();
 }finally{preparing=false;$('mg-generate').disabled=false}
}
async function resume(){
 if(!job)throw Error('Select a saved batch.');
 job=(await api('jobs/'+job.id+'/control','POST',{owner,action:'resume'})).job;
 await showJob(job.id);
}
async function pause(){
 if(!job)throw Error('Select a batch.');
 job=(await api('jobs/'+job.id+'/control','POST',{owner,action:'pause'})).job;
 message('Pause requested. The PC will finish its current PSD, then stop.');
 await showJob(job.id);
}
async function retry(){
 if(!job)throw Error('Select a batch.');
 job=(await api('jobs/'+job.id+'/control','POST',{owner,action:'retry'})).job;
 markRequested();await showJob(job.id);
}
async function regenerate(){
 if(!job)throw Error('Select a batch.');
 if(!confirm('Regenerate every PSD mockup on your PC? Existing verified JPGs remain stored until replacements pass checks.'))return;
 job=(await api('jobs/'+job.id+'/control','POST',{owner,action:'regenerate'})).job;
 markRequested();await showJob(job.id);
}
async function saveMapping(){
 if(!job)throw Error('Select a batch with a mapping error.');
 const blocked=job.templates.find(t=>t.status==='needs_mapping');
 if(!blocked)throw Error('No artwork layer needs mapping.');
 const path=$('mg-map-select').value;
 const template=templates.find(t=>t.id===blocked.id);
 if(!template?.smartObjects?.some(x=>(x.kind==='smart'||!x.kind)&&x.visible&&x.path===path))
  throw Error('Choose a visible artwork Smart Object.');
 await api('templates/'+blocked.id+'/update','POST',{mapping:{path}});
 await loadTemplates();
 $('mg-mapping').hidden=true;
 await retry();
}
function selectSeven(){
 const ready=[...$('mg-templates').querySelectorAll('input.mg-template-choice')].filter(cb=>!cb.disabled);
 ready.forEach((cb,index)=>{cb.checked=index<7});
 message('Selected '+Math.min(7,ready.length)+' PSD templates. Queue only when needed; Etsy drafts do not wait.');
}
function selectAllCompatible(){
 const available=[...$('mg-templates').querySelectorAll('input.mg-template-choice')].filter(cb=>!cb.disabled);
 available.forEach(cb=>{cb.checked=true});
 message('Selected all '+available.length+' compatible PSDs. Pick the '+ETSY_MOCKUP_SLOTS+' for Etsy once they are generated.');
}
function clearTemplates(){
 for(const cb of $('mg-templates').querySelectorAll('input.mg-template-choice'))cb.checked=false;
 message('No PSD templates selected. You can create the Etsy draft now.');
}
$('mockup_files').addEventListener('change',()=>{
 if($('mockup_files').files.length){
  requested=false;ready=false;panel.dataset.generationRequested='false';
  panel.dataset.generationReady='false';
  message('Using manually selected JPG mockups for this Etsy listing.');
 }
});
$('master_file').addEventListener('change',()=>{
 clearCurrentBatch();
 lastAutoOrientation=null;
 orientationDetection=inspectArtworkOrientation($('master_file').files?.[0]);
 // Master selection, not Create Etsy Draft, starts mockup rendering.
 // This direct job owns a fresh copy of the selected master; if draft upload
 // completes later, the artwork-uploaded event must not create a second job.
 const file=$('master_file').files?.[0];
 if(file&&$('mg-auto-queue').checked){
  // Mockups start straight away from the selected file. The master also goes to
  // R2 staging now (Product Creator); its artwork ID and folders are created with
  // the Etsy draft, and the batch is linked to the artwork then.
  void initialLoad.then(async()=>{
   await orientationDetection;
   if([...$('mg-templates').querySelectorAll('input.mg-template-choice:checked')].length)
    await createJob({automatic:true});
  }).catch(failure);
 }
});
window.addEventListener('pod-artwork-uploaded',event=>{
 const info=event.detail||{},file=$('master_file').files?.[0];
 if(['portrait','landscape','square'].includes(String(info.orientation||'').toLowerCase())){
  const verified=String(info.orientation).toLowerCase();
  if(verified!==detectedArtworkOrientation){
   detectedArtworkOrientation=verified;lastAutoOrientation=null;showOrientation();
   orientationDetection=loadTemplates();
  }
 }
 if(!file||!info.artworkId||file.name!==info.filename||file.size!==Number(info.size)||
   file.lastModified!==Number(info.lastModified))return;
 currentArtworkId=String(info.artworkId);
 // A batch already started from this file only needs linking to the artwork.
 void (jobCreation||Promise.resolve()).then(()=>{
  if(activeJobId&&activeMasterSignature===fileSignature(file))
   return linkBatchToArtwork(activeJobId,currentArtworkId);
  if(!$('mg-auto-queue').checked)return;
  return initialLoad.then(async()=>{
   if(![...$('mg-templates').querySelectorAll('input.mg-template-choice:checked')].length)return;
   await createJob({artworkId:currentArtworkId,automatic:true});
  });
 }).catch(failure);
});
$('mg-psds').addEventListener('change',scheduleTemplateLibraryUpload);
$('mg-psds-horizontal').addEventListener('change',scheduleTemplateLibraryUpload);
$('mg-save-templates').addEventListener('click',()=>act(uploadTemplates));
$('mg-select-seven').addEventListener('click',selectSeven);
$('mg-select-seventeen').addEventListener('click',selectAllCompatible);
$('mg-clear-templates').addEventListener('click',clearTemplates);
$('mg-pc-folder-save').addEventListener('click',()=>act(savePcFolder));
$('mg-pc-folder').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void act(savePcFolder)}});
$('mg-select-all').addEventListener('click',()=>{
 if(!job)return;selectionByJob.set(job.id,{chosen:firstSlots(job)});selectionChanged();
});
$('mg-deselect-all').addEventListener('click',()=>{
 if(!job)return;selectionByJob.set(job.id,{chosen:new Set()});selectionChanged();
});
$('mg-apply-selected').addEventListener('click',()=>act(useResults));
$('mg-org-modal').addEventListener('scroll',()=>{
 if(!drag)return;
 drag.box=$('mg-org-list').getBoundingClientRect();
 if(!drag.frame)drag.frame=requestAnimationFrame(dragFrame);
},{passive:true});
const backToSelection=()=>{closeOrganizer();message('Back to selection. Change the ticked mockups, then apply again.')};
$('mg-org-back').addEventListener('click',backToSelection);
$('mg-org-close').addEventListener('click',backToSelection);
// Escape drops a photo being dragged back where it was, otherwise closes the organizer.
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape'||!organizer)return;
 event.preventDefault();
 if(!cancelDrag())backToSelection();
});
$('mg-org-save').addEventListener('click',()=>act(saveOrganizer));
for(const [id,method] of [
 ['mg-generate',()=>createJob()],['mg-refresh-jobs',loadJobs],['mg-pause',pause],
 ['mg-retry',retry],['mg-regenerate',regenerate],['mg-save-map',saveMapping]
])$(id).addEventListener('click',()=>act(method));
// Template readiness controls auto-queue; a failed worker-status request must not
// disable uploads or generation.
initialLoad=loadTemplates();
void loadPcFolder();
void Promise.allSettled([loadJobs(),workerStatus()]);
initialLoad.then(()=>{
 renderPreviews();
 message('Saved PSD templates loaded. Master uploads automatically queue selected mockups.');
}).catch(failure);
// Polling updates are UI-only. The PC worker continues running if this tab closes.
// Every poll is Render bandwidth, so a background tab or a finished batch is not
// polled; the worker status is checked every 30 s while nothing is running.
let lastWorkerCheck=Date.now();
const batchRunning=()=>!!job&&!job.paused&&job.templates.some(t=>t.status==='queued'||t.status==='processing');
setInterval(()=>{
 if(preparing||document.hidden||organizer)return;
 const running=batchRunning();
 // Finished mockups appear within about 2 s while a batch is running.
 if(running)void showJob(job.id,{quiet:true}).catch(failure);
 if((running&&Date.now()-lastWorkerCheck>=6000)||Date.now()-lastWorkerCheck>=30000){lastWorkerCheck=Date.now();void workerStatus();}
},2000);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden||preparing)return;
 lastWorkerCheck=Date.now();void workerStatus();
 if(job)void showJob(job.id,{quiet:true}).catch(failure);
});
}
