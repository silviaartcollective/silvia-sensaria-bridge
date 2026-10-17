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

const selectionByJob=new Map();
const selectionFor=id=>{
 if(!selectionByJob.has(id))selectionByJob.set(id,{defaultSelected:true,exceptions:new Set()});
 return selectionByJob.get(id);
};
const isSelected=(id,itemId)=>{
 const selection=selectionFor(id);
 return selection.exceptions.has(itemId)?!selection.defaultSelected:selection.defaultSelected;
};
function setSelected(id,itemId,checked){
 const selection=selectionFor(id);
 if(checked===selection.defaultSelected)selection.exceptions.delete(itemId);
 else selection.exceptions.add(itemId);
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
function renderPreviews(){
 const completed=job?job.templates.filter(t=>t.status==='completed'):[];
 const signature=(job?.id||'none')+'|'+completed.map(t=>t.id+':'+(t.finishedAt||'')).join(';')+
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
 list.scrollTop=savedScrollTop; // Keep review position while new JPGs finish generating.
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
async function useResults(){
 if(!currentBatch())throw Error('These mockups were created for a different artwork. Create a fresh batch for this master.');
 if(attaching)return;
 const batchId=job.id,version=selectionVersion;
 const selected=job.templates.filter(t=>t.status==='completed'&&isSelected(batchId,t.id));
 if(!selected.length){markRequested();throw Error('Select at least one generated JPG.')}
 attaching=true;renderPreviews();
 try{
  const chosen=selected.slice(0,17),artworkId=$('artwork_id').value.trim();
  if(job.artworkId&&job.artworkId===artworkId){
    // Server-to-server R2 sync avoids fetching 17 large JPGs back into the browser.
    lastAppliedBatchId=batchId;appliedCount=chosen.length;
    ready=true;requested=true;
    panel.dataset.generationRequested='true';panel.dataset.generationReady='true';
    message('Syncing '+chosen.length+' verified JPGs directly from Cloudflare R2…');
    void syncGeneratedJpgs(batchId,chosen.map(t=>t.id)).catch(failure);
    return;
  }
  const dt=new DataTransfer();
  for(const t of chosen){
   const response=await fetch('/api/mockups/jobs/'+batchId+'/download/'+t.id,{cache:'no-store'});
   if(!response.ok)throw Error('Could not retrieve '+t.outputName+' (HTTP '+response.status+')');
   dt.items.add(new File([await response.blob()],t.outputName,{type:'image/jpeg'}));
  }
  if(!job||job.id!==batchId||selectionVersion!==version)return;
  $('mockup_files').files=dt.files;
  lastAppliedBatchId=batchId;appliedCount=chosen.length;
  ready=true;requested=true;
  panel.dataset.generationRequested='true';panel.dataset.generationReady='true';
  $('upload-status').textContent=chosen.length+' selected PC-generated mockups ready for the Etsy draft.'+
    (selected.length>17?' Etsy can fit only the first 17 selected artwork mockups alongside 3 preset photos.':'');
  message('Selected mockups ready ('+chosen.length+' JPGs).');
 }finally{attaching=false;renderPreviews()}
}
async function loadTemplates(){
 templates=(await api('templates')).templates;
 const selected=new Set([...$('mg-templates').querySelectorAll('input.mg-template-choice:checked')].map(x=>x.value));
 if(detectedArtworkOrientation&&lastAutoOrientation!==detectedArtworkOrientation){
  selected.clear();
  for(const t of templates.filter(t=>t.status==='ready'&&templateFitsOrientation(t,detectedArtworkOrientation)).slice(0,16))
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
  const title=create('span',template.name+(template.mapping?' · mapped':' · map Smart Object'));
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
  if(count>=16)break;
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
  const text=fixed
   ?'Shared PC Crop + Mockup Worker v'+worker.version+' online'+(worker.busy?' · processing':' · idle')
   :worker.online&&worker.mockups===true
    ?'PC worker v'+(worker.version||'unknown')+' still uses Photoshop/Photopea. Update the worker folder, run setup-worker.cmd and restart (v4.5.0 renders PSDs on its own).'
    :worker.online?'Old crop-only worker online. Update the PC worker folder, run setup-worker.cmd and restart.'
    :worker.configured?'Shared PC worker offline · use Launch Shared Crop Worker above'
    :'Shared PC worker not configured in Render';
  $('mg-worker-status').textContent=text;
  $('mg-worker-status').style.color=fixed?'#477153':'#a46b3d';
  return fixed;
 }catch{
  $('mg-worker-status').textContent='Could not check PC worker connection';
  return false;
 }
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
 const objects=(template?.smartObjects||[]).filter(t=>t.kind==='smart'&&t.visible);
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
async function createJob({artworkId='',automatic=false}={}){
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
    artworkId:uploaded,templateIds:ids,fitMode:'contain'
   })).job;
   currentArtworkId=uploaded;
  }else{
   const result=await api('jobs','POST',{filename:art.name,size:art.size,templateIds:ids,fitMode:'contain'});
   message('Uploading the master artwork for this new PC batch…');
   await upload(result.uploadUrl,art,'application/octet-stream');
   await api('jobs/'+result.job.id+'/artwork-confirm','POST');
   freshJob=(await api('jobs/'+result.job.id)).job;
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
 if(!template?.smartObjects?.some(x=>x.kind==='smart'&&x.visible&&x.path===path))
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
function selectSeventeen(){
 const available=[...$('mg-templates').querySelectorAll('input.mg-template-choice')].filter(cb=>!cb.disabled);
 available.forEach((cb,i)=>{cb.checked=i<17});
 message('Selected '+Math.min(17,available.length)+' PSDs for the available artwork photo slots.');
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
  // Queue from the one verified artwork in R2; don't upload the master twice.
  void initialLoad.then(()=>window.startProductArtworkUpload()).catch(failure);
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
 if(activeJobId&&activeMasterSignature===fileSignature(file))return;
 if(!$('mg-auto-queue').checked)return;
 void initialLoad.then(async()=>{
  if(![...$('mg-templates').querySelectorAll('input.mg-template-choice:checked')].length)return;
  await createJob({artworkId:currentArtworkId,automatic:true});
 }).catch(failure);
});
$('mg-psds').addEventListener('change',scheduleTemplateLibraryUpload);
$('mg-psds-horizontal').addEventListener('change',scheduleTemplateLibraryUpload);
$('mg-save-templates').addEventListener('click',()=>act(uploadTemplates));
$('mg-select-seven').addEventListener('click',selectSeven);
$('mg-select-seventeen').addEventListener('click',selectSeventeen);
$('mg-clear-templates').addEventListener('click',clearTemplates);
$('mg-select-all').addEventListener('click',()=>{
 if(!job)return;selectionByJob.set(job.id,{defaultSelected:true,exceptions:new Set()});selectionChanged();
});
$('mg-deselect-all').addEventListener('click',()=>{
 if(!job)return;selectionByJob.set(job.id,{defaultSelected:false,exceptions:new Set()});selectionChanged();
});
$('mg-apply-selected').addEventListener('click',()=>act(useResults));
for(const [id,method] of [
 ['mg-generate',()=>createJob()],['mg-refresh-jobs',loadJobs],['mg-pause',pause],
 ['mg-retry',retry],['mg-regenerate',regenerate],['mg-save-map',saveMapping]
])$(id).addEventListener('click',()=>act(method));
// Template readiness controls auto-queue; a failed worker-status request must not
// disable uploads or generation.
initialLoad=loadTemplates();
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
 if(preparing||document.hidden)return;
 const running=batchRunning();
 if(running)void showJob(job.id,{quiet:true}).catch(failure);
 if(running||Date.now()-lastWorkerCheck>=30000){lastWorkerCheck=Date.now();void workerStatus();}
},6000);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden||preparing)return;
 lastWorkerCheck=Date.now();void workerStatus();
 if(job)void showJob(job.id,{quiet:true}).catch(failure);
});
}
