import crypto from 'node:crypto';

// Every Silvia variant SKU starts with its artwork ID (SAC0012-C-2436). Listings
// made by the Product Creator are not in the converter map, so the SKU prefix
// identifies their artwork; exactly one distinct ID is required.
const LISTING_SKU_ARTWORK=/^(SAC\d+)-/i;
export function artworkIdFromSkus(skus){
  const ids=new Set((Array.isArray(skus)?skus:[])
    .map(sku=>LISTING_SKU_ARTWORK.exec(String(sku||'').trim())?.[1]?.toUpperCase()).filter(Boolean));
  return ids.size===1?[...ids][0]:null;
}

export function masterListingTags(value) {
  const tags=Array.isArray(value)?value:String(value??'').split(',');
  const clean=tags.map(t=>String(t||'').trim()).filter(Boolean);
  if(clean.length>13)throw Error('Etsy permits up to 13 tags.');
  if(clean.some(t=>t.length>20||t.includes(',')))throw Error('Each Etsy tag must be 20 characters or fewer and cannot contain a comma.');
  if(new Set(clean.map(t=>t.toLocaleLowerCase('en'))).size!==clean.length)
    throw Error('Duplicate Etsy tags are not allowed.');
  return clean;
}
export function listingEditorFields(listing){
  return {
    title:String(listing?.title||''),
    description:String(listing?.description||''),
    tags:masterListingTags(listing?.tags||[]),
    shopSectionId:Number(listing?.shop_section_id||0)
  };
}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function listingEditorFingerprint(listing){return hash(listingEditorFields(listing));}
export function inventoryEditorRows(inventory){
  return (inventory?.products||[]).map((p,index)=>({
    index,productId:Number(p.product_id||0),sku:String(p.sku||''),
    variations:(p.property_values||[]).map(x=>String(x.property_name||'')+': '+(x.values||[]).join(', ')).join(' · '),
    offerings:(p.offerings||[]).map((v,offeringIndex)=>({
      offeringIndex,price:inventoryPrice(v.price),quantity:Number(v.quantity||0),
      enabled:Boolean(v.is_enabled)
    }))
  }));
}
export function inventoryPrice(raw){
  const num=raw&&typeof raw==='object'?Number(raw.amount)/Number(raw.divisor||100):Number(raw);
  if(!Number.isFinite(num))throw Error('Unable to read Etsy inventory price.');
  return Number(num.toFixed(2));
}
export function inventoryEditorFingerprint(inv){
  return hash(inventoryEditorRows(inv).map(p=>({
    productId:p.productId,sku:p.sku,variations:p.variations,
    offerings:p.offerings.map(o=>[o.price,o.quantity,o.enabled])
  })));
}
export function validateMasterListingEdit(input,oldListing){
  if(!input||typeof input!=='object')throw Error('Listing changes are missing.');
  const title=String(input.title??'').trim();
  const description=String(input.description??'');
  if(!title||title.length>140)throw Error('Title must contain 1–140 characters.');
  if(!description.trim()||description.length>13000)throw Error('Description must contain 1–13,000 characters.');
  const tags=masterListingTags(input.tags);
  const section=Number(input.shopSectionId||0);
  if(!Number.isSafeInteger(section)||section<0)throw Error('Invalid Etsy shop section.');
  const existing=listingEditorFields(oldListing),next={title,description,tags,shopSectionId:section};
  const patch={};
  if(next.title!==existing.title)patch.title=next.title;
  if(next.description!==existing.description)patch.description=next.description;
  if(JSON.stringify(next.tags)!==JSON.stringify(existing.tags))patch.tags=next.tags;
  if(next.shopSectionId!==existing.shopSectionId)patch.shop_section_id=next.shopSectionId;
  return {patch,next,changed:Object.keys(patch).length>0};
}
export function applyInventoryEditorChanges(inventory,updates){
  if(!Array.isArray(updates)||updates.length>200)throw Error('Too many inventory changes.');
  const cloned=JSON.parse(JSON.stringify(inventory));
  const seen=new Set();
  for(const row of updates){
    const pi=Number(row.productIndex),oi=Number(row.offeringIndex);
    if(!Number.isSafeInteger(pi)||!Number.isSafeInteger(oi)||pi<0||oi<0)
      throw Error('Invalid variation selection.');
    const product=cloned.products?.[pi],offering=product?.offerings?.[oi];
    if(!offering||String(product.sku||'')!==String(row.sku||'')||
       Number(product.product_id||0)!==Number(row.productId||0))
      throw Error('Etsy variations have changed. Refresh this listing.');
    const unique=pi+':'+oi;
    if(seen.has(unique))throw Error('Duplicate variation change.');seen.add(unique);
    const price=Number(row.price),qty=Number(row.quantity);
    if(!Number.isFinite(price)||price<0.20||price>100000||
       !Number.isInteger(Math.round(price*100))||Math.abs(price*100-Math.round(price*100))>.00001)
      throw Error('Variant prices must be $0.20–$100,000 with no more than two decimals.');
    if(!Number.isSafeInteger(qty)||qty<0||qty>999)throw Error('Variant quantity must be 0–999.');
    if(typeof row.enabled!=='boolean')throw Error('Variant availability must be true or false.');
    offering.price=price;offering.quantity=qty;offering.is_enabled=row.enabled;
  }
  return cloned;
}
