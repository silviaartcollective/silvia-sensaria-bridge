// Never treat a successful HTTP upload as proof that Etsy retained the photo.
// Image IDs are opaque; compare against the actual listing images read from Etsy.
export function receivedEtsyImageIds(images){
 return new Set((Array.isArray(images)?images:[]).map(image=>
  String(image?.listing_image_id??image?.listingImageId??'')).filter(Boolean));
}
export function missingEtsyImageReceipts(receipts,images){
 const present=receivedEtsyImageIds(images);
 return (receipts||[]).filter(receipt=>
  !receipt?.listingImageId||!present.has(String(receipt.listingImageId)));
}
export async function verifyEtsyImageReceipts({
 receipts,readImages,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 attempts=6
}){
 if(!Array.isArray(receipts)||!receipts.length)
  throw Error('No Etsy image receipts were provided for verification.');
 let missing=receipts,readError=null;
 for(let i=0;i<attempts;i++){
  try{
   const remote=await readImages();
   missing=missingEtsyImageReceipts(receipts,remote);
   readError=null;
   if(!missing.length)return {verified:receipts.length,remoteCount:remote.length};
  }catch(error){readError=error}
  if(i+1<attempts)await pause(Math.min(5000,750*(i+1)));
 }
 if(readError)throw Error('Could not verify Etsy photos: '+String(readError.message||readError));
 throw Error('Etsy did not confirm '+missing.length+' uploaded photo(s): '+
  missing.map(r=>String(r.filename||r.key||r.rank||'unknown')).slice(0,5).join(', '));
}
