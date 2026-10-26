// Mockup presets (Daily Listings and the Listing Reposter): the "Preset …"
// folders in the PC mockup folder, their PSDs by shape, Arrange photos (the
// shared photo organizer) and which preset the page uses. The section's
// data-for names whose choice it is ("repost" for the reposter); the page's
// own script reads window.mockupPresets.
(()=>{'use strict';
const section=document.getElementById('mockup-presets');
if(!section)return;
const FOR=section.dataset.for||'';
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
const listeners=[];
const changed=()=>{for(const listener of listeners)try{listener()}catch{}};

let presets=[],chosen='',room=20,presetsLoaded=null,presetsAt=0,limit=20,video=null;
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
 if(!preset){changed();return;}
 for(const key of ORDER){
  const list=preset.templates.filter(t=>(key==='unclassified'?!NAMES[t.orientation]:t.orientation===key));
  if(!list.length)continue;
  const title=make('div','group-title',key==='unclassified'?'Shape not known yet ':NAMES[key]+' artworks ');
  // With an arranged order, the PSDs within Etsy's 20 photos are used; else the first that fit.
  const plan=key!=='unclassified'&&preset.arrange?.[key],custom=Boolean(plan?.saved);
  const used=custom?new Set(plan.order.slice(0,limit).filter(id=>id.startsWith('generated:')).map(id=>id.slice(10))):null;
  title.append(make('span','muted',key==='unclassified'
   ?'('+list.length+'): the PC worker finds it when it opens these PSDs, or set it in the Product Creator.'
   :'('+list.length+(custom?', in your arranged photo order'+(used.size<list.length?': the '+used.size+' within Etsy\'s '+limit+' photos are used':''):
    list.length>room?', the first '+room+' are used':'')+')'));
  if(key!=='unclassified'){
   const arrange=make('button','','Arrange photos');arrange.type='button';
   arrange.addEventListener('click',()=>void openArrange(preset.name,key).catch(error=>notice('mp-status',String(error.message||error),'error')));
   title.append(arrange);
  }
  const grid=make('div','tpl-grid');
  list.forEach((template,index)=>grid.append(card(template,key!=='unclassified'&&(used?!used.has(template.id):index>=room))));
  groups.append(title,grid);
 }
 changed();
}
async function loadPresets(){
 const data=await request('/api/batch/presets'+(FOR?'?for='+FOR:''));
 presets=data.presets||[];room=data.room;chosen=data.chosen||'';limit=data.limit||20;video=data.video||null;presetsAt=Date.now();
 // The preset photos are in every organizer: their pictures load now.
 for(const tile of presets[0]?.tiles||[])if(tile.kind==='preset')new Image().src=tile.thumb;
 const where=data.folder?' ('+data.folder+')':'';
 el('mp-about').textContent='Your presets are the folders named Preset 1, Preset 2… in the PC mockup folder'+where+
  '. Each '+(FOR==='repost'?'reposted':'new')+' listing gets the PSDs from the chosen preset that suit its artwork\'s shape. Add, remove or move PSDs on the PC; the worker picks the change up within a minute.';
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
// ---------------------------------------------------------------- photo order
// The Etsy photo order for a preset and shape, arranged in the Product
// Creator's organizer (photo-organizer-client.js). Each preset's photos and
// orders come with the preset list, so it opens at once.
async function openArrange(presetName,layout){
 // The preset video's link lasts an hour.
 if(video&&Date.now()-presetsAt>45*60*1000)await loadPresets();
 const preset=presetByName(presetName),plan=preset?.arrange?.[layout];
 if(!plan)return;
 photoOrganizer.open({tiles:preset.tiles,order:plan.order,limit,video,saveLabel:'Save order',
  note:(plan.saved?'Your saved order for ':'The usual order for ')+presetName+' · '+NAMES[layout]+
   ' artworks. Every listing made with this preset and shape (Daily Listings and the Listing Reposter) gets the order you save, until you change it.',
  onSave:()=>void saveArranged(presetName,layout),onBack:()=>photoOrganizer.close()});
}
async function saveArranged(presetName,layout){
 const order=photoOrganizer.order();
 if(!order)return;
 el('mg-org-save').disabled=true;
 try{
  await request('/api/batch/photo-order',{preset:presetName,layout,order});
  const preset=presetByName(presetName);
  if(preset)preset.arrange[layout]={order,saved:true};
  photoOrganizer.close();
  showPresets();
  notice('mp-status','Photo order saved for '+presetName+' · '+NAMES[layout]+' artworks. Listings made with this preset and shape get it.');
 }catch(error){el('mg-org-status').textContent=String(error.message||error);}
 finally{el('mg-org-save').disabled=false;}
}
el('mp-refresh').addEventListener('click',()=>{presetsLoaded=loadPresets().catch(error=>notice('mp-status',String(error.message||error),'error'));});
async function choose(name){
 const previous=chosen;chosen=name;showPresets();
 try{await request('/api/batch/presets',{name,...(FOR?{for:FOR}:{})});}
 catch(error){chosen=previous;showPresets();notice('mp-status',String(error.message||error),'error');}
}
presetsLoaded=loadPresets().catch(error=>notice('mp-status',String(error.message||error),'error'));
window.mockupPresets={
 get loaded(){return presetsLoaded},
 get chosen(){return presetByName(chosen)},
 get all(){return presets},
 names:NAMES,countsOf,
 onChange(listener){listeners.push(listener)}
};
})();
