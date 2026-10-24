// Daily Listings page: ChatGPT SEO settings and Renew listings. The server runs
// the renewal (listing-renewer.mjs), so this page only starts it and shows it.
(()=>{'use strict';
const el=id=>document.getElementById(id);
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
async function request(path,body){
 const res=await fetch(path,body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('Server returned an invalid response (HTTP '+res.status+').');}
 if(!res.ok||!data.ok){const error=Error(data.error||'Request failed (HTTP '+res.status+').');error.data=data;throw error;}
 return data;
}
const notice=(id,text,kind='')=>{const node=el(id);node.className='notice'+(kind?' '+kind:'');node.textContent=text;};

// ChatGPT SEO settings
let defaults={instructions:'',model:''};
async function loadSettings(){
 const data=await request('/api/ai-seo/settings');
 defaults=data.defaults;
 el('ai-model').value=data.settings.model;el('ai-instructions').value=data.settings.instructions;
 el('ai-state').textContent=data.configured?'Connected':'Not connected';
 if(!data.configured)notice('ai-status','ChatGPT is not connected yet. Add your OpenAI API key in Render as OPENAI_API_KEY (Environment), then reload this page.','warn');
 return data;
}
el('ai-default').addEventListener('click',()=>{el('ai-instructions').value=defaults.instructions;el('ai-model').value=defaults.model;});
el('ai-save').addEventListener('click',async()=>{
 el('ai-save').disabled=true;
 try{
  const data=await request('/api/ai-seo/settings',{instructions:el('ai-instructions').value,model:el('ai-model').value});
  el('ai-instructions').value=data.settings.instructions;el('ai-model').value=data.settings.model;
  notice('ai-status',data.settings.custom?'Saved. ChatGPT uses your instructions.':'Saved. ChatGPT uses the built-in instructions.');
 }catch(error){notice('ai-status',String(error.message||error),'error');}
 finally{el('ai-save').disabled=false;}
});

// Renew listings
let state={job:null,running:false,chatGpt:false,canDelete:false,max:50},timer=0;
function checks(){
 const box=el('rn-checks');box.replaceChildren();
 const line=(ok,text,link)=>{const row=make('div','check');row.append(make('b','',ok?'✓':'✕'),make('span','',text));
  if(link&&!ok){const a=make('a','',link.text);a.href=link.href;row.append(a);}box.append(row);};
 line(state.chatGpt,state.chatGpt?'ChatGPT is connected.':'ChatGPT is not connected: add OPENAI_API_KEY in Render.');
 line(state.canDelete,state.canDelete?'Etsy allows the app to delete the old listings.':'Etsy has not allowed the app to delete listings yet.',
  {text:'Reconnect Etsy',href:'/etsy/connect'});
}
function count(){const n=Math.round(Number(el('rn-count').value));return n>=1&&n<=state.max?n:0;}
function buttons(){
 const n=count();
 el('rn-start').textContent='Renew '+(n||'')+' listing'+(n===1?'':'s');
 el('rn-start').disabled=state.running||!n||!state.chatGpt||!state.canDelete;
 el('rn-stop').classList.toggle('hidden',!state.running);
}
const label={waiting:'Waiting',working:'',done:'Renewed',failed:'Failed'};
function show(){
 checks();buttons();
 const job=state.job;
 if(!job){el('rn-rows').replaceChildren();el('rn-bar').classList.add('hidden');return;}
 const p=job.progress||{};
 const texts={finding:'Finding the oldest unsold listings: '+(p.checked||0)+' of '+(p.listings||'…')+' checked, '+job.results.length+' of '+job.count+' found…',
  renewing:'Renewing: '+(p.done||0)+' of '+job.results.length+' done…',
  done:job.results.length?'Finished: '+job.results.filter(r=>r.status==='done').length+' of '+job.results.length+' renewed.':'No active listing without sales was found.',
  stopped:'Stopped. Start again to renew more.',failed:'Stopped by an error: '+(job.error||'')};
 const failed=job.results.filter(r=>r.status==='failed').length;
 notice('rn-status',(texts[job.status]||job.status)+(failed&&['done','stopped'].includes(job.status)?' '+failed+' could not be renewed (see below); their old listings were kept or are still live.':''),
  job.status==='failed'?'error':failed?'warn':'');
 el('rn-updated').textContent=job.updatedAt?'Last run '+new Date(job.updatedAt).toLocaleString():'';
 const bar=el('rn-bar');bar.classList.toggle('hidden',!job.results.length);
 bar.firstElementChild.style.width=(job.results.length?Math.round(100*(p.done||0)/job.results.length):0)+'%';
 const rows=el('rn-rows');rows.replaceChildren();
 for(const row of job.results){
  const item=make('div','row'),text=make('div');
  text.append(make('div','t',row.title||'#'+row.listingId));
  const info=['#'+row.listingId,row.ageDays!=null?row.ageDays+' days old':''].filter(Boolean).join(' · ');
  const sub=make('div','muted',info);
  if(row.newListingId){
   sub.append(document.createTextNode(' → new '));
   const a=make('a','','#'+row.newListingId);a.href='https://www.etsy.com/listing/'+row.newListingId;a.target='_blank';a.rel='noopener noreferrer';
   sub.append(a);
  }
  text.append(sub);
  if(row.newTitle)text.append(make('div','muted','New title: '+row.newTitle));
  if(row.note)text.append(make('div','muted',row.note));
  if(row.error)text.append(make('div','muted',row.error));
  item.append(text,make('span','badge '+row.status,label[row.status]||row.step||row.status));
  if(row.status==='working')item.lastChild.textContent=row.step;
  rows.append(item);
 }
}
async function refresh(){
 try{
  const data=await request('/api/renewer');
  state={...state,...data};show();
 }catch(error){notice('rn-status',String(error.message||error),'error');}
 clearTimeout(timer);
 if(state.running)timer=setTimeout(refresh,3000);
}
el('rn-count').addEventListener('input',buttons);
el('rn-start').addEventListener('click',async()=>{
 const n=count();if(!n||state.running)return;
 if(!confirm('Renew '+n+' listing'+(n===1?'':'s')+' on Etsy?\n\nThe '+n+' oldest listings without sales are posted again as new listings with new SEO from ChatGPT, and each old listing is then deleted. Each new listing costs Etsy\'s $0.20 listing fee. This cannot be undone.'))return;
 el('rn-start').disabled=true;
 try{
  const data=await request('/api/renewer/start',{count:n,confirm:'RENEW LISTINGS ON ETSY'});
  state.job=data.job;state.running=true;show();timer=setTimeout(refresh,1500);
 }catch(error){notice('rn-status',String(error.message||error),'error');buttons();}
});
el('rn-stop').addEventListener('click',async()=>{
 try{await request('/api/renewer/stop',{});notice('rn-status','Stopping after the listings being renewed now…');}
 catch(error){notice('rn-status',String(error.message||error),'error');}
});
void loadSettings().catch(error=>notice('ai-status',String(error.message||error),'error'));
void refresh();
})();
