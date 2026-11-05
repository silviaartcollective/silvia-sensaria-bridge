// Artwork Library: the artworks as whole pictures with their SKU; a click opens
// one larger, with buttons that download its original, its master or both,
// straight from storage. Pictures still being made fill in by themselves.
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
const hide=id=>{el(id).className='notice hidden';el(id).textContent='';};
// The link carries the file name, so the browser saves the file and the page stays.
function save(url){const a=make('a');a.href=url;a.rel='noopener';a.style.display='none';document.body.append(a);a.click();a.remove();}
const shape=art=>String(Math.min(4,Math.max(.25,art.width/art.height||.8)));
const cards=new Map();
let open=null,busy=false,pollTimer=0;

function picture(box,art,size){
 box.replaceChildren();box.classList.remove('making');
 const url=art[size];
 if(url){const img=make('img');img.alt=art.artworkId;img.decoding='async';if(size==='gallery')img.loading='lazy';img.src=url;
  img.addEventListener('error',()=>box.replaceChildren(make('span','','No picture yet')),{once:true});box.append(img);}
 else if(art.making){box.classList.add('making');box.append(make('span','','Making the preview…'));}
 else box.append(make('span','',art.error?'No preview: '+art.error:'No picture yet'));
}
// Rows of one height each, as near the page's row height as the pictures
// allow: a row ends where it comes closest to that height.
function layout(){
 const gallery=el('al-gallery'),width=gallery.clientWidth;if(!width)return;
 const style=getComputedStyle(gallery),target=parseFloat(style.getPropertyValue('--row'))||250,gap=parseFloat(style.columnGap)||0;
 const place=(row,height)=>{for(const item of row)item.node.style.width=Math.floor(Number(shape(item.art))*height)+'px';};
 const tall=(count,sum)=>(width-gap*(count-1))/sum;
 let row=[],sum=0;
 for(const item of cards.values()){
  const a=Number(shape(item.art)),joined=tall(row.length+1,sum+a);
  if(row.length&&joined<target){
   const alone=tall(row.length,sum);
   if(alone/target<=target/joined){place(row,alone);row=[item];sum=a;}
   else{row.push(item);place(row,joined);row=[];sum=0;}
   continue;
  }
  row.push(item);sum+=a;
 }
 if(row.length)place(row,Math.min(target,tall(row.length,sum)));
}
let layoutFrame=0;
const relayout=()=>{cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(layout);};
function card(art){
 const node=make('button','art');node.type='button';node.title='Open '+art.artworkId;
 node.style.setProperty('--a',shape(art));
 const box=make('div','pic');picture(box,art,'gallery');
 node.append(box,make('div','sku',art.artworkId));
 node.addEventListener('click',()=>show(art.artworkId));
 cards.set(art.artworkId,{node,box,art});
 return node;
}

// The window: the artwork larger (the gallery picture at once, the bigger one
// when it arrives), and the download buttons.
function big(art){
 const box=el('al-big');box.style.setProperty('--a',shape(art));
 if(!art.view){picture(box,art,'view');return;}
 box.replaceChildren();box.classList.remove('making');
 const img=make('img');img.alt=art.artworkId;img.src=art.gallery;box.append(img);
 const full=new Image();full.decoding='async';full.onload=()=>{if(open===art.artworkId)img.src=full.src;};full.src=art.view;
}
function show(artworkId){
 const art=cards.get(artworkId)?.art;if(!art)return;
 open=artworkId;
 el('al-title').textContent=art.artworkId;el('al-name').textContent=art.filename||'';
 hide('al-window-status');big(art);
 new ResizeObserver(relayout).observe(el('al-gallery'));
const dialog=el('al-window');if(!dialog.open)dialog.showModal();
}
async function download(files){
 if(busy||!open)return;
 const artworkId=open;busy=true;
 const buttons=[...document.querySelectorAll('#al-window [data-files]')];buttons.forEach(button=>{button.disabled=true;});
 notice('al-window-status',files.includes('original')?'Getting '+artworkId+' ready (an original is made first if it has none)…':'Getting '+artworkId+' ready…');
 try{
  const ready=await request('/api/artwork-library/'+encodeURIComponent(artworkId)+'/download',{files});
  const names=[];
  if(ready.original){save(ready.original.url);names.push('the original ('+ready.original.name+')');}
  // The master after the original, so they arrive in that order.
  if(ready.original&&ready.master)await new Promise(resolve=>setTimeout(resolve,1200));
  if(ready.master){save(ready.master.url);names.push('the master ('+ready.master.name+')');}
  notice('al-window-status','Downloading '+names.join(', then ')+'.'+
   (names.length>1?' If your browser asks whether this site may download several files, allow it.':''));
 }catch(error){notice('al-window-status',artworkId+': '+String(error.message||error),'error');}
 finally{busy=false;buttons.forEach(button=>{button.disabled=false;});}
}

function count(artworks){
 const making=artworks.filter(art=>art.making).length;
 el('al-count').textContent=(artworks.length?artworks.length+' artwork'+(artworks.length===1?'':'s')+', lowest SKU first.':'No artworks in the app yet.')+
  (making?' Making the preview of '+making+' more…':'');
 return making;
}
// While previews are being made, the list is checked again and each one shows when it is ready.
async function poll(){
 try{
  const {artworks}=await request('/api/artwork-library?poll=1');
  for(const art of artworks){
   const known=cards.get(art.artworkId);
   if(!known){el('al-gallery').append(card(art));relayout();continue;}
   if(known.art.gallery===art.gallery&&known.art.making===art.making&&known.art.error===art.error)continue;
   if(shape(known.art)!==shape(art)){known.node.style.setProperty('--a',shape(art));relayout();}
   known.art=art;picture(known.box,art,'gallery');
   if(open===art.artworkId)big(art);
  }
  if(count(artworks))pollTimer=setTimeout(poll,4000);
 }catch{pollTimer=setTimeout(poll,10000);}
}
async function load(){
 try{
  const {artworks}=await request('/api/artwork-library');
  const gallery=el('al-gallery');gallery.replaceChildren();cards.clear();
  for(const art of artworks)gallery.append(card(art));
  layout();
  if(count(artworks)){clearTimeout(pollTimer);pollTimer=setTimeout(poll,4000);}
 }catch(error){el('al-count').textContent='';notice('al-status',String(error.message||error),'error');}
}

new ResizeObserver(relayout).observe(el('al-gallery'));
const dialog=el('al-window');
dialog.addEventListener('close',()=>{open=null;});
// A click on the dimmed page around the window closes it; Esc does too.
dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
el('al-close').addEventListener('click',()=>dialog.close());
for(const button of document.querySelectorAll('#al-window [data-files]'))
 button.addEventListener('click',()=>void download(button.dataset.files.split(',')));
void load();
})();
