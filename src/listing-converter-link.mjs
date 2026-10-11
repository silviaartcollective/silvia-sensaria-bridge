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
