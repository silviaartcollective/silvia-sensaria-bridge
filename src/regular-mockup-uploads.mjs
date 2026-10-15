// Regular JPG/PNG mockups may arrive AFTER the master has been stored.
// Reserve them independently of the master, without changing the R2 artwork ID.
import {loadArtworkManifest,saveArtworkManifest} from './artwork-storage.mjs';
import {artworkObjectExists,artworkObjectInfo,signedArtworkUploadUrl} from './r2.mjs';
import {mockupObjectKey} from './production.mjs';

let mutationTail=Promise.resolve();
const lock=fn=>{
 const work=mutationTail.then(fn,fn);
 mutationTail=work.catch(()=>{});
 return work;
};
const fileKey=file=>[
 String(file.filename||''),Number(file.size||0),Number(file.lastModified||0)
].join('|');
function validate(files){
 if(!Array.isArray(files)||files.length<1||files.length>17)
  throw Error('Select between 1 and 17 regular mockup images.');
 return files.map(file=>{
  const filename=String(file?.filename||'').trim();
  const extension=filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]||'';
  const contentType=extension==='png'?'image/png':
   ['jpg','jpeg'].includes(extension)?'image/jpeg':
   extension==='webp'?'image/webp':null;
  const size=Number(file?.size);
  if(!contentType||!Number.isSafeInteger(size)||size<1||size>60*1024*1024)
   throw Error('Regular mockups must be JPG, PNG or WebP files under 60 MB.');
  return {filename,contentType,size,lastModified:Number(file?.lastModified)||0};
 });
}
export async function reserveRegularMockups(artworkId,input){
 return lock(async()=>{
  const files=validate(input),manifest=await loadArtworkManifest(artworkId);
  if(manifest?.status!=='ready')throw Error('Upload the master artwork to R2 first.');
  const current=Array.isArray(manifest.mockups)?manifest.mockups:[];
  const pending=Array.isArray(manifest.pendingRegularMockups)?manifest.pendingRegularMockups:[];
  const newPending=[],uploads=[];
  for(const file of files){
   const key=fileKey(file);
   const old=current.find(row=>String(row.originalFilename)===file.filename &&
    Number(row.size)===file.size &&
    (!row.lastModified||Number(row.lastModified)===file.lastModified));
   if(old&&await artworkObjectExists(old.key)){
    uploads.push({filename:file.filename,key:old.key,alreadyPresent:true});continue;
   }
   let item=[...pending,...newPending].find(row=>fileKey(row)===key);
   if(!item){
    if(current.length+pending.length+newPending.length>=17)
     throw Error('This artwork already has 17 mockup images. Remove unwanted images before adding more.');
    const highest=Math.max(-1,...[...current,...pending,...newPending].map(row=>Number(row.index)||0));
    const index=highest+1;
    const ext=file.filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]||'jpg';
    item={...file,index,originalFilename:file.filename,key:mockupObjectKey(artworkId,index,ext),
      reservedAt:new Date().toISOString()};
    newPending.push(item);
   }
   const alreadyPresent=await artworkObjectExists(item.key);
   uploads.push({...item,alreadyPresent,
    ...(!alreadyPresent?{uploadUrl:await signedArtworkUploadUrl(item.key,item.contentType)}:{})});
  }
  if(newPending.length){
   manifest.pendingRegularMockups=[...pending,...newPending];
   await saveArtworkManifest(manifest);
  }
  return {artworkId,uploads,totalSaved:current.length};
 });
}
export async function confirmRegularMockups(artworkId){
 return lock(async()=>{
  const manifest=await loadArtworkManifest(artworkId);
  if(manifest?.status!=='ready')throw Error('Master artwork is not ready.');
  const pending=Array.isArray(manifest.pendingRegularMockups)?manifest.pendingRegularMockups:[];
  const current=Array.isArray(manifest.mockups)?manifest.mockups:[];
  const successful=[],incomplete=[];
  for(const item of pending){
   if(!await artworkObjectExists(item.key)){incomplete.push(item);continue}
   const actual=await artworkObjectInfo(item.key);
   if(Number(actual.size)!==Number(item.size)){
    incomplete.push(item);continue;
   }
   if(!current.some(saved=>saved.key===item.key)){
    current.push({...item,source:'regular-upload',confirmedAt:new Date().toISOString()});
    successful.push(item);
   }
  }
  manifest.mockups=current.sort((a,b)=>Number(a.index)-Number(b.index));
  manifest.pendingRegularMockups=incomplete;
  if(successful.length)await saveArtworkManifest(manifest);
  return {artworkId,confirmed:successful.length,pending:incomplete.length,
    totalSaved:current.length,items:successful};
 });
}
