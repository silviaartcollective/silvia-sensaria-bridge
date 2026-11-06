// Shop Data: waits while the server reads the Etsy shop, then shows what it
// found, enables the CSV download and fills in the ChatGPT audit prompt.
(()=>{'use strict';
const el=id=>document.getElementById(id);
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
async function request(path){
 const res=await fetch(path,{cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('Server returned an invalid response (HTTP '+res.status+').');}
 if(!res.ok||!data.ok)throw Error(data.error||'Request failed (HTTP '+res.status+').');
 return data;
}
const notice=(text,kind='')=>{const node=el('sd-status');node.className='notice'+(kind?' '+kind:'');node.textContent=text;};
const hide=()=>{el('sd-status').className='notice hidden';el('sd-status').textContent='';};
const plural=(n,one,many)=>n+' '+(n===1?one:many);
let timer=0,shownAt='',edited=false;

function facts(summary){
 const box=el('sd-facts');box.replaceChildren();
 const line=(kind,text)=>{const row=make('div','check '+kind);row.append(make('b','',kind==='bad'?'!':kind==='good'?'✓':'•'),make('span','',text));box.append(row);};
 const state=Object.entries(summary.byState).map(([name,n])=>n+' '+name.replace('_',' ')).join(', ');
 line('',plural(summary.listings,'listing','listings')+(state?': '+state:''));
 line('','Active listings: '+summary.views+' views, '+summary.favourites+' favourites, '+plural(summary.sales,'sale','sales'));
 const check=(n,bad,good)=>line(n?'bad':'good',n?bad(n):good);
 check(summary.noSales,n=>plural(n,'active listing has','active listings have')+' never sold','Every active listing has sold');
 check(summary.noViews,n=>plural(n,'active listing has','active listings have')+' no views','Every active listing has views');
 check(summary.under13Tags,n=>plural(n,'active listing uses','active listings use')+' fewer than 13 tags','Every active listing uses all 13 tags');
 check(summary.noSection,n=>plural(n,'active listing is','active listings are')+' in no section','Every active listing is in a section');
 check(summary.fewPhotos,n=>plural(n,'active listing has','active listings have')+' fewer than 5 photos','Every active listing has at least 5 photos');
 check(summary.altMissing,n=>plural(n,'active listing has','active listings have')+' photos without useful alt text','Every photo has alt text');
 check(summary.duplicateTitles,n=>plural(n,'listing shares','listings share')+' a title with another listing','No two listings share a title');
 check(summary.emptySections,n=>n+' of '+plural(summary.sections,'section is','sections are')+' empty','No section is empty');
 if(summary.salesUnknown)line('bad','Sales could not be counted for '+plural(summary.salesUnknown,'listing','listings'));
}
function render(data){
 const snap=data.snapshot;
 if(snap){
  el('sd-download').removeAttribute('aria-disabled');el('sd-copy').disabled=false;
  el('sd-read-at').textContent='Read '+new Date(snap.readAt).toLocaleString()+(snap.shop.name?' · '+snap.shop.name:'');
  // A new reading fills in the prompt again, unless it was edited here.
  if(snap.readAt!==shownAt){facts(snap.summary);if(!edited)el('sd-prompt').value=snap.prompt;shownAt=snap.readAt;}
 }
 el('sd-again').disabled=data.state==='reading';
 const bar=el('sd-bar');
 if(data.state==='reading'){
  const {step,read,total}=data.progress||{};
  // Reading the listings is quick; counting each one's sales is most of the wait.
  bar.classList.remove('hidden');bar.firstElementChild.style.width=(step==='sales'&&total?10+Math.round(read/total*90):5)+'%';
  notice((step==='sales'?'Counting each listing\'s sales… '+read+' of '+plural(total||0,'listing','listings')+'.':
   'Reading the listings from Etsy…'+(read?' '+plural(read,'listing','listings')+' so far.':''))+
   (snap?' Until it finishes, the buttons use the previous reading.':' A few hundred listings take a minute or two.'));
 }else{
  bar.classList.add('hidden');
  if(data.state==='failed')notice('Could not read the shop: '+data.error+(snap?'\nThe buttons use the previous reading.':''),'error');
  else hide();
 }
}
async function load(again){
 clearTimeout(timer);
 try{
  const data=await request('/api/shop-data'+(again?'?again=1':''));
  render(data);
  if(data.state==='reading')timer=setTimeout(load,2000);
 }catch(error){notice(error.message,'error');timer=setTimeout(load,10000);}
}
el('sd-again').addEventListener('click',()=>load(true));
el('sd-prompt').addEventListener('input',()=>{edited=true;});
el('sd-copy').addEventListener('click',async()=>{
 const button=el('sd-copy'),text=el('sd-prompt').value;
 try{await navigator.clipboard.writeText(text);}
 catch{el('sd-prompt').select();document.execCommand('copy');}
 button.textContent='Copied';setTimeout(()=>{button.textContent='Copy ChatGPT audit prompt';},2000);
});
load(false);
})();
