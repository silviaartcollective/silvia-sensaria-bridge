// One shared favicon implementation for the Silvia and Japandi admin apps.
// Favicon assets are served as actual PNG and ICO bytes, not an SVG redirect.
// The source SVG is shop-specific; Silvia's original SA logo is retained.
import {readFileSync} from 'node:fs';
import sharp from 'sharp';

const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);

export function buildIcoFromPngs(entries){
 if(!Array.isArray(entries)||entries.length===0||entries.length>10)
  throw new Error('ICO requires at least one PNG icon');
 const header=Buffer.alloc(6+16*entries.length);
 header.writeUInt16LE(0,0);  // reserved
 header.writeUInt16LE(1,2);  // Windows icon
 header.writeUInt16LE(entries.length,4);
 let offset=header.length;
 for(let i=0;i<entries.length;i++){
  const {size,png}=entries[i],entry=6+i*16;
  if(!Number.isInteger(size)||size<1||size>256||!Buffer.isBuffer(png)||
     !png.subarray(0,8).equals(pngSignature))throw new Error('Invalid PNG favicon frame');
  header[entry]=size===256?0:size;
  header[entry+1]=size===256?0:size;
  header[entry+2]=0;  // no palette
  header[entry+3]=0;
  header.writeUInt16LE(1,entry+4); // planes
  header.writeUInt16LE(32,entry+6); // RGBA
  header.writeUInt32LE(png.length,entry+8);
  header.writeUInt32LE(offset,entry+12);
  offset+=png.length;
 }
 return Buffer.concat([header,...entries.map(item=>item.png)]);
}

export async function buildFaviconAssets(svgText){
 const svg=Buffer.from(svgText,'utf8');
 // Chromium can ignore favicons containing an SVG <image> referencing a
 // base64 PNG; expose that original logo directly as a native raster icon.
 const inline=String(svgText).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/i);
 let png;
 if(inline){
  const embedded=Buffer.from(inline[1],'base64');
  if(!embedded.subarray(0,8).equals(pngSignature))
   throw new Error('Embedded brand favicon is not a valid PNG');
  png=await sharp(embedded).resize(64,64,{fit:'fill'}).png().toBuffer();
 }else{
  png=await sharp(svg).resize(64,64,{fit:'fill'}).png().toBuffer();
 }
 const frame32=await sharp(png).resize(32,32).png().toBuffer();
 const frame16=await sharp(png).resize(16,16).png().toBuffer();
 const ico=buildIcoFromPngs([{size:16,png:frame16},{size:32,png:frame32}]);
 return {svg,png,png32:frame32,png16:frame16,ico};
}

let cachedAssets=null;
export async function getFaviconAssets(){
 if(!cachedAssets){
  const svg=readFileSync(new URL('./favicon.svg',import.meta.url),'utf8');
  cachedAssets=buildFaviconAssets(svg).catch(error=>{
   cachedAssets=null;throw error;
  });
 }
 return cachedAssets;
}
