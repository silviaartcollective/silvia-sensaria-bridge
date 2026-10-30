import { artworkIdFromSkus } from './master-listings.mjs';
// Prevent reconversion from silently relinking a different Etsy listing or artwork.
// Reposted listings may legitimately reuse the original artwork if every prior
// listing in their recorded replacement chain points to the same artwork ID.
export function hasAuthorizedConverterLink({listingId,sourceListingId,artworkId,reconvert=false,mappings={}}){
 const target=Number(listingId),source=Number(sourceListingId);
 if(!Number.isSafeInteger(target)||target<=0||!Number.isSafeInteger(source)||source<=0||
    !artworkId)return false;
 if(target===source)return true;
 if(!reconvert)return false;
 let at=target;
 const visited=new Set();
 for(let hops=0;hops<24;hops++){
  if(visited.has(at))return false;
  visited.add(at);
  const link=mappings?.[String(at)];
  if(!link||link.artworkId!==artworkId)return false;
  const prior=Number(link.replacedFromListingId);
  if(!Number.isSafeInteger(prior)||prior<=0)return false;
  if(prior===source){
   return mappings?.[String(source)]?.artworkId===artworkId;
  }
  at=prior;
 }
 return false;
}

const cleanSkus=listing=>(Array.isArray(listing?.skus)?listing.skus:[]).map(sku=>String(sku||'').trim()).filter(Boolean);

// The artwork a listing's edits may change: { artworkId, source, manifest } or
// null. Verified by the converter map (a converted listing, or one reposted
// from it), by the artwork's manifest recording this Etsy listing ID, or by
// every variant SKU of the listing naming the artwork: those variants are
// fulfilled with its files, so a listing copied or reposted outside the app
// (a new listing ID, the same SKUs) may replace them too.
export async function linkedListingArtwork({listingId,listing,map,loadManifest}){
 const id=Number(listingId);
 const mapping=map?.listings?.[String(id)];
 if(mapping?.status==='converted'&&mapping.artworkId){
  const artworkId=String(mapping.artworkId).toUpperCase();
  const manifest=await loadManifest(artworkId).catch(()=>null);
  if(manifest?.master?.key&&manifest.status==='ready'&&hasAuthorizedConverterLink({
    listingId:id,sourceListingId:manifest.sourceEtsyListingId,artworkId,
    reconvert:true,mappings:map.listings}))
   return {artworkId,source:'converter',manifest};
 }
 const skus=cleanSkus(listing),fromSku=artworkIdFromSkus(skus);
 if(fromSku){
  const manifest=await loadManifest(fromSku).catch(()=>null);
  const recorded=[manifest?.etsyDraftListingId,manifest?.etsyConfiguration?.listingId,manifest?.sourceEtsyListingId]
   .some(value=>Number(value)===id);
  const everySku=skus.every(sku=>artworkIdFromSkus([sku])===fromSku);
  if(manifest?.master?.key&&manifest.status==='ready'&&(recorded||everySku))
   return {artworkId:fromSku,source:recorded?'product-creator':'skus',manifest};
 }
 return null;
}

// Why linkedListingArtwork found no artwork, in words for the Listings page.
export async function unlinkedListingReason({listingId,listing,map,loadManifest}){
 const mapping=map?.listings?.[String(Number(listingId))];
 const skus=cleanSkus(listing),fromSku=artworkIdFromSkus(skus);
 const artworkId=fromSku||(mapping?.artworkId?String(mapping.artworkId).toUpperCase():'');
 if(!artworkId)
  return 'This listing is not linked to a Silvia artwork: none of its Etsy SKUs starts with a SAC artwork ID. If it is still a Gelato listing, convert it in the Gelato → Silvia Converter tab first.';
 if(!fromSku&&mapping?.status==='reserved')
  return 'Converting this listing to '+artworkId+' was never finished, so its Etsy variants still have their old SKUs. Finish the conversion in the Gelato → Silvia Converter tab; the artwork can be replaced after that.';
 const foreign=skus.filter(sku=>artworkIdFromSkus([sku])!==fromSku);
 if(fromSku&&foreign.length)
  return 'Some of this listing\'s Etsy SKUs do not start with '+fromSku+' ('+foreign.slice(0,3).join(', ')+'). Fix those SKUs in its variations, then try again.';
 const manifest=await loadManifest(artworkId).catch(()=>null);
 if(!manifest)return artworkId+' has no artwork record in R2, so its artwork cannot be replaced from here.';
 if(!manifest.master?.key)return artworkId+'\'s artwork record in R2 has no master file.';
 if(manifest.status!=='ready')
  return artworkId+'\'s artwork in R2 is not finished (its status is "'+manifest.status+'"). Finish its upload or conversion first.';
 return 'Artwork ownership could not be verified for this listing: '+artworkId+'\'s converter link does not lead to listing #'+Number(listingId)+'.';
}
