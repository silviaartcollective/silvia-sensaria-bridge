// Listing Fees page: the month's fees from Etsy (/api/listing-fees) and the planner.
(()=>{'use strict';
const el=id=>document.getElementById(id);
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
const notice=(text,kind='')=>{const node=el('lf-status');node.className='notice'+(kind?' '+kind:'');node.textContent=text;if(!text)node.classList.add('hidden');};
let currency='USD';
const money=cents=>(Number(cents)/100).toLocaleString(undefined,{style:'currency',currency});
// The month in this computer's time zone.
function range(value){
 const [year,month]=value.split('-').map(Number);
 const start=new Date(year,month-1,1),end=new Date(year,month,1);
 return {min:Math.floor(start/1000),max:Math.floor(end/1000)-1,days:Math.round((end-start)/86400000),start};
}
const thisMonth=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
function row(cells){const tr=make('tr');cells.forEach((text,i)=>tr.append(make('td',i?'n':'',text)));return tr;}
async function load(fresh=false){
 const value=el('lf-month').value||thisMonth(),{min,max,days,start}=range(value);
 el('pl-days').value=String(days);plan();
 notice('Reading the month from Etsy…');el('lf-refresh').disabled=true;
 try{
  const res=await fetch('/api/listing-fees?'+new URLSearchParams({min,max,...(fresh?{fresh:'1'}:{})}),{cache:'no-store'});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.ok)throw Error(data.error||'Etsy could not be read (HTTP '+res.status+').');
  currency=data.currency||'USD';
  const listing=data.listing;
  el('lf-total').textContent=money(listing.total);
  el('lf-count').textContent=listing.count+' listing'+(listing.count===1?'':'s')+' and renewals';
  el('lf-projected').textContent=data.projected==null?'–':money(data.projected);
  const elapsed=Math.max(1,Math.min(days,(Date.now()/1000-min)/86400));
  el('lf-rate').textContent=data.projected==null?(Date.now()/1000>max?'the month is over':'the month has not started'):'about '+money(listing.total/elapsed)+' a day so far';
  el('lf-other-total').textContent=money(data.other.reduce((sum,item)=>sum+item.total,0));
  el('lf-types').replaceChildren(...(listing.byType.length?listing.byType.map(item=>row([item.label,String(item.count),money(item.total)])):[row(['No listing fees this month','',''])]));
  el('lf-other').replaceChildren(...(data.other.length?data.other.map(item=>row([item.label,String(item.count),money(item.total)])):[row(['None','',''])]));
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
 }catch(error){notice(String(error.message||error),'error');}
 finally{el('lf-refresh').disabled=false;}
}
function plan(){
 const n=id=>Math.max(0,Number(el(id).value)||0);
 const perDay=(n('pl-new')+n('pl-repost'))*n('pl-fee');
 el('pl-result').textContent='≈ '+(perDay*n('pl-days')).toLocaleString(undefined,{style:'currency',currency:'USD'})+' a month ('+
  perDay.toLocaleString(undefined,{style:'currency',currency:'USD'})+' a day, '+((n('pl-new')+n('pl-repost'))*n('pl-days'))+' listings)';
}
for(const id of ['pl-new','pl-repost','pl-days','pl-fee'])el(id).addEventListener('input',plan);
el('lf-month').value=thisMonth();el('lf-month').max=thisMonth();
el('lf-month').addEventListener('change',()=>void load());
el('lf-refresh').addEventListener('click',()=>void load(true));
plan();void load();
})();
