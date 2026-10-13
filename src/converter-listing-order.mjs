// The Etsy shop listings endpoint can order by last update. That changes
// whenever an old listing is renewed; use its original creation time instead.
function timestampSeconds(value){
  if(value==null||value==='')return null;
  const numeric=Number(value);
  if(Number.isFinite(numeric)&&numeric>0){
    const seconds=numeric>100000000000?numeric/1000:numeric;
    return Number.isFinite(seconds)&&seconds>0?seconds:null;
  }
  if(typeof value==='string'){
    const parsed=Date.parse(value);
    return Number.isFinite(parsed)?parsed/1000:null;
  }
  return null;
}

export function originalEtsyCreationTimestamp(listing){
  for(const field of ['originalCreationTimestamp','original_creation_timestamp','original_creation_tsz',
    'creation_timestamp','created_timestamp','creation_tsz','created_tsz']){
    const value=timestampSeconds(listing?.[field]);
    if(value!==null)return value;
  }
  return null;
}

function stableListingId(listing){
  const id=Number(listing?.listingId??listing?.listing_id);
  return Number.isSafeInteger(id)?id:Number.MAX_SAFE_INTEGER;
}

export function sortConverterListingsOldestFirst(listings){
  return [...listings].sort((a,b)=>{
    const dateA=originalEtsyCreationTimestamp(a),dateB=originalEtsyCreationTimestamp(b);
    if(dateA!==null&&dateB!==null&&dateA!==dateB)return dateA-dateB;
    if(dateA===null&&dateB!==null)return 1;
    if(dateB===null&&dateA!==null)return -1;
    return stableListingId(a)-stableListingId(b);
  });
}
