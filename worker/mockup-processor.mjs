// PSD mockup renderer used by the shared PC crop + mockup worker.
// Everything runs inside this Node process: the PSD is read with ag-psd and
// prepared once (cached on disk); every artwork after that is a perspective warp
// plus composite with sharp. No Photoshop, Photopea or browser is involved.
import {stat} from 'node:fs/promises';
import sharp from 'sharp';
import {renderMockupNative,NativeMockupUnsupported} from './native-mockup.mjs';

export {NativeMockupUnsupported};

export async function renderMockupOnPC({psdPath,artworkPath,outputPath,templateName='',mapping,
 fitMode='contain',onStage=()=>{}}){
 const started=Date.now();
 let result;
 try{
  result=await renderMockupNative({psdPath,artworkPath,outputPath,mapping,fitMode,onStage});
 }catch(error){
  if(error instanceof NativeMockupUnsupported)
   throw Object.assign(Error(('PSD template "'+templateName+'" is not supported by the PC worker: '+
    error.message).slice(0,450)),{nativeUnsupported:true});
  throw error;
 }
 if(result.needsMapping)return result;
 const metadata=await sharp(outputPath,{limitInputPixels:24_000_001}).metadata();
 if(metadata.format!=='jpeg'||!metadata.width||!metadata.height||
    metadata.width*metadata.height>24000000||metadata.width<150||metadata.height<150)
  throw Error('Rendered mockup is not a valid JPEG within 24 megapixels.');
 const size=(await stat(outputPath)).size;
 if(size<100||size>60*1024*1024)throw Error('Rendered mockup file size is invalid.');
 console.log('[PC PSD renderer] '+templateName+' rendered in '+
  ((Date.now()-started)/1000).toFixed(2)+'s ('+
  (result.preparedFromCache?'prepared template reused':'template prepared on first use')+').');
 return {...result,dimensions:{width:metadata.width,height:metadata.height},size,
  renderMs:Date.now()-started};
}
