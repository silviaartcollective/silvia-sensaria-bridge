// Redo listing page (/listings/redo?listing=…, listing-redo-page.mjs): the
// Product Creator's form for a listing already on Etsy. It starts from the
// listing's artwork and settings; Update Etsy listing puts the new mockups,
// SEO and settings on that same listing. Nothing changes on Etsy before that.
(()=>{'use strict';
const CONFIRM='REDO SILVIA LISTING';
const $=id=>document.getElementById(id);
const listingId=Number(new URL(location.href).searchParams.get('listing'))||0;
const base='/api/master-listings/'+listingId+'/';
let info=null,jobId='',finished=false,limit=20,pollTimer=0,applying=false;
const mockups=new Map(),order=[];

async function request(path,body){
 const res=await fetch(path,body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('The app returned an unreadable response (HTTP '+res.status+'). If it was just deploying, try again in a minute.');}
 if(!res.ok||!data.ok)throw Error(data.error||'Request failed (HTTP '+res.status+').');
 return data;
}
function status(id,text,kind=''){const n=$(id);n.style.display=text?'block':'none';n.className='status'+(kind?' '+kind:'');n.textContent=text;}
function result(text,kind=''){const n=$('result');n.className='result'+(text?' show':'');n.style.borderColor=kind==='error'?'#e7b9a9':'';n.textContent=text;}
function option(select,value,label){const o=document.createElement('option');o.value=String(value);o.textContent=label;select.append(o);}
function setSelect(id,value){
 const select=$(id);if(value===undefined||value===null)return;
 const text=String(value);if([...select.options].some(o=>o.value===text))select.value=text;
}
const back=()=>{location.href='/listings'+(listingId?'?listing='+listingId:'');};
$('redo-back').addEventListener('click',back);

// The listing, its artwork and the shop's Etsy settings.
async function load(){
 if(!listingId){status('redo-summary-status','No listing was chosen. Go back and open a listing first.','warn');return;}
 try{
  const [data,options]=await Promise.all([request(base+'redo'),fetch('/etsy/listing-options',{cache:'no-store'}).then(r=>r.json()).catch(()=>({}))]);
  info=data;
  $('scope-badge').textContent='Etsy listing #'+listingId;
  if(!data.artworkId){
   status('redo-summary-status',data.reason||'This listing\'s artwork is not in the app, so it cannot be redone here.','warn');
   for(const node of document.querySelectorAll('#creator-form input,#creator-form select,#creator-form textarea,#creator-form button'))node.disabled=true;
   return;
  }
  limit=data.limit||20;
  $('redo-sub').textContent='Etsy listing #'+listingId+' ('+data.state+') · '+data.artworkId+'. Set it up again from scratch: it keeps its URL, reviews, favourites and sales.';
  $('artwork_id').value=data.artworkId;$('orientation_name').value=data.layoutName;
  if(data.picture){$('redo-picture').src=data.picture;$('redo-picture').hidden=false;}
  fillOptions(options,data);
  $('title').value=data.current.title;$('tags').value=(data.current.tags||[]).join(', ');
  counts();
  fillMockupChoices(data);
  $('redo-worker').style.display=data.workerOnline?'none':'block';
  status('redo-summary-status','Redoing Etsy listing #'+listingId+' with '+data.artworkId+' ('+data.layoutName+'). Make new mockups, write the SEO and check the settings, then click Update Etsy listing.','ok');
  $('redo-update').disabled=false;
  if(data.run?.state==='running')followRun();
 }catch(error){status('redo-summary-status','Could not load the listing: '+String(error.message||error),'warn');}
}
// The settings start from the orientation's template (Listings → Templates),
// else what the listing has now. The shop section stays the listing's.
function fillOptions(d,data){
 const lists={shipping_profile_id:['shippingProfiles','shipping_profile_id',p=>p.title||('Shipping profile '+p.shipping_profile_id)],
  readiness_state_id:['readinessProfiles','readiness_state_id',p=>(p.title||p.name||p.readiness_state||('Processing profile '+p.readiness_state_id))+
   (p.min_processing_time!==undefined&&p.max_processing_time!==undefined?' · '+p.min_processing_time+'–'+p.max_processing_time+' '+(p.processing_time_unit||'days'):'')],
  shop_section_id:['shopSections','shop_section_id',p=>p.title||('Section '+p.shop_section_id)],
  return_policy_id:['returnPolicies','return_policy_id',p=>(p.accepts_returns?'Returns':'No returns')+' · '+(p.accepts_exchanges?'Exchanges':'No exchanges')+(p.return_deadline?' · '+p.return_deadline+' days':'')],
  production_partner_id:['productionPartners','production_partner_id',p=>p.partner_name||('Partner '+p.production_partner_id)]};
 const first={shipping_profile_id:'Keep the listing\'s shipping profile',readiness_state_id:'Template processing profile',shop_section_id:'Keep the listing\'s section',
  return_policy_id:'Keep the listing\'s return policy',production_partner_id:'No production partner'};
 for(const [id,[key,valueKey,label]] of Object.entries(lists)){
  const select=$(id);select.replaceChildren();option(select,'',first[id]);
  for(const p of d?.[key]||[])option(select,p[valueKey],label(p));
 }
 const current=data.current,template=d?.listingTemplates?.[data.layout]||{};
 const pick=key=>template[key]!==undefined&&template[key]!==''&&template[key]!==null?template[key]:current[key];
 setSelect('shipping_profile_id',pick('shipping_profile_id'));
 setSelect('readiness_state_id',template.readiness_state_id||d?.detectedPreset?.readiness_state_id||'');
 setSelect('shop_section_id',current.shop_section_id||'');
 setSelect('return_policy_id',pick('return_policy_id'));
 setSelect('production_partner_id',template.production_partner_id!==undefined?(template.production_partner_id||''):(current.production_partner_id||''));
 setSelect('who_made',pick('who_made')||'i_did');setSelect('when_made',pick('when_made')||'made_to_order');
 setSelect('is_supply',String(Boolean(pick('is_supply'))));setSelect('should_auto_renew',String(pick('should_auto_renew')!==false));
 setSelect('listing_style',template.listing_style||'');
 status('template-status',Object.keys(template).length?'Settings filled from the '+data.layoutName+' template (Listings → Templates), else the listing\'s own.':
  'No '+data.layoutName+' template yet: the listing\'s own settings.',Object.keys(template).length?'ok':'');
}

// Mockups: made from the ticked PSD templates on the PC; the finished ones show on the right.
function renderPreview(){
 const list=$('mg-preview-list'),keep=$('redo-keep-photos').checked;
 list.replaceChildren();
 $('mg-select-all').disabled=$('mg-deselect-all').disabled=keep;
 if(keep){
  $('redo-preview-title').textContent='Current Etsy photos';$('mg-preview-count').textContent=(info?.photos?.length||0)+' kept';
  for(const url of info?.photos||[]){const item=document.createElement('div');item.className='mg-preview-item kept';
   const img=document.createElement('img');img.src=url;img.alt='Current photo';img.loading='lazy';item.append(img);list.append(item);}
  $('mg-selection-status').textContent='The listing keeps these photos. Untick "Keep the listing\'s current photos" to use new mockups.';
  return;
 }
 $('redo-preview-title').textContent='Generated mockups';
 if(!order.length){const p=document.createElement('p');p.className='mg-preview-empty';
  p.textContent=jobId?'Mockups are being made on the PC; they appear here as they finish.':'Tick the PSD templates and click Make mockups. Finished mockups appear here while they generate.';list.append(p);}
 for(const id of order){
  const m=mockups.get(id),item=document.createElement('label');item.className='mg-preview-item';
  const box=document.createElement('input');box.type='checkbox';box.checked=m.chosen;
  box.addEventListener('change',()=>{m.chosen=box.checked;selection();});
  const img=document.createElement('img');img.src=m.url;img.alt=m.name;img.loading='lazy';
  const name=document.createElement('span');name.textContent=m.name;
  item.append(box,img,name);list.append(item);
 }
 selection();
}
function chosenIds(){return order.filter(id=>mockups.get(id).chosen);}
function selection(){
 if($('redo-keep-photos').checked)return;
 const n=chosenIds().length;
 $('mg-preview-count').textContent=order.length+' ready';
 $('mg-selection-status').textContent=order.length?n+' of '+order.length+' mockups chosen'+(n>limit?' — Etsy takes '+limit+' photos at most':'')+'. The preset photos and video are added as for a new listing.':
  'Pick up to '+limit+' mockups. With the preset photos, Etsy shows the first '+limit+'.';
}
$('mg-select-all').addEventListener('click',()=>{order.forEach((id,i)=>{mockups.get(id).chosen=i<limit;});renderPreview();});
$('mg-deselect-all').addEventListener('click',()=>{for(const m of mockups.values())m.chosen=false;renderPreview();});
$('redo-keep-photos').addEventListener('change',()=>{$('redo-mockup-tools').style.display=$('redo-keep-photos').checked?'none':'';renderPreview();});
// The PSD library for this artwork's shape, as in the Product Creator: tick the
// templates to use. The last choice is remembered.
const pickKey=()=>'redo-templates-'+(info?.layout||'');
function rememberPick(ids){try{localStorage.setItem(pickKey(),JSON.stringify(ids));}catch{}}
function rememberedPick(){try{return JSON.parse(localStorage.getItem(pickKey())||'[]');}catch{return [];}}
function tickedIds(){return [...$('redo-library').querySelectorAll('input:checked')].map(box=>box.value);}
function countTicked(){const n=tickedIds().length;$('redo-lib-count').textContent=n+' of '+(info?.library?.length||0)+' ticked';$('redo-make').disabled=!n||replacing;}
function tick(ids){const want=new Set(ids.map(String));for(const box of $('redo-library').querySelectorAll('input'))box.checked=want.has(box.value);countTicked();}
function fillMockupChoices(data){
 const list=$('redo-library');list.replaceChildren();
 for(const t of data.library||[]){
  const item=document.createElement('label');item.title=t.folder?t.folder+' / '+t.name:t.name;
  const box=document.createElement('input');box.type='checkbox';box.value=t.id;box.addEventListener('change',countTicked);
  const img=document.createElement('img');img.loading='lazy';img.alt='';img.src=t.preview;img.onerror=()=>{img.style.visibility='hidden';};
  const name=document.createElement('span');name.textContent=t.name.replace(/\.psd$/i,'');
  item.append(box,img,name);
  if(t.folder){const folder=document.createElement('small');folder.textContent=t.folder;item.append(folder);}
  list.append(item);
 }
 if(!(data.library||[]).length){
  const shapes=Object.entries(data.shapes||{}).map(([k,n])=>n+' '+k).join(', ');
  status('redo-mockup-status','No '+data.layoutName.toLowerCase()+' PSD templates are ready. The app sees '+(data.templateCount||0)+' templates'+(shapes?': '+shapes:'')+
   '. Set their orientation in the Product Creator\'s PSD library (or keep them in a folder named after the shape on the PC), or keep the listing\'s current photos.','warn');
  $('redo-make').disabled=true;$('redo-lib-count').textContent='';return;
 }
 tick(rememberedPick().filter(id=>data.library.some(t=>t.id===id)));
 status('redo-mockup-status','','');
}
$('redo-lib-first').addEventListener('click',()=>{tick((info?.library||[]).slice(0,limit).map(t=>t.id));});
$('redo-lib-none').addEventListener('click',()=>tick([]));
$('redo-make').addEventListener('click',async()=>{
 const ids=tickedIds();if(!info?.artworkId)return;
 if(!ids.length)return status('redo-mockup-status','Tick the PSD templates to make mockups from.','warn');
 if(jobId&&!finished&&!confirm('Mockups are still being made. Start again with the ticked templates?'))return;
 clearTimeout(pollTimer);jobId='';finished=false;mockups.clear();order.length=0;renderPreview();
 const btn=$('redo-make');btn.disabled=true;status('redo-mockup-status','Starting '+ids.length+' mockups…');
 try{
  const started=await request(base+'redo-mockups',{templateIds:ids});
  rememberPick(ids);
  jobId=started.jobId;$('redo-progress').hidden=false;$('redo-progress').firstElementChild.style.width='0';
  $('redo-worker').style.display=started.workerOnline?'none':'block';
  status('redo-mockup-status','Making '+started.total+' mockups on the PC…');renderPreview();poll(jobId);
 }catch(error){status('redo-mockup-status',String(error.message||error),'warn');}
 finally{btn.disabled=false;}
});
async function poll(id){
 if(id!==jobId)return;
 try{
  const data=await request(base+'redo?job='+encodeURIComponent(id));
  if(id!==jobId)return;
  let added=false;
  for(const m of data.mockups)if(!mockups.has(m.id)){mockups.set(m.id,{...m,chosen:order.length<limit});order.push(m.id);added=true;}
  const st=data.status;finished=st.finished;
  $('redo-progress').firstElementChild.style.width=Math.round(100*(st.done+st.failed)/Math.max(1,st.total))+'%';
  if(finished){$('redo-progress').hidden=true;status('redo-mockup-status',st.done+' of '+st.total+' mockups made'+(st.failed?' ('+st.failed+' failed)':'')+'. Untick any you do not want on the right.',st.done?'ok':'warn');}
  else status('redo-mockup-status',st.done+' of '+st.total+' mockups made'+(st.note?' — '+st.note:'')+'…');
  if(added&&!$('redo-keep-photos').checked)renderPreview();
  if(!finished)pollTimer=setTimeout(()=>poll(id),3000);
 }catch(error){status('redo-mockup-status','Could not check the mockups ('+String(error.message||error)+'). Trying again…','warn');pollTimer=setTimeout(()=>poll(id),6000);}
}

// SEO: pasted output or ChatGPT, read as in the Product Creator.
const norm=v=>String(v||'').normalize('NFKC').replace(/[*_#:—–-]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
function counts(){
 $('title-count').textContent=$('title').value.trim().length+'/140';
 const tags=tagList();$('tags-count').textContent=tags.length+'/13 tags'+(tags.some(t=>t.length>20)?' · a tag is over 20 characters':'');
}
function tagList(){return $('tags').value.split(',').map(t=>t.trim()).filter(Boolean);}
$('title').addEventListener('input',counts);$('tags').addEventListener('input',counts);
function applySeo(seo){
 if(seo.title)$('title').value=seo.title;
 if(seo.description)$('seo_description').value=seo.description;
 if(seo.tags?.length)$('tags').value=seo.tags.join(', ');
 const style=seo.style||seo.homestyle;
 if(style){const match=[...$('listing_style').options].find(o=>o.value&&norm(o.value)===norm(style));if(match)$('listing_style').value=match.value;}
 const id=String(seo.sectionId||'')||String(seo.sectionUrl||'').match(/[?&]section_id=(\d+)/)?.[1]||'';
 const section=[...$('shop_section_id').options].find(o=>(id&&o.value===id)||(!id&&seo.sectionName&&norm(o.textContent)===norm(seo.sectionName)));
 if(section)$('shop_section_id').value=section.value;
 counts();
}
$('apply-seo-btn').addEventListener('click',()=>{
 const text=$('seo_generator_output').value.trim();
 if(!text)return status('seo-paste-status','Paste the SEO output first.','warn');
 const seo=window.parseSeoPaste(text);applySeo(seo);
 const needed=seo.missing.filter(part=>['title','description','tags'].includes(part));
 status('seo-paste-status',(seo.found.length?'Filled in: '+seo.found.map(p=>p==='tags'?seo.tags.length+' tags':p).join(', ')+'.':'Nothing recognised in the paste.')+
  (seo.missing.length?' Missing from the paste: '+seo.missing.join(', ')+'.':''),needed.length?'warn':'ok');
});
$('ai-seo-btn').addEventListener('click',async()=>{
 if(!info?.artworkId)return;
 const btn=$('ai-seo-btn');btn.disabled=true;status('seo-paste-status','ChatGPT is looking at the artwork and writing the SEO…');
 try{
  const data=await request('/api/ai-seo/generate',{artworkId:info.artworkId,orientation:info.layoutName});
  $('seo_generator_output').value=data.pasteText||'';applySeo(data.seo||{});
  status('seo-paste-status','Written by ChatGPT'+(data.seo?.missingTags?' · add '+data.seo.missingTags+' more tag(s) by hand':'')+'. Edit anything before updating Etsy.','ok');
 }catch(error){status('seo-paste-status',String(error.message||error),'warn');}
 finally{btn.disabled=false;}
});
$('redo-template').addEventListener('change',()=>{$('readiness_state_id').disabled=!$('redo-template').checked;});

// Update Etsy listing.
function plan(){
 const keep=$('redo-keep-photos').checked,num=id=>$(id).value?Number($(id).value):'';
 return {confirm:CONFIRM,photos:!keep,mockupJobId:jobId,templateIds:chosenIds(),template:$('redo-template').checked,
  seo:{title:$('title').value.trim(),tags:tagList(),description:$('seo_description').value.trim(),sectionId:$('shop_section_id').value,style:$('listing_style').value},
  settings:{shipping_profile_id:num('shipping_profile_id'),readiness_state_id:num('readiness_state_id'),return_policy_id:num('return_policy_id'),
   production_partner_id:num('production_partner_id'),who_made:$('who_made').value,when_made:$('when_made').value,
   is_supply:$('is_supply').value==='true',should_auto_renew:$('should_auto_renew').value==='true',listing_style:$('listing_style').value}};
}
function problems(p){
 const out=[];
 if(p.photos){
  if(!p.mockupJobId)out.push('Make the mockups, or tick "Keep the listing\'s current photos".');
  else if(!finished)out.push('Wait for the mockups to finish.');
  else if(!p.templateIds.length)out.push('Choose at least one mockup on the right.');
  else if(p.templateIds.length>limit)out.push('Choose up to '+limit+' mockups.');
 }
 if(!p.seo.title||p.seo.title.length>140)out.push('The title must be 1–140 characters.');
 if(!p.seo.tags.length||p.seo.tags.length>13||p.seo.tags.some(t=>t.length>20))out.push('Use 1–13 tags of up to 20 characters each.');
 if(!p.seo.description)out.push('Write the Short SEO Description (or use ChatGPT).');
 return out;
}
$('redo-update').addEventListener('click',async()=>{
 if(!info?.artworkId||applying)return;
 const p=plan(),issues=problems(p);
 if(issues.length)return result(issues.join('\n'),'error');
 if(!confirm('Update Etsy listing #'+listingId+' now?\n\n'+(p.photos?p.templateIds.length+' new mockups (with the preset photos) replace its photos.\n':'Its photos stay.\n')+
  'Its title, tags, description'+(p.template?', sizes, prices':'')+' and settings are replaced.\nIt keeps its URL, reviews and favourites.'))return;
 applying=true;$('redo-update').disabled=true;result('Starting…');
 try{await request(base+'redo-apply',p);followRun();}
 catch(error){applying=false;$('redo-update').disabled=false;result(String(error.message||error),'error');}
});
const STEP_TEXT={photos:'Putting the new photos on Etsy…',details:'Updating the title, tags, description, sizes and settings on Etsy…',saving:'Saving…'};
async function followRun(){
 applying=true;$('redo-update').disabled=true;
 try{
  const {run}=await request(base+'redo?progress=1');
  if(run?.state==='running'){result(STEP_TEXT[run.step]||'Working…');pollTimer=setTimeout(followRun,3000);return;}
  applying=false;
  if(run?.state==='done'){
   const n=$('result');n.className='result show';n.textContent='';
   const strong=document.createElement('strong');strong.textContent='Listing updated. ';
   const link=document.createElement('a');link.href='https://www.etsy.com/listing/'+listingId;link.target='_blank';link.rel='noopener';link.textContent='View it on Etsy';link.style.textDecoration='underline';
   n.append(strong,'Etsy listing #'+listingId+' is redone'+(run.photos?' with '+run.photos+' photos':'')+'. ',link);
   $('redo-update').textContent='Updated';
  }else{result('The update stopped: '+String(run?.error||'unknown error'),'error');$('redo-update').disabled=false;}
 }catch(error){result('Could not check the update ('+String(error.message||error)+'). Trying again…');pollTimer=setTimeout(followRun,6000);}
}
// A new master artwork, uploaded here: the editor's Production artwork steps
// (reserve, upload to R2, crop on the PC, check, then replace), after which
// the page reloads the artwork. Mockups made before it are dropped.
let replacing=false,replaceTimer=0;
const replaceStatus=(text,kind='')=>status('redo-replace-status',text,kind);
function replaceProgress(percent){const bar=$('redo-replace-progress');bar.hidden=percent==null;if(percent!=null)bar.firstElementChild.style.width=percent+'%';}
function lockForReplace(on){
 replacing=on;
 for(const id of ['redo-replace','master_file','redo-make','redo-update'])$(id).disabled=on||!info?.artworkId;
 if(!on){$('redo-replace').disabled=!$('master_file').files?.length;if(!info?.library?.length)$('redo-make').disabled=true;}
}
$('master_file').addEventListener('change',()=>{
 const file=$('master_file').files?.[0];
 $('redo-replace').disabled=!file||replacing||!info?.artworkId;
 if(file)replaceStatus(file.name+' ('+(file.size/1048576).toFixed(1)+' MB) is ready. Click Upload new artwork to replace '+(info?.artworkId||'the artwork')+'.');
});
async function fingerprint(file){
 if(!globalThis.crypto?.subtle)throw Error('Secure browser file checks are unavailable. Open the app over HTTPS.');
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
async function shapeOf(file){
 try{const b=await createImageBitmap(file);const o=b.width===b.height?'square':b.width>b.height?'landscape':'portrait';b.close();return o;}catch{return 'auto';}
}
async function putFile(url,file,type){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const res=await fetch(url,{method:'PUT',headers:{'content-type':type||file.type||'image/jpeg'},body:file});
   if(res.ok)return;
   if(![408,429,500,502,503,504].includes(res.status)||attempt===2)throw Error('The upload to Cloudflare failed ('+res.status+').');
  }catch(error){if(attempt===2)throw error;}
  await new Promise(r=>setTimeout(r,1200*(2**attempt)));
 }
}
$('redo-replace').addEventListener('click',async()=>{
 const file=$('master_file').files?.[0];if(!file||!info?.artworkId||replacing)return;
 if(!confirm('Replace '+info.artworkId+'\'s artwork with '+file.name+'?\n\nIt is uploaded and cropped on the PC worker. Once the crops are checked, '+
  info.artworkId+'\'s master and production crops are replaced (orders use the new files from then on). Etsy is not changed until you click Update Etsy listing.'))return;
 lockForReplace(true);
 try{
  replaceStatus('Checking '+file.name+'…');replaceProgress(3);
  const [sha256,orientation]=await Promise.all([fingerprint(file),shapeOf(file)]);
  const reserved=await request('/api/listing-converter/reconvert/reserve',{listingId,artworkId:info.artworkId,orientation,
   master:{filename:file.name,contentType:file.type||'image/jpeg',size:file.size,sha256}});
  if(!reserved.uploadAlreadyPresent){replaceStatus('Uploading '+file.name+'…');replaceProgress(10);await putFile(reserved.upload.uploadUrl,file,reserved.upload.contentType);}
  replaceStatus('Queueing the production crops…');replaceProgress(15);
  const started=await request('/api/listing-converter/reconvert/crop',{listingId,artworkId:info.artworkId,revision:reserved.revision});
  try{const url=URL.createObjectURL(file);const img=$('redo-picture');img.onerror=()=>{img.hidden=true;};img.src=url;img.hidden=false;}catch{}
  if(started.job?.status==='completed')return void activate(reserved.revision);
  replaceStatus(started.worker&&!started.worker.online?'Queued · start the PC crop worker; this page goes on by itself.':'Queued for the PC crop worker…');
  watchReplace(reserved.revision,Date.now());
 }catch(error){replaceFailed(error);}
});
function replaceFailed(error){replaceProgress(null);replaceStatus('The artwork was not replaced: '+String(error.message||error),'warn');lockForReplace(false);}
const final=message=>Object.assign(Error(message),{final:true});
async function watchReplace(revision,since,failures=0){
 clearTimeout(replaceTimer);
 replaceTimer=setTimeout(async()=>{
  try{
   const st=(await request('/api/listing-converter/reconvert/statuses?listingIds='+listingId)).statuses?.[listingId];
   if(!st?.exists||st.revision!==revision)throw final('This artwork job was replaced or removed.');
   if(st.ready)return void activate(revision);
   if(st.status==='failed'||st.status==='completed')throw final(st.message||'The crop worker could not make the new crops.');
   if(Date.now()-since>3*60*60*1000)throw final('The crops are still not finished after 3 hours. Check the PC crop worker.');
   const progress=Number(st.progress)||0;replaceProgress(15+Math.round(.75*progress));
   replaceStatus(st.status==='pending'?(st.queuePosition>1?'Queued · #'+st.queuePosition+' in line for the PC crop worker.':'Queued · next for the PC crop worker.'):
    'Cropping on the PC worker'+(st.currentRatio?' · '+st.currentRatio:'')+' · '+progress+'%');
   watchReplace(revision,since);
  }catch(error){
   if(error.final||failures>=4)return replaceFailed(error);
   watchReplace(revision,since,failures+1);
  }
 },4000);
}
async function activate(revision){
 try{
  replaceStatus('Crops checked. Replacing '+info.artworkId+'\'s files…');replaceProgress(95);
  await request('/api/listing-converter/reconvert/activate',{listingId,artworkId:info.artworkId,revision,confirm:'REPLACE SILVIA ARTWORK'});
  // Mockups made from the old artwork are dropped; the shape may have changed.
  clearTimeout(pollTimer);jobId='';finished=false;mockups.clear();order.length=0;
  const fresh=await request(base+'redo');
  if(fresh.artworkId){
   info={...info,...fresh};
   $('orientation_name').value=fresh.layoutName;
   fillMockupChoices(fresh);
  }
  $('master_file').value='';replaceProgress(null);
  replaceStatus('Artwork replaced: '+info.artworkId+' now uses the new master and crops. Make the mockups now so they show it.','ok');
  status('redo-mockup-status','',''); renderPreview();
 }catch(error){replaceFailed(error);return;}
 lockForReplace(false);
}
// A replacement started earlier (page reloaded) goes on here.
async function resumeReplace(){
 try{
  const st=(await request('/api/listing-converter/reconvert/statuses?listingIds='+listingId)).statuses?.[listingId];
  if(!st?.exists||!st.jobId||['activated','failed'].includes(st.status)||st.source==='existing-master')return;
  if(Date.now()-Date.parse(st.queuedAt||0)>24*60*60*1000)return;
  lockForReplace(true);replaceProgress(15);
  replaceStatus('A new artwork upload from earlier is still being cropped…');
  if(st.ready)return void activate(st.revision);
  watchReplace(st.revision,Date.now());
 }catch{}
}
load().then(()=>{if(info?.artworkId)return resumeReplace();});
})();
