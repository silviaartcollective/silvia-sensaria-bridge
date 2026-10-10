// Photopea renderer embedded in Product Creator. No R2 secrets are exposed to the iframe.
const panel=document.getElementById('mockup-generator-panel');
if(panel){
const $=id=>document.getElementById(id);
const create=(tag,label,attrs={})=>{const el=document.createElement(tag);el.textContent=label||'';for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;};
let templates=[],jobs=[],job=null,owner=crypto.randomUUID(),running=false,stopping=false,needsSelection=null;
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
   this.frame.src='https://www.photopea.com/';
   $('mg-engine-status').textContent='Connecting to Photopea…';
  }
  return this.ready;
 }
 async send(data,timeout=240000){
  await this.init();
  if(this.pending)throw Error('Photopea is still processing a previous operation.');
  return new Promise((resolve,reject)=>{
   const p={resolve,reject,messages:[],binary:null};
   p.timer=setTimeout(()=>{this.pending=null;reject(Error('Photopea timed out while processing this PSD.'));},timeout);
   this.pending=p;
   this.frame.contentWindow.postMessage(data,'https://www.photopea.com',data instanceof ArrayBuffer?[data]:[]);
  });
 }
 async load(kind,id){
  const r=await fetch('/api/mockups/file/'+kind+'/'+id,{cache:'no-store'});
  if(!r.ok)throw Error('Unable to load '+kind+' from R2 (HTTP '+r.status+').');
  return this.send(await r.arrayBuffer(),300000);
 }
 async script(fn,...args){return this.send('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+');');}
 parse(result,tag){
  const line=result.messages.find(x=>x.startsWith(tag));
  if(!line)throw Error('Photopea did not confirm '+tag+' operation.');
  return JSON.parse(line.slice(tag.length));
 }
}
const pp=new Photopea();
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
 for(const t of templates){
  const row=create('div','',{class:'mg-item'});
  const label=create('label'),cb=create('input','',{type:'checkbox',value:t.id});
  cb.checked=t.status==='ready';cb.disabled=t.status!=='ready';
  label.append(cb);
  if(t.previewKey)label.append(create('img','',{src:'/api/mockups/file/preview/'+t.id,alt:'PSD template preview'}));
  const details=create('span');details.append(create('strong',t.name),create('small',t.collection+' · '+t.status+
     (t.mapping?' · target '+t.mapping.path:'')));label.append(details);row.append(label);
  const preview=create('button','Preview / Inspect',{type:'button'});
  preview.addEventListener('click',()=>act(()=>previewTemplate(t)));
  row.append(preview);
  const del=create('button','Delete',{type:'button'});
  del.addEventListener('click',()=>act(async()=>{
   if(!confirm('Permanently delete '+t.name+' from saved templates?'))return;
   await api('templates/'+t.id,'DELETE');await loadTemplates();
  }));
  row.append(del);box.append(row);
 }
 if(!templates.length)box.append(create('p','No saved templates yet.',{class:'uploadmeta'}));
}
async function uploadTemplates(){
 const files=[...$('mg-psds').files];if(!files.length)throw Error('Select PSD or PSB templates.');
 for(let i=0;i<files.length;i++){
  const file=files[i];message('Uploading '+(i+1)+'/'+files.length+': '+file.name);
  const d=await api('templates','POST',{name:file.name,size:file.size,collection:$('mg-collection').value});
  await upload(d.uploadUrl,file,'application/octet-stream');
  await api('templates/'+d.template.id+'/confirm','POST');
 }
 $('mg-psds').value='';await loadTemplates();message(files.length+' templates saved.');
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
 message(job.filename+' — '+done+'/'+job.templates.length+' completed ('+job.status+')');
 const zip=$('mg-download-all');zip.href='/api/mockups/jobs/'+job.id+'/download-all';
  zip.hidden=!done;
  const box=$('mg-results');box.replaceChildren();
 for(const t of job.templates){
  const row=create('div','',{class:'mg-item'}),title=create('span');
  title.append(create('strong',t.outputName),create('small',t.status+(t.error?' — '+t.error:'')));
  row.append(title);
  if(t.status==='completed')
   row.append(create('a','Download JPG',{href:'/api/mockups/jobs/'+job.id+'/download/'+t.id,download:t.outputName}));
  box.append(row);
 }
 return job;
}
async function createJob(){
 const art=$('mg-artwork').files[0];if(!art)throw Error('Choose artwork first.');
 const ids=[...$('mg-templates').querySelectorAll('input:checked')].map(x=>x.value);
 if(!ids.length)throw Error('Select saved PSD templates.');
 const result=await api('jobs','POST',{filename:art.name,size:art.size,templateIds:ids,fitMode:$('mg-fit').value});
 message('Uploading source artwork…');await upload(result.uploadUrl,art,'application/octet-stream');
 await api('jobs/'+result.job.id+'/artwork-confirm','POST');
 await loadJobs();await showJob(result.job.id);
 message('Batch saved. Press Start / Resume to render '+ids.length+' mockups.');
}
async function process(){
 if(!job)throw Error('Select a batch.');
 if(running)return;
 running=true;stopping=false;
 const timer=setInterval(()=>{void api('jobs/'+job.id+'/heartbeat','POST',{owner}).catch(()=>{})},40000);
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
    failure(e);
   }
   await showJob(job.id);
  }
 }finally{clearInterval(timer);running=false;await loadJobs();}
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
 if(!job)throw Error('Select a completed batch.');
 const finished=job.templates.filter(t=>t.status==='completed').slice(0,10);
 if(!finished.length)throw Error('No completed JPGs yet.');
 const dt=new DataTransfer();
 for(const t of finished){
  const r=await fetch('/api/mockups/jobs/'+job.id+'/download/'+t.id);
  if(!r.ok)throw Error('Could not retrieve '+t.outputName);
  dt.items.add(new File([await r.blob()],t.outputName,{type:'image/jpeg'}));
 }
 $('mockup_files').files=dt.files;
 $('creator-listing-tab').click();
 $('upload-status').textContent=finished.length+' generated JPG mockups are selected for this Etsy listing.';
}
function act(fn){Promise.resolve().then(fn).catch(failure)}
for(const [id,fn]of [['mg-upload-templates',uploadTemplates],['mg-refresh-templates',loadTemplates],
 ['mg-new-job',createJob],['mg-refresh-jobs',loadJobs],['mg-start',resume],
 ['mg-pause',pause],['mg-retry',retry],['mg-regenerate',regenerate],['mg-save-map',saveMapping],
 ['mg-use-results',useResults]])$(id).addEventListener('click',()=>act(fn));
const tabListing=$('creator-listing-tab'),tabMockup=$('creator-mockup-tab');
function chooseTab(isMockup){
 $('product-listing-panel').hidden=isMockup;panel.hidden=!isMockup;
 tabListing.setAttribute('aria-selected',String(!isMockup));
 tabMockup.setAttribute('aria-selected',String(isMockup));
 if(isMockup)history.replaceState(null,'',location.pathname+'#mockup-generator');
 else if(location.hash==='#mockup-generator')history.replaceState(null,'',location.pathname);
}
tabListing.addEventListener('click',()=>chooseTab(false));
tabMockup.addEventListener('click',()=>chooseTab(true));
if(location.hash==='#mockup-generator')chooseTab(true);
act(async()=>{await loadTemplates();await loadJobs();});
}
