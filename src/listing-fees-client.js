// Fees & Expenses page: the month's fees from Etsy (/api/listing-fees), its
// ChatGPT costs (/api/expenses/chatgpt), their total, and the planner.
(()=>{'use strict';
const el=id=>document.getElementById(id);
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
const notice=(text,kind='')=>{const node=el('lf-status');node.className='notice'+(kind?' '+kind:'');node.textContent=text;if(!text)node.classList.add('hidden');};
let currency='USD',etsyCents=null,aiUsd=null;
const usd=value=>Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:value>0&&value<1?3:2});
// The month's total in the shop's currency, once both parts are in: ChatGPT's
// US$ cost is converted at today's rate (Etsy fees are in the shop's currency).
const fxPerUsd={USD:1},fxAsked=new Set();
async function loadFx(code){
 if(fxPerUsd[code]||fxAsked.has(code))return;fxAsked.add(code);
 try{
  const res=await fetch('/api/expenses/fx?'+new URLSearchParams({currency:code}),{cache:'no-store'});
  const data=await res.json().catch(()=>({}));
  if(res.ok&&data.ok&&data.perUsd>0)fxPerUsd[code]=data.perUsd;
 }catch{}
 fxAsked.delete(code);totals();
}
function totals(){
 const perUsd=fxPerUsd[currency];
 el('ex-etsy').textContent=etsyCents==null?'–':money(etsyCents);
 el('ex-ai').textContent=aiUsd==null?'–':perUsd&&currency!=='USD'?money(Math.round(aiUsd*perUsd*100)):usd(aiUsd);
 if(etsyCents==null||aiUsd==null){el('ex-total').textContent='–';return;}
 if(!perUsd){el('ex-total').textContent=money(etsyCents)+' + '+usd(aiUsd);void loadFx(currency);return;}
 el('ex-total').textContent=money(etsyCents+Math.round(aiUsd*perUsd*100));
 el('ex-total-note').textContent=currency==='USD'?'fees and expenses':'fees and expenses · ChatGPT US$'+aiUsd.toFixed(2)+' at '+perUsd.toFixed(4)+' '+currency+' per US$';
}
// The chosen month's name on every section ("This month" for the current one).
function monthNames(){
 const value=el('lf-month').value||thisMonth(),name=range(value).start.toLocaleDateString(undefined,{month:'long',year:'numeric'});
 el('ex-month').textContent=value===thisMonth()?'This month · '+name:name;
 for(const node of document.querySelectorAll('.month-name'))node.textContent=name;
}
// Each answer belongs to the month it was asked for: a slower one for an
// earlier choice is dropped.
let asked=0;
async function loadChatGpt(){
 const value=el('lf-month').value||thisMonth(),{min,max}=range(value),mine=++asked;
 aiUsd=null;totals();
 try{
  const res=await fetch('/api/expenses/chatgpt?'+new URLSearchParams({month:value,min,max}),{cache:'no-store'});
  const data=await res.json().catch(()=>({}));
  if(mine!==asked)return;
  if(!res.ok||!data.ok)throw Error(data.error||'ChatGPT costs could not be read (HTTP '+res.status+').');
  const u=data.usage;
  el('ai-estimated').textContent=u?usd(u.estimatedUsd):usd(0);
  el('ai-tokens').textContent=u?u.inputTokens.toLocaleString()+' tokens in · '+u.outputTokens.toLocaleString()+' out':'nothing recorded in this month';
  el('ai-calls').textContent=u?u.calls+' request'+(u.calls===1?'':'s'):'';
  el('ai-per').textContent=u&&u.calls?usd(u.estimatedUsd/u.calls):'–';
  el('ai-billed').textContent=data.billed?Number(data.billed.total).toLocaleString(undefined,{style:'currency',currency:data.billed.currency||'USD'}):'–';
  el('ai-billed-note').textContent=data.billed?'whole OpenAI organization':data.billedError||(data.adminKeyConfigured?'':'add OPENAI_ADMIN_KEY in Render to see it');
  el('ai-models').replaceChildren(...(u&&Object.keys(u.byModel||{}).length?Object.entries(u.byModel).map(([model,m])=>
   row([model,String(m.calls),m.inputTokens.toLocaleString()+' / '+m.outputTokens.toLocaleString(),usd(m.estimatedUsd)])):[row(['No ChatGPT requests recorded this month','','',''])]));
  // The billed amount when there is one, else the estimate.
  aiUsd=data.billed&&String(data.billed.currency).toUpperCase()==='USD'?Number(data.billed.total):u?u.estimatedUsd:0;
  el('ex-ai-note').textContent=data.billed?'billed by OpenAI':'estimated from tokens';
  const say=text=>{el('ai-status').className=text?'notice':'notice hidden';el('ai-status').textContent=text||'';};
  if(u?.unpricedCalls)say(u.unpricedCalls+' request(s) used a model without a known price; their cost is not included.');
  // A month before the app recorded ChatGPT requests: only OpenAI's bill has it.
  else if(!u&&!data.billed)say('The app did not record ChatGPT requests in this month (it records them from this update on). '+
   (data.adminKeyConfigured?(data.billedError||'OpenAI billed nothing for it.'):'Add OPENAI_ADMIN_KEY in Render to see what OpenAI billed for it.'));
  else if(!u&&data.billed)say('The app did not record requests in this month; the amount is what OpenAI billed.');
  else say('');
 }catch(error){if(mine!==asked)return;aiUsd=null;el('ai-status').className='notice error';el('ai-status').textContent=String(error.message||error);}
 totals();
}
const money=cents=>(Number(cents)/100).toLocaleString(undefined,{style:'currency',currency});
// The month in this computer's time zone.
function range(value){
 const [year,month]=value.split('-').map(Number);
 const start=new Date(year,month-1,1),end=new Date(year,month,1);
 return {min:Math.floor(start/1000),max:Math.floor(end/1000)-1,days:Math.round((end-start)/86400000),start};
}
const thisMonth=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
function row(cells){const tr=make('tr');cells.forEach((text,i)=>tr.append(make('td',i?'n':'',text)));return tr;}
let askedEtsy=0;
async function load(fresh=false){
 const value=el('lf-month').value||thisMonth(),{min,max,days,start}=range(value),mine=++askedEtsy;
 etsyCents=null;totals();
 el('pl-days').value=String(days);plan();
 notice('Reading the month from Etsy…');el('lf-refresh').disabled=true;
 try{
  const res=await fetch('/api/listing-fees?'+new URLSearchParams({min,max,...(fresh?{fresh:'1'}:{})}),{cache:'no-store'});
  const data=await res.json().catch(()=>({}));
  if(mine!==askedEtsy)return;
  if(!res.ok||!data.ok)throw Error(data.error||'Etsy could not be read (HTTP '+res.status+').');
  currency=data.currency||'USD';
  const listing=data.listing;
  el('lf-total').textContent=money(listing.total);
  el('lf-count').textContent=listing.count+' listing'+(listing.count===1?'':'s')+' and renewals'+(listing.count>0?' · '+money(listing.total/listing.count)+' each':'');
  el('lf-projected').textContent=data.projected==null?'–':money(data.projected);
  const elapsed=Math.max(1,Math.min(days,(Date.now()/1000-min)/86400));
  el('lf-rate').textContent=data.projected==null?(Date.now()/1000>max?'the month is over':'the month has not started'):'about '+money(listing.total/elapsed)+' a day so far';
  el('lf-other-total').textContent=money(data.other.reduce((sum,item)=>sum+item.total,0));
  etsyCents=listing.total+data.other.reduce((sum,item)=>sum+item.total,0);totals();
  el('lf-types').replaceChildren(...(listing.byType.length?listing.byType.map(item=>row([item.label,String(item.count),money(item.total)])):[row(['No listing fees this month','',''])]));
  el('lf-other').replaceChildren(...(data.other.length?data.other.map(item=>row([item.label,String(item.count),money(item.total)])):[row(['None','',''])]));
  el('lf-skipped').replaceChildren(...((data.skipped||[]).length?data.skipped.map(item=>row([item.label,String(item.count),money(item.total)])):[row(['None','',''])]));
  // By day, in this computer's time zone.
  const perDay=new Map();
  for(const [at,cents] of data.charges){
   const day=new Date(at*1000);const key=day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');
   const entry=perDay.get(key)||{count:0,total:0};entry.count+=cents>0?1:-1;entry.total+=cents;perDay.set(key,entry);
  }
  const top=Math.max(1,...[...perDay.values()].map(entry=>entry.total));
  const box=el('lf-days');box.replaceChildren();
  for(let i=0;i<days;i++){
   const day=new Date(start.getFullYear(),start.getMonth(),i+1);
   if(day>new Date())break;
   const key=day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');
   const entry=perDay.get(key)||{count:0,total:0};
   const line=make('div','day'),track=make('div','track'),bar=make('span');
   bar.style.width=Math.round(100*Math.max(0,entry.total)/top)+'%';track.append(bar);
   line.append(make('span','',day.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'})),track,
    make('span','muted',entry.count+' · '+money(entry.total)));
   box.append(line);
  }
  notice(data.cached?'Read from Etsy '+Math.round(data.ageSeconds/60)+' min ago. Refresh to read it again.':'');
 }catch(error){if(mine!==askedEtsy)return;etsyCents=null;totals();notice(String(error.message||error),'error');}
 finally{if(mine===askedEtsy)el('lf-refresh').disabled=false;}
}
function plan(){
 const n=id=>Math.max(0,Number(el(id).value)||0);
 const perDay=(n('pl-new')+n('pl-repost'))*n('pl-fee');
 el('pl-result').textContent='≈ '+(perDay*n('pl-days')).toLocaleString(undefined,{style:'currency',currency:'USD'})+' a month ('+
  perDay.toLocaleString(undefined,{style:'currency',currency:'USD'})+' a day, '+((n('pl-new')+n('pl-repost'))*n('pl-days'))+' listings)';
}
for(const id of ['pl-new','pl-repost','pl-days','pl-fee'])el(id).addEventListener('input',plan);
el('lf-month').value=thisMonth();el('lf-month').max=thisMonth();
el('lf-month').addEventListener('change',()=>{monthNames();void load();void loadChatGpt();});
el('lf-refresh').addEventListener('click',()=>{void load(true);void loadChatGpt();});
monthNames();plan();void load();void loadChatGpt();
})();
