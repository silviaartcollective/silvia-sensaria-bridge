// Listings → editor → Redo listing: set a published listing up again, step by
// step as in the Product Creator (artwork, mockups, SEO, sizes), and put it all
// on the same Etsy listing. Nothing changes on Etsy until the last step.
(()=>{'use strict';
const CONFIRM='REDO SILVIA LISTING';
const el=id=>document.getElementById(id);
let state=null,pollTimer=0;
async function request(path,body){
 const res=await fetch(path,body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('Server returned an invalid response (HTTP '+res.status+').');}
 if(!res.ok||!data.ok)throw Error(data.error||'Request failed (HTTP '+res.status+').');
 return data;
}
function say(id,message,kind=''){const node=el(id);node.className='notice'+(kind?' '+kind:'');node.textContent=message;}
function hush(id){el(id).className='notice hidden';el(id).textContent='';}
const path=(id,action)=>'/api/master-listings/'+encodeURIComponent(id)+'/'+action;
const alive=s=>state===s&&!el('editor-drawer').classList.contains('hidden');
function stopPolling(){clearTimeout(pollTimer);pollTimer=0;}

function setMode(mode){
 const redo=mode==='redo';
 el('edit-mode').classList.toggle('hidden',redo);el('redo-panel').classList.toggle('hidden',!redo);
 for(const b of document.querySelectorAll('.mode-tabs button')){
  const on=b.dataset.mode===mode;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));
 }
 if(redo&&state&&!state.loaded)void loadInfo(state);
}
for(const b of document.querySelectorAll('.mode-tabs button'))b.addEventListener('click',()=>setMode(b.dataset.mode));

function goStep(n){
 if(!state)return;
 state.step=n;
 for(const node of document.querySelectorAll('.redo-step'))node.classList.toggle('hidden',Number(node.dataset.step)!==n);
 for(const li of document.querySelectorAll('.redo-nav button')){
  const s=Number(li.dataset.step);li.classList.toggle('active',s===n);li.classList.toggle('done',s<n);
 }
 if(n===4)paintSummary();
}
for(const b of document.querySelectorAll('.redo-nav button'))b.addEventListener('click',()=>{if(state?.loaded&&state.info?.artworkId)goStep(Number(b.dataset.step));});
for(const b of document.querySelectorAll('[data-redo-go]'))b.addEventListener('click',()=>goStep(Number(b.dataset.redoGo)));

// A new listing opened in the editor: the redo starts over, in Edit mode.
function open(id,fields){
 stopPolling();
 state={id:Number(id),fields:fields||{},loaded:false,info:null,jobId:'',preset:'',mockups:new Map(),chosen:new Set(),order:[],
  finished:false,style:'',applying:false};
 el('redo-title').value=fields?.title||'';el('redo-tags').value=(fields?.tags||[]).join(', ');el('redo-description').value='';
 el('redo-mockups').replaceChildren();el('redo-bar').classList.add('hidden');el('redo-mockup-note').textContent='';
 el('redo-keep-photos').checked=false;el('redo-template').checked=true;
 for(const id of ['redo-unavailable','redo-mockup-status','redo-seo-status','redo-status'])hush(id);
 el('redo-steps').classList.add('hidden');el('redo-loading').classList.remove('hidden');
 countTitle();goStep(1);setMode('edit');
}

async function loadInfo(s){
 s.loaded=true;
 try{
  const info=await request(path(s.id,'redo'));
  if(!alive(s))return;
  s.info=info;el('redo-loading').classList.add('hidden');
  if(!info.artworkId){
   say('redo-unavailable','This listing\'s artwork is not in the app (or its master file is missing), so it cannot be redone here. '+
    'Convert it with the Gelato → Silvia Converter first, or replace its production artwork.','warn');
   return;
  }
  el('redo-steps').classList.remove('hidden');
  el('redo-artwork').textContent=info.artworkId+(info.title?' · '+info.title:'');
  el('redo-layout').textContent=info.layoutName+' artwork · mockups, description and sizes follow the '+info.layoutName+' template';
  const pic=el('redo-picture');pic.classList.toggle('hidden',!info.picture);if(info.picture)pic.src=info.picture;
  const presets=el('redo-preset');presets.replaceChildren();
  for(const p of info.presets){const o=document.createElement('option');o.value=p.name;o.textContent=p.name+' ('+p.count+' mockups)';presets.append(o);}
  presets.value=info.chosen||'';
  if(!info.presets.length)say('redo-mockup-status','No mockup preset has '+info.layoutName.toLowerCase()+' mockups. Add a preset folder on the PC, or keep the listing\'s photos.','warn');
  el('redo-worker').classList.toggle('hidden',info.workerOnline);
  const section=el('redo-section');section.replaceChildren();
  const none=document.createElement('option');none.value='';none.textContent='Keep the current section';section.append(none);
  for(const item of info.sections){const o=document.createElement('option');o.value=item.id;o.textContent=item.title;section.append(o);}
  section.value=String(s.fields.shopSectionId||'')&&info.sections.some(x=>x.id===String(s.fields.shopSectionId))?String(s.fields.shopSectionId):'';
  el('redo-write').disabled=!info.chatGpt;
  if(!info.chatGpt)say('redo-seo-status','ChatGPT is not connected (OPENAI_API_KEY in Render): write the title, tags and description by hand.','warn');
  if(info.run?.state==='running'){goStep(4);followRun(s);}
 }catch(error){
  if(!alive(s))return;
  s.loaded=false;el('redo-loading').classList.add('hidden');say('redo-unavailable','Could not load the redo: '+String(error.message||error),'error');
 }
}

// Step 2: mockups from a preset, made on the PC as for a new listing.
el('redo-keep-photos').addEventListener('change',()=>{
 const keep=el('redo-keep-photos').checked;
 el('redo-mockup-tools').classList.toggle('hidden',keep);
});
el('redo-make').addEventListener('click',async()=>{
 const s=state;if(!s?.info)return;
 const preset=el('redo-preset').value;if(!preset){say('redo-mockup-status','Choose a mockup preset.','error');return;}
 if(s.jobId&&!s.finished&&!confirm('Mockups are still being made. Start again with '+preset+'?'))return;
 stopPolling();s.jobId='';s.mockups.clear();s.chosen.clear();s.order=[];s.finished=false;el('redo-mockups').replaceChildren();
 const btn=el('redo-make');btn.disabled=true;say('redo-mockup-status','Starting the mockups…');
 try{
  const started=await request(path(s.id,'redo-mockups'),{preset});
  if(!alive(s))return;
  s.jobId=started.jobId;s.preset=preset;s.total=started.total;
  el('redo-bar').classList.remove('hidden');el('redo-bar').firstElementChild.style.width='0';
  say('redo-mockup-status','Making '+started.total+' mockups on the PC'+(started.workerOnline?'…':' — the PC worker is offline: start it to go on.'),started.workerOnline?'':'warn');
  pollMockups(s);
 }catch(error){say('redo-mockup-status',String(error.message||error),'error');}
 finally{btn.disabled=false;}
});
async function pollMockups(s){
 if(!alive(s)||!s.jobId)return;
 const jobId=s.jobId;
 try{
  const data=await request(path(s.id,'redo')+'?job='+encodeURIComponent(jobId));
  if(!alive(s)||s.jobId!==jobId)return;
  for(const m of data.mockups)if(!s.mockups.has(m.id)){s.mockups.set(m.id,m);s.order.push(m.id);s.chosen.add(m.id);addTile(s,m);}
  const st=data.status;
  el('redo-bar').firstElementChild.style.width=Math.round(100*(st.done+st.failed)/Math.max(1,st.total))+'%';
  s.finished=st.finished;
  if(st.finished){
   el('redo-bar').classList.add('hidden');
   say('redo-mockup-status',st.done+' of '+st.total+' mockups made'+(st.failed?' ('+st.failed+' failed)':'')+
    '. Untick any you do not want; the preset photos are added as for a new listing.',st.done?'':'error');
  }else say('redo-mockup-status',st.done+' of '+st.total+' mockups made'+(st.note?' — '+st.note:'')+'…');
  paintChosen(s);
  if(!st.finished)pollTimer=setTimeout(()=>pollMockups(s),3000);
 }catch(error){
  if(!alive(s))return;
  say('redo-mockup-status','Could not check the mockups ('+String(error.message||error)+'). Trying again…','warn');
  pollTimer=setTimeout(()=>pollMockups(s),6000);
 }
}
function addTile(s,m){
 const b=document.createElement('button');b.type='button';b.className='chosen';b.dataset.id=m.id;b.title=m.name;
 const img=document.createElement('img');img.alt=m.name;img.loading='lazy';img.src=m.url;
 const tick=document.createElement('span');tick.textContent='✓';
 b.append(img,tick);
 b.addEventListener('click',()=>{if(s.chosen.has(m.id))s.chosen.delete(m.id);else s.chosen.add(m.id);paintChosen(s);});
 el('redo-mockups').append(b);
}
function paintChosen(s){
 for(const b of el('redo-mockups').children){const on=s.chosen.has(b.dataset.id);b.classList.toggle('chosen',on);b.lastElementChild.textContent=on?'✓':'';}
 el('redo-mockup-note').textContent=s.mockups.size?s.chosen.size+' of '+s.mockups.size+' mockups chosen':'';
}

// Step 3: title, tags and description, written by ChatGPT from the artwork or by hand.
function countTitle(){el('redo-title-count').textContent=el('redo-title').value.trim().length+'/140';}
function tagList(){return el('redo-tags').value.split(',').map(t=>t.trim()).filter(Boolean);}
function countTags(){const tags=tagList();el('redo-tags-count').textContent=tags.length+'/13'+(tags.some(t=>t.length>20)?' · a tag is over 20 characters':'');}
el('redo-title').addEventListener('input',countTitle);el('redo-tags').addEventListener('input',countTags);
el('redo-write').addEventListener('click',async()=>{
 const s=state;if(!s?.info)return;
 const btn=el('redo-write');btn.disabled=true;say('redo-seo-status','ChatGPT is looking at the artwork… (up to a minute)');
 try{
  const {seo}=await request(path(s.id,'redo-seo'),{});
  if(!alive(s))return;
  el('redo-title').value=seo.title;el('redo-tags').value=seo.tags.join(', ');el('redo-description').value=seo.description;
  s.style=seo.style||'';
  if(seo.sectionId&&[...el('redo-section').options].some(o=>o.value===seo.sectionId))el('redo-section').value=seo.sectionId;
  countTitle();countTags();
  say('redo-seo-status','New SEO written'+(seo.style?' · style: '+seo.style:'')+(seo.missingTags?' · add '+seo.missingTags+' more tag(s) by hand':'')+'. Edit anything before going on.');
 }catch(error){if(alive(s))say('redo-seo-status',String(error.message||error),'error');}
 finally{btn.disabled=false;}
});

// Step 4: what will change, then the redo itself.
function plan(){
 const s=state,keep=el('redo-keep-photos').checked;
 return {confirm:CONFIRM,photos:!keep,mockupJobId:s.jobId,templateIds:s.order.filter(id=>s.chosen.has(id)),preset:s.preset,
  template:el('redo-template').checked,
  seo:{title:el('redo-title').value.trim(),tags:tagList(),description:el('redo-description').value.trim(),sectionId:el('redo-section').value,style:s.style}};
}
function problems(p){
 const out=[];
 if(p.photos){
  if(!p.mockupJobId)out.push('Make the mockups (step 2), or tick "Keep the listing\'s current photos".');
  else if(!state.finished)out.push('Wait for the mockups to finish (step 2).');
  else if(!p.templateIds.length)out.push('Choose at least one mockup (step 2).');
 }
 if(!p.seo.title||p.seo.title.length>140)out.push('The title must be 1–140 characters (step 3).');
 if(!p.seo.tags.length||p.seo.tags.length>13||p.seo.tags.some(t=>t.length>20))out.push('Use 1–13 tags of up to 20 characters (step 3).');
 if(!p.seo.description)out.push('Write the description (step 3).');
 return out;
}
function paintSummary(){
 const p=plan(),list=el('redo-summary');list.replaceChildren();
 const line=(label,text)=>{const li=document.createElement('li');const b=document.createElement('b');b.textContent=label+': ';li.append(b,text);list.append(li);};
 line('Photos',p.photos?(p.templateIds.length+' new mockups from '+(p.preset||'the preset')+', with the preset photos, replace the current photos'):'kept as they are');
 line('Title',p.seo.title||'(missing)');
 line('Tags',p.seo.tags.length+' tags');
 line('Description','the '+(state.info?.layoutName||'')+' template with the new SEO description');
 line('Sizes, prices and profiles',p.template?'the current template (sizes, prices, shipping and processing profiles, style)':'kept as they are');
 const issues=problems(p);
 if(issues.length)say('redo-status',issues.join('\n'),'warn');else if(!state.applying)hush('redo-status');
 el('redo-apply').disabled=Boolean(issues.length)||state.applying;
}
el('redo-template').addEventListener('change',paintSummary);
el('redo-apply').addEventListener('click',async()=>{
 const s=state;if(!s?.info)return;
 const p=plan();if(problems(p).length)return paintSummary();
 if(!confirm('Redo Etsy listing #'+s.id+' now? Its photos, title, tags and description'+(p.template?', sizes and prices':'')+
  ' are replaced on Etsy. The listing keeps its URL, reviews and favourites.'))return;
 s.applying=true;el('redo-apply').disabled=true;say('redo-status','Starting the redo…');
 try{
  await request(path(s.id,'redo-apply'),p);
  if(alive(s))followRun(s);
 }catch(error){s.applying=false;if(alive(s)){say('redo-status',String(error.message||error),'error');el('redo-apply').disabled=false;}}
});
const STEP_TEXT={photos:'Putting the new photos on Etsy…',details:'Updating the title, tags, description and sizes on Etsy…',saving:'Saving…'};
async function followRun(s){
 if(!alive(s))return;
 s.applying=true;el('redo-apply').disabled=true;
 try{
  const {run}=await request(path(s.id,'redo')+'?progress=1');
  if(!alive(s))return;
  if(run?.state==='running'){say('redo-status',STEP_TEXT[run.step]||'Working…');pollTimer=setTimeout(()=>followRun(s),3000);return;}
  s.applying=false;
  if(run?.state==='done'){
   say('redo-status','Done. Etsy listing #'+s.id+' is redone'+(run.photos?' with '+run.photos+' photos':'')+'. Open it on Etsy to check it.');
   document.dispatchEvent(new CustomEvent('listing-redone',{detail:{listingId:s.id}}));
  }else{say('redo-status','The redo stopped: '+String(run?.error||'unknown error'),'error');el('redo-apply').disabled=false;}
 }catch(error){if(alive(s)){say('redo-status','Could not check the redo ('+String(error.message||error)+'). Trying again…','warn');pollTimer=setTimeout(()=>followRun(s),6000);}}
}
window.listingRedo={open,setMode};
})();
