import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';

// The prepared-template cache lives under LOCALAPPDATA; keep it in a temp folder.
const cacheRoot=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-cache-'));
process.env.LOCALAPPDATA=cacheRoot;
test.after(()=>fs.rm(cacheRoot,{recursive:true,force:true}));

// The PSD reader is a worker dependency (npm --prefix worker install).
let agPsd=null;
try{agPsd=await import('../worker/node_modules/ag-psd/dist/index.js')}catch{}
const needsReader={skip:agPsd?false:'worker dependencies are not installed'};
const native=agPsd?await import('../worker/native-mockup.mjs'):{};
const processor=agPsd?await import('../worker/mockup-processor.mjs'):{};
agPsd?.initializeCanvas(()=>{throw Error('no canvas')},
 (width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));

const GUID='20953ddb-9391-11ec-b4f1-c15674f50bc4';
const GUID2='4f1c5e2a-9391-11ec-b4f1-c15674f50bc4';
function image(width,height,fn){
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=fn(x,y);data.set([p[0],p[1],p[2],p[3]??255],(y*width+x)*4);
 }
 return {width,height,data};
}
// Pixel centre inside a convex quad (TL, TR, BR, BL), independent of the renderer.
function inQuad(quad,x,y){
 const px=x+0.5,py=y+0.5;
 for(let i=0;i<4;i++){
  const [ax,ay]=quad[i],[bx,by]=quad[(i+1)%4];
  if((bx-ax)*(py-ay)-(by-ay)*(px-ax)<0)return false;
 }
 return true;
}
const lerp=(a,b,t)=>a+(b-a)*t;
const multiply=(b,s)=>b*s/255;
const screen=(b,s)=>255-(255-b)*(255-s)/255;

// A perspective frame mockup:
//   wall (gradient) → group "Frame" with a mask hiding the right strip of the art
//   { artwork Smart Object (trapezoid), glare clipped to it (screen, 40%) }
//   → shadow strip across the top (multiply, 60%).
function frameScene({W=240,H=180,shade=false,unrelated=false}={}){
 const quad=[[60,30],[180,40],[180,150],[60,160]];
 const old=[150,120,90];
 const wall=(x,y)=>[200-(y>>2),190,170+(x>>3)];
 const glare=[255,255,255],glareAlpha=x=>x<120?0.4:0;
 const groupMask=x=>x<170?255:0;
 const shadow=y=>y<60?0.6:0;
 const composite=image(W,H,(x,y)=>{
  let c=wall(x,y);
  if(inQuad(quad,x,y)&&groupMask(x)){
   let a=old.slice();
   a=a.map((v,i)=>lerp(v,screen(v,glare[i]),glareAlpha(x)));
   c=a;
  }
  c=c.map(v=>lerp(v,multiply(v,60),shadow(y)));
  if(shade&&inQuad(quad,x,y)&&y>=110&&y<130)c=c.map(v=>v*0.5);
  if(unrelated&&inQuad(quad,x,y))c=[(x*37)%256,(y*53)%256,((x+y)*29)%256];
  return c;
 });
 const psd={width:W,height:H,imageData:composite,children:[
  {name:'Wall',left:0,top:0,right:W,bottom:H,imageData:image(W,H,(x,y)=>wall(x,y))},
  {name:'Frame',opened:true,blendMode:'pass through',
   mask:{left:0,top:0,right:W,bottom:H,defaultColor:0,imageData:image(W,H,x=>[groupMask(x),groupMask(x),groupMask(x),255])},
   children:[
    {name:'Your Art',left:0,top:0,right:W,bottom:H,
     imageData:image(W,H,(x,y)=>inQuad(quad,x,y)?[...old,255]:[0,0,0,0]),
     placedLayer:{id:GUID,type:'raster',transform:quad.flat(),width:400,height:500}},
    {name:'Glare',blendMode:'screen',opacity:1,clipping:true,left:0,top:0,right:W,bottom:H,
     imageData:image(W,H,x=>[...glare,Math.round(255*glareAlpha(x))])}
   ]},
  {name:'Shadow',blendMode:'multiply',opacity:0.6,left:0,top:0,right:W,bottom:60,
   imageData:image(W,60,()=>[60,60,60,255])}
 ],linkedFiles:[{id:GUID,name:'art.png',data:new Uint8Array([1,2,3])}]};
 return {psd,quad,wall,glareAlpha,groupMask,shadow};
}
function readBack(psd){
 return agPsd.readPsd(agPsd.writePsdBuffer(psd),{useImageData:true,skipThumbnail:true});
}
// Artwork with four flat quadrants: TL red, TR green, BL blue, BR yellow.
const QUADRANTS={tl:[230,20,20],tr:[20,200,40],bl:[30,40,220],br:[240,220,30]};
async function quadrantArtwork(file,width=400,height=500){
 const {data}=image(width,height,(x,y)=>QUADRANTS[(y<height/2?'t':'b')+(x<width/2?'l':'r')]);
 await sharp(Buffer.from(data.buffer),{raw:{width,height,channels:4}}).removeAlpha().png().toFile(file);
}
async function pixels(file){
 const {data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});
 return {info,at:(x,y)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)]};
}
const near=(a,b,tol,label)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<=tol),
 label+': got '+a.join(',')+' expected '+b.map(Math.round).join(','));

test('perspective artwork, clipped glare, group mask and shadow render on the PC worker alone',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const scene=frameScene();
  const psdPath=path.join(dir,'frame.psd'),artPath=path.join(dir,'art.png'),out=path.join(dir,'out.jpg');
  await fs.writeFile(psdPath,agPsd.writePsdBuffer(scene.psd));
  await quadrantArtwork(artPath);
  const stages=[];
  const first=await processor.renderMockupOnPC({psdPath,artworkPath:artPath,outputPath:out,
   templateName:'frame.psd',fitMode:'cover',onStage:s=>stages.push(s)});
  assert.equal(first.needsMapping,false);
  assert.equal(first.usedMapping,'1.1'); // Photoshop numbering: Frame is 2nd from top, art below Glare
  assert.equal(first.preparedFromCache,false);
  assert.ok(first.fidelity.meanPixelError<1,JSON.stringify(first.fidelity));
  assert.ok(first.fidelity.correctedFraction<0.01,JSON.stringify(first.fidelity));
  assert.deepEqual(first.dimensions,{width:240,height:180});
  const {at}=await pixels(out);
  // The diagonals of the quad meet at the artwork's centre; step toward each corner.
  const [cx,cy]=[120,96];
  const expect=(colour,x,y)=>{
   let c=colour.map((v,i)=>lerp(v,screen(v,255),scene.glareAlpha(x)));
   return c.map(v=>lerp(v,multiply(v,60),scene.shadow(y)));
  };
  near(at(cx-25,cy-25),expect(QUADRANTS.tl,cx-25,cy-25),10,'top-left quadrant');
  near(at(cx+25,cy-25),expect(QUADRANTS.tr,cx+25,cy-25),10,'top-right quadrant');
  near(at(cx-25,cy+25),expect(QUADRANTS.bl,cx-25,cy+25),10,'bottom-left quadrant');
  near(at(cx+25,cy+25),expect(QUADRANTS.br,cx+25,cy+25),10,'bottom-right quadrant');
  // Outside the artwork and under the group mask the PSD is untouched.
  near(at(20,100),scene.wall(20,100),6,'wall');
  near(at(175,100),scene.wall(175,100),6,'masked strip of the artwork');
  near(at(20,20),scene.wall(20,20).map(v=>lerp(v,multiply(v,60),0.6)),6,'shadow over the wall');

  const second=await processor.renderMockupOnPC({psdPath,artworkPath:artPath,outputPath:out,templateName:'frame.psd'});
  assert.equal(second.preparedFromCache,true);
  assert.ok(stages.some(s=>/one time per template/.test(s)));
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('effects the layers cannot explain (e.g. an inner shadow) are carried onto every new artwork',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  // The composite darkens a band inside the artwork by 50%, which no layer explains.
  const scene=frameScene({shade:true});
  const psdPath=path.join(dir,'shade.psd'),artPath=path.join(dir,'art.png'),out=path.join(dir,'out.jpg');
  await fs.writeFile(psdPath,agPsd.writePsdBuffer(scene.psd));
  await quadrantArtwork(artPath);
  const result=await processor.renderMockupOnPC({psdPath,artworkPath:artPath,outputPath:out,templateName:'shade.psd',fitMode:'cover'});
  assert.ok(result.fidelity.correctedFraction>0.05,JSON.stringify(result.fidelity));
  const {at}=await pixels(out);
  const glare=(c,x)=>c.map(v=>lerp(v,screen(v,255),scene.glareAlpha(x)));
  near(at(95,121),glare(QUADRANTS.bl,95).map(v=>v*0.5),12,'shaded bottom-left');
  near(at(95,71),glare(QUADRANTS.tl,95),12,'unshaded top-left');
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('a PSD whose composite does not match its artwork layer at all is rejected, never rendered wrong',needsReader,()=>{
 const psd=readBack(frameScene({unrelated:true}).psd);
 assert.throws(()=>native.prepareFromPsd(psd),
  error=>error instanceof native.NativeMockupUnsupported&&/does not match its artwork Smart Object/.test(error.message));
});

test('16-bit PSD pixels are converted to 8 bits',needsReader,()=>{
 const wide=v=>({width:1,height:1,data:new Uint16Array([v,v,v,65535])});
 const psd={imageData:wide(65535),children:[{imageData:wide(32896),mask:{imageData:wide(0)},children:[{imageData:wide(256)}]}]};
 native.normalizeDepth(psd);
 assert.deepEqual([...psd.imageData.data],[255,255,255,255]);
 assert.deepEqual([...psd.children[0].imageData.data],[128,128,128,255]);
 assert.deepEqual([...psd.children[0].mask.imageData.data],[0,0,0,255]);
 assert.deepEqual([...psd.children[0].children[0].imageData.data],[1,1,1,255]);
});

test('several visible Smart Objects ask for the artwork layer once, then use the saved choice',needsReader,()=>{
 const {psd}=frameScene();
 psd.children.push({name:'Logo',left:0,top:0,right:20,bottom:20,imageData:image(20,20,()=>[0,0,0,255]),
  placedLayer:{id:GUID2,type:'raster',transform:[0,0,20,0,20,20,0,20],width:20,height:20}});
 psd.linkedFiles.push({id:GUID2,name:'logo.png',data:new Uint8Array([1])});
 const parsed=readBack(psd);
 const asked=native.prepareFromPsd(parsed);
 assert.equal(asked.needsMapping,true);
 assert.deepEqual(asked.objects.map(o=>o.path).sort(),['0','2.1']);
 const mapped=native.prepareFromPsd(parsed,{path:'2.1'});
 assert.equal(mapped.needsMapping,false);
 assert.equal(mapped.usedMapping,'2.1');
 // A choice saved by layer name (e.g. mockup 19's "5") also works.
 assert.equal(native.prepareFromPsd(parsed,{path:'Your Art'}).usedMapping,'2.1');
 // A stale saved choice asks for the layer again instead of failing the PSD.
 const stale=native.prepareFromPsd(parsed,{path:'7'});
 assert.equal(stale.needsMapping,true);
 assert.match(stale.reason,/select the artwork layer again/);
});

test('a hidden Smart Object (like mockup 19\'s "mockup 1 (1)") is never chosen as the artwork',needsReader,()=>{
 const {psd}=frameScene();
 psd.children.push({name:'mockup 1 (1)',hidden:true,left:0,top:0,right:20,bottom:20,imageData:image(20,20,()=>[0,0,0,255]),
  placedLayer:{id:GUID2,type:'raster',transform:[0,0,20,0,20,20,0,20],width:20,height:20}});
 psd.linkedFiles.push({id:GUID2,name:'hidden.png',data:new Uint8Array([1])});
 const prepared=native.prepareFromPsd(readBack(psd));
 assert.equal(prepared.needsMapping,false);
 assert.equal(prepared.usedMapping,'2.1');
 assert.deepEqual(prepared.objects.map(o=>[o.path,o.visible]).sort(),[['0',false],['2.1',true]]);
 assert.equal(native.prepareFromPsd(readBack(psd),{path:'0'}).needsMapping,true);
});

test('ordinary Smart Objects (identity warp grid) are accepted; real warps and filters are not',needsReader,()=>{
 const grid=(dx=0)=>({style:'custom',uOrder:4,vOrder:4,
  bounds:{left:{value:0},top:{value:0},right:{value:300},bottom:{value:300}},
  customEnvelopeWarp:{meshPoints:Array.from({length:16},(_,i)=>({x:(i%4)*100+(i===5?dx:0),y:Math.floor(i/4)*100}))}});
 assert.equal(native.warpIsIdentity(grid()),true);
 assert.equal(native.warpIsIdentity(undefined),true);
 assert.equal(native.warpIsIdentity(grid(40)),false);
 assert.equal(native.warpIsIdentity({style:'arc',value:30}),false);
 const layer=extra=>({placedLayer:{transform:[0,0,10,0,10,10,0,10],width:10,height:10,...extra}});
 assert.ok(native.smartObjectGeometry(layer({warp:grid()})));
 assert.throws(()=>native.smartObjectGeometry(layer({warp:grid(40)})),/Warp/);
 assert.throws(()=>native.smartObjectGeometry(layer({filter:{list:[{enabled:true}]}})),/Smart Filters/);
});

test('homography maps the Smart Object corners exactly',needsReader,()=>{
 const quad=[[60,30],[180,40],[180,150],[60,160]];
 const H=native.homography([[0,0],[400,0],[400,500],[0,500]],quad);
 [[0,0],[400,0],[400,500],[0,500]].forEach(([x,y],i)=>{
  const [u,v]=native.applyHomography(H,x,y);
  assert.ok(Math.abs(u-quad[i][0])<1e-6&&Math.abs(v-quad[i][1])<1e-6);
 });
});

test('templates without a saved composite or with 32-bit colour are rejected clearly',needsReader,()=>{
 assert.throws(()=>native.prepareFromPsd({width:10,height:10,colorMode:3,bitsPerChannel:8,children:[]}),
  /Maximize PSD and PSB File Compatibility/);
 assert.throws(()=>native.prepareFromPsd({width:10,height:10,colorMode:3,bitsPerChannel:32,children:[]}),
  /32-bit/);
});

test('an unsupported template fails that PSD without pausing the batch',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const psdPath=path.join(dir,'bad.psd');
  await fs.writeFile(psdPath,agPsd.writePsdBuffer(frameScene({unrelated:true}).psd));
  await quadrantArtwork(path.join(dir,'art.png'));
  await assert.rejects(processor.renderMockupOnPC({psdPath,artworkPath:path.join(dir,'art.png'),
   outputPath:path.join(dir,'out.jpg'),templateName:'bad.psd'}),
   error=>error.nativeUnsupported===true&&/bad\.psd" is not supported by the PC worker/.test(error.message));
  const worker=readFileSync(new URL('../worker/index.mjs',import.meta.url),'utf8');
  assert.match(worker,/!error\.nativeUnsupported&&/);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('a 12-megapixel template renders each new artwork in about a second once prepared',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const W=4000,H=3000,quad=[[900,400],[3100,400],[3100,2700],[900,2700]];
  const wall=(x,y)=>[180+(x%40),170,160+(y%30)];
  const psd={width:W,height:H,
   imageData:image(W,H,(x,y)=>inQuad(quad,x,y)?[150,120,90]:wall(x,y)),
   children:[
    {name:'Wall',left:0,top:0,right:W,bottom:H,imageData:image(W,H,wall)},
    {name:'Art',left:900,top:400,right:3100,bottom:2700,imageData:image(2200,2300,()=>[150,120,90,255]),
     placedLayer:{id:GUID,type:'raster',transform:quad.flat(),width:2200,height:2300}}
   ],linkedFiles:[{id:GUID,name:'art.png',data:new Uint8Array([1])}]};
  const psdPath=path.join(dir,'big.psd'),art=path.join(dir,'art.png'),out=path.join(dir,'out.jpg');
  await fs.writeFile(psdPath,agPsd.writePsdBuffer(psd));
  await quadrantArtwork(art,6000,7200);
  const prepare=Date.now();
  await processor.renderMockupOnPC({psdPath,artworkPath:art,outputPath:out,templateName:'big.psd'});
  const prepared=Date.now()-prepare;
  const start=Date.now();
  const result=await processor.renderMockupOnPC({psdPath,artworkPath:art,outputPath:out,templateName:'big.psd'});
  const render=Date.now()-start;
  console.log('12 MP template: first render with preparation '+prepared+' ms, cached render '+render+' ms');
  assert.equal(result.preparedFromCache,true);
  assert.deepEqual(result.dimensions,{width:4000,height:3000});
  assert.ok(render<4000,'cached render took '+render+' ms');
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('the PC worker renders PSDs itself: no Photoshop, Photopea or browser code remains',()=>{
 const worker=new URL('../worker/',import.meta.url);
 const processorSource=readFileSync(new URL('mockup-processor.mjs',worker),'utf8');
 const pkg=JSON.parse(readFileSync(new URL('package.json',worker),'utf8'));
 assert.doesNotMatch(processorSource.replace(/^\/\/.*$/gm,''),/puppeteer|photopea|photoshop|chrom/i);
 assert.match(processorSource,/renderMockupNative\(/);
 assert.equal(pkg.dependencies['puppeteer-core'],undefined);
 assert.ok(pkg.dependencies['ag-psd']);
 for(const legacy of ['native-photoshop.mjs','photoshop-native.jsx','photoshop-runner.ps1','photopea-worker-page.js'])
  assert.throws(()=>readFileSync(new URL(legacy,worker)),{code:'ENOENT'},legacy);
});

test('the worker claims the next queued PSD immediately instead of waiting between mockups',()=>{
 const source=readFileSync(new URL('../worker/index.mjs',import.meta.url),'utf8');
 assert.match(source,/mockupPollAt\.delete\(app\.appUrl\)/);
 assert.match(source,/if\(await pollOnce\(\)\)continue;/);
 assert.doesNotMatch(source,/<12000/);
});
