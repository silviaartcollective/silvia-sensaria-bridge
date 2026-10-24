// Daily Listings → New listings and Mockup presets. The page uploads each master
// to R2 (with a small preview for ChatGPT) and hands it to the batch; the
// server does the rest (batch-poster.mjs), so the page only shows the batch.
(()=>{'use strict';
const el=id=>document.getElementById(id);
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
async function request(path,body){
 const res=await fetch(path,body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('Server returned an invalid response (HTTP '+res.status+').');}
 if(!res.ok||!data.ok)throw Error(data.error||'Request failed (HTTP '+res.status+').');
 return data;
}
const notice=(id,text,kind='')=>{const node=el(id);node.className='notice'+(kind?' '+kind:'');node.textContent=text;};
const NAMES={portrait:'Vertical',landscape:'Horizontal',square:'Square',panoramic:'Panoramic'};
// The same rule as the server: 1.85:1 or wider is panoramic.
const layoutOf=(width,height)=>width===height?'square':height>width?'portrait':width/height>=1.85?'panoramic':'landscape';

// ---------------------------------------------------------------- mockup presets
// The presets are folders on the PC; the page shows them and remembers which
// one new artworks use.
let presets=[],chosen='',room=20,presetsLoaded=null;
const ORDER=['portrait','landscape','square','panoramic','unclassified'];
const presetByName=name=>presets.find(p=>p.name===name)||null;
const countsOf=preset=>Object.keys(NAMES).map(key=>[key,preset.templates.filter(t=>t.orientation===key).length]).filter(([,n])=>n);
function card(template,unused){
 const box=make('div','tpl'+(unused?' unused':''));box.title=template.localPath+(unused?' (not used: only '+room+' fit)':'');
 const pic=make('div','pic'),img=make('img');
 img.alt='';img.loading='lazy';img.decoding='async';img.src='/api/batch/template-preview/'+encodeURIComponent(template.id);
 img.addEventListener('error',()=>pic.replaceChildren(make('span','none','Preview appears once the PC worker has opened this PSD')));
 pic.append(img);box.append(pic,make('div','name',template.name));
 return box;
}
function showPresets(){
 const tabs=el('mp-tabs');tabs.replaceChildren();
 for(const preset of presets){
  const button=make('button',preset.name===chosen?'primary':'',preset.name+' · '+preset.templates.length);
  button.type='button';button.addEventListener('click',()=>void choose(preset.name));tabs.append(button);
 }
 el('mp-room').textContent='Up to '+room+' mockups fit next to your preset photos.';
 const groups=el('mp-groups');groups.replaceChildren();
 const preset=presetByName(chosen);
 if(!preset){checks();return;}
 for(const key of ORDER){
  const list=preset.templates.filter(t=>(key==='unclassified'?!NAMES[t.orientation]:t.orientation===key));
  if(!list.length)continue;
  const title=make('div','group-title',key==='unclassified'?'Shape not known yet ':NAMES[key]+' artworks ');
  title.append(make('span','muted',key==='unclassified'
   ?'('+list.length+'): the PC worker finds it when it opens these PSDs, or set it in the Product Creator.'
   :'('+list.length+(list.length>room?', the first '+room+' are used':'')+')'));
  const grid=make('div','tpl-grid');
  list.forEach((template,index)=>grid.append(card(template,key!=='unclassified'&&index>=room)));
  groups.append(title,grid);
 }
 checks();
}
async function loadPresets(){
 const data=await request('/api/batch/presets');
 presets=data.presets||[];room=data.room;chosen=data.chosen||'';
 const where=data.folder?' ('+data.folder+')':'';
 el('mp-about').textContent='Your presets are the folders named Preset 1, Preset 2… in the PC mockup folder'+where+
  '. Each new listing gets the PSDs from the chosen preset that suit its artwork\'s shape. Add, remove or move PSDs on the PC; the worker picks the change up within a minute.';
 if(!presets.length){
  const seen=(data.folders||[]).map(f=>f.path+' ('+f.count+')').join(', ');
  notice('mp-status',!data.worker?.online
   ?'No preset folders found, and the PC worker is offline, so the app cannot see the mockup folder as it is now. Start the PC worker, wait a minute, then click Check again.'
   :!data.folder?'No mockup folder on the PC is set for this shop, so the worker does not read your PSDs for it. In the Product Creator, under PSD mockups, enter the folder in "Mockup folder on the PC" (for example D:\\Mockups\\My Mockups) and click Save folder. The worker reads it within a minute; then click Check again.'
   :data.worker.fromConfig&&data.worker.folder&&data.worker.folder!==data.folder
    ?'The PC worker reads '+data.worker.folder+', set in its own settings on the PC (config.local.json), not the folder saved in the Product Creator. Remove mockupFolder there, or move your preset folders into it.'
   :data.worker.error?'The PC worker cannot read the mockup folder: '+data.worker.error
   :data.worker.count===0?'The PC worker finds no PSD files in '+(data.worker.folder||data.folder)+'. Check that this is the folder that holds your Preset folders (or the folders they are in). '+
    '(A folder kept in OneDrive needs PC worker v4.7.8 or later.)'
   :!(data.folders||[]).length?'The PC worker found '+data.worker.count+' PSD'+(data.worker.count===1?'':'s')+' and sends them to the app within a minute; then click Check again.'
   :'No preset folders found yet. Inside the PC mockup folder'+where+', make folders named Preset 1, Preset 2… and put PSDs in them (subfolders such as Vertical are fine). '+
    'The worker reports changes within a minute; then click Check again.'+(seen?'\nFolders the app sees now: '+seen+'.':''),'warn');
 }
 else if(data.outside>0)notice('mp-status',data.outside+' PSD'+(data.outside===1?' is':'s are')+' not in a preset folder, so new listings do not use '+(data.outside===1?'it':'them')+'.');
 else el('mp-status').classList.add('hidden');
 showPresets();
}
el('mp-refresh').addEventListener('click',()=>{presetsLoaded=loadPresets().catch(error=>notice('mp-status',String(error.message||error),'error'));});
async function choose(name){
 const previous=chosen;chosen=name;showPresets();
 try{await request('/api/batch/presets',{name});}
 catch(error){chosen=previous;showPresets();notice('mp-status',String(error.message||error),'error');}
}

// ---------------------------------------------------------------- the batch
let state={job:null,running:false,chatGpt:false,max:20},timer=0;
const uploads=[];   // files being uploaded by this page
function checks(){
 const box=el('bt-checks');box.replaceChildren();
 const line=(ok,text)=>{const row=make('div','check');row.append(make('b','',ok?'✓':'✕'),make('span','',text));box.append(row);};
 line(state.chatGpt,state.chatGpt?'ChatGPT is connected.':'ChatGPT is not connected: add OPENAI_API_KEY in Render.');
 const preset=presetByName(chosen);
 line(Boolean(preset),preset?'Mockup preset: '+preset.name+' ('+countsOf(preset).map(([key,n])=>n+' '+NAMES[key]).join(' · ')+')':
  'No mockup preset yet (see Mockup presets below).');
}
const badge={waiting:'Waiting',working:'Working',ready:'Draft ready',published:'Published',failed:'Failed'};
function show(){
 checks();
 const job=state.job,items=job?.items||[];
 el('bt-actions').classList.toggle('hidden',!items.length);
 el('bt-files').disabled=uploads.some(u=>u.active)||items.length>=state.max&&!job?.closed;
 if(!items.length){el('bt-rows').replaceChildren();el('bt-status').classList.add('hidden');return;}
 const by=status=>items.filter(item=>item.status===status).length;
 const waiting=by('waiting'),working=by('working'),ready=by('ready'),failed=by('failed'),published=by('published');
 const parts=[ready&&ready+' draft'+(ready===1?'':'s')+' ready',published&&published+' published',working&&working+' being made',
  waiting&&waiting+' waiting',failed&&failed+' failed'].filter(Boolean);
 notice('bt-status',items.length+' artwork'+(items.length===1?'':'s')+' in this batch: '+parts.join(', ')+'.'+
  (!state.running&&(waiting||working)?' Stopped: press Resume to go on.':''),failed?'warn':'');
 el('bt-updated').textContent=job.updatedAt?'Updated '+new Date(job.updatedAt).toLocaleTimeString():'';
 const rows=el('bt-rows');rows.replaceChildren();
 for(const item of items){
  const row=make('div','row item');
  let picture;
  if(item.previewUrl){picture=make('img');picture.src=item.previewUrl;picture.alt='';picture.loading='lazy';}else picture=make('div','ph');
  const text=make('div');
  text.append(make('div','t',item.seo?.title||item.filename));
  text.append(make('div','muted',[item.filename,item.artworkId,NAMES[item.orientation]].filter(Boolean).join(' · ')));
  if(item.seo?.tags?.length)text.append(make('div','tags',item.seo.tags.join(', ')));
  if(item.mockups&&item.status==='working'&&item.mockups.total){
   const bar=make('div','mini'),fill=make('div');fill.style.width=Math.round(100*item.mockups.done/item.mockups.total)+'%';bar.append(fill);text.append(bar);
  }
  if(item.error)text.append(make('div','muted',item.error));
  const side=make('div','side');
  side.append(make('span','badge '+(item.status==='published'?'done':item.status==='ready'?'done':item.status),
   item.status==='working'?item.step:badge[item.status]||item.status));
  if(item.listingId){
   const a=make('a','',item.status==='published'?'View on Etsy':'Open draft on Etsy');
   a.href=item.status==='published'?'https://www.etsy.com/listing/'+item.listingId:'https://www.etsy.com/your/shops/me/listing-editor/edit/'+item.listingId;
   a.target='_blank';a.rel='noopener noreferrer';side.append(a);
  }
  if(item.status==='ready'){
   const label=make('label'),box=make('input');box.type='checkbox';box.checked=item.publish!==false;
   box.addEventListener('change',async()=>{
    try{state={...state,...await request('/api/batch/tick',{n:item.n,publish:box.checked})};show();}
    catch(error){notice('bt-status',String(error.message||error),'error');}
   });
   label.append(box,make('span','','Publish'));side.append(label);
  }
  row.append(picture,text,side);rows.append(row);
 }
 const ticked=items.filter(item=>item.status==='ready'&&item.publish!==false).length;
 el('bt-publish').textContent='Publish '+ticked+' listing'+(ticked===1?'':'s');
 el('bt-publish').disabled=!ticked||state.running;
 el('bt-stop').classList.toggle('hidden',!state.running);
 el('bt-resume').classList.toggle('hidden',state.running||!(waiting||working));
 el('bt-retry').classList.toggle('hidden',state.running||!failed);
 el('bt-new').classList.toggle('hidden',state.running||waiting+working>0);
}
async function refresh(){
 try{state={...state,...await request('/api/batch')};show();}
 catch(error){notice('bt-status',String(error.message||error),'error');}
 clearTimeout(timer);
 if(state.running||uploads.some(u=>u.active))timer=setTimeout(refresh,4000);
}

// Uploads: the master to R2 staging, a 1024 px preview for ChatGPT, then the batch.
function put(url,file,type,onProgress){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.setRequestHeader('content-type',type);
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(event.loaded/event.total);};
  xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error('Upload failed (HTTP '+xhr.status+').'));
  xhr.onerror=()=>reject(Error('Upload failed: the connection dropped.'));
  xhr.send(file);
 });
}
async function preview(file){
 try{
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const size={width:bitmap.width,height:bitmap.height};if(bitmap.close)bitmap.close();
  return {blob:await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85)),...size};
 }catch{return null} // e.g. TIFF: the server makes the preview from the master
}
let pickNote='';   // what the last choice of files left out
function showUploads(){
 const box=el('bt-uploads');box.replaceChildren();
 if(pickNote)box.append(make('div','notice warn',pickNote));
 for(const upload of uploads.filter(u=>u.active||u.error)){
  const row=make('div','row'),text=make('div');
  text.append(make('div','t',upload.file.name),make('div','muted',upload.error||upload.note||'Uploading… '+Math.round(upload.progress*100)+'%'));
  if(!upload.error){const bar=make('div','mini'),fill=make('div');fill.style.width=Math.round(upload.progress*100)+'%';bar.append(fill);text.append(bar);}
  row.append(text,make('span','badge '+(upload.error?'failed':'working'),upload.error?'Not added':'Uploading'));
  box.append(row);
 }
}
async function uploadOne(upload){
 const file=upload.file;
 try{
  const preset=presetByName(chosen);
  if(!preset)throw Error('Choose a mockup preset first (Mockup presets below).');
  const small=await preview(file);
  if(small){
   const shape=layoutOf(small.width,small.height);
   if(!preset.templates.some(t=>t.orientation===shape||(shape==='square'&&t.squareCompatible)))
    upload.note=preset.name+' has no '+NAMES[shape]+' mockups yet: add some to its folder before this artwork reaches its mockups.';
  }
  const staged=await request('/api/artworks/stage',{filename:file.name,contentType:file.type||'application/octet-stream',size:file.size});
  await put(staged.uploadUrl,file,staged.contentType,fraction=>{upload.progress=fraction*0.95;showUploads();});
  let previewKey='';
  if(small?.blob){
   const target=await request('/api/batch/preview-url',{});
   await put(target.uploadUrl,small.blob,'image/jpeg',()=>{});
   previewKey=target.key;
  }
  const data=await request('/api/batch/add',{stageId:staged.stageId,filename:file.name,contentType:staged.contentType,size:file.size,previewKey,preset:preset.name});
  state={...state,...data};upload.active=false;upload.progress=1;
 }catch(error){upload.active=false;upload.error=String(error.message||error);}
 showUploads();show();
}
el('bt-files').addEventListener('change',async()=>{
 const picked=[...el('bt-files').files];el('bt-files').value='';
 if(!picked.length)return;
 // Only images; with more than the batch has room for, the first ones are taken.
 const images=picked.filter(file=>/^image\//.test(file.type)||/\.(jpe?g|png|webp|tiff?)$/i.test(file.name));
 const room=state.max-((state.job&&!state.job.closed)?state.job.items.length:0);
 if(room<=0){notice('bt-status','This batch is full ('+state.max+' artworks). Publish it and start a new batch for more.','warn');return;}
 const files=images.slice(0,room),left=images.length-files.length,skipped=picked.length-images.length;
 const said=[left&&'The first '+files.length+' were added: a batch holds '+state.max+'. Add the other '+left+' to the next batch.',
  skipped&&skipped+' file'+(skipped===1?' was':'s were')+' not an image and '+(skipped===1?'was':'were')+' left out.'].filter(Boolean);
 pickNote=said.join(' ');showUploads();
 if(!files.length)return;
 await presetsLoaded;
 const added=files.map(file=>({file,active:true,progress:0,error:'',note:''}));
 uploads.push(...added);showUploads();show();
 clearTimeout(timer);timer=setTimeout(refresh,4000);
 // Three at a time.
 let next=0;
 await Promise.all(Array.from({length:Math.min(3,added.length)},async()=>{while(next<added.length)await uploadOne(added[next++]);}));
 void refresh();
});
const action=(id,path,body,ask)=>el(id).addEventListener('click',async()=>{
 if(ask&&!confirm(ask()))return;
 el(id).disabled=true;
 try{state={...state,...await request(path,body())};show();clearTimeout(timer);timer=setTimeout(refresh,1500);}
 catch(error){notice('bt-status',String(error.message||error),'error');}
 finally{el(id).disabled=false;show();}
});
action('bt-stop','/api/batch/stop',()=>({}));
action('bt-resume','/api/batch/resume',()=>({}));
action('bt-retry','/api/batch/resume',()=>({retryFailed:true}));
action('bt-new','/api/batch/new',()=>({}),()=>'Start a new batch? Drafts in this batch that were not published stay on Etsy as drafts.');
action('bt-publish','/api/batch/publish',()=>({confirm:'PUBLISH NEW LISTINGS ON ETSY'}),()=>{
 const n=(state.job?.items||[]).filter(item=>item.status==='ready'&&item.publish!==false).length;
 return 'Publish '+n+' listing'+(n===1?'':'s')+' on Etsy?\n\nEach new listing costs Etsy\'s $0.20 listing fee.';
});
presetsLoaded=loadPresets().catch(error=>notice('mp-status',String(error.message||error),'error'));
void refresh();
})();
