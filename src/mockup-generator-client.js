// Photopea renderer embedded in Product Creator. No R2 secrets are exposed to the iframe.
const panel=document.getElementById('mockup-generator-panel');
if(panel){
const $=id=>document.getElementById(id);
const create=(tag,label,attrs={})=>{const el=document.createElement(tag);el.textContent=label||'';for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;};
let templates=[],jobs=[],job=null,owner=crypto.randomUUID(),running=false,stopping=false,needsSelection=null,requested=false,ready=false,preparing=false;
let initialLoad=Promise.resolve(),selectionVersion=0;
const selectionByJob=new Map();
function selectionFor(id){
 if(!selectionByJob.has(id))selectionByJob.set(id,{defaultSelected:true,exceptions:new Set()});
 return selectionByJob.get(id);
}
function isSelected(id,itemId){
 const selection=selectionFor(id);
 return selection.exceptions.has(itemId)?!selection.defaultSelected:selection.defaultSelected;
}
function setSelected(id,itemId,checked){
 const selection=selectionFor(id);
 if(checked===selection.defaultSelected)selection.exceptions.delete(itemId);
 else selection.exceptions.add(itemId);
}
function renderPreviews(){
 const target=$('mg-preview-list');target.replaceChildren();
 const completed=job?job.templates.filter(t=>t.status==='completed'):[];
 const selected=completed.filter(t=>isSelected(job.id,t.id)).length;
 $('mg-preview-count').textContent=completed.length+' ready';
 $('mg-selection-status').textContent=job
  ?selected+' of '+completed.length+' selected. '+Math.min(selected,7)+' will attach to Etsy'+
   (selected>7?' (first 7 selected in list).':'')+'. 3 preset images use the other slots.'
  :'All finished mockups are selected by default. Up to 7 can accompany the 3 preset images.';
 $('mg-apply-selected').disabled=!job||!selected;
 $('mg-select-all').disabled=!job;
 $('mg-deselect-all').disabled=!job;
 if(!completed.length){
  target.append(create('p','Finished mockups will appear here while they generate.',{class:'mg-preview-empty'}));return;
 }
 for(const t of completed){
  const label=create('label','',{class:'mg-preview-item'});
  const check=create('input','',{type:'checkbox',value:t.id});
  check.checked=isSelected(job.id,t.id);
  check.addEventListener('change',()=>{
   setSelected(job.id,t.id,check.checked);selectionChanged();
  });
  const img=create('img','',{alt:'Generated '+t.outputName,
   src:'/api/mockups/jobs/'+job.id+'/thumbnail/'+t.id+'?v='+encodeURIComponent(t.finishedAt||'1'),
   loading:'lazy',decoding:'async'});
  const caption=create('span',t.outputName);
  caption.append(create('small',t.dimensions?(t.dimensions.width+' × '+t.dimensions.height):'Ready JPG'));
  label.append(check,img,caption);target.append(label);
 }
}
function selectionChanged(){
 selectionVersion++;
 markRequested();
 renderPreviews();
 if(job&&job.templates.every(t=>t.status==='completed')&&job.templates.some(t=>t.status==='completed'&&isSelected(job.id,t.id)))
  act(useResults);
 else $('upload-status').textContent='Review the checked mockups and apply your selection before creating the Etsy listing.';
}

function setProgress(done,total){$('mg-progress-bar').style.width=(total?Math.round(100*done/total):0)+'%';}
function markRequested(){requested=true;ready=false;panel.dataset.generationRequested='true';panel.dataset.generationReady='false';}
$('creator-form').addEventListener('submit',e=>{
 if(requested&&!ready){e.preventDefault();e.stopImmediatePropagation();
 failure(Error('Generated mockups are not ready yet. Finish the batch or retry before creating the Etsy draft.'));}
},true);
const message=(text,warning=false)=>{const el=$('mg-progress');el.textContent=text;el.classList.toggle('warn',warning)};
const failure=e=>message(e?.message||String(e),true);
async function api(route,method='GET',body){
 const r=await fetch('/api/mockups/'+route,{method,cache:'no-store',
   ...(method==='GET'?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body||{})})});
 const data=await r.json().catch(()=>({error:'Invalid server response'}));
 if(!r.ok||data.ok!==true)throw Error(data.error||'Mockup API error '+r.status);
 return data;
}
async function upload(url,blob,mime){
 const r=await fetch(url,{method:'PUT',headers:{'content-type':mime},body:blob});
 if(!r.ok)throw Error('R2 upload failed (HTTP '+r.status+'). Check signed URLs and bucket CORS.');
}
function releaseOldPhotopeaDocuments(){
 try{
  var count=0;
  while(app.documents.length>0 && count++<120){
   var doc=app.documents[0];
   if(doc.clearHistory)doc.clearHistory();
   doc.close();
  }
  if(app.documents.length>0)throw Error('Photopea could not release an earlier PSD.');
  app.echoToOE('MG_CLEANED:'+count);
 }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
}
class Photopea{
 constructor(){
  this.frame=$('mg-editor');this.pending=null;this.ready=null;this.readyResolve=null;
  window.addEventListener('message',e=>{
   if(e.origin!=='https://www.photopea.com'||e.source!==this.frame.contentWindow)return;
   if(e.data==='done'){
    if(this.pending){
     const p=this.pending;this.pending=null;clearTimeout(p.timer);
     const bad=p.messages.find(m=>m.startsWith('MG_ERROR:'));
     bad?p.reject(Error(bad.slice(9))):p.resolve(p);
    }else if(this.readyResolve){this.readyResolve();this.readyResolve=null;$('mg-engine-status').textContent='Photopea connected';}
   }else if(this.pending){
    if(e.data instanceof ArrayBuffer)this.pending.binary=e.data;
    else if(typeof e.data==='string')this.pending.messages.push(e.data);
   }
  });
 }
 async init(){
  if(!this.ready){
   this.ready=new Promise((resolve,reject)=>{
    this.readyResolve=resolve;
    setTimeout(()=>{if(this.readyResolve){this.readyResolve=null;this.ready=null;reject(Error('Photopea connection timed out. Check content blockers.'));}},90000);
   });
   this.frame.src='https://www.photopea.com/#'+encodeURIComponent(JSON.stringify({environment:{intro:false,vmode:2}}));
   $('mg-engine-status').textContent='Connecting to Photopea…';
  }
  return this.ready;
 }
 async send(data,timeout=180000){
  await this.init();
  if(this.pending)throw Error('Photopea is still processing a previous operation.');
  return new Promise((resolve,reject)=>{
   const p={resolve,reject,messages:[],binary:null};
   p.timer=setTimeout(()=>{this.pending=null;reject(Error('PSD processing timed out after '+Math.round(timeout/1000)+' seconds; the processor will try the next PSD.'));},timeout);
   this.pending=p;
   this.frame.contentWindow.postMessage(data,'https://www.photopea.com',data instanceof ArrayBuffer?[data]:[]);
  });
 }
 async reset(){
  if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Error('Processor reset.'));this.pending=null;}
  this.ready=null;this.readyResolve=null;
  this.frame.src='about:blank';
  $('mg-engine-status').textContent='Restarting background PSD engine…';
 }
 async load(kind,id){
  if(kind==='template'){
   try{await this.send('('+releaseOldPhotopeaDocuments.toString()+')();',15000);}
   catch(error){await this.reset();await this.init();}
  }
  const label=kind==='template'?'PSD template':'artwork';
  message('Downloading '+label+' from R2…');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),150000);
  let content;
  try{
   const response=await fetch('/api/mockups/file/'+kind+'/'+id,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('R2 HTTP '+response.status);
   const size=Number(response.headers.get('content-length')||0);
   if(size>350*1024*1024)throw Error('PSD exceeds the 350 MB browser limit');
   message('Receiving '+label+(size?' ('+(size/1024/1024).toFixed(1)+' MB)':'')+'…');
   content=await response.arrayBuffer();
  }catch(error){throw Error('Could not download '+label+': '+error.message);}
  finally{clearTimeout(timer);}
  message('Importing '+label+' into background processor ('+(content.byteLength/1024/1024).toFixed(1)+' MB)…');
  await this.send(content,180000);
  return content.byteLength;
 }
 async script(fn,...args){return this.send('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+');');}
 parse(result,tag){
  const line=result.messages.find(x=>x.startsWith(tag));
  if(!line)throw Error('Photopea did not confirm '+tag+' operation.');
  return JSON.parse(line.slice(tag.length));
 }
}
const pp=new Photopea();
window.addEventListener('pagehide',()=>{
 if(!running||!job)return;
 // A closing or navigating browser must not retain the batch's ownership.
 const payload=new Blob([JSON.stringify({owner,action:'release'})],{type:'application/json'});
 navigator.sendBeacon('/api/mockups/jobs/'+job.id+'/control',payload);
});
function inspect(){
 try{
  var doc=app.activeDocument,objects=[],visibility=[];
  if(!doc)throw Error('PSD did not open');
  function walk(layers,stem,visibleParent){
   for(var i=0;i<layers.length;i++){
    var l=layers[i],path=stem?stem+'.'+i:String(i),group=!!(l.layers&&l.layers.length!==undefined);
    var smart=false;try{smart=l.kind===LayerKind.SMARTOBJECT||String(l.kind).toLowerCase().includes('smart')}catch(_){}
    var visibilityState=!!l.visible&&visibleParent;
    var info={path:path,name:String(l.name||''),kind:smart?'smart':(group?'group':'other'),visible:visibilityState};
    visibility.push(info);if(smart)objects.push(info);
    if(group)walk(l.layers,path,visibilityState);
   }
  }
  walk(doc.layers,'',true);
  app.echoToOE('MG_INSPECT:'+JSON.stringify({objects:objects,visibility:visibility,
    width:Math.round(doc.width.as('px')),height:Math.round(doc.height.as('px'))}));
 }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
}
function openArtworkSlot(path){
 try{
  var parent=app.activeDocument,parts=path.split('.').map(Number);
  var l=parent.layers[parts[0]];
  for(var i=1;i<parts.length;i++)l=l.layers[parts[i]];
  if(!l||!(l.kind===LayerKind.SMARTOBJECT||String(l.kind).toLowerCase().includes('smart'))||!l.visible)
   throw Error('Mapped artwork layer is hidden or not a Smart Object.');
  parent.source='MG_PARENT_DOC';parent.activeLayer=l;
  executeAction(stringIDToTypeID('placedLayerEditContents'));
  var child=app.activeDocument;
  if(child===parent)throw Error('Smart Object edit document did not open.');
  child.source='MG_CHILD_DOC';
  app.echoToOE('MG_SLOT:'+JSON.stringify({width:Math.round(child.width.as('px')),
     height:Math.round(child.height.as('px'))}));
 }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
}
function replaceArtwork(mode){
 try{
  var art=app.activeDocument,child=null,parent=null;
  for(var i=0;i<app.documents.length;i++){
   var d=app.documents[i];if(d.source==='MG_CHILD_DOC')child=d;if(d.source==='MG_PARENT_DOC')parent=d;
  }
  if(!child||!parent||art===child)throw Error('Photopea could not locate the artwork Smart Object.');
  var old=[];for(var k=0;k<child.layers.length;k++)old.push(child.layers[k]);
  if(!art.activeLayer)throw Error('Replacement artwork has no editable layer.');
  var layer=art.activeLayer.duplicate(child,ElementPlacement.PLACEATBEGINNING);
  app.activeDocument=child;
  for(var k=0;k<old.length;k++)old[k].visible=false;
  layer.visible=true;child.activeLayer=layer;
  var b=layer.bounds,sw=b[2].as('px')-b[0].as('px'),sh=b[3].as('px')-b[1].as('px');
  var tw=child.width.as('px'),th=child.height.as('px');
  if(sw<=0||sh<=0||tw<=0||th<=0)throw Error('Invalid artwork Smart Object dimensions.');
  var factor=(mode==='cover'?Math.max(tw/sw,th/sh):Math.min(tw/sw,th/sh))*100;
  layer.resize(factor,factor,AnchorPosition.MIDDLECENTER);
  b=layer.bounds;layer.translate(tw/2-(b[0].as('px')+b[2].as('px'))/2,
                            th/2-(b[1].as('px')+b[3].as('px'))/2);
  app.activeDocument=art;art.close();
  app.activeDocument=child;child.save();child.close();
  app.activeDocument=parent;
  app.echoToOE('MG_REPLACED:'+JSON.stringify({replaced:true,targetWidth:tw,targetHeight:th}));
 }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
}
function visibilityCheck(){
 try{
  var doc=app.activeDocument,visibility=[];
  function walk(layers,stem,visibleParent){
   for(var i=0;i<layers.length;i++){
    var l=layers[i],path=stem?stem+'.'+i:String(i),group=!!(l.layers&&l.layers.length!==undefined);
    var smart=false;try{smart=l.kind===LayerKind.SMARTOBJECT||String(l.kind).toLowerCase().includes('smart')}catch(_){}
    var v=!!l.visible&&visibleParent;
    visibility.push({path:path,name:String(l.name||''),kind:smart?'smart':(group?'group':'other'),visible:v});
    if(group)walk(l.layers,path,v);
   }
  }
  walk(doc.layers,'',true);
  app.echoToOE('MG_VISIBILITY:'+JSON.stringify(visibility));
 }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
}
function exportComposite(){
 try{
  var doc=app.activeDocument,w=Math.round(doc.width.as('px')),h=Math.round(doc.height.as('px'));
  if(!w||!h)throw Error('Invalid composite size.');
  if(w*h>24000000){
   var f=Math.sqrt(24000000/(w*h));
   doc.resizeImage(UnitValue(Math.max(1,Math.floor(w*f)),'px'),
      UnitValue(Math.max(1,Math.floor(h*f)),'px'),null,ResampleMethod.BICUBIC);
  }
  app.echoToOE('MG_EXPORT:'+JSON.stringify({width:Math.round(doc.width.as('px')),height:Math.round(doc.height.as('px'))}));
  doc.saveToOE('jpg:0.9');
 }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
}

function thumbnailPhotopea(){
 try{
  var doc=app.activeDocument,w=doc.width.as('px'),h=doc.height.as('px');
  if(Math.max(w,h)>800){
   var f=800/Math.max(w,h);
   doc.resizeImage(UnitValue(Math.max(1,Math.floor(w*f)),'px'),
      UnitValue(Math.max(1,Math.floor(h*f)),'px'),null,ResampleMethod.BICUBIC);
  }
  app.echoToOE('MG_PREVIEW:'+JSON.stringify({width:Math.round(doc.width.as('px')),height:Math.round(doc.height.as('px'))}));
  doc.saveToOE('jpg:0.72');
 }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
}
async function previewTemplate(template){
  message('Scanning '+template.name+' in Photopea…');
  await pp.load('template',template.id);
  const inspected=pp.parse(await pp.script(inspect),'MG_INSPECT:');
  const scan=await api('templates/'+template.id+'/inspect','POST',{objects:inspected.objects});
  if(scan.classification.status==='needs_mapping'){
    needsSelection={template:template,objects:scan.classification.objects};
    $('mg-mapping').hidden=false;
    $('mg-map-file').textContent=template.name+' — '+scan.classification.reason;
    $('mg-map-select').replaceChildren();
    for(const o of scan.classification.objects)$('mg-map-select').append(create('option',o.name+' ['+o.path+']',{value:o.path}));
  }
  const image=await pp.script(thumbnailPhotopea);
  pp.parse(image,'MG_PREVIEW:');
  if(!image.binary||image.binary.byteLength>3*1024*1024)throw Error('Photopea preview unavailable or too large.');
  const data=await api('templates/'+template.id+'/preview','POST');
  await upload(data.uploadUrl,new Blob([image.binary],{type:'image/jpeg'}),'image/jpeg');
  await api('templates/'+template.id+'/preview-confirm','POST',{key:data.key});
  await loadTemplates();
  message('Saved thumbnail and Smart Object scan for '+template.name+'.');
}
async function inspectAndReplace(item,template,result){
  message('Opening PSD: '+template.name);
  await pp.load('template',template.id);
  const inspected=pp.parse(await pp.script(inspect),'MG_INSPECT:');
  const check=await api('templates/'+template.id+'/inspect','POST',{objects:inspected.objects});
  const selection=check.classification;
  if(selection.status!=='mapped'){
   needsSelection={template:template,objects:selection.objects};
   $('mg-mapping').hidden=false;
   $('mg-map-file').textContent=template.name+' — '+selection.reason;
   $('mg-map-select').replaceChildren();
   for(const o of selection.objects)$('mg-map-select').append(create('option',o.name+' ['+o.path+']',{value:o.path}));
   throw Object.assign(Error(selection.reason),{needsMapping:true});
  }
  const slot=pp.parse(await pp.script(openArtworkSlot,selection.path),'MG_SLOT:');
  if(!slot.width||!slot.height)throw Error('Smart Object source size is invalid.');
  await pp.load('artwork',job.id);
  const applied=pp.parse(await pp.script(replaceArtwork,job.fitMode),'MG_REPLACED:');
  if(!applied.replaced)throw Error('Smart Object replacement did not complete.');
  const after=pp.parse(await pp.script(visibilityCheck),'MG_VISIBILITY:');
  if(JSON.stringify(after)!==JSON.stringify(inspected.visibility))
    throw Error('Original PSD layer visibility or structure changed. Output refused.');
  const data=await pp.script(exportComposite);
  const dims=pp.parse(data,'MG_EXPORT:');
  if(!data.binary||data.binary.byteLength<100||dims.width*dims.height>24000000)
    throw Error('Photopea did not return a valid JPG within 24MP.');
  const sig=new Uint8Array(data.binary,0,2);
  if(sig[0]!==255||sig[1]!==216)throw Error('Photopea export did not return a JPG.');
  message('Uploading and verifying '+item.outputName);
  await upload(result.output.uploadUrl,new Blob([data.binary],{type:'image/jpeg'}),'image/jpeg');
  await api('jobs/'+job.id+'/complete','POST',{owner,templateId:item.id,
    outputKey:result.output.key,mapping:selection.path,visibilityVerified:true,
    mappingVerified:true,artworkReplaced:true});
}
async function loadTemplates(){
 templates=(await api('templates')).templates;
 const box=$('mg-templates');box.replaceChildren();
 $('mg-saved-count').textContent='('+templates.filter(t=>t.status==='ready').length+')';
 for(const t of templates){
  const label=create('label'),cb=create('input','',{type:'checkbox',value:t.id});
  cb.checked=t.status==='ready';cb.disabled=t.status!=='ready';
  label.append(cb,create('span',t.name+(t.mapping?' · mapped':' · auto-map')));
  box.append(label);
 }
 if(!templates.length)box.append(create('p','No PSD templates saved yet.'));
}
async function uploadTemplates(){
 const files=[...$('mg-psds').files],ids=[];
 for(let i=0;i<files.length;i++){
  const file=files[i];
  message('Uploading PSD '+(i+1)+'/'+files.length+': '+file.name);
  const d=await api('templates','POST',{name:file.name,size:file.size,collection:$('mg-collection').value});
  await upload(d.uploadUrl,file,'application/octet-stream');
  await api('templates/'+d.template.id+'/confirm','POST');
  ids.push(d.template.id);
 }
 $('mg-psds').value='';
 if(ids.length){
  await loadTemplates();
  for(const box of $('mg-templates').querySelectorAll('input[type=checkbox]'))box.checked=ids.includes(box.value);
 }
 return ids;
}
async function loadJobs(){
 jobs=(await api('jobs')).jobs;
 const box=$('mg-jobs');box.replaceChildren();
 for(const j of jobs.slice(0,40)){
  const row=create('div','',{class:'mg-item'});
  const count=j.templates.filter(t=>t.status==='completed').length;
  const info=create('span');info.append(create('strong',j.filename),create('small',j.status+' · '+count+'/'+j.templates.length));
  const btn=create('button',job?.id===j.id?'Selected':'Open',{type:'button'});
  btn.addEventListener('click',()=>act(()=>showJob(j.id)));
  row.append(info,btn);box.append(row);
 }
}
async function showJob(id){
 job=(await api('jobs/'+id)).job;
 const done=job.templates.filter(t=>t.status==='completed').length;
 message('Generating mockups: '+done+'/'+job.templates.length+' · '+job.status);
 setProgress(done,job.templates.length);
 const zip=$('mg-download-all');zip.href='/api/mockups/jobs/'+job.id+'/download-all';
  zip.hidden=!done;
  const box=$('mg-results');box.replaceChildren();
 for(const t of job.templates){
  const row=create('div','',{class:'mg-item'}),title=create('span');
  title.append(create('strong',t.outputName),create('small',t.status+(t.error?' — '+t.error:'')));
  row.append(title);
  if(t.status==='completed'){
   row.append(create('a','Download JPG',{href:'/api/mockups/jobs/'+job.id+'/download/'+t.id,download:t.outputName}));
   const remove=create('button','Delete JPG',{type:'button'});
   remove.addEventListener('click',()=>act(async()=>{
    if(!confirm('Delete '+t.outputName+'?'))return;
    await api('jobs/'+job.id+'/download/'+t.id,'DELETE');await showJob(job.id);
   }));row.append(remove);
  }
  box.append(row);
 }
 renderPreviews();
 return job;
}
async function createJob(){
 if(running||preparing)return;
 preparing=true;
 try{
 await initialLoad;
 const art=$('master_file').files[0];
 if(!art)throw Error('Choose the master artwork in Product Creator first.');
 await uploadTemplates();
 const ids=[...$('mg-templates').querySelectorAll('input:checked')].map(x=>x.value);
 if(!ids.length)throw Error('Choose saved PSD templates or upload new PSDs.');
 markRequested();
 const previous=jobs.find(j=>j.artworkUploaded&&j.filename===art.name&&j.artworkSize===art.size&&
  j.templates.length===ids.length&&j.templates.every(t=>ids.includes(t.id))&&j.status!=='completed');
 if(previous){
  job=(await api('jobs/'+previous.id)).job;
  message('Resuming existing batch; artwork does not need reuploading.');
 }else{
  const result=await api('jobs','POST',{filename:art.name,size:art.size,templateIds:ids,fitMode:'contain'});
  message('Saving the master artwork for mockup generation…');
  await upload(result.uploadUrl,art,'application/octet-stream');
  await api('jobs/'+result.job.id+'/artwork-confirm','POST');
  job=(await api('jobs/'+result.job.id)).job;
 }
 setProgress(job.templates.filter(t=>t.status==='completed').length,job.templates.length);
 await loadJobs();
 await resume();
 }finally{preparing=false;}
}
async function process(){
 if(!job)throw Error('Select a batch.');
 if(running)return;
 running=true;stopping=false;$('mg-generate').disabled=true;$('mg-pause').disabled=false;
 // Serialize heartbeats so a delayed R2 update cannot overwrite the final release.
 let heartbeatInFlight=Promise.resolve();
 const timer=setInterval(()=>{
  heartbeatInFlight=heartbeatInFlight.then(()=>api('jobs/'+job.id+'/heartbeat','POST',{owner})).catch(()=>{});
 },20000);
 try{
  await pp.init();
  while(!stopping){
   const claimed=await api('jobs/'+job.id+'/claim','POST',{owner});
   job=claimed.job;
   if(!claimed.item){message('All available jobs processed.');break;}
   try{await inspectAndReplace(claimed.item,claimed.template,claimed)}
   catch(e){
    await api('jobs/'+job.id+'/fail','POST',{owner,templateId:claimed.item.id,
       error:e.message||String(e),needsMapping:!!e.needsMapping});
    failure(Error(claimed.item.name+': '+e.message));
    if(/timed out|stopped responding|Processor reset|processing exceeded/i.test(e.message||''))await pp.reset();
   }
   await showJob(job.id);
  }
 }finally{
  clearInterval(timer);
  await heartbeatInFlight;
  // Releasing even after PSD errors prevents a stopped browser blocking the next attempt.
  try{await api('jobs/'+job.id+'/control','POST',{owner,action:'release'});}
  catch(error){failure(Error('Could not release batch: '+error.message));}
  running=false;
  $('mg-generate').disabled=false;$('mg-pause').disabled=true;
  await showJob(job.id);await loadJobs();
  if(job.templates.length&&job.templates.every(t=>t.status==='completed')){
   try{await useResults();
    message('All '+job.templates.length+' mockups generated. Finished JPGs attached to the Etsy listing.');}
   catch(error){failure(Error('JPG files generated, but automatic attachment failed: '+error.message));}
  }else if(!stopping){
   const incomplete=job.templates.filter(t=>t.status!=='completed').length;
   message(incomplete+' mockups need attention. Open Saved batches to retry them. Etsy draft creation is held until the batch finishes.',true);
  }
 }
}
async function resume(){
 if(!job)throw Error('Select or create a batch.');
 job=(await api('jobs/'+job.id+'/control','POST',{owner,action:'resume'})).job;
 await process();
}
async function pause(){
 stopping=true;
 if(job){await api('jobs/'+job.id+'/control','POST',{owner,action:'pause'});message('Paused; finish in-progress PSD then stop.');}
}
async function retry(){
 if(!job)throw Error('Select a batch.');
 job=(await api('jobs/'+job.id+'/control','POST',{owner,action:'retry'})).job;
 await process();
}
async function regenerate(){
  if(!job)throw Error('Select a batch first.');
  if(!confirm('Regenerate every mockup? Existing verified JPGs remain until replacements pass checks.'))return;
  job=(await api('jobs/'+job.id+'/control','POST',{owner,action:'regenerate'})).job;
  await process();
}
async function saveMapping(){
 if(!needsSelection)throw Error('No template is awaiting a mapping.');
 const path=$('mg-map-select').value;
 if(!needsSelection.objects.some(o=>o.path===path))throw Error('Select a valid visible artwork Smart Object.');
 await api('templates/'+needsSelection.template.id+'/update','POST',{mapping:{path}});
 $('mg-mapping').hidden=true;needsSelection=null;
 message('Artwork layer saved. Click Retry failed to resume.');
 await loadTemplates();
}
async function useResults(){
 if(!job)throw Error('Select a batch with finished mockups.');
 const batchId=job.id,version=selectionVersion;
 const selected=job.templates.filter(t=>t.status==='completed'&&isSelected(batchId,t.id));
 if(!selected.length){
  $('mockup_files').value='';
  markRequested();
  throw Error('Select at least one finished mockup for the listing.');
 }
 const chosen=selected.slice(0,7);
 const dt=new DataTransfer();
 $('mg-apply-selected').disabled=true;
 try{
  for(const t of chosen){
   const r=await fetch('/api/mockups/jobs/'+batchId+'/download/'+t.id,{cache:'no-store'});
   if(!r.ok)throw Error('Could not retrieve '+t.outputName);
   dt.items.add(new File([await r.blob()],t.outputName,{type:'image/jpeg'}));
  }
  if(!job||job.id!==batchId||selectionVersion!==version)return;
  $('mockup_files').files=dt.files;
  ready=true;requested=true;
  panel.dataset.generationRequested='true';panel.dataset.generationReady='true';
  $('upload-status').textContent=chosen.length+' selected generated JPGs attached to Etsy draft media.'+
   (selected.length>7?' Only the first 7 checked previews are attached; 3 preset images fill the remaining slots.':'');
 }finally{
  renderPreviews();
 }
}
$('mockup_files').addEventListener('change',()=>{
  if($('mockup_files').files.length){requested=false;ready=false;
   panel.dataset.generationRequested='false';message('Using manually selected JPG mockups for this Etsy listing.');}
 });
function act(fn){Promise.resolve().then(fn).catch(failure)}
async function maybeAutoStart(){
 await initialLoad;
 if(running||preparing)return;
 if(!$('master_file').files.length)return;
 const chosen=$('mg-templates').querySelectorAll('input:checked').length;
 if(!chosen&&!$('mg-psds').files.length){
  message('Master artwork selected. Upload a PSD or select saved templates to start automatically.');return;
 }
 await createJob();
}
$('master_file').addEventListener('change',()=>act(maybeAutoStart));
$('mg-psds').addEventListener('change',()=>act(maybeAutoStart));
$('mg-select-all').addEventListener('click',()=>{
 if(!job)return;selectionByJob.set(job.id,{defaultSelected:true,exceptions:new Set()});selectionChanged();
});
$('mg-deselect-all').addEventListener('click',()=>{
 if(!job)return;selectionByJob.set(job.id,{defaultSelected:false,exceptions:new Set()});selectionChanged();
});
$('mg-apply-selected').addEventListener('click',()=>act(useResults));
for(const [id,fn] of [
 ['mg-generate',createJob],
 ['mg-refresh-jobs',loadJobs],
 ['mg-pause',pause],
 ['mg-retry',retry],
 ['mg-regenerate',regenerate],
 ['mg-save-map',async()=>{await saveMapping();await retry();}]
])$(id).addEventListener('click',()=>act(fn));
initialLoad=Promise.all([loadTemplates(),loadJobs()]);
initialLoad.then(()=>{renderPreviews();if($('master_file').files.length)void maybeAutoStart().catch(failure);}).catch(failure);
}
