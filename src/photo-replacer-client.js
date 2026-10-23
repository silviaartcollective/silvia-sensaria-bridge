// Listings → Replace a photo. The server does the work (photo-replacer.mjs) and
// keeps the job, so this page only starts it, shows it and can be reloaded.
(()=>{'use strict';
const el=id=>document.getElementById(id);
let opened=false,listings=[],chosen=null,job=null,running=false,newFile=null,pollTimer=0,ticksFor='';
const ticks=new Map();
async function request(path,body){
 const res=await fetch(path,body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('Server returned an invalid response (HTTP '+res.status+').');}
 if(!res.ok||!data.ok)throw Error(data.error||'Request failed (HTTP '+res.status+').');
 return data;
}
function notice(message,kind=''){const node=el('pr-status');node.className='notice'+(kind?' '+kind:'');node.textContent=message;}
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
window.photoReplacer={open(){if(opened)return;opened=true;void init();}};
// The Listings script runs first; a page opened on this tab starts it here.
if(!el('photos-panel').classList.contains('hidden'))window.photoReplacer.open();

async function init(){
 try{await refreshJob();}catch(error){notice(String(error.message||error),'error');}
 try{
  for(let offset=0;offset<=4900;offset+=100){
   const data=await request('/api/master-listings?offset='+offset);
   listings.push(...(data.listings||[]));
   if(!data.hasMore)break;
  }
  const select=el('pr-listing');select.replaceChildren(make('option','','Choose a listing…'));
  select.firstChild.value='';
  for(const row of listings){
   const option=make('option','',[row.title||'Untitled',row.artworkId,'#'+row.listingId].filter(Boolean).join(' · '));
   option.value=String(row.listingId);select.append(option);
  }
 }catch(error){el('pr-listing').replaceChildren(make('option','','Listings could not load: '+String(error.message||error)));}
}
el('pr-listing').addEventListener('change',async()=>{
 const id=el('pr-listing').value;chosen=null;showChosen();
 const box=el('pr-photos');box.replaceChildren();
 if(!id)return;
 box.append(make('div','muted','Loading photos…'));
 try{
  const data=await request('/api/photo-replacer/listing-photos?listingId='+encodeURIComponent(id));
  box.replaceChildren();
  for(const photo of data.photos){
   const button=make('button');button.type='button';button.title='Photo #'+photo.rank;
   const img=make('img');img.src=photo.url;img.alt='Photo #'+photo.rank;img.loading='lazy';
   button.append(img,make('span','', '#'+photo.rank));
   button.addEventListener('click',()=>{
    chosen={listingId:Number(id),...photo};
    for(const other of box.querySelectorAll('button'))other.classList.toggle('chosen',other===button);
    el('pr-slot').value=String(photo.rank);showChosen();
   });
   box.append(button);
  }
  if(!data.photos.length)box.append(make('div','muted','This listing has no photos.'));
 }catch(error){box.replaceChildren(make('div','muted',String(error.message||error)));}
});
function showChosen(){
 el('pr-chosen').textContent=chosen?'Chosen: photo #'+chosen.rank+' of this listing. Every listing\'s slot #'+(el('pr-slot').value||chosen.rank)+' is checked first.':'Click the photo to replace.';
}
el('pr-slot').addEventListener('input',showChosen);
el('pr-file').addEventListener('change',()=>{
 newFile=el('pr-file').files?.[0]||null;
 const preview=el('pr-new-preview');
 if(newFile){preview.src=URL.createObjectURL(newFile);preview.classList.remove('hidden');}
 else preview.classList.add('hidden');
});

el('pr-scan').addEventListener('click',async()=>{
 if(running)return;
 const slot=Number(el('pr-slot').value);
 if(!chosen)return notice('Choose a listing and click the photo to replace.','error');
 if(!newFile)return notice('Choose the new photo.','error');
 if(!(slot>=1&&slot<=20))return notice('Choose the slot (1 to 20) where you keep this photo.','error');
 el('pr-scan').disabled=true;
 try{
  notice('Uploading the new photo…');
  const contentType=newFile.type||'image/jpeg';
  const reserved=await request('/api/photo-replacer/upload',{contentType,size:newFile.size});
  const put=await fetch(reserved.uploadUrl,{method:'PUT',headers:{'content-type':contentType},body:newFile});
  if(!put.ok)throw Error('Upload failed ('+put.status+').');
  notice('Looking for the photo in every listing…');
  const data=await request('/api/photo-replacer/scan',{listingId:chosen.listingId,listingImageId:chosen.listingImageId,slot,
   newImage:{key:reserved.key,filename:newFile.name,contentType}});
  show(data.job,true);
 }catch(error){notice(String(error.message||error),'error');}
 finally{el('pr-scan').disabled=running;}
});

async function refreshJob(){
 const data=await request('/api/photo-replacer');
 show(data.job,data.running);
}
function schedule(){
 clearTimeout(pollTimer);
 if(running)pollTimer=setTimeout(()=>{void refreshJob().catch(error=>{notice(String(error.message||error),'error');schedule();});},2500);
}
const kindText=(row,slot)=>{
 const o=row.outcome,t=row.target;
 if(o?.status==='replaced')return ['done','Replaced'];
 if(o?.status==='already')return ['done','Already the new photo'];
 if(o?.status==='failed')return ['failed','Failed: '+(o.error||'')];
 if(!t)return ['none',row.slotThumb?'Not found · slot #'+slot+' has another photo':'Not found'];
 if(t.kind==='same')return ['same',t.atSlot?'Same photo · slot #'+t.rank:'Same photo · in slot #'+t.rank+', not #'+slot];
 return ['similar',t.atSlot?'Older version? · slot #'+t.rank:'Looks similar · slot #'+t.rank];
};
function show(next,isRunning){
 job=next;running=Boolean(isRunning);
 el('pr-scan').disabled=running;el('pr-stop').classList.toggle('hidden',!running);
 if(!job){el('pr-results').classList.add('hidden');el('pr-bar').classList.add('hidden');schedule();return;}
 if(ticksFor!==job.id){ticks.clear();ticksFor=job.id;for(const row of job.results)ticks.set(row.listingId,Boolean(row.selected));}
 for(const row of job.results)if(!ticks.has(row.listingId))ticks.set(row.listingId,Boolean(row.selected));
 const {done,total}=job.progress||{};
 const bar=el('pr-bar');bar.classList.toggle('hidden',!total);bar.firstElementChild.style.width=(total?Math.round(100*done/total):0)+'%';
 const states={scanning:total?'Looking for the photo: '+done+' of '+total+' listings checked…':'Getting your listings from Etsy…',
  scanned:'Found. Review the listings below, then replace.',replacing:'Replacing: '+done+' of '+total+' listings…',
  done:'Finished.',stopped:'Stopped. Replace again to continue with the ticked listings.',failed:'Stopped by an error: '+(job.error||'')};
 notice(states[job.status]||job.status,job.status==='failed'?'error':'');
 el('pr-results').classList.remove('hidden');
 const found=job.results.filter(row=>row.target).length,replaced=job.results.filter(row=>row.outcome?.status==='replaced').length;
 el('pr-summary').textContent=found+' of '+job.results.length+' listings have the photo'+(replaced?' · '+replaced+' replaced':'');
 const preset=el('pr-preset-label');preset.classList.toggle('hidden',!job.presetRole);
 if(job.presetRole){
  el('pr-preset-text').textContent='Also use the new photo for new drafts (it replaces the preset "'+({'choose-option':'Choose your option','choose-frame':'Choose your frame',promotion:'Promotion'}[job.presetRole]||job.presetRole)+'")';
  if(el('pr-preset').dataset.job!==job.id){el('pr-preset').checked=job.updatePreset!==false;el('pr-preset').dataset.job=job.id;}
 }
 const order=row=>row.outcome?.status==='failed'?0:!row.target?4:row.target.kind==='same'&&row.target.atSlot?1:row.target.kind==='same'?2:3;
 const list=el('pr-list');list.replaceChildren();
 for(const row of [...job.results].sort((a,b)=>order(a)-order(b))){
  const item=make('label','pr-row');
  const box=make('input');box.type='checkbox';
  const replaceable=Boolean(row.target)&&row.outcome?.status!=='replaced';
  box.checked=replaceable&&ticks.get(row.listingId)===true;box.disabled=!replaceable||running;
  box.addEventListener('change',()=>{ticks.set(row.listingId,box.checked);updateCount();});
  const img=make('img');img.alt='';img.loading='lazy';
  const src=row.target?.thumb||row.slotThumb;if(src)img.src=src;
  const text=make('div');text.append(make('div','t',row.title||'Untitled'),make('div','muted',['#'+row.listingId,row.state,row.artworkId].filter(Boolean).join(' · ')));
  const [kind,label]=kindText(row,job.slot);
  item.append(box,img,text,make('span','pr-badge '+kind,label));
  list.append(item);
 }
 updateCount();schedule();
}
function updateCount(){
 const ids=job?job.results.filter(row=>row.target&&row.outcome?.status!=='replaced'&&ticks.get(row.listingId)).map(row=>row.listingId):[];
 const button=el('pr-replace');button.textContent='Replace in '+ids.length+' listing'+(ids.length===1?'':'s');
 button.disabled=running||!ids.length||!job||!['scanned','stopped','done'].includes(job.status);
 el('pr-count').textContent=job?.slot?'The new photo goes in the same position as the one it replaces.':'';
 return ids;
}
function tickAll(on){if(!job)return;for(const row of job.results)if(row.target)ticks.set(row.listingId,on);show(job,running);}
el('pr-all').addEventListener('click',()=>tickAll(true));
el('pr-none').addEventListener('click',()=>tickAll(false));
el('pr-replace').addEventListener('click',async()=>{
 const ids=updateCount();if(!ids.length||running)return;
 if(!confirm('Replace the photo in '+ids.length+' listing'+(ids.length===1?'':'s')+' on Etsy?\n\nEach listing gets the new photo in the same position, and the old one is removed. This changes your live Etsy listings.'))return;
 el('pr-replace').disabled=true;
 try{
  const data=await request('/api/photo-replacer/replace',{listingIds:ids,updatePreset:el('pr-preset').checked,confirm:'REPLACE PHOTOS ON ETSY'});
  show(data.job,true);
 }catch(error){notice(String(error.message||error),'error');updateCount();}
});
el('pr-stop').addEventListener('click',async()=>{
 try{await request('/api/photo-replacer/stop',{});notice('Stopping after the current listing…');}
 catch(error){notice(String(error.message||error),'error');}
});
})();
