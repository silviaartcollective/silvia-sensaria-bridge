// Fidelity-gated native PSD mockups. No browser, Photopea or Photoshop.
// First pass supports layered 8-bit RGB PSDs with one rectangular Smart Object,
// normal blending and a verifiable flattened composite. Warp, perspective,
// complex layer effects and PSB are explicitly unsupported (never guessed).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const MAX_PIXELS=24_000_000;
const MAX_BYTES=275*1024*1024;
const BASE=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'pod-worker-cache','native-psd-v1');
export class NativeMockupUnsupported extends Error {
 constructor(reason){super(reason);this.name='NativeMockupUnsupported'}
}
const unsupported=reason=>{throw new NativeMockupUnsupported(reason)};
function simpleLayer(layer){
 const blend=String(layer.blendMode||'normal').toLowerCase();
 return blend==='normal' &&
  (layer.opacity===undefined||Number(layer.opacity)>=0.999) &&
  !layer.mask&&!layer.vectorMask&&!layer.effects&&!layer.adjustment&&!layer.filterMask&&
  layer.clipping!==true&&layer.fillOpacity!==0;
}
function flatVisible(psd){
 if(!Array.isArray(psd.children)||!psd.children.length)
  unsupported('PSD has no accessible layers.');
 if(psd.children.some(layer=>Array.isArray(layer.children)))
  unsupported('Grouped Photoshop layers require a more complete native compositor.');
 const ordered=psd.children.filter(layer=>layer.visible!==false&&layer.hidden!==true);
 if(ordered.some(layer=>!simpleLayer(layer)))
  unsupported('Layer masks, blending and adjustment effects are not supported by the native fidelity profile.');
 return ordered.reverse(); // PSD child order is topmost first
}
export function nativeSmartObjects(psd){
 const objects=[];
 const visit=(layers,prefix='',visible=true)=>{
  (layers||[]).forEach((layer,index)=>{
   const id=prefix?prefix+'.'+index:String(index);
   const shown=visible&&layer.visible!==false&&layer.hidden!==true;
   if(layer.placedLayer)
    objects.push({path:id,name:String(layer.name||'Smart Object'),kind:'smart',visible:shown});
   if(Array.isArray(layer.children))visit(layer.children,id,shown);
  });
 };
 visit(psd.children);
 return objects;
}
function region(layer,canvasWidth,canvasHeight){
 const left=Math.round(Number(layer.left)),top=Math.round(Number(layer.top));
 const right=Math.round(Number(layer.right)),bottom=Math.round(Number(layer.bottom));
 if(![left,top,right,bottom].every(Number.isFinite)||right<=left||bottom<=top||
   left<0||top<0||right>canvasWidth||bottom>canvasHeight)
  unsupported('Smart Object has invalid or clipped pixel bounds.');
 return {left,top,width:right-left,height:bottom-top};
}
export function verifyNativeSmartObject(layer,slot){
 const info=layer?.placedLayer;
 if(!info||!Array.isArray(info.transform)||info.transform.length!==8)
  unsupported('Smart Object transform coordinates are missing.');
 if(info.warp||info.nonAffineTransform)
  unsupported('Warped or perspective Smart Objects require a dedicated native transform implementation.');
 const expected=[slot.left,slot.top,slot.left+slot.width,slot.top,
  slot.left+slot.width,slot.top+slot.height,slot.left,slot.top+slot.height];
 if(info.transform.some((value,index)=>
  !Number.isFinite(Number(value))||Math.abs(Number(value)-expected[index])>3))
  unsupported('Smart Object has rotation, skew or perspective that a rectangle would distort.');
 return true;
}
function rawPixels(layer){
 const data=layer.imageData;
 if(!data||!data.data||!Number.isInteger(data.width)||!Number.isInteger(data.height)||
   data.width<1||data.height<1||data.data.length!==data.width*data.height*4)
  unsupported('PSD layer pixel data could not be decoded in RGBA.');
 const left=Math.round(Number(layer.left)),top=Math.round(Number(layer.top));
 if(!Number.isFinite(left)||!Number.isFinite(top))
  unsupported('PSD layer offset is invalid.');
 return {bytes:Buffer.from(data.data),width:data.width,height:data.height,left,top};
}
async function overlayFor(layer,width,height){
 const raw=rawPixels(layer);
 const left=Math.max(0,raw.left),top=Math.max(0,raw.top);
 const right=Math.min(width,raw.left+raw.width),bottom=Math.min(height,raw.top+raw.height);
 if(right<=left||bottom<=top)return null;
 const png=await sharp(raw.bytes,{raw:{width:raw.width,height:raw.height,channels:4}})
  .extract({left:left-raw.left,top:top-raw.top,width:right-left,height:bottom-top})
  .png().toBuffer();
 return {input:png,left,top};
}
async function layerScene(layers,width,height){
 const overlays=[];
 for(const layer of layers){
  const overlay=await overlayFor(layer,width,height);
  if(overlay)overlays.push(overlay);
 }
 const base=sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}});
 return (overlays.length?base.composite(overlays):base).png().toBuffer();
}
async function verifyReconstruction(psd,background,slotPng,foreground,slot){
 const source=psd.imageData;
 if(!source||source.width!==psd.width||source.height!==psd.height||
   !source.data||source.data.length!==psd.width*psd.height*4)
  unsupported('PSD has no flattened reference image for visual fidelity verification.');
 const reconstructed=await sharp(background)
  .composite([{input:slotPng,left:slot.left,top:slot.top},
              {input:foreground,left:0,top:0}])
  .ensureAlpha().raw().toBuffer();
 const original=source.data,n=psd.width*psd.height;
 let error=0,outliers=0;
 for(let i=0;i<n;i++){
  const p=4*i,alphaA=reconstructed[p+3]/255,alphaB=original[p+3]/255;
  let delta=0;
  for(let color=0;color<3;color++)
   delta+=Math.abs(reconstructed[p+color]*alphaA+255*(1-alphaA)-
      (original[p+color]*alphaB+255*(1-alphaB)));
  delta/=3;error+=delta;if(delta>24)outliers++;
 }
 const mean=error/n,ratio=outliers/n;
 if(mean>2.5||ratio>0.015)
  unsupported('Original PSD effects differ from the reconstructed layers: mean pixel error '+
   mean.toFixed(2)+', high-error pixels '+(ratio*100).toFixed(2)+'%.');
 return {meanPixelError:Number(mean.toFixed(3)),outlierFraction:Number(ratio.toFixed(6))};
}
function selectSmartObject(psd,mapping){
 const objects=nativeSmartObjects(psd).filter(x=>x.visible);
 const pathId=mapping?.path;
 if(pathId!=null&&!objects.some(x=>x.path===String(pathId)))
  unsupported('Saved artwork Smart Object mapping was not found in the PSD.');
 if(pathId==null&&objects.length!==1)
  unsupported('Multiple Smart Objects require an explicitly selected artwork layer.');
 const record=pathId!=null?objects.find(x=>x.path===String(pathId)):objects[0];
 if(record.path.includes('.'))
  unsupported('Grouped Smart Objects are not yet supported by the native compositor.');
 const layer=psd.children[Number(record.path)];
 if(!layer||!simpleLayer(layer))unsupported('Artwork layer has unsupported Photoshop effects.');
 return {record,layer,objects:nativeSmartObjects(psd)};
}
export async function prepareNativePsd({psdPath,mapping=null,onStage=async()=>{}}){
 if(path.extname(psdPath).toLowerCase()!=='.psd')
  unsupported('PSB is not yet supported by the native parser.');
 const stat=await fs.stat(psdPath);
 if(stat.size>MAX_BYTES)unsupported('PSD exceeds the native memory safety limit.');
 // Inspect PSD dimensions and 8-bit color depth before decompressing layers.
 const fd=await fs.open(psdPath,'r');
 let head;
 try{
  head=Buffer.alloc(26);
  const info=await fd.read(head,0,head.length,0);
  if(info.bytesRead!==26)unsupported('PSD header is truncated.');
 }finally{await fd.close()}
 if(head.toString('ascii',0,4)!=='8BPS'||head.readUInt16BE(4)!==1)
  unsupported('Not a supported Photoshop PSD document.');
 const h=head.readUInt32BE(14),w=head.readUInt32BE(18);
 if(head.readUInt16BE(22)!==8||head.readUInt16BE(24)!==3||
   !w||!h||w*h>MAX_PIXELS)
  unsupported('Native PSD supports only 8-bit RGB images up to 24 megapixels.');
 const hash=crypto.createHash('sha256').update(JSON.stringify([
  psdPath,stat.size,stat.mtimeMs,mapping?.path||'',1
 ])).digest('hex');
 const folder=path.join(BASE,hash),manifestPath=path.join(folder,'manifest.json');
 try{
  const record=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  if(record.version===1&&record.psdBytes===stat.size){
   await Promise.all(['background.png','foreground.png','mask.png']
    .map(file=>fs.stat(path.join(folder,file))));
   return {...record,folder,preparedFromCache:true};
  }
 }catch{}
 await onStage('Analyzing PSD layers natively (no Photopea)');
 let readPsd;
 try{({readPsd}=await import('ag-psd'))}
 catch{unsupported('Native PSD parser unavailable; run setup-worker.cmd to install ag-psd.')}
 let psd;
 try{psd=readPsd(await fs.readFile(psdPath),{useImageData:true,skipThumbnail:true,skipLinkedFilesData:true,
   totalMemoryLimit:512*1024*1024})}
 catch(error){unsupported('PSD parser rejected the template: '+String(error.message||error).slice(0,160))}
 if(psd.colorMode!==3||psd.bitsPerChannel!==8||
   psd.width<1||psd.height<1||psd.width*psd.height>MAX_PIXELS)
  unsupported('Only 8-bit RGB PSD mockups up to 24 megapixels are supported natively.');
 const {layer,record,objects}=selectSmartObject(psd,mapping);
 const ordered=flatVisible(psd),position=ordered.indexOf(layer);
 if(position<0)unsupported('Artwork layer is not visible.');
 const slot=region(layer,psd.width,psd.height);
 verifyNativeSmartObject(layer,slot);
 const target=rawPixels(layer);
 if(target.width!==slot.width||target.height!==slot.height||
    target.left!==slot.left||target.top!==slot.top)
  unsupported('Smart Object pixel bounds do not match its transformed rectangle.');
 const background=await layerScene(ordered.slice(0,position),psd.width,psd.height);
 const foreground=await layerScene(ordered.slice(position+1),psd.width,psd.height);
 const placeholder=await sharp(target.bytes,{raw:{width:target.width,height:target.height,channels:4}})
  .png().toBuffer();
 const check=await verifyReconstruction(psd,background,placeholder,foreground,slot);
 const recordOut={
  version:1,psdBytes:stat.size,width:psd.width,height:psd.height,slot,
  objects,usedMapping:record.path,fidelity:check
 };
 await fs.mkdir(folder,{recursive:true});
 const written=await Promise.all([
  fs.writeFile(path.join(folder,'background.png'),background),
  fs.writeFile(path.join(folder,'foreground.png'),foreground),
  fs.writeFile(path.join(folder,'mask.png'),placeholder)
 ]);
 void written;
 await fs.writeFile(manifestPath+'.tmp',JSON.stringify(recordOut));
 await fs.rename(manifestPath+'.tmp',manifestPath);
 return {...recordOut,folder,preparedFromCache:false};
}
export async function renderNativeScene({background,foreground,mask,artwork,slot,
 outputPath,fitMode='contain'}){
 const {left,top,width,height}=slot;
 if(![left,top,width,height].every(Number.isInteger)||left<0||top<0||width<1||height<1)
  throw Error('Prepared artwork position is invalid.');
 const resized=await sharp(artwork).rotate()
  .resize(width,height,{fit:fitMode==='cover'?'cover':'contain',
   background:{r:255,g:255,b:255,alpha:1}})
  .ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const originalMask=await sharp(mask).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(originalMask.info.width!==width||originalMask.info.height!==height)
  throw Error('Prepared PSD artwork mask dimensions do not match.');
 const rgba=Buffer.from(resized.data);
 for(let i=0;i<rgba.length;i+=4)
  rgba[i+3]=Math.round(rgba[i+3]*originalMask.data[i+3]/255);
 const art=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer();
 const result=await sharp(background).composite([
  {input:art,left,top},{input:foreground,left:0,top:0}
 ]).jpeg({quality:92,mozjpeg:true}).toFile(outputPath);
 return result;
}
export async function renderMockupNative({psdPath,artworkPath,outputPath,mapping=null,
 fitMode='contain',onStage=async()=>{}}){
 const started=Date.now();
 const prepared=await prepareNativePsd({psdPath,mapping,onStage});
 await onStage(prepared.preparedFromCache?
  'Reusing native prepared PSD scene (no browser)':
  'PSD scene verified against original composite; rendering natively');
 const result=await renderNativeScene({
  background:path.join(prepared.folder,'background.png'),
  foreground:path.join(prepared.folder,'foreground.png'),
  mask:path.join(prepared.folder,'mask.png'),
  artwork:artworkPath,slot:prepared.slot,outputPath,fitMode
 });
 return {engine:'native',objects:prepared.objects,usedMapping:prepared.usedMapping,
  needsMapping:false,dimensions:{width:result.width,height:result.height},
  size:result.size,renderMs:Date.now()-started,
  preparedFromCache:prepared.preparedFromCache,fidelity:prepared.fidelity};
}
