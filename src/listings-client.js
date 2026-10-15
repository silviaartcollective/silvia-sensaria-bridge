(()=>{'use strict';
const el=id=>document.getElementById(id);
let listings=[],selectedId=0,current=null,dirty=false,converterLoaded=false;
const fields=['edit-title','edit-description','edit-tags','edit-section'];
function notice(id,message,error=false){const node=el(id);node.className='notice'+(error?' error':'');node.textContent=message;}
function clearNotice(id){el(id).className='notice hidden';el(id).textContent='';}
async function request(path,body){
 const res=await fetch(path,body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('Server returned an invalid response (HTTP '+res.status+').');}
 if(!res.ok||!data.ok)throw Error(data.error||'Request failed (HTTP '+res.status+').');
 return data;
}
function showTab(tab){
 const converter=tab==='converter';
 el('master-panel').classList.toggle('hidden',converter);
 el('converter-panel').classList.toggle('hidden',!converter);
 for(const name of ['master','converter']){
  const b=el('tab-'+name);const active=name===tab;
  b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));
 }
 const link=new URL(location.href);link.searchParams.set('tab',tab);
 history.replaceState({},'',link);
 if(converter&&!converterLoaded){
  el('converter-frame').src='/listing-converter?embedded=1';
  converterLoaded=true;
 }
}
// Keep the old converter comfortably scrollable inside its Listings tab.
const converterFrame=el('converter-frame');
function resizeConverterFrame(){
 if(!converterLoaded||el('converter-panel').classList.contains('hidden'))return;
 try{
  const doc=converterFrame.contentDocument;
  const height=Math.max(doc?.documentElement?.scrollHeight||0,doc?.body?.scrollHeight||0,950);
  converterFrame.style.height=Math.min(16000,height+36)+'px';
 }catch{converterFrame.style.height='1100px';}
}
converterFrame.addEventListener('load',resizeConverterFrame);
setInterval(resizeConverterFrame,3500);
el('tab-master').addEventListener('click',()=>showTab('master'));
el('tab-converter').addEventListener('click',()=>showTab('converter'));
function filteredList(){
 const q=el('listing-search').value.trim().toLowerCase();
 return listings.filter(o=>!q||String(o.listingId).includes(q)||String(o.title||'').toLowerCase().includes(q));
}
function renderList(){
 const box=el('listing-items');box.replaceChildren();
 const rows=filteredList();
 el('listing-count').textContent=rows.length+' of '+listings.length+' Etsy listings';
 for(const row of rows){
  const b=document.createElement('button');b.type='button';b.className='listing-choice'+(row.listingId===selectedId?' selected':'');
  const title=document.createElement('b');title.textContent=row.title||'Untitled';
  const sub=document.createElement('span');sub.className='muted';
  sub.textContent='#'+row.listingId+' · '+(row.state||'unknown')+' · '+(row.artworkId||'Not linked to Silvia')+
     (row.converted?' · Converted':'');
  b.append(title,sub);b.addEventListener('click',()=>{if(dirty&&!confirm('Discard unsaved edits to this listing?'))return;
    openListing(row.listingId).catch(error=>notice('details-status',String(error.message||error),true));});
  box.append(b);
 }
}
async function loadListings(){
 el('reload-list').disabled=true;
 el('listing-count').textContent='Loading listings from Etsy…';
 try{
  const r=await request('/api/master-listings');
  listings=r.listings||[];renderList();
 }catch(error){el('listing-count').textContent=String(error.message||error);}
 finally{el('reload-list').disabled=false;}
}
function renderInventory(data){
 const body=el('variants-body');body.replaceChildren();
 const rows=data.inventoryRows||[],count=rows.reduce((n,p)=>n+p.offerings.length,0);
 el('variants-count').textContent=count+' variation offerings. SKU fields are read-only.';
 el('save-variants').disabled=!data.inventoryHash||!count;
 el('variant-error').className=data.inventoryError?'notice warn':'notice warn hidden';
 el('variant-error').textContent=data.inventoryError||'';
 for(const p of rows)for(const offering of p.offerings){
  const tr=document.createElement('tr');tr.dataset.product=String(p.index);
  tr.dataset.offering=String(offering.offeringIndex);
  const name=document.createElement('td');
  const sku=document.createElement('strong');sku.textContent=p.sku||'(no SKU)';
  const subt=document.createElement('div');subt.className='muted';subt.textContent=p.variations||'Default';
  name.append(sku,subt);
  const cell=(type,value,attributes={})=>{
    const td=document.createElement('td'),input=document.createElement('input');
    input.type=type;if(type==='checkbox')input.checked=Boolean(value);else input.value=String(value);
    for(const [key,v] of Object.entries(attributes))input.setAttribute(key,String(v));
    input.addEventListener('change',()=>{dirty=true;});
    td.append(input);return td;
  };
  tr.append(name,cell('number',offering.price,{min:0.2,max:100000,step:0.01,'aria-label':'Price for '+p.sku}),
   cell('number',offering.quantity,{min:0,max:999,step:1,'aria-label':'Quantity for '+p.sku}),
   cell('checkbox',offering.enabled,{'aria-label':'Enabled for '+p.sku}));
  body.append(tr);
 }
}
async function openListing(id){
 selectedId=Number(id);dirty=false;renderList();
 el('editor').classList.add('hidden');el('editor-empty').classList.remove('hidden');
 el('editor-empty').textContent='Loading Etsy listing #'+id+'…';
 clearNotice('details-status');clearNotice('variant-status');
 const data=await request('/api/master-listings/'+encodeURIComponent(id));
 if(selectedId!==Number(id))return;
 current=data;el('editor-empty').classList.add('hidden');el('editor').classList.remove('hidden');
 const f=data.fields;
 el('editor-heading').textContent='Editing #'+id;
 el('editor-info').textContent='Etsy '+data.state+' · '+(data.artworkId||'No Silvia artwork mapping')+' · '+(data.converted?'Converted listing':'Not converted');
 el('open-etsy').href='https://www.etsy.com/listing/'+id;
 el('edit-title').value=f.title||'';el('edit-description').value=f.description||'';
 el('edit-tags').value=(f.tags||[]).join(', ');
 const section=el('edit-section');section.replaceChildren();
 const none=document.createElement('option');none.value='0';none.textContent='No shop section';section.append(none);
 for(const entry of data.sections||[]){
  const option=document.createElement('option');option.value=String(entry.shop_section_id);option.textContent=entry.title||('Section '+entry.shop_section_id);
  section.append(option);
 }
 if(f.shopSectionId && ![...section.options].some(o=>o.value===String(f.shopSectionId))){
  const o=document.createElement('option');o.value=String(f.shopSectionId);o.textContent='Current section #'+f.shopSectionId;section.append(o);
 }
 section.value=String(f.shopSectionId||0);
 el('listing-preview').classList.add('hidden');
 if(data.previewUrl){
  const img=el('listing-preview');img.src=data.previewUrl;img.classList.remove('hidden');
 }
 renderInventory(data);
}
fields.forEach(id=>el(id).addEventListener('input',()=>{dirty=true;}));
el('listing-search').addEventListener('input',renderList);
el('reload-list').addEventListener('click',()=>loadListings());
el('save-details').addEventListener('click',async()=>{
 if(!current)return;
 const id=selectedId,btn=el('save-details');btn.disabled=true;
 notice('details-status','Validating Etsy listing and saving the edited details…');
 try{
  const result=await request('/api/master-listings/'+id+'/details',{
    confirm:'SAVE SILVIA LISTING',fingerprint:current.metadataHash,
    title:el('edit-title').value,description:el('edit-description').value,
    tags:el('edit-tags').value.split(','),shopSectionId:Number(el('edit-section').value)
  });
  await openListing(id);
  notice('details-status',result.changed?'Etsy listing details saved and verified.':'No changes were necessary.');
  await loadListings();
 }catch(error){notice('details-status',String(error.message||error),true);}
 finally{btn.disabled=false;}
});
el('save-variants').addEventListener('click',async()=>{
 if(!current?.inventoryHash)return;
 const updates=[],original=current.inventoryRows||[],btn=el('save-variants'),id=selectedId;
 for(const tr of el('variants-body').querySelectorAll('tr')){
  const pi=Number(tr.dataset.product),oi=Number(tr.dataset.offering);
  const p=original[pi],before=p?.offerings?.[oi],inputs=tr.querySelectorAll('input');
  if(!p||!before||inputs.length!==3){notice('variant-status','Variation data changed. Refresh the listing.',true);return;}
  const price=Number(inputs[0].value),quantity=Number(inputs[1].value),enabled=inputs[2].checked;
  if(before.price!==price||before.quantity!==quantity||before.enabled!==enabled)
   updates.push({productIndex:pi,offeringIndex:oi,productId:p.productId,sku:p.sku,price,quantity,enabled});
 }
 if(!updates.length){notice('variant-status','No variation changes to save.');return;}
 if(!confirm('Save '+updates.length+' variation change(s) to the live Etsy listing?'))return;
 btn.disabled=true;notice('variant-status','Saving '+updates.length+' variation change(s) to Etsy…');
 try{
  const result=await request('/api/master-listings/'+id+'/inventory',{
   confirm:'SAVE SILVIA VARIANTS',fingerprint:current.inventoryHash,updates
  });
  await openListing(id);
  notice('variant-status','Etsy saved and verified '+result.updated+' variation change(s).');
 }catch(error){notice('variant-status',String(error.message||error),true);}
 finally{btn.disabled=false;}
});
const tab=new URL(location.href).searchParams.get('tab');
showTab(tab==='converter'?'converter':'master');
loadListings();
})();