// Daily Listings → New listings. The page uploads each master to R2 (with a
// small preview for ChatGPT) and hands it to the batch with the preset chosen
// under Mockup presets (mockup-presets-client.js); the server does the rest
// (batch-poster.mjs), so the page only shows the batch.
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

// ---------------------------------------------------------------- the batch
let state={job:null,running:false,chatGpt:false,max:20},timer=0;
const uploads=[];   // files being uploaded by this page
function checks(){
 const box=el('bt-checks');box.replaceChildren();
 const line=(ok,text)=>{const row=make('div','check');row.append(make('b','',ok?'✓':'✕'),make('span','',text));box.append(row);};
 line(state.chatGpt,state.chatGpt?'ChatGPT is connected.':'ChatGPT is not connected: add OPENAI_API_KEY in Render.');
 const preset=mockupPresets.chosen;
 line(Boolean(preset),preset?'Mockup preset: '+preset.name+' ('+mockupPresets.countsOf(preset).map(([key,n])=>n+' '+NAMES[key]).join(' · ')+')':
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
  (failed&&!job.stopping?' Press Try again on a failed one to go on from where it stopped.':'')+
  (job.stopping?' Stopping: the artworks being worked on stop after their current step.'
   :!state.running&&(waiting||working)?' Stopped: press Resume to go on, or Start over.':''),failed?'warn':'');
 el('bt-updated').textContent=job.updatedAt?'Updated '+new Date(job.updatedAt).toLocaleTimeString():'';
 const rows=el('bt-rows');rows.replaceChildren();
 for(const item of items){
  const row=make('div','row item');
  const picture=previewOf(item);
  const text=make('div');
  text.append(make('div','t',item.seo?.title||item.filename));
  text.append(make('div','muted',[item.filename,item.artworkId,NAMES[item.orientation]].filter(Boolean).join(' · ')));
  if(item.seo?.tags?.length)text.append(make('div','tags',item.seo.tags.join(', ')));
  // ChatGPT gave fewer than 13 usable tags even when asked again: the rest are added by hand.
  if(item.seo?.tags?.length<13)text.append(make('div','warnline','Only '+item.seo.tags.length+' of 13 tags: add '+
   (13-item.seo.tags.length)+' more in the listing on Etsy.'));
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
  // A failed artwork goes on from where it stopped, also while the others are worked on.
  if(item.status==='failed'&&!job.stopping){
   const again=make('button','','Try again');again.type='button';
   again.addEventListener('click',async()=>{
    again.disabled=true;
    try{state={...state,...await request('/api/batch/retry',{n:item.n})};show();clearTimeout(timer);timer=setTimeout(refresh,1500);}
    catch(error){notice('bt-status',String(error.message||error),'error');again.disabled=false;}
   });
   side.append(again);
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
 el('bt-stop').classList.toggle('hidden',!state.running||job.stopping);
 el('bt-resume').classList.toggle('hidden',state.running||!(waiting||working));
 el('bt-retry').classList.toggle('hidden',!failed||Boolean(job.stopping));
 el('bt-start-over').classList.toggle('hidden',!items.length);
}
async function refresh(){
 try{state={...state,...await request('/api/batch')};show();}
 catch(error){notice('bt-status',String(error.message||error),'error');}
 clearTimeout(timer);
 if(state.running||uploads.some(u=>u.active))timer=setTimeout(refresh,4000);
}

// Uploads: the master to R2 staging, a 1024 px preview for ChatGPT, then the batch.
function put(url,file,type,onProgress,upload){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.setRequestHeader('content-type',type);
  if(upload)upload.xhr=xhr;
  xhr.onabort=()=>reject(Error('Upload cancelled.'));
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(event.loaded/event.total);};
  xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error('Upload failed (HTTP '+xhr.status+').'));
  xhr.onerror=()=>reject(Error('Upload failed: the connection dropped.'));
  xhr.send(file);
 });
}
// Each artwork's picture is made once and kept, so the list refreshing every
// few seconds never loads it again (the server's links change every time).
// An artwork uploaded from this page shows the preview made here at once.
const pictures=new Map(),localPreviews=new Map(); // stageId -> <img>, object URL
function previewOf(item){
 const known=pictures.get(item.stageId);
 if(known)return known;
 const src=localPreviews.get(item.stageId)||item.previewUrl;
 if(!src)return make('div','ph');
 const img=make('img');img.src=src;img.alt='';img.decoding='async';
 pictures.set(item.stageId,img);
 return img;
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
 const file=upload.file,cancelled=()=>{if(upload.cancelled)throw Error('Upload cancelled.');};
 try{
  cancelled();
  const preset=mockupPresets.chosen;
  if(!preset)throw Error('Choose a mockup preset first (Mockup presets below).');
  const small=await preview(file);
  if(small){
   const shape=layoutOf(small.width,small.height);
   if(!preset.templates.some(t=>t.orientation===shape||(shape==='square'&&t.squareCompatible)))
    upload.note=preset.name+' has no '+NAMES[shape]+' mockups yet: add some to its folder before this artwork reaches its mockups.';
  }
  const staged=await request('/api/artworks/stage',{filename:file.name,contentType:file.type||'application/octet-stream',size:file.size});
  await put(staged.uploadUrl,file,staged.contentType,fraction=>{upload.progress=fraction*0.95;showUploads();},upload);
  cancelled();
  let previewKey='';
  if(small?.blob){
   const target=await request('/api/batch/preview-url',{});
   await put(target.uploadUrl,small.blob,'image/jpeg',()=>{});
   previewKey=target.key;
   localPreviews.set(staged.stageId,URL.createObjectURL(small.blob));
  }
  cancelled();
  const data=await request('/api/batch/add',{stageId:staged.stageId,filename:file.name,contentType:staged.contentType,size:file.size,previewKey,preset:preset.name,
   width:small?.width||0,height:small?.height||0});
  state={...state,...data};upload.active=false;upload.progress=1;
 }catch(error){upload.active=false;if(!upload.cancelled)upload.error=String(error.message||error);}
 showUploads();show();
}
// Artworks come from the file picker or are dropped on New listings.
async function addFiles(picked){
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
 await mockupPresets.loaded;
 const added=files.map(file=>({file,active:true,progress:0,error:'',note:''}));
 uploads.push(...added);showUploads();show();
 clearTimeout(timer);timer=setTimeout(refresh,4000);
 // Three at a time.
 let next=0;
 await Promise.all(Array.from({length:Math.min(3,added.length)},async()=>{while(next<added.length)await uploadOne(added[next++]);}));
 void refresh();
}
el('bt-files').addEventListener('change',()=>{
 const picked=[...el('bt-files').files];el('bt-files').value='';
 void addFiles(picked);
});
// Drag and drop: files dropped anywhere on New listings are added like chosen
// ones. Dropped anywhere else they are ignored, instead of opening in the tab.
const hasFiles=event=>[...(event.dataTransfer?.types||[])].includes('Files');
const dropBox=el('bt-drop'),dropArea=el('batch');
let dragDepth=0;
const dragOver=on=>dropBox.classList.toggle('over',on);
dropArea.addEventListener('dragenter',event=>{if(!hasFiles(event))return;event.preventDefault();dragDepth++;dragOver(true);});
dropArea.addEventListener('dragleave',event=>{if(!hasFiles(event))return;if(--dragDepth<=0){dragDepth=0;dragOver(false);}});
dropArea.addEventListener('dragover',event=>{if(!hasFiles(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';});
dropArea.addEventListener('drop',event=>{
 if(!hasFiles(event))return;
 event.preventDefault();dragDepth=0;dragOver(false);
 if(uploads.some(u=>u.active)){notice('bt-status','The artworks being uploaded are added first; drop more when they are done.','warn');return;}
 void addFiles([...event.dataTransfer.files]);
});
window.addEventListener('dragover',event=>{
 if(!hasFiles(event))return;
 event.preventDefault();
 if(!dropArea.contains(event.target))event.dataTransfer.dropEffect='none';
});
window.addEventListener('drop',event=>{if(hasFiles(event))event.preventDefault();});
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
// Start over also cancels uploads still running on this page.
el('bt-start-over').addEventListener('click',()=>{for(const upload of uploads)if(upload.active){upload.cancelled=true;upload.xhr?.abort();}},true);
action('bt-start-over','/api/batch/start-over',()=>({}),()=>'Start over?\n\nThe batch is stopped and emptied, and you choose the artworks again. '+
 'Artworks without a draft are removed from temporary storage; drafts already created stay on Etsy as drafts.');
action('bt-publish','/api/batch/publish',()=>({confirm:'PUBLISH NEW LISTINGS ON ETSY'}),()=>{
 const n=(state.job?.items||[]).filter(item=>item.status==='ready'&&item.publish!==false).length;
 return 'Publish '+n+' listing'+(n===1?'':'s')+' on Etsy?\n\nEach new listing costs Etsy\'s $0.20 listing fee.';
});
mockupPresets.onChange(checks);
void refresh();
})();
