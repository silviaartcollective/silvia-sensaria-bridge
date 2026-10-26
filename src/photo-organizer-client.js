// The Etsy photo organizer, shared by the Product Creator ("Apply selected to
// listing") and Daily Listings ("Arrange photos" for a mockup preset). Laid out
// like Etsy's "Photo and video" editor: square tiles in rows of six, the first
// photo Featured, and the preset video fixed in the second spot, where Etsy
// shows it. Photos are dragged (mouse, pen or touch) or moved with the arrow
// keys; the other tiles slide out of the way. The page holds the dialog and its
// styles (renderPhotoOrganizer and PHOTO_ORGANIZER_CSS, mockup-generator-ui.mjs).
(()=>{'use strict';
const $=id=>document.getElementById(id);
const create=(tag,label='',attrs={})=>{
 const el=document.createElement(tag);el.textContent=label;
 for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
 return el;
};
let organizer=null,wired=false;
const VIDEO_TILE='video';
let tileNodes=new Map(),drag=null;
// Opens the organizer on these photos: tiles [{id,label,thumb}], order (tile ids),
// limit (Etsy's 20), video ({label,src} or null), note (what saving does) and
// saveLabel. Save calls onSave; Back, × and Escape call onBack.
function open({tiles,order,limit=20,video=null,note='',saveLabel='Save order',onSave,onBack}){
 wire();
 finishDrag();
 organizer={tiles:new Map(tiles.map(t=>[t.id,t])),order:[...order],limit:limit||20,
  video:video?(typeof video==='object'?video:{}):null,note,saveLabel,onSave,onBack};
 const modal=$('mg-org-modal');
 if(modal.parentElement!==document.body)document.body.append(modal);
 modal.hidden=false;modal.scrollTop=0;document.body.classList.add('mg-org-open');
 $('mg-org-save').disabled=false;
 renderOrganizer();
 tileNodes.get(organizer.order[0])?.focus({preventScroll:true});
}
function close(){
 finishDrag();
 organizer=null;tileNodes=new Map();
 $('mg-org-modal').hidden=true;document.body.classList.remove('mg-org-open');
 $('mg-org-list').replaceChildren();
}
// Tile ids in grid order: the photos, with the video in the second spot.
function organizerDisplay(){
 const ids=[...organizer.order];
 if(organizer.video)ids.splice(Math.min(1,ids.length),0,VIDEO_TILE);
 return ids;
}
function photoTile(id){
 const tile=organizer.tiles.get(id)||{label:id};
 const node=create('div','',{class:'mg-org-tile',role:'listitem',tabindex:'0',title:tile.label||''});
 if(tile.thumb)node.append(create('img','',{src:tile.thumb,alt:'',draggable:'false'}));
 else node.append(create('div',tile.label||'Photo',{class:'mg-org-blank'}));
 node.append(create('b','Featured',{class:'mg-org-badge'}),create('span',tile.label||'',{class:'mg-org-caption'}));
 node.addEventListener('pointerdown',event=>pressTile(event,id,node));
 node.addEventListener('keydown',event=>keyMove(event,id));
 return node;
}
function videoTile(){
 const label=organizer.video.label||'Preset video';
 const node=create('div','',{class:'mg-org-tile mg-org-video',role:'listitem',
  'aria-label':label+', Featured video. Etsy shows it second.',title:label+': Etsy shows it in the second spot.'});
 if(organizer.video.src){
  const video=create('video','',{src:organizer.video.src+'#t=0.5',preload:'metadata',muted:'',playsinline:'','aria-hidden':'true'});
  video.muted=true;video.addEventListener('error',()=>video.remove());
  node.append(video);
 }
 node.append(create('span','',{class:'mg-org-play','aria-hidden':'true'}),create('b','Featured',{class:'mg-org-badge'}),
  create('span',label,{class:'mg-org-caption'}));
 return node;
}
function renderOrganizer(){
 if(!organizer)return;
 tileNodes=new Map(organizer.order.map(id=>[id,photoTile(id)]));
 if(organizer.video)tileNodes.set(VIDEO_TILE,videoTile());
 const list=$('mg-org-list');
 list.replaceChildren();
 const count=organizer.order.length,over=Math.max(0,count-organizer.limit),remaining=organizer.limit-count;
 // Etsy shows 20 photos: photos moved below this line are not added.
 if(over)list.append(create('div','Etsy shows '+organizer.limit+' photos · the '+over+' below this line '+
  (over===1?'is':'are')+' not added',{class:'mg-org-limit',role:'separator'}));
 if(remaining>0)list.append(create('div',remaining+' more photo'+(remaining===1?'':'s')+' can be added',
  {class:'mg-org-slot','aria-hidden':'true'}));
 placeTiles();
 refreshTiles();
 $('mg-org-count').textContent=Math.min(count,organizer.limit)+' of '+organizer.limit+' photos'+
  (organizer.video?' and 1 video':'')+(over?' · '+over+' more below the line':'');
 $('mg-org-status').textContent=(over?'Drag the photos you want into the first '+organizer.limit+'. ':'')+organizer.note;
 $('mg-org-save').textContent=organizer.saveLabel;
}
// Puts the tiles in the page in the current order, with Etsy's 20-photo line
// after the 20th photo.
function placeTiles(){
 const list=$('mg-org-list'),line=list.querySelector('.mg-org-limit'),end=list.querySelector('.mg-org-slot');
 let photos=0;
 for(const id of organizerDisplay()){
  list.insertBefore(tileNodes.get(id),end);
  if(id!==VIDEO_TILE&&++photos===organizer.limit&&line)list.insertBefore(line,end);
 }
}
// The Featured badge on the first photo; photos past Etsy's 20 are dimmed.
function markTiles(){
 organizer.order.forEach((id,index)=>{
  const node=tileNodes.get(id);
  node.querySelector('.mg-org-badge').hidden=index!==0;
  node.classList.toggle('over',index>=organizer.limit);
 });
}
function refreshTiles(){
 markTiles();
 const total=organizer.order.length;
 organizer.order.forEach((id,index)=>{
  tileNodes.get(id).setAttribute('aria-label','Photo '+(index+1)+' of '+total+(index===0?', Featured':'')+
   (index>=organizer.limit?', not added (Etsy shows '+organizer.limit+')':'')+': '+(organizer.tiles.get(id)?.label||'Photo'));
 });
}
// Puts the tiles in the current order; moved tiles slide from where they were.
function arrange(){
 const list=$('mg-org-list'),nodes=[...tileNodes.values()];
 const animate=!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const before=new Map(nodes.map(node=>[node,node.getBoundingClientRect()]));
 placeTiles();
 refreshTiles();
 if(!animate)return;
 for(const node of nodes){node.style.transition='none';node.style.transform=''}
 const moved=[];
 for(const node of nodes){
  const was=before.get(node),now=node.getBoundingClientRect();
  const dx=was.left-now.left,dy=was.top-now.top;
  if(Math.abs(dx)<1&&Math.abs(dy)<1)continue;
  node.style.transform='translate('+dx+'px,'+dy+'px)';moved.push(node);
 }
 void list.offsetWidth;
 for(const node of moved){node.style.transition='transform .18s ease';node.style.transform=''}
}
function moveTo(id,to){
 const from=organizer.order.indexOf(id);
 to=Math.max(0,Math.min(organizer.order.length-1,to));
 if(from<0||from===to)return false;
 organizer.order.splice(from,1);organizer.order.splice(to,0,id);
 arrange();
 return true;
}
function announce(id){
 const index=organizer.order.indexOf(id);
 $('mg-org-live').textContent=(organizer.tiles.get(id)?.label||'Photo')+' moved to photo '+(index+1)+
  (index===0?', the Featured photo.':'.');
}
function keyMove(event,id){
 if(!organizer||drag)return;
 const from=organizer.order.indexOf(id);
 const columns=getComputedStyle($('mg-org-list')).gridTemplateColumns.split(' ').length||6;
 const target={ArrowLeft:from-1,ArrowRight:from+1,ArrowUp:from-columns,ArrowDown:from+columns,
  Home:0,End:organizer.order.length-1}[event.key];
 if(target===undefined)return;
 event.preventDefault();
 if(moveTo(id,target))announce(id);
 tileNodes.get(id).focus({preventScroll:false});
}
// The photo itself is dragged: it lifts the moment it is pressed, follows the
// pointer and lands the moment it is let go. While dragging nothing in the page
// is measured or re-laid out: every tile is its own layer (see the CSS), the
// other tiles slide to their new spots with transforms from spot positions
// measured at the press, and at most one update runs per frame. The tiles take
// their new order in the page on release.
function pressTile(event,id,node){
 if(!organizer||drag||event.button!==0)return;
 event.preventDefault(); // no text selection or native image drag
 node.focus({preventScroll:true});
 const list=$('mg-org-list'),display=organizerDisplay();
 for(const tile of tileNodes.values()){tile.style.transition='';tile.style.transform=''}
 const box=list.getBoundingClientRect();
 drag={id,node,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,
  frame:0,start:[...organizer.order],box,box0:box,
  home:new Map(display.map((tileId,slot)=>[tileId,slot])),
  slots:display.map(tileId=>{const tile=tileNodes.get(tileId);return {x:tile.offsetLeft,y:tile.offsetTop}})};
 list.classList.add('sorting');node.classList.add('dragging');document.body.classList.add('mg-org-dragging');
 node.style.transform='translate3d(0,0,0) scale(1.04)';
 window.addEventListener('pointermove',dragMove);
 window.addEventListener('pointerup',dragEnd);
 window.addEventListener('pointercancel',dragEnd);
}
function dragMove(event){
 if(!drag||event.pointerId!==drag.pointerId)return;
 drag.x=event.clientX;drag.y=event.clientY;
 if(!drag.frame)drag.frame=requestAnimationFrame(dragFrame);
}
function dragFrame(){
 if(!drag)return;
 drag.frame=0;
 // Follows the pointer, also while the dialog scrolls under it.
 const dx=drag.x-drag.startX-(drag.box.left-drag.box0.left),dy=drag.y-drag.startY-(drag.box.top-drag.box0.top);
 drag.node.style.transform='translate3d('+dx+'px,'+dy+'px,0) scale(1.04)';
 const modal=$('mg-org-modal');
 if(drag.y<60)modal.scrollTop-=14;else if(drag.y>innerHeight-60)modal.scrollTop+=14;
 // The spot nearest the dragged photo; the video's spot is fixed.
 const home=drag.slots[drag.home.get(drag.id)];
 const id=organizerDisplay()[nearestSlot(home.x+dx,home.y+dy)];
 if(id===undefined||id===VIDEO_TILE||id===drag.id)return;
 const from=organizer.order.indexOf(drag.id),to=organizer.order.indexOf(id);
 organizer.order.splice(from,1);organizer.order.splice(to,0,drag.id);
 slideTiles();
}
function nearestSlot(x,y){
 let best=0,distance=Infinity;
 drag.slots.forEach((slot,index)=>{
  const d=(slot.x-x)**2+(slot.y-y)**2;
  if(d<distance){distance=d;best=index}
 });
 return best;
}
// Shows the other tiles at their new spots (relative to where they sit in the page).
function slideTiles(){
 organizerDisplay().forEach((id,slot)=>{
  if(id===drag.id)return;
  const tile=tileNodes.get(id),from=drag.slots[drag.home.get(id)],to=drag.slots[slot];
  const dx=to.x-from.x,dy=to.y-from.y;
  tile.style.transform=dx||dy?'translate3d('+dx+'px,'+dy+'px,0)':'';
 });
 markTiles();
}
function dragEnd(event){
 if(!drag||event.pointerId!==drag.pointerId)return;
 const {id,start}=drag,moved=event.type==='pointerup'&&start.join()!==organizer.order.join();
 finishDrag();
 if(moved)announce(id);
 tileNodes.get(id)?.focus({preventScroll:true});
}
function finishDrag(){
 window.removeEventListener('pointermove',dragMove);
 window.removeEventListener('pointerup',dragEnd);
 window.removeEventListener('pointercancel',dragEnd);
 if(!drag)return;
 const {node,frame,start}=drag;
 drag=null;
 if(frame)cancelAnimationFrame(frame);
 // Lands at once: the tiles take their new order in the page and lose their
 // transforms in the same frame.
 const list=$('mg-org-list');
 list.classList.remove('sorting');node.classList.remove('dragging');document.body.classList.remove('mg-org-dragging');
 for(const tile of tileNodes.values())tile.style.transform='';
 if(!organizer)return;
 if(start.join()!==organizer.order.join())placeTiles();
 refreshTiles();
}
function cancelDrag(){
 if(!drag)return false;
 if(organizer)organizer.order=drag.start;
 finishDrag();
 return true;
}
function wire(){
 if(wired)return;
 wired=true;
 $('mg-org-modal').addEventListener('scroll',()=>{
  if(!drag)return;
  drag.box=$('mg-org-list').getBoundingClientRect();
  if(!drag.frame)drag.frame=requestAnimationFrame(dragFrame);
 },{passive:true});
 $('mg-org-back').addEventListener('click',()=>organizer?.onBack?.());
 $('mg-org-close').addEventListener('click',()=>organizer?.onBack?.());
 $('mg-org-save').addEventListener('click',()=>organizer?.onSave?.());
 // Escape drops a photo being dragged back where it was, otherwise goes back.
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!organizer)return;
  event.preventDefault();
  if(!cancelDrag())organizer.onBack?.();
 });
}
window.photoOrganizer={open,close,isOpen:()=>Boolean(organizer),order:()=>organizer?[...organizer.order]:null};
})();
