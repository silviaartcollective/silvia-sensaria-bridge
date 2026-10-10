import {GetObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
import {once} from 'node:events';
import {r2Client,r2Config} from './r2.mjs';
import {getMockupJob} from './mockup-generator.mjs';

function crcUpdate(crc,data){
 for(const b of data){
  crc^=b;
  for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return crc>>>0;
}
const u16=(buf,n,v)=>buf.writeUInt16LE(v,n);
const u32=(buf,n,v)=>buf.writeUInt32LE(v>>>0,n);
function localHeader(name){
 const b=Buffer.alloc(30+name.length);
 u32(b,0,0x04034b50);u16(b,4,20);u16(b,6,0x0808);u16(b,8,0);u16(b,10,0);u16(b,12,0);
 u32(b,14,0);u32(b,18,0);u32(b,22,0);u16(b,26,name.length);u16(b,28,0);name.copy(b,30);
 return b;
}
function descriptor(crc,size){
 const b=Buffer.alloc(16);
 u32(b,0,0x08074b50);u32(b,4,crc);u32(b,8,size);u32(b,12,size);return b;
}
function centralEntry(name,crc,size,offset){
 const b=Buffer.alloc(46+name.length);
 u32(b,0,0x02014b50);u16(b,4,20);u16(b,6,20);u16(b,8,0x0808);
 u16(b,10,0);u16(b,12,0);u16(b,14,0);u32(b,16,crc);u32(b,20,size);
 u32(b,24,size);u16(b,28,name.length);u16(b,30,0);u16(b,32,0);u16(b,34,0);
 u16(b,36,0);u32(b,38,0);u32(b,42,offset);name.copy(b,46);return b;
}
function endHeader(count,centralSize,centralOffset){
 const b=Buffer.alloc(22);u32(b,0,0x06054b50);
 u16(b,8,count);u16(b,10,count);u32(b,12,centralSize);u32(b,16,centralOffset);return b;
}
export async function streamMockupZip(res,id){
 const job=await getMockupJob(id);
 const items=job.templates.filter(x=>x.status==='completed'&&x.outputKey);
 if(!items.length)throw Error('There are no generated JPGs to download.');
 if(items.length>150)throw Error('This batch has too many outputs.');
 const client=r2Client(),Bucket=r2Config().bucket;
 const files=[],names=new Set();
 let estimated=22;
 for(const item of items){
  const info=await client.send(new HeadObjectCommand({Bucket,Key:item.outputKey}));
  const bytes=Number(info.ContentLength);
  if(!Number.isSafeInteger(bytes)||bytes<100||bytes>60*1024*1024)throw Error('Invalid saved JPG size: '+item.name);
  let filename=item.outputName;
  if(names.has(filename.toLowerCase()))filename=filename.replace(/\.jpg$/i,'-'+item.id.slice(0,8)+'.jpg');
  names.add(filename.toLowerCase());
  const name=Buffer.from(filename,'utf8');
  files.push({key:item.outputKey,bytes,name});
  estimated+=30+name.length+bytes+16+46+name.length;
 }
 if(estimated>0xffffff00)throw Error('ZIP exceeds the 4GB standard archive limit. Download JPGs individually.');
 res.writeHead(200,{'content-type':'application/zip',
  'cache-control':'private, no-store',
  'x-content-type-options':'nosniff',
  'content-disposition':'attachment; filename="mockups-'+id+'.zip"'});
 let offset=0;
 async function emit(bytes){
  offset+=bytes.length;
  if(!res.write(bytes))await once(res,'drain');
 }
 try{
  const central=[];
  for(const file of files){
   const start=offset;
   await emit(localHeader(file.name));
   const object=await client.send(new GetObjectCommand({Bucket,Key:file.key}));
   let crc=0xffffffff,size=0;
   for await(const chunk of object.Body){
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=bytes.length;crc=crcUpdate(crc,bytes);
    if(size>file.bytes)throw Error('Mockup file changed during archive creation.');
    await emit(bytes);
   }
   if(size!==file.bytes)throw Error('Mockup file length changed during download.');
   crc=(crc^0xffffffff)>>>0;
   await emit(descriptor(crc,size));
   central.push(centralEntry(file.name,crc,size,start));
  }
  const start=offset;
  for(const entry of central)await emit(entry);
  await emit(endHeader(central.length,offset-start,start));
  res.end();
 }catch(error){
  res.destroy(error);
 }
 return true;
}
export function zipSignatureParts(name){
 const label=Buffer.from(name,'utf8');
 return {local:localHeader(label),descriptor:descriptor(0x12345678,100),
  central:centralEntry(label,0x12345678,100,0),
  end:endHeader(1,46+label.length,30+label.length+100+16)};
}
