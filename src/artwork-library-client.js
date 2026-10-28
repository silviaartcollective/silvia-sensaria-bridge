// Artwork Library: the artworks as pictures with their SKU; a click downloads
// the artwork's original, then its master, straight from storage.
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
const notice=(text,kind='')=>{const node=el('al-status');node.className='notice'+(kind?' '+kind:'');node.textContent=text;};
// The link carries the file name, so the browser saves the file and the page stays.
function save(url){const a=make('a');a.href=url;a.rel='noopener';a.style.display='none';document.body.append(a);a.click();a.remove();}
const picture=(box,art)=>{
 box.replaceChildren();
 if(art.picture){const img=make('img');img.alt=art.artworkId;img.loading='lazy';img.decoding='async';img.src=art.picture;
  img.addEventListener('error',()=>box.replaceChildren(make('span','','No picture yet')),{once:true});box.append(img);}
 else box.append(make('span','','No picture yet'));
};
async function download(card,art){
 if(card.classList.contains('busy'))return;
 card.classList.add('busy');
 notice(art.picture?'Getting '+art.artworkId+' ready…':'Making the original of '+art.artworkId+' first…');
 try{
  const files=await request('/api/artwork-library/'+encodeURIComponent(art.artworkId)+'/download',{});
  save(files.original.url);
  // The master after the original, so they arrive in that order.
  await new Promise(resolve=>setTimeout(resolve,1200));
  save(files.master.url);
  notice('Downloading '+art.artworkId+': the original ('+files.original.name+'), then the master ('+files.master.name+'). '+
   'If your browser asks whether this site may download several files, allow it.');
  if(files.picture&&!art.picture){art.picture=files.picture;picture(card.querySelector('.pic'),art);}
 }catch(error){notice(art.artworkId+': '+String(error.message||error),'error');}
 finally{card.classList.remove('busy');}
}
async function load(){
 try{
  const {artworks}=await request('/api/artwork-library');
  el('al-count').textContent=artworks.length?artworks.length+' artwork'+(artworks.length===1?'':'s')+', lowest SKU first.':'No artworks in the app yet.';
  const gallery=el('al-gallery');gallery.replaceChildren();
  for(const art of artworks){
   const card=make('button','art');card.type='button';card.title='Download '+art.artworkId+': original, then master';
   const box=make('div','pic');picture(box,art);
   card.append(box,make('div','sku',art.artworkId));
   card.addEventListener('click',()=>void download(card,art));
   gallery.append(card);
  }
 }catch(error){el('al-count').textContent='';notice(String(error.message||error),'error');}
}
void load();
})();
