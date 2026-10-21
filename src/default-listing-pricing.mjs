import crypto from 'node:crypto';

const validOrientation = new Set(['portrait','landscape','square']);
const validProductKey = /^(P|C|FC)\|[0-9]{1,2}x[0-9]{1,2}\|(NONE|BLK|WHT|NAT|BRN)$/;
const round=value=>Number(Number(value).toFixed(2));
function offeringPrice(v){
  const x=v?.price;
  const price=x&&typeof x==='object'?Number(x.amount)/Number(x.divisor||100):Number(x);
  return Number.isFinite(price)?round(price):null;
}
function productSignature(product){
  return {
    sku:String(product?.sku||''),
    variation:(product?.property_values||[]).map(v=>({
      id:Number(v.property_id||0),values:(v.values||[]).map(String)
    })),
    offerings:(product?.offerings||[]).map(v=>({
      price:offeringPrice(v),quantity:Number(v.quantity||0),enabled:Boolean(v.is_enabled)
    }))
  };
}
const inventorySignature=inv=>JSON.stringify({
  products:(inv?.products||[]).map(productSignature),
  priceOnProperty:inv?.price_on_property||[],
  quantityOnProperty:inv?.quantity_on_property||[],
  skuOnProperty:inv?.sku_on_property||[]
});
export function templateInventoryFingerprint(inventory,context={}){
  return crypto.createHash('sha256')
    .update(JSON.stringify({inventory:inventorySignature(inventory),context}))
    .digest('hex');
}
export function planDefaultTemplateInventory({
  inventory,artworkId,orientation,catalog,readinessStateId,buildInventory
}){
  const id=String(artworkId||'').trim().toUpperCase();
  if(!/^(SAC|JAC)\d+$/.test(id))throw Error('A linked shop artwork ID is required.');
  const direction=String(orientation||'').toLowerCase();
  if(!validOrientation.has(direction))throw Error('Stored artwork orientation is not verified.');
  if(!Array.isArray(inventory?.products)||!inventory.products.length)throw Error('Etsy listing has no variation inventory.');
  const enabled=(inventory.products||[]).filter(p=>(p.offerings||[]).some(o=>o.is_enabled));
  const named=(inventory.products||[]).filter(p=>String(p.sku||'').trim());
  if(!enabled.length||!named.length)throw Error('No enabled shop-owned SKU was found; this is not a default listing template.');
  if(named.some(p=>!String(p.sku).toUpperCase().startsWith(id+'-')))
    throw Error('Listing contains SKUs outside the linked artwork. No inventory changes allowed.');
  if(enabled.some(p=>!String(p.sku||'').toUpperCase().startsWith(id+'-')))
    throw Error('Enabled variation lacks the linked artwork SKU.');
  // Reject custom product axes: automatic reconstruction is reserved for
  // the default Size × Product - Style template, never handmade variations.
  if((inventory.products||[]).some(p=>{
    const pv=p.property_values||[];
    return pv.length!==2||!pv.some(v=>Number(v.property_id)===513)||
      !pv.some(v=>Number(v.property_id)===514);
  }))throw Error('Not a default Size × Product - Style template; edit manually.');
  const ready=Number(readinessStateId);
  if(!Number.isInteger(ready)||ready<=0)throw Error('Etsy readiness state could not be verified.');
  if(typeof buildInventory!=='function')throw Error('The default inventory builder is unavailable.');
  const target=buildInventory({artworkId:id,catalog,readinessStateId:ready,orientation:direction,defaultQuantity:999});
  if(!target?.products?.length||!target.enabledCount)throw Error('No supported product variants for this artwork orientation.');
  const oldBySku=new Map(named.map(p=>[String(p.sku).toUpperCase(),p]));
  const newSkuSet=new Set(target.products.map(p=>String(p.sku).toUpperCase()).filter(Boolean));
  const oldSkuSet=new Set(oldBySku.keys());
  const added=[...newSkuSet].filter(s=>!oldSkuSet.has(s));
  const removed=[...oldSkuSet].filter(s=>!newSkuSet.has(s));
  const repriced=[];
  // Preserve existing nonzero quantities for matching products rather than
  // resetting live availability unnecessarily.
  for(const p of target.products){
    const previous=oldBySku.get(String(p.sku||'').toUpperCase());
    if(!previous)continue;
    const was=previous.offerings?.[0];
    if(was&&p.offerings?.[0]?.is_enabled&&was.is_enabled&&Number.isInteger(Number(was.quantity))&&Number(was.quantity)>0){
      p.offerings[0].quantity=Number(was.quantity);
    }
    const current=offeringPrice(was),next=offeringPrice(p.offerings?.[0]);
    if(current!==null&&next!==null&&Math.abs(current-next)>0.004)
      repriced.push({sku:String(p.sku),fromUsd:current,toUsd:next});
  }
  const changed=inventorySignature(inventory)!==inventorySignature(target);
  return {
    artworkId:id,orientation:direction,
    previousVariantCount:inventory.products.length,
    targetVariantCount:target.products.length,
    enabledVariantCount:target.enabledCount,
    added,removed,repriced,
    changed,
    inventory:target,
    // A successful preview is still only a proposal, not a permission to write.
    previewOnly:true
  };
}
