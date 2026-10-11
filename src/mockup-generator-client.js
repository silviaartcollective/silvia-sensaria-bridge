// Product Creator UI for the shared PC Crop + Mockup Worker.
// The browser uploads inputs and previews results; it NEVER opens PSDs in Photopea.
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
let initialLoad=Promise.resolve(),selectionVersion=0,attachTimer=null,attaching=false;
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
let lastStatus='';
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
$('creator-form').addEventListener('submit',event=>{
 if(requested&&!ready){
  event.preventDefault();event.stopImmediatePropagation();
  failure(Error('The PC worker is still generating mockups or your image selection has not been attached. Select the finished JPGs first.'));
 }
},true);
function renderPreviews(){
 const list=$('mg-preview-list');list.replaceChildren();
 const completed=job?job.templates.filter(t=>t.status==='completed'):[];
 const selected=job?completed.filter(t=>isSelected(job.id,t.id)).length:0;
 $('mg-preview-count').textContent=completed.length+' ready';
 $('mg-selection-status').textContent=job
  ?selected+' of '+completed.length+' selected · '+Math.min(selected,7)+' added to Etsy'+
    (selected>7?' (first 7 checked)':'')+'. Three preset listing images use the other slots.'
  :'All finished mockups are selected by default. Up to 7 accompany the 3 preset images.';
 $('mg-apply-selected').disabled=!job||!selected||attaching;
 $('mg-select-all').disabled=!job;
 $('mg-deselect-all').disabled=!job;
 if(!completed.length){
  list.append(create('p','Finished JPGs will appear here while your PC worker generates them.',{class:'mg-preview-empty'}));
  return;
 }
 for(const template of completed){
  const row=create('label','',{class:'mg-preview-item'});
  const checkbox=create('input','',{type:'checkbox',value:template.id});
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
}
function selectionChanged(){
 selectionVersion++;markRequested();renderPreviews();
 if(attachTimer)clearTimeout(attachTimer);
 if(job?.status==='completed'&&job.templates.some(t=>t.status==='completed'&&isSelected(job.id,t.id))){
  const id=job.id;
  attachTimer=setTimeout(()=>{attachTimer=null;if(job?.id===id)act(useResults)},650);
 }
}
async function useResults(){
 if(!job)throw Error('Select a batch with completed mockups.');
 if(attaching)return;
 const batchId=job.id,version=selectionVersion;
 const selected=job.templates.filter(t=>t.status==='completed'&&isSelected(batchId,t.id));
 if(!selected.length){markRequested();throw Error('Select at least one generated JPG.')}
 attaching=true;renderPreviews();
 try{
  const dt=new DataTransfer(),chosen=selected.slice(0,7);
  for(const t of chosen){
   const response=await fetch('/api/mockups/jobs/'+batchId+'/download/'+t.id,{cache:'no-store'});
   if(!response.ok)throw Error('Could not retrieve '+t.outputName+' (HTTP '+response.status+')');
   dt.items.add(new File([await response.blob()],t.outputName,{type:'image/jpeg'}));
  }
  if(!job||job.id!==batchId||selectionVersion!==version)return;
  $('mockup_files').files=dt.files;
  ready=true;requested=true;
  panel.dataset.generationRequested='true';panel.dataset.generationReady='true';
  $('upload-status').textContent=chosen.length+' selected PC-generated mockups ready for the Etsy draft.'+
    (selected.length>7?' Only the first 7 selected images are attached.':'');
  message('Selected mockups ready for Etsy ('+chosen.length+' JPGs)');
 }finally{attaching=false;renderPreviews()}
}
async function loadTemplates(){
 templates=(await api('templates')).templates;
 const selected=new Set([...$('mg-templates').querySelectorAll('input:checked')].map(x=>x.value));
 const box=$('mg-templates');box.replaceChildren();
 $('mg-saved-count').textContent='('+templates.filter(t=>t.status==='ready').length+')';
 for(const template of templates){
  const row=create('label'),cb=create('input','',{type:'checkbox',value:template.id});
  cb.disabled=template.status!=='ready';
  cb.checked=cb.disabled?false:(selected.size?selected.has(template.id):true);
  row.append(cb,create('span',template.name+(template.mapping?' · mapped':' · auto-map')));
  box.append(row);
 }
 if(!templates.length)box.append(create('p','No PSD templates saved yet.'));
}
async function uploadTemplates(){
 const files=[...$('mg-psds').files],ids=[];
 for(let i=0;i<files.length;i++){
  const file=files[i];
  message('Uploading PSD '+(i+1)+'/'+files.length+' to R2: '+file.name);
  const result=await api('templates','POST',{
   name:file.name,size:file.size,collection:$('mg-collection').value
  });
  await upload(result.uploadUrl,file,'application/octet-stream');
  await api('templates/'+result.template.id+'/confirm','POST');
  ids.push(result.template.id);
 }
 $('mg-psds').value='';
 if(ids.length){
  await loadTemplates();
  // Newly uploaded templates replace the current check selection.
  for(const cb of $('mg-templates').querySelectorAll('input[type=checkbox]'))
   cb.checked=ids.includes(cb.value);
 }
 return ids;
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
  const text=worker.online&&worker.mockups===true
   ?'Shared PC Crop + Mockup Worker online'+(worker.busy?' · processing':' · idle')
   :worker.online?'Old crop-only worker online. Update the PC worker folder, run setup-worker.cmd and restart to enable mockups.'
   :worker.configured?'Shared PC worker offline · use Launch Shared Crop Worker above'
   :'Shared PC worker not configured in Render';
  $('mg-worker-status').textContent=text;
  $('mg-worker-status').style.color=worker.online&&worker.mockups===true?'#477153':'#a46b3d';
  return worker.online&&worker.mockups===true;
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
   row.append(create('a','Download JPG',{href:'/api/mockups/jobs/'+job.id+'/download/'+t.id,download:t.outputName}));
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
 else if(failed.length)message(failed.length+' mockups need attention · '+count+'/'+job.templates.length+' ready',true);
 else message('Waiting for shared PC worker · '+count+'/'+job.templates.length+' ready');
 $('mg-generate').disabled=preparing;
 $('mg-pause').disabled=!job||job.status==='completed'||job.paused;
 if(!quiet||failed.some(t=>t.status==='needs_mapping'))await mappingPrompt();
 if(job.status==='completed'&&previous!=='completed'&&requested&&!ready&&
   job.templates.some(t=>t.status==='completed'&&isSelected(job.id,t.id)))act(useResults);
 return job;
}
async function createJob(){
 if(preparing)return;
 preparing=true;$('mg-generate').disabled=true;
 try{
  await initialLoad;
  const art=$('master_file').files?.[0];
  if(!art)throw Error('Choose the master artwork above first.');
  await uploadTemplates();
  const ids=[...$('mg-templates').querySelectorAll('input:checked')].map(x=>x.value);
  if(!ids.length)throw Error('Choose saved PSD templates or upload new ones.');
  markRequested();
  const existing=jobs.find(j=>j.artworkUploaded&&j.filename===art.name&&j.artworkSize===art.size&&
   j.templates.length===ids.length&&j.templates.every(t=>ids.includes(t.id))&&j.status!=='completed');
  if(existing){
   job=(await api('jobs/'+existing.id)).job;
   message('Reusing the existing PC batch; master artwork is already uploaded.');
   if(job.paused)await resume();
  }else{
   const result=await api('jobs','POST',{filename:art.name,size:art.size,templateIds:ids,fitMode:'contain'});
   message('Uploading the master artwork for PC mockup generation…');
   await upload(result.uploadUrl,art,'application/octet-stream');
   await api('jobs/'+result.job.id+'/artwork-confirm','POST');
   job=(await api('jobs/'+result.job.id)).job;
  }
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
async function maybeAutoStart(){
 await initialLoad;
 if(preparing||!$('master_file').files.length)return;
 const chosen=$('mg-templates').querySelectorAll('input:checked').length;
 if(!chosen&&!$('mg-psds').files.length){
  message('Master artwork selected. Add PSD templates to start the PC generator.');return;
 }
 await createJob();
}
$('mockup_files').addEventListener('change',()=>{
 if($('mockup_files').files.length){
  requested=false;ready=false;panel.dataset.generationRequested='false';
  panel.dataset.generationReady='false';
  message('Using manually selected JPG mockups for this Etsy listing.');
 }
});
$('master_file').addEventListener('change',()=>act(maybeAutoStart));
$('mg-psds').addEventListener('change',()=>act(maybeAutoStart));
$('mg-select-all').addEventListener('click',()=>{
 if(!job)return;selectionByJob.set(job.id,{defaultSelected:true,exceptions:new Set()});selectionChanged();
});
$('mg-deselect-all').addEventListener('click',()=>{
 if(!job)return;selectionByJob.set(job.id,{defaultSelected:false,exceptions:new Set()});selectionChanged();
});
$('mg-apply-selected').addEventListener('click',()=>act(useResults));
for(const [id,method] of [
 ['mg-generate',createJob],['mg-refresh-jobs',loadJobs],['mg-pause',pause],
 ['mg-retry',retry],['mg-regenerate',regenerate],['mg-save-map',saveMapping]
])$(id).addEventListener('click',()=>act(method));
initialLoad=Promise.all([loadTemplates(),loadJobs(),workerStatus()]);
initialLoad.then(()=>{
 renderPreviews();
 if($('master_file').files.length)void maybeAutoStart().catch(failure);
 else if(jobs[0])void showJob(jobs[0].id).catch(failure);
}).catch(failure);
// Polling updates are UI-only. The PC worker continues running if this tab closes.
setInterval(()=>{
 if(preparing)return;
 if(job)void showJob(job.id,{quiet:true}).catch(failure);
 void workerStatus();
},6000);
}
