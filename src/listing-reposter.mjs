import crypto from 'node:crypto';
import { getShopListings, getListingInventory, updateListingInventory, createDraftListing, updateListing, uploadListingImage, getListingProperties, updateListingProperty } from './etsy.mjs';
import { getEtsyListingImages } from './mockup-sorter.mjs';
import { getJsonObject, putJsonObject, getArtworkObject, artworkObjectExists, signedArtworkUploadUrl } from './r2.mjs';

const ETSY='https://api.etsy.com/v3/application';
const DAY=86400;
const MAX_IMAGES=10;
const LOCKS=new Set();
export const listingId = value => {
  const s=String(value||'').trim();
  if(!/^[1-9]\d{0,19}$/.test(s))throw new Error('Valid numeric Etsy listing ID required.');
  return s;
};
const args=session=>({shopId:session.shop.shop_id,keystring:session.keystring,sharedSecret:session.sharedSecret,accessToken:session.accessToken});
const key=(shop,id)=>'reposter/'+String(shop)+'/'+listingId(id)+'/replacement.json';
const now=()=>new Date().toISOString();
const safe=(v,max=200)=>String(v??'').trim().slice(0,max);
function mediaKey(shop,id) { return 'reposter/'+String(shop)+'/'+listingId(id)+'/media/'+crypto.randomUUID()+'.jpg'; }
export function estimatedRenewals(listing,clock=Date.now()) {
  const born=Number(listing?.original_creation_timestamp || listing?.created_timestamp || listing?.creation_timestamp || 0);
  if(!born) return {ageDays:null,estimated:null,label:'Unknown'};
  const age=Math.max(0,Math.floor((clock/1000-born)/DAY));
  const count=Math.floor(age/120);
  return {ageDays:age,estimated:count,label:'~'+count+' four-month cycles'};
}
export function scanCandidate(listing,saleCount,clock=Date.now()) {
  const age=estimatedRenewals(listing,clock);
  const noSales=saleCount===0;
  return {listingId:String(listing.listing_id),title:String(listing.title||''),
    state:String(listing.state||''),ageDays:age.ageDays,
    estimatedRenewals:age.estimated,renewalVerified:false,
    salesCount:saleCount,salesVerified:Number.isInteger(saleCount),
    status:noSales && age.estimated>=2 && age.estimated<=3 && listing.state==='active'?'review_renewals':'not_eligible',
    note:'Sales checked through Etsy transactions. Etsy does not expose an exact renewal count; confirm 2–3 in Shop Manager.'
  };
}
function headers(session) {
  return {'x-api-key':String(session.keystring)+':'+String(session.sharedSecret),
    authorization:'Bearer '+String(session.accessToken)};
}
async function etsy(session,path,{method='GET',body}={}) {
  const response=await fetch(ETSY+path,{
    method,headers:{...headers(session),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await response.text();
  if(!response.ok)throw new Error('Etsy API '+response.status+': '+text.slice(0,350));
  return text?JSON.parse(text):{};
}
export async function listingSalesCount(session,id) {
  const data=await etsy(session,'/shops/'+session.shop.shop_id+'/listings/'+listingId(id)+'/transactions?limit=1&offset=0&legacy=false');
  if(Number.isInteger(data.count)&&data.count>=0)return data.count;
  const items=data.results;
  if(Array.isArray(items)&&items.length>0)return items.length;
  throw new Error('Etsy did not return a reliable transaction count. Sales unverified.');
}
export async function findCandidates(session) {
  const listings=[];
  let exhausted=false, scanned=0;
  for(let offset=0;offset<1500;offset+=100){
    const page=await getShopListings({...args(session),state:'active',limit:100,offset});
    const results=page.results||[];
    scanned+=results.length;
    for(const item of results) {
      const age=estimatedRenewals(item).estimated;
      if(age>=2 && age<=3)listings.push(item);
    }
    if(results.length<100){exhausted=true;break;}
  }
  const candidates=listings.slice(0,80);
  const rows=[];
  for(let i=0;i<candidates.length;i+=5){
    const group=await Promise.all(candidates.slice(i,i+5).map(async item=>{
      try{return scanCandidate({...item,state:'active'},await listingSalesCount(session,item.listing_id));}
      catch(e){return {...scanCandidate({...item,state:'active'},null),status:'sales_unverified',error:String(e.message||e)};}
    }));
    rows.push(...group);
  }
  return {items:rows.filter(x=>x.status==='review_renewals').concat(rows.filter(x=>x.status!=='review_renewals')),
    scanned,limitReached:!exhausted||listings.length>80,matchedAge:listings.length,
    note:'Candidates use estimated four-month age cycles. Etsy has no reliable renewal-count field; please verify renewals before posting.'};
}
export async function getListing(session,id) {
  const listing=await etsy(session,'/listings/'+listingId(id)+'?legacy=false');
  if(String(listing.shop_id)!==String(session.shop.shop_id))throw new Error('This listing belongs to a different Etsy shop.');
  return listing;
}
export async function getListingVideos(session,id) {
  const x=await etsy(session,'/listings/'+listingId(id)+'/videos');
  return x.results||[];
}
export async function getVariationImages(session,id) {
  const x=await etsy(session,'/shops/'+session.shop.shop_id+'/listings/'+listingId(id)+'/variation-images');
  return x.results||[];
}
export async function getDetails(session,id) {
  const listing=await getListing(session,id);
  const [sales,images,videos,variations]=await Promise.all([
    listingSalesCount(session,id),
    getEtsyListingImages({listingId:id,...args(session)}),
    getListingVideos(session,id),
    getVariationImages(session,id)
  ]);
  const age=scanCandidate(listing,sales);
  let replacement=null;
  try {replacement=await getJsonObject(key(session.shop.shop_id,id));}
  catch(e){if(e?.$metadata?.httpStatusCode!==404&&!['NoSuchKey','NotFound'].includes(e?.name))throw e;}
  return {listing,images:images.map(x=>({id:x.listing_image_id,url:x.url_570xN||x.url_fullxfull,rank:x.rank,alt:x.alt_text||''})),
    videosCount:videos.length,variationImagesCount:variations.length,assessment:age,
    replacement:replacement?{draftId:replacement.draftId,status:replacement.status,sourceId:replacement.sourceId,
      preparedAt:replacement.preparedAt,error:replacement.error||null,seo:replacement.seo||null}:null};
}

function priceNumber(value) {
  if(value && typeof value==='object')return Number(value.amount)/Number(value.divisor||100);
  return Number(value);
}
export function inventorySignature(inventory) {
  return (inventory?.products||[]).map(p=>({
    sku:String(p.sku||''),
    properties:(p.property_values||[]).map(v=>({
      id:Number(v.property_id),
      values:(v.value_ids?.length?v.value_ids:v.values||[]).map(String).sort()
    })).sort((a,b)=>a.id-b.id),
    offers:(p.offerings||[]).map(o=>({
      price:Math.round(priceNumber(o.price)*100)/100,
      quantity:Number(o.quantity||0),enabled:!!o.is_enabled
    })).sort((a,b)=>a.price-b.price)
  })).sort((a,b)=>a.sku.localeCompare(b.sku));
}
export function assertSameInventory(original,cloned) {
  const a=inventorySignature(original),b=inventorySignature(cloned);
  if(!a.length||JSON.stringify(a)!==JSON.stringify(b))
    throw new Error('Copied variants, SKUs, prices, or quantities differ from the original. Original listing kept active.');
  return true;
}

export function validateSeo(input) {
  const title=safe(input?.title,200);
  const description=safe(input?.description,40000);
  const tags=Array.isArray(input?.tags)?input.tags.map(s=>safe(s,30)).filter(Boolean):[];
  if(!title||title.length>140)throw new Error('SEO title must contain 1–140 characters.');
  if(!description||description.length>13000)throw new Error('Description must contain 1–13000 characters.');
  if(tags.length>13 || tags.some(t=>t.length>20))throw new Error('Etsy permits up to 13 tags, each at most 20 characters.');
  if(new Set(tags.map(s=>s.toLowerCase())).size!==tags.length)throw new Error('Remove duplicate Etsy tags.');
  if(![2,3].includes(Number(input?.confirmedRenewals)))
    throw new Error('Confirm 2 or 3 renewals from Etsy Shop Manager before reposting.');
  if(!['keep','replace'].includes(input?.mockupMode))throw new Error('Select keep or replace mockups.');
  return {title,description,tags,confirmedRenewals:Number(input.confirmedRenewals),mockupMode:input.mockupMode};
}
function listingCopy(listing,seo,inventory) {
  const enabled=(inventory.products||[]).flatMap(p=>p.offerings||[]).filter(o=>o.is_enabled);
  const priced=enabled.find(x=>x.price!=null)?.price ?? listing.price;
  const price=typeof priced==='object'?Number(priced.amount)/Number(priced.divisor||100):Number(priced);
  if(!Number.isFinite(price)||price<=0)throw new Error('Unable to preserve the existing listing price.');
  const quantity=Math.max(1,Number(listing.quantity||1));
  if(!Number.isFinite(Number(listing.taxonomy_id)) || Number(listing.taxonomy_id)<=0)
    throw new Error('Existing taxonomy is missing.');
  if(!Number.isFinite(Number(listing.shipping_profile_id))||Number(listing.shipping_profile_id)<=0)
    throw new Error('Existing listing has no shipping profile; cannot safely duplicate.');
  return {
    ...seo,price,quantity,taxonomy_id:listing.taxonomy_id,
    shipping_profile_id:listing.shipping_profile_id,
    readiness_state_id:listing.readiness_state_id,
    return_policy_id:listing.return_policy_id,
    shop_section_id:listing.shop_section_id,
    who_made:listing.who_made,when_made:listing.when_made,
    is_supply:listing.is_supply,should_auto_renew:listing.should_auto_renew,
    is_taxable:listing.is_taxable,is_customizable:listing.is_customizable,
    materials:listing.materials||[],
    production_partner_ids:listing.production_partner_ids||[]
  };
}
function publicEtsyImage(url) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || !/(^|\.)etsystatic\.com$/.test(parsed.hostname))
    throw new Error('Only Etsy-hosted listing image URLs can be cloned.');
  return parsed.toString();
}
async function fetchOriginalImage(url) {
  const response=await fetch(publicEtsyImage(url),{redirect:'error'});
  if(!response.ok)throw new Error('Could not copy an existing Etsy mockup: '+response.status);
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>20_000_000)throw new Error('Existing Etsy mockup exceeds 20MB.');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>20_000_000)throw new Error('Existing Etsy mockup exceeds 20MB.');
  return bytes;
}
function forListing(shop,id,objectKey){
  const prefix='reposter/'+String(shop)+'/'+listingId(id)+'/media/';
  if(!String(objectKey||'').startsWith(prefix) || !/^[-\w/.]+\.jpg$/.test(objectKey))
    throw new Error('Mockup upload key does not match the listing.');
  return String(objectKey);
}
export async function reserveMockups(session,id,files) {
  listingId(id);
  if(!Array.isArray(files)||!files.length||files.length>MAX_IMAGES)throw new Error('Select 1–10 JPEG mockups.');
  const result=[];
  for(const file of files){
    if(!/image\/jpeg/.test(String(file.type)))throw new Error('Upload JPEG mockups only.');
    if(!file.size||file.size>20_000_000)throw new Error('Each mockup must be under 20MB.');
    const objectKey=mediaKey(session.shop.shop_id,id);
    result.push({key:objectKey,name:safe(file.name,90),
      uploadUrl:await signedArtworkUploadUrl(objectKey,'image/jpeg',20*60)});
  }
  return result;
}
export async function prepareReplacement(session,sourceId,input) {
  const id=listingId(sourceId),shop=session.shop.shop_id,lock=shop+':'+id;
  if(LOCKS.has(lock))throw new Error('Reposting is already processing for this listing.');
  LOCKS.add(lock);
  try {
    const seo=validateSeo(input), listing=await getListing(session,id);
    if(listing.state!=='active')throw new Error('Only currently active listings can be replaced.');
    const assessment=scanCandidate(listing,await listingSalesCount(session,id));
    if(assessment.status!=='review_renewals')throw new Error('Listing is not an eligible zero-sales 2–3-cycle candidate.');
    const [inventory,properties,originalImages,originalVideos,variationImages]=await Promise.all([
      getListingInventory({listingId:id,...args(session)}),
      getListingProperties({listingId:id,...args(session)}),
      getEtsyListingImages({listingId:id,...args(session)}),
      getListingVideos(session,id),getVariationImages(session,id)
    ]);
    const images=seo.mockupMode==='keep'?originalImages:
      (Array.isArray(input.mockups)?input.mockups:[]);
    if(!images.length||images.length>MAX_IMAGES)throw new Error('A replacement requires 1–10 mockups.');
    if(seo.mockupMode==='replace' && variationImages.length)
      throw new Error('This listing has variation-image assignments. Keep its mockups or remap the variants manually before replacing.');
    // Fail closed on source changes: do not replace a draft if it was already prepared with different SEO.
    let record;
    try{record=await getJsonObject(key(shop,id));}
    catch(e){if(e?.$metadata?.httpStatusCode!==404&&!['NoSuchKey','NotFound'].includes(e?.name))throw e;}
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify({
      title:seo.title,description:seo.description,tags:seo.tags,mode:seo.mockupMode,
      keys:seo.mockupMode==='replace'?images.map(x=>x.key):images.map(x=>x.listing_image_id)
    })).digest('hex');
    if(record && record.status==='completed')throw new Error('This listing has already been reposted.');
    if(record && record.fingerprint!==fingerprint)
      throw new Error('A draft for this listing already exists with different SEO or media. Continue using that draft; no duplicate was created.');
    if(record && record.status==='prepared')return {record,reused:true};
    let draftId=record?.draftId;
    if(!draftId){
      const draft=await createDraftListing({
        ...args(session),listing:listingCopy(listing,seo,inventory)
      });
      draftId=Number(draft.listing_id);
      if(!Number.isSafeInteger(draftId)||draftId<=0)throw new Error('Etsy draft creation returned no listing ID.');
      record={sourceId:id,draftId,shopId:String(shop),fingerprint,
        status:'building',preparedAt:now(),seo:{title:seo.title,description:seo.description,tags:seo.tags,mockupMode:seo.mockupMode},imageMap:{},completedImages:[],videoIds:[]};
      await putJsonObject(key(shop,id),record);
    }
    // Etsy does not support atomic copying; all operations are resumable and the original stays live.
    if(!record.inventoryCopied){
      await updateListingInventory({listingId:draftId,inventory,...args(session)});
      record.inventoryCopied=true;await putJsonObject(key(shop,id),record);
    }
    if(!record.propertiesCopied){
      const rows=properties.results||[];
      for(const p of rows){
        if(!p.property_id || !(p.value_ids?.length || p.values?.length))continue;
        await updateListingProperty({shopId:shop,listingId:draftId,propertyId:p.property_id,
          valueIds:p.value_ids||[],values:p.values||[],scaleId:p.scale_id,...args(session)});
      }
      record.propertiesCopied=true;await putJsonObject(key(shop,id),record);
    }
    for(let index=0;index<images.length;index++){
      const source=images[index],ident=seo.mockupMode==='keep'?String(source.listing_image_id):source.key;
      if(record.completedImages.includes(ident))continue;
      let bytes;
      if(seo.mockupMode==='keep')bytes=await fetchOriginalImage(source.url_fullxfull||source.url_570xN);
      else{
        const media=await getArtworkObject(forListing(shop,id,source.key));
        if(media.body.length>20_000_000)throw new Error('Uploaded mockup exceeds 20MB.');
        bytes=media.body;
      }
      const uploaded=await uploadListingImage({shopId:shop,listingId:draftId,
        imageBuffer:bytes,filename:'reposter-'+(index+1)+'.jpg',contentType:'image/jpeg',
        rank:index+1,altText:seo.mockupMode==='keep'?source.alt_text||'':'',
        ...args(session)});
      const newId=Number(uploaded.listing_image_id);
      if(!newId)throw new Error('Etsy did not return an ID for uploaded mockup.');
      record.imageMap[String(ident)]=newId;record.completedImages.push(ident);
      await putJsonObject(key(shop,id),record);
    }
    // Preserve single Etsy video by linking existing video_id within the same shop.
    for(const video of originalVideos){
      if(record.videoIds.includes(Number(video.video_id)))continue;
      const form=new FormData();
      form.append('video_id',String(video.video_id));
      form.append('name','Existing listing video');
      const response=await fetch(ETSY+'/shops/'+shop+'/listings/'+draftId+'/videos',{
        method:'POST',headers:headers(session),body:form
      });
      if(!response.ok)throw new Error('Unable to copy original Etsy video: '+response.status+' '+(await response.text()).slice(0,160));
      record.videoIds.push(Number(video.video_id));
      await putJsonObject(key(shop,id),record);
    }
    if(variationImages.length){
      const mappings=variationImages.map(v=>({
        property_id:Number(v.property_id),value_id:Number(v.value_id),
        image_id:record.imageMap[String(v.image_id)]
      }));
      if(mappings.some(x=>!x.image_id||!x.property_id||!x.value_id))
        throw new Error('Cannot safely restore original variation mockup assignments.');
      await etsy(session,'/shops/'+shop+'/listings/'+draftId+'/variation-images',{
        method:'POST',body:{variation_images:mappings}
      });
    }
    const verified=await getEtsyListingImages({listingId:draftId,...args(session)});
    if(verified.length!==images.length)throw new Error('Draft does not yet have the same number of expected mockups.');
    const latestInventory=await getListingInventory({listingId:draftId,...args(session)});
    assertSameInventory(inventory,latestInventory);
    const verifiedVideos=await getListingVideos(session,draftId);
    if(verifiedVideos.length!==originalVideos.length)
      throw new Error('Draft video count differs from original. Original listing kept active.');
    record.status='prepared';record.preparedAt=now();
    await putJsonObject(key(shop,id),record);
    return {record,reused:false};
  } finally {LOCKS.delete(lock);}
}
export async function finalizeReplacement(session,sourceId,confirmation) {
  const id=listingId(sourceId),shop=session.shop.shop_id,lock=shop+':'+id;
  if(confirmation!=='PUBLISH AND DEACTIVATE')throw new Error('Explicit PUBLISH AND DEACTIVATE confirmation required.');
  if(LOCKS.has(lock))throw new Error('Listing replacement already processing.');
  LOCKS.add(lock);
  try{
    const record=await getJsonObject(key(shop,id));
    if(!record || !['prepared','published','completed'].includes(record.status))throw new Error('Finish preparing and verifying a replacement draft first.');
    if(record.status==='completed')return {record,alreadyComplete:true};
    const original=await getListing(session,id);
    if(original.state!=='active' && record.status!=='published')
      throw new Error('Original listing is no longer active. Review manually.');
    if(await listingSalesCount(session,id)!==0)throw new Error('Original listing has sales since preparation. Stop and review.');
    const newListing=await getListing(session,record.draftId);
    const [originalInventory,draftInventory,draftImages,sourceImages,draftVideos,sourceVideos]=await Promise.all([
      getListingInventory({listingId:id,...args(session)}),
      getListingInventory({listingId:record.draftId,...args(session)}),
      getEtsyListingImages({listingId:record.draftId,...args(session)}),
      getEtsyListingImages({listingId:id,...args(session)}),
      getListingVideos(session,record.draftId),getListingVideos(session,id)
    ]);
    assertSameInventory(originalInventory,draftInventory);
    const imageCount=record.completedImages?.length||0;
    if(!imageCount||draftImages.length!==imageCount)
      throw new Error('Replacement draft mockups changed since preparation. Original kept active.');
    if(draftVideos.length!==sourceVideos.length)
      throw new Error('Replacement videos changed since preparation. Original kept active.');
    const expectedSourceCount=record.seo?.mockupMode==='keep' ? sourceImages.length : imageCount;
    if(record.seo?.mockupMode==='keep' && expectedSourceCount!==imageCount)
      throw new Error('Original mockups changed since preparation. Prepare a fresh replacement manually.');

    if(!['draft','active'].includes(newListing.state))throw new Error('Replacement draft is not ready to publish.');
    if(record.status==='prepared'){
      if(newListing.state==='draft')await updateListing({
        ...args(session),listingId:record.draftId,listing:{state:'active'}
      });
      const online=await getListing(session,record.draftId);
      if(online.state!=='active')throw new Error('Replacement could not be verified active. Original remains unchanged.');
      record.status='published';record.publishedAt=now();
      await putJsonObject(key(shop,id),record);
    }
    if(original.state==='active'){
      await updateListing({...args(session),listingId:id,listing:{state:'inactive'}});
    }
    const oldAfter=await getListing(session,id),newAfter=await getListing(session,record.draftId);
    if(newAfter.state!=='active'||oldAfter.state!=='inactive')
      throw new Error('Replacement verification incomplete: check both Etsy listings before continuing.');
    record.status='completed';record.finishedAt=now();
    await putJsonObject(key(shop,id),record);
    return {record,alreadyComplete:false};
  } finally{LOCKS.delete(lock);}
}
