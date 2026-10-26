// Listing Reposter: refreshes, then reposts, unsold listings (listing-renewer.mjs
// on the server). This page starts, stops and resumes a run and shows it; the
// mockup preset and the ChatGPT settings are their own scripts.
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
const CONFIRM='REPOST LISTINGS ON ETSY';

let state={job:null,running:false,chatGpt:false,canEdit:false,max:50,count:20,rules:null,refreshed:0},timer=0,countSet=false;
function checks(){
 const box=el('rp-checks');box.replaceChildren();
 const line=(ok,text,link)=>{const row=make('div','check');row.append(make('b','',ok?'✓':'✕'),make('span','',text));
  if(link&&!ok){const a=make('a','',link.text);a.href=link.href;row.append(a);}box.append(row);};
 line(state.chatGpt,state.chatGpt?'ChatGPT is connected.':'ChatGPT is not connected: add OPENAI_API_KEY in Render.');
 line(state.canEdit,state.canEdit?'Etsy lets the app edit your listings.':'Etsy has not allowed the app to edit listings yet.',{text:'Reconnect Etsy',href:'/etsy/connect'});
 const preset=window.mockupPresets?.chosen;
 line(Boolean(preset),preset?'Mockup preset: '+preset.name+' ('+mockupPresets.countsOf(preset).map(([key,n])=>n+' '+mockupPresets.names[key]).join(' · ')+')':
  'No mockup preset chosen yet (see Mockup presets below).');
 const problem=rulesProblem();
 if(problem)line(false,problem);
 else if(state.refreshed)line(true,state.refreshed+' listing'+(state.refreshed===1?' has':'s have')+' been refreshed so far; each is reposted if it is still unsold at '+rules().repostMonths+' months.');
}
const count=()=>{const n=Math.round(Number(el('rp-count').value));return n>=1&&n<=state.max?n:0;};
const rules=()=>({refreshMonths:Math.round(Number(el('rp-refresh').value)),repostMonths:Math.round(Number(el('rp-repost').value)),
 windowDays:Math.round(Number(el('rp-window').value))});
function rulesProblem(){
 const r=rules();
 if(!(r.refreshMonths>=1&&r.refreshMonths<=36))return 'Refresh after 1 to 36 months.';
 if(!(r.repostMonths>r.refreshMonths&&r.repostMonths<=48))return 'Repost after more months than the refresh (up to 48).';
 if(!(r.windowDays>=1&&r.windowDays<=120))return 'Renewing within 1 to 120 days.';
 return '';
}
function buttons(){
 const n=count(),job=state.job,running=state.running;
 const unfinished=job?.results?.some(row=>['waiting','working'].includes(row.status));
 const failedRows=job?.results?.some(row=>row.status==='failed');
 el('rp-start').textContent='Refresh and repost up to '+(n||'')+' listing'+(n===1?'':'s');
 el('rp-start').disabled=running||!n||Boolean(rulesProblem())||!state.chatGpt||!state.canEdit||!window.mockupPresets?.chosen;
 el('rp-stop').classList.toggle('hidden',!running);
 el('rp-resume').classList.toggle('hidden',running||!unfinished);
 el('rp-retry').classList.toggle('hidden',running||!failedRows);
}
const label={waiting:'Waiting',failed:'Failed'};
const actionOf=row=>row.action||'repost';
const day=iso=>iso?new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
function link(id,text){const a=make('a','',text);a.href='https://www.etsy.com/listing/'+id;a.target='_blank';a.rel='noopener noreferrer';return a;}
function show(){
 checks();buttons();
 const job=state.job;
 if(!job){el('rp-rows').replaceChildren();el('rp-bar').classList.add('hidden');return;}
 const p=job.progress||{},rows=job.results||[];
 const done=rows.filter(r=>r.status==='done').length,failed=rows.filter(r=>r.status==='failed').length;
 const finished=action=>rows.filter(r=>r.status==='done'&&actionOf(r)===action).length;
 const r=job.rules;
 const none=r?'No listing is due: none of the unsold listings that renew within '+r.windowDays+' days is '+r.refreshMonths+
  ' months old (refresh), or refreshed and '+r.repostMonths+' months old (repost).':'No active listing without sales was found.';
 const texts={finding:'Finding the listings due: '+(p.due!=null?p.due+' renew'+(p.due===1?'s':'')+' soon at the right age, ':'')+
   (p.checked||0)+' checked for sales, '+rows.length+' picked…',
  renewing:'Working: '+done+' of '+rows.length+' done'+(job.preset?' · mockups from '+job.preset:'')+'…',
  done:rows.length?'Finished: '+finished('refresh')+' refreshed, '+finished('repost')+' reposted'+(failed?'':'.'):none,
  stopped:'Stopped. Resume to go on where it stopped.',failed:'Stopped by an error: '+(job.error||'')};
 notice('rp-status',(texts[job.status]||job.status)+(failed&&['done','stopped'].includes(job.status)?(job.status==='done'?', ':' ')+failed+
  ' could not be done (see below); those listings are still as they were.':''),job.status==='failed'?'error':failed?'warn':'');
 el('rp-updated').textContent=job.updatedAt?'Last run '+new Date(job.updatedAt).toLocaleString():'';
 const bar=el('rp-bar');bar.classList.toggle('hidden',!rows.length);
 bar.firstElementChild.style.width=(rows.length?Math.round(100*(done+failed)/rows.length):0)+'%';
 const box=el('rp-rows');box.replaceChildren();
 for(const row of rows){
  const item=make('div','row item'),text=make('div');
  const pic=row.photo?Object.assign(make('img'),{src:row.photo,alt:'',loading:'lazy'}):make('div','ph');
  text.append(make('div','t',row.status==='done'&&row.newTitle?row.newTitle:row.title||'#'+row.listingId));
  const refresh=actionOf(row)==='refresh';
  const sub=make('div','muted',[(refresh?'Refresh':'Repost')+' #'+row.listingId,row.ageDays!=null?row.ageDays+' days old':'',
   row.renewsAt?'renews '+day(row.renewsAt):'',row.refreshedAt?'refreshed '+day(row.refreshedAt):'',
   row.artworkId?row.artworkId+' · new mockups':refresh?'new title and tags':'photos copied'].filter(Boolean).join(' · '));
  if(row.newListingId&&row.status==='done'){sub.append(document.createTextNode(' → new '));sub.append(link(row.newListingId,'#'+row.newListingId));}
  text.append(sub);
  if(row.newTitle&&row.status!=='done')text.append(make('div','muted','New title: '+row.newTitle));
  if(row.note)text.append(make('div','muted',row.note));
  if(row.error)text.append(make('div','muted',row.error));
  item.append(pic,text,make('span','badge '+row.status,row.status==='working'?row.step:row.status==='done'?(refresh?'Refreshed':'Reposted'):
   label[row.status]||row.step||row.status));
  if(row.status==='waiting'&&row.step==='Stopped')item.lastChild.textContent='Stopped';
  box.append(item);
 }
}
async function refresh(){
 try{
  const data=await request('/api/renewer');
  state={...state,...data};
  if(!countSet){
   el('rp-count').value=String(data.count||20);el('rp-count').max=String(data.max||50);
   if(data.rules){el('rp-refresh').value=String(data.rules.refreshMonths);el('rp-repost').value=String(data.rules.repostMonths);
    el('rp-window').value=String(data.rules.windowDays);}
   countSet=true;
  }
  show();
 }catch(error){notice('rp-status',String(error.message||error),'error');}
 clearTimeout(timer);
 if(state.running)timer=setTimeout(refresh,3000);
}
async function run(path,body){
 try{const data=await request(path,body);state={...state,...data,running:true};show();clearTimeout(timer);timer=setTimeout(refresh,1500);}
 catch(error){notice('rp-status',String(error.message||error),'error');buttons();}
}
el('rp-count').addEventListener('input',buttons);
for(const id of ['rp-refresh','rp-repost','rp-window'])el(id).addEventListener('input',()=>{checks();buttons();});
el('rp-start').addEventListener('click',()=>{
 const n=count(),preset=window.mockupPresets?.chosen,r=rules();if(!n||state.running||!preset||rulesProblem())return;
 if(!confirm('Refresh and repost up to '+n+' listing'+(n===1?'':'s')+' on Etsy?\n\nUnsold listings that renew within '+r.windowDays+' days: '+
  'those '+r.refreshMonths+' months old are refreshed (new SEO from ChatGPT, new mockups from '+preset.name+' made on the PC, and the current template, on the same listing, no fee); '+
  'refreshed ones still unsold at '+r.repostMonths+' months are reposted as new listings ($0.20 each) and the old ones deactivated.'))return;
 el('rp-start').disabled=true;
 void run('/api/renewer/start',{count:n,rules:r,confirm:CONFIRM});
});
el('rp-stop').addEventListener('click',async()=>{
 try{await request('/api/renewer/stop',{});notice('rp-status','Stopping after the step each listing is on…');}
 catch(error){notice('rp-status',String(error.message||error),'error');}
});
el('rp-resume').addEventListener('click',()=>void run('/api/renewer/resume',{confirm:CONFIRM}));
el('rp-retry').addEventListener('click',()=>void run('/api/renewer/resume',{confirm:CONFIRM,retryFailed:true}));
window.mockupPresets?.onChange(()=>{checks();buttons();});
void refresh();
})();
