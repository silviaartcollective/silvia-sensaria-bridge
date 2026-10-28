// Artwork Files: how many masters and originals there are, Generate for the
// originals still to make (with its progress), and the two zip downloads.
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
const notice=(text,kind='')=>{const node=el('af-status');node.className='notice'+(kind?' '+kind:'');node.textContent=text;};
const plural=(n,word)=>n+' '+word+(n===1?'':'s');
function bytes(n){
 if(!n)return '0 MB';
 return n>=1e9?(n/1e9).toFixed(n>=1e10?0:1)+' GB':n>=1e6?(n/1e6).toFixed(n>=1e8?0:1)+' MB':Math.max(1,Math.round(n/1e3))+' KB';
}
const enable=(link,on)=>link.setAttribute('aria-disabled',String(!on));
let timer=0;
function show(data){
 const {masters,originals,job}=data;
 el('af-masters-facts').textContent=masters.count?plural(masters.count,'master artwork')+' · '+bytes(masters.bytes)+' in all':'No master artworks in the app yet.';
 enable(el('af-masters'),masters.count>0);
 const todo=originals.missing+originals.outdated;
 el('af-originals-facts').textContent=plural(originals.count,'original')+' made ('+bytes(originals.bytes)+')'+
  (originals.missing?' · '+originals.missing+' still to make':'')+(originals.outdated?' · '+originals.outdated+' out of date (master replaced)':'')+
  (!todo&&originals.count?' · all up to date':'');
 enable(el('af-originals'),originals.count>0);
 const button=el('af-generate');
 button.disabled=job.running||!todo;
 button.textContent=job.running?'Generating…':todo?'Generate '+plural(todo,'original'):'All originals are made';
 const bar=el('af-bar');bar.classList.toggle('hidden',!job.running&&!job.total);
 bar.firstElementChild.style.width=(job.total?Math.round(100*job.done/job.total):0)+'%';
 if(job.running)notice('Making originals: '+job.done+' of '+job.total+' done'+(job.current?' · now '+job.current:'')+'. You can leave this page; they go on being made.');
 else if(job.finishedAt&&job.total)notice('Finished: '+plural(job.made,'original')+' made'+(job.failed.length?', '+job.failed.length+' could not be made (see below)':'')+'.',
  job.failed.length?'warn':'');
 else el('af-status').classList.add('hidden');
 const box=el('af-failed');box.replaceChildren();
 for(const row of job.failed||[]){
  const item=make('div','row item'),text=make('div');
  text.append(make('div','t',row.artworkId),make('div','muted',row.error));
  item.append(text,make('span','badge failed','Failed'));box.append(item);
 }
 el('af-updated').textContent='Checked '+new Date().toLocaleTimeString();
}
async function refresh(){
 try{const data=await request('/api/artwork-files');show(data);clearTimeout(timer);if(data.job.running)timer=setTimeout(refresh,2500);}
 catch(error){notice(String(error.message||error),'error');}
}
el('af-generate').addEventListener('click',async()=>{
 el('af-generate').disabled=true;
 try{show(await request('/api/artwork-files/originals/generate',{}));clearTimeout(timer);timer=setTimeout(refresh,1500);}
 catch(error){notice(String(error.message||error),'error');el('af-generate').disabled=false;}
});
void refresh();
})();
