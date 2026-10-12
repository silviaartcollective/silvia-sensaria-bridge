import sharp from 'sharp';
import {GetObjectCommand} from '@aws-sdk/client-s3';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {r2Client,r2Config,downloadArtworkObjectToFile} from './r2.mjs';

export function masterGeometry(metadata={}){
 let width=Number(metadata.width||0),height=Number(metadata.height||0);
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
  throw Error('Could not determine master artwork dimensions.');
 if([5,6,7,8].includes(Number(metadata.orientation||1))) [width,height]=[height,width];
 return {width,height,orientation:width>height?'landscape':height>width?'portrait':'square'};
}

export async function inspectStoredMasterGeometry(key){
 const cfg=r2Config();
 // Read the metadata header first; avoid downloading the full artwork if possible.
 try{
  const partial=await r2Client().send(new GetObjectCommand({
   Bucket:cfg.bucket,Key:key,Range:'bytes=0-524287'
  }));
  const bytes=Buffer.from(await partial.Body.transformToByteArray());
  return masterGeometry(await sharp(bytes,{limitInputPixels:false}).metadata());
 }catch(error){
  // TIFF/EXIF metadata may be beyond the initial range; stream to disk if needed.
  const temporary=join(tmpdir(),'master-geometry-'+randomUUID());
  try{
   await downloadArtworkObjectToFile(key,temporary);
   return masterGeometry(await sharp(temporary,{limitInputPixels:false}).metadata());
  }catch(fallback){
   throw Error('Unable to inspect actual master image orientation: '+fallback.message);
  }finally{await rm(temporary,{force:true}).catch(()=>{})}
 }
}
