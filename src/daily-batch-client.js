// Daily Listings → New listings and Mockup sets. The page uploads each master
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

// ---------------------------------------------------------------- mockup sets
let sets={},templates=[],room=20,layout='portrait',chosen=new Set(),setsLoaded=null;
const suits=(template,orientation)=>template.orientation===orientation||(orientation==='square'&&template.squareCompatible);
function showSet(){
 for(const button of el('ms-tabs').querySelectorAll('button'))button.className=button.dataset.layout===layout?'primary':'';
 el('ms-save').textContent='Save '+NAMES[layout]+' set';
 el('ms-room').textContent='Up to '+room+' mockups fit next to your preset photos.';
 const grid=el('ms-grid');grid.replaceChildren();
 const fitting=templates.filter(t=>suits(t,layout));
 if(!fitting.length)grid.append(make('div','muted','No saved PSD templates for '+NAMES[layout]+' artworks yet. Add them in the Product Creator (PSD mockups) and set their orientation.'));
 for(const template of fitting){
  const card=make('label','tpl'+(chosen.has(template.id)?' on':''));
  const top=make('div','top'),box=make('input');box.type='checkbox';box.checked=chosen.has(template.id);
  box.addEventListener('change',()=>{
   if(box.checked&&chosen.size>=room){box.checked=false;notice('ms-status','Up to '+room+' mockups fit. Untick one first.','warn');return;}
   if(box.checked)chosen.add(template.id);else chosen.delete(template.id);
   card.classList.toggle('on',box.checked);count();
  });
  top.append(box,make('span','name',template.name));
  let picture;
  if(template.preview){picture=make('img');picture.src='/api/mockups/file/preview/'+template.id;picture.alt='';picture.loading='lazy';}
  else picture=make('div','ph');
  card.append(picture,top);grid.append(card);
 }
 count();
}
function count(){el('ms-count').textContent=chosen.size+' chosen';}
function pickLayout(next){layout=next;chosen=new Set(sets[layout]||[]);showSet();}
async function loadSets(){
 const data=await request('/api/batch/mockup-sets');
 sets=data.sets||{};templates=data.templates||[];room=data.room;
 pickLayout(layout);checks();
}
el('ms-tabs').addEventListener('click',event=>{const b=event.target.closest('button');if(b)pickLayout(b.dataset.layout);});
el('ms-first').addEventListener('click',()=>{chosen=new Set(templates.filter(t=>suits(t,layout)).slice(0,room).map(t=>t.id));showSet();});
el('ms-none').addEventListener('click',()=>{chosen=new Set();showSet();});
el('ms-save').addEventListener('click',async()=>{
 el('ms-save').disabled=true;
 try{
  // Saved in the order the templates are shown.
  const ids=templates.filter(t=>chosen.has(t.id)).map(t=>t.id);
  sets=(await request('/api/batch/mockup-sets',{orientation:layout,templateIds:ids})).sets;
  notice('ms-status','Saved: '+NAMES[layout]+' artworks get '+ids.length+' mockup'+(ids.length===1?'':'s')+'.');checks();
 }catch(error){notice('ms-status',String(error.message||error),'error');}
 finally{el('ms-save').disabled=false;}
});

// ---------------------------------------------------------------- the batch
let state={job:null,running:false,chatGpt:false,max:20},timer=0;
const uploads=[];   // files being uploaded by this page
function checks(){
 const box=el('bt-checks');box.replaceChildren();
 const line=(ok,text)=>{const row=make('div','check');row.append(make('b','',ok?'✓':'✕'),make('span','',text));box.append(row);};
 line(state.chatGpt,state.chatGpt?'ChatGPT is connected.':'ChatGPT is not connected: add OPENAI_API_KEY in Render.');
 const ready=Object.keys(NAMES).filter(key=>(sets[key]||[]).length);
 line(ready.length>0,ready.length?'Mockup sets: '+Object.keys(NAMES).map(key=>NAMES[key]+' '+(sets[key]||[]).length).join(' · '):'No mockup set chosen yet (see Mockup sets below).');
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
function showUploads(){
 const box=el('bt-uploads');box.replaceChildren();
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
  const small=await preview(file);
  if(small){
   const shape=layoutOf(small.width,small.height);
   if(!(sets[shape]||[]).length)upload.note='No '+NAMES[shape]+' mockup set yet: choose one below before this artwork reaches its mockups.';
  }
  const staged=await request('/api/artworks/stage',{filename:file.name,contentType:file.type||'application/octet-stream',size:file.size});
  await put(staged.uploadUrl,file,staged.contentType,fraction=>{upload.progress=fraction*0.95;showUploads();});
  let previewKey='';
  if(small?.blob){
   const target=await request('/api/batch/preview-url',{});
   await put(target.uploadUrl,small.blob,'image/jpeg',()=>{});
   previewKey=target.key;
  }
  const data=await request('/api/batch/add',{stageId:staged.stageId,filename:file.name,contentType:staged.contentType,size:file.size,previewKey});
  state={...state,...data};upload.active=false;upload.progress=1;
 }catch(error){upload.active=false;upload.error=String(error.message||error);}
 showUploads();show();
}
el('bt-files').addEventListener('change',async()=>{
 const files=[...el('bt-files').files];el('bt-files').value='';
 if(!files.length)return;
 const room=state.max-((state.job&&!state.job.closed)?state.job.items.length:0);
 if(files.length>room){notice('bt-status','This batch has room for '+room+' more artwork'+(room===1?'':'s')+'. Choose fewer, or publish and start a new batch.','warn');return;}
 await setsLoaded;
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
setsLoaded=loadSets().catch(error=>notice('ms-status',String(error.message||error),'error'));
void refresh();
})();
