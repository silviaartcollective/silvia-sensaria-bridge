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

// Like the folder PSDs with two Smart Objects: the artwork "5" on top and an
// older Smart Object ("ChatGPT Image …") under the scene.
function twoSmartObjects(){
 const scene=frameScene();
 scene.psd.children[1].children[0].name='5';
 scene.psd.children.unshift({name:'ChatGPT Image May 12, 2025',left:0,top:0,right:20,bottom:20,
  imageData:image(20,20,()=>[0,0,0,255]),
  placedLayer:{id:GUID2,type:'raster',transform:[0,0,20,0,20,20,0,20],width:20,height:20}});
 scene.psd.linkedFiles.push({id:GUID2,name:'chatgpt.png',data:new Uint8Array([1])});
 return scene;
}

test('with several visible Smart Objects the top one is the artwork, unless another one was chosen',needsReader,()=>{
 const parsed=()=>readBack(twoSmartObjects().psd);
 const top=native.prepareFromPsd(parsed());
 assert.equal(top.needsMapping,false);
 assert.equal(top.usedMapping,'1.1');
 assert.deepEqual(top.objects.map(o=>[o.path,o.name,!!o.suggested]).sort(),
  [['1.1','5',true],['3','ChatGPT Image May 12, 2025',false]]);
 // A layer chosen in the Product Creator (by path or by name) still wins.
 const chosen=native.prepareFromPsd(parsed(),{path:'3'});
 assert.equal(chosen.usedMapping,'3');
 assert.equal(native.prepareFromPsd(parsed(),{path:'5'}).usedMapping,'1.1');
 // A choice that is no longer in the PSD falls back to the top one.
 assert.equal(native.prepareFromPsd(parsed(),{path:'7'}).usedMapping,'1.1');
});

test('the top Smart Object follows the Layers panel, groups included; the server matches saved choices like the PC',needsReader,async()=>{
 const {classifySmartObjects}=await import('../src/mockup-generator.mjs');
 const top=paths=>native.topSmartObject(paths.map(path=>({path,visible:true}))).path;
 assert.equal(top(['3','1.1','2']),'1.1');
 assert.equal(top(['10','2','2.0.4']),'2');
 assert.equal(top(['2.1','2.0.4']),'2.0.4');
 // A saved choice matches by path before name, on the server as on the PC.
 const named=[{path:'5',name:'Background',visible:true,kind:'smart'},{path:'0',name:'5',visible:true,kind:'smart'}];
 assert.equal(classifySmartObjects(named,{name:'mockup 19.psd'}).path,'5');
 // A saved choice that is gone falls back to the layer the worker marked.
 const marked=[{path:'3',name:'A',visible:true,kind:'smart'},{path:'1',name:'B',visible:true,kind:'smart',suggested:true}];
 assert.deepEqual([classifySmartObjects(marked,{name:'a.psd',mapping:{path:'7'}}).status,
  classifySmartObjects(marked,{name:'a.psd',mapping:{path:'7'}}).path],['mapped','1']);
});

test('templates prepared by an older worker that asked for a layer are prepared again with the top one',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const psdPath=path.join(dir,'two smart objects.psd');
  await fs.writeFile(psdPath,agPsd.writePsdBuffer(twoSmartObjects().psd));
  const first=await native.prepareNativePsd({psdPath});
  assert.equal(first.usedMapping,'1.1');
  // What worker 4.7.0 cached for this PSD: "select the artwork layer".
  const manifestPath=path.join(first.folder,'manifest.json');
  const current=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  await fs.writeFile(manifestPath,JSON.stringify({version:current.version,psdBytes:current.psdBytes,needsMapping:true,
   objects:current.objects.map(({suggested,...x})=>x),reason:'This PSD has several visible Smart Objects. Select the artwork layer.'}));
  const again=await native.prepareNativePsd({psdPath});
  assert.equal(again.preparedFromCache,false);
  assert.ok(!again.needsMapping);
  assert.equal(again.usedMapping,'1.1');
  // Prepared with the top one, it is reused from then on.
  const cached=await native.prepareNativePsd({psdPath});
  assert.equal(cached.preparedFromCache,true);
  assert.equal(cached.usedMapping,'1.1');
  assert.deepEqual(cached.objects.filter(x=>x.suggested).map(x=>x.path),['1.1']);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
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
 // A saved choice pointing at the hidden layer uses the visible one instead.
 assert.equal(native.prepareFromPsd(readBack(psd),{path:'0'}).usedMapping,'2.1');
});

test('ordinary Smart Objects (identity warp grid) are accepted; real warps are not',needsReader,()=>{
 const grid=(dx=0)=>({style:'custom',uOrder:4,vOrder:4,
  bounds:{left:{value:0},top:{value:0},right:{value:300},bottom:{value:300}},
  customEnvelopeWarp:{meshPoints:Array.from({length:16},(_,i)=>({x:(i%4)*100+(i===5?dx:0),y:Math.floor(i/4)*100}))}});
 assert.equal(native.warpIsIdentity(grid()),true);
 assert.equal(native.warpIsIdentity(undefined),true);
 assert.equal(native.warpIsIdentity(grid(40)),false);
 assert.equal(native.warpIsIdentity({style:'arc',value:30}),false);
 // Real Photoshop cylinder warps store their bend in `values`.
 assert.equal(native.warpIsIdentity({style:'cylinder',values:[0,25]}),false);
 assert.equal(native.warpIsIdentity({style:'cylinder',values:[0,0]}),true);
 const layer=extra=>({placedLayer:{transform:[0,0,10,0,10,10,0,10],width:10,height:10,...extra}});
 assert.ok(native.smartObjectGeometry(layer({warp:grid()})));
 assert.throws(()=>native.smartObjectGeometry(layer({warp:grid(40)})),/Warp/);
 // Smart filters on the artwork are ignored rather than failing the template.
 assert.ok(native.smartObjectGeometry(layer({filter:{list:[{enabled:true}]}})));
});

test('homography maps the Smart Object corners exactly',needsReader,()=>{
 const quad=[[60,30],[180,40],[180,150],[60,160]];
 const H=native.homography([[0,0],[400,0],[400,500],[0,500]],quad);
 [[0,0],[400,0],[400,500],[0,500]].forEach(([x,y],i)=>{
  const [u,v]=native.applyHomography(H,x,y);
  assert.ok(Math.abs(u-quad[i][0])<1e-6&&Math.abs(v-quad[i][1])<1e-6);
 });
});

test('32-bit and CMYK templates are rejected clearly',needsReader,()=>{
 assert.throws(()=>native.prepareFromPsd({width:10,height:10,colorMode:3,bitsPerChannel:32,children:[]}),/32-bit/);
 assert.throws(()=>native.prepareFromPsd({width:10,height:10,colorMode:4,bitsPerChannel:8,children:[]}),/RGB or grayscale/);
});

test('a PSD saved without "Maximize compatibility" (blank composite) is built from its layers',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const scene=frameScene();
  scene.psd.imageData=image(240,180,()=>[255,255,255]); // Photoshop's blank placeholder
  const psdPath=path.join(dir,'nocompat.psd'),artPath=path.join(dir,'art.png'),out=path.join(dir,'out.jpg');
  await fs.writeFile(psdPath,agPsd.writePsdBuffer(scene.psd));
  await quadrantArtwork(artPath);
  const result=await processor.renderMockupOnPC({psdPath,artworkPath:artPath,outputPath:out,templateName:'nocompat.psd',fitMode:'cover'});
  assert.equal(result.fidelity.selfComposited,true);
  const {at}=await pixels(out);
  const glare=(c,x)=>c.map(v=>lerp(v,screen(v,255),scene.glareAlpha(x)));
  const shade=(c,y)=>c.map(v=>lerp(v,multiply(v,60),scene.shadow(y)));
  near(at(95,71),glare(QUADRANTS.tl,95),12,'artwork with glare');
  near(at(145,121),QUADRANTS.br,12,'artwork without glare');
  near(at(20,100),scene.wall(20,100),8,'wall rebuilt from layers');
  near(at(20,20),shade(scene.wall(20,20),20),8,'shadow over wall rebuilt from layers');
  near(at(175,100),scene.wall(175,100),8,'group mask hides the art strip');
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('blank-composite detection only triggers on a single flat colour',needsReader,()=>{
 assert.equal(native.compositeIsBlank({width:4,height:4,imageData:image(4,4,()=>[255,255,255])}),true);
 assert.equal(native.compositeIsBlank({width:4,height:4}),true);
 assert.equal(native.compositeIsBlank({width:4,height:4,imageData:image(4,4,(x)=>x?[255,255,255]:[0,0,0])}),false);
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
 assert.match(processorSource,/renderInPool\(/);
 assert.equal(pkg.dependencies['puppeteer-core'],undefined);
 assert.ok(pkg.dependencies['ag-psd']);
 for(const legacy of ['native-photoshop.mjs','photoshop-native.jsx','photoshop-runner.ps1','photopea-worker-page.js'])
  assert.throws(()=>readFileSync(new URL(legacy,worker)),{code:'ENOENT'},legacy);
});

test('the worker renders several mockups at once, alongside crops, and claims the next PSD immediately',()=>{
 const source=readFileSync(new URL('../worker/index.mjs',import.meta.url),'utf8');
 const pool=readFileSync(new URL('../worker/render-pool.mjs',import.meta.url),'utf8');
 assert.match(source,/await Promise\.all\(\[cropLane\(\),mockupLane\(\),warmUpLane\(\),mockupFolderLane\(\)\]\);/);
 assert.match(source,/if\(running\.size>=RENDER_THREADS\)\{await Promise\.race\(running\);continue\}/);
 assert.match(source,/continue; \/\/ claim the next queued PSD straight away/);
 assert.match(pool,/new Worker\(new URL\('\.\/render-thread\.mjs', import\.meta\.url\)\)/);
 assert.match(pool,/if \(await isTemplatePrepared\(\{ psdPath, mapping, psdSize, psdVersion \}\)\) return render\(\);/);
 assert.doesNotMatch(source,/<12000/);
});

test('a prepared template stays prepared when the download cache touches the PSD',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const psdPath=path.join(dir,'touched.psd'),art=path.join(dir,'art.png'),out=path.join(dir,'out.jpg');
  await fs.writeFile(psdPath,agPsd.writePsdBuffer(frameScene().psd));
  await quadrantArtwork(art);
  const first=await processor.renderMockupOnPC({psdPath,artworkPath:art,outputPath:out,templateName:'touched.psd'});
  assert.equal(first.preparedFromCache,false);
  const later=new Date(Date.now()+60000);
  await fs.utimes(psdPath,later,later); // what downloadCached does on every reuse
  assert.equal(await native.isTemplatePrepared({psdPath}),true);
  const second=await processor.renderMockupOnPC({psdPath,artworkPath:art,outputPath:out,templateName:'touched.psd'});
  assert.equal(second.preparedFromCache,true);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('several mockups render in parallel on the thread pool',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const art=path.join(dir,'art.png');await quadrantArtwork(art);
  const psds=[];
  for(let n=0;n<4;n++){const p=path.join(dir,'t'+n+'.psd');await fs.writeFile(p,agPsd.writePsdBuffer(frameScene().psd));psds.push(p)}
  const results=await Promise.all(psds.map((psdPath,n)=>processor.renderMockupOnPC({psdPath,artworkPath:art,
   outputPath:path.join(dir,'o'+n+'.jpg'),templateName:'t'+n+'.psd'})));
  assert.deepEqual(results.map(r=>r.dimensions.width),[240,240,240,240]);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('with several smart objects the worker picks the one that is clearly the artwork, else the top one, and the server accepts it',needsReader,async()=>{
 const {classifySmartObjects}=await import('../src/mockup-generator.mjs');
 const W=200,H=160,G=['1a2b3c4d-9391-11ec-b4f1-c15674f50bc4','2a2b3c4d-9391-11ec-b4f1-c15674f50bc4','3a2b3c4d-9391-11ec-b4f1-c15674f50bc4'];
 const ring=(x,y)=>x<6||y<6||x>=94||y>=114?[20,20,20,255]:[0,0,0,0];
 const scene=names=>({width:W,height:H,imageData:image(W,H,(x,y)=>x>=50&&x<150&&y>=20&&y<140?(x<56||y<26||x>=144||y>=134?[20,20,20]:[150,120,90]):[200,190,180]),
  children:[
   {name:names[0],left:0,top:0,right:W,bottom:H,imageData:image(W,H,()=>[200,190,180,255]),
    placedLayer:{id:G[0],type:'raster',transform:[0,0,W,0,W,H,0,H],width:W,height:H}},
   {name:names[1],left:50,top:20,right:150,bottom:140,imageData:image(100,120,()=>[150,120,90,255]),
    placedLayer:{id:G[1],type:'raster',transform:[50,20,150,20,150,140,50,140],width:100,height:120}},
   {name:names[2],left:50,top:20,right:150,bottom:140,imageData:image(100,120,ring),
    placedLayer:{id:G[2],type:'raster',transform:[50,20,150,20,150,140,50,140],width:100,height:120}}
  ],linkedFiles:G.map(id=>({id,name:id+'.png',data:new Uint8Array([1])}))});
 // Background photo (full canvas) and frame ring are skipped: the middle layer is the artwork.
 const prepared=native.prepareFromPsd(readBack(scene(['Layer 1','Layer 2','Layer 3'])));
 assert.equal(prepared.needsMapping,false);
 assert.equal(prepared.usedMapping,'1');
 assert.equal(prepared.objects.find(o=>o.path==='1').suggested,true);
 const classified=classifySmartObjects(prepared.objects,{name:'Black.psd'});
 assert.equal(classified.status,'mapped');
 assert.equal(classified.path,'1');
 assert.ok(classified.objects.every(o=>o.kind==='smart'),'the layer picker needs kind');
 // A placeholder name wins.
 assert.equal(native.prepareFromPsd(readBack(scene(['Room','Frame','Your Design Here']))).usedMapping,'0');
 // Two equally plausible layers: the top one, and the server agrees.
 const two=scene(['A','B','C']);two.children[2].imageData=image(100,120,()=>[150,120,90,255]);
 const topOne=native.prepareFromPsd(readBack(two));
 assert.equal(topOne.needsMapping,false);
 assert.equal(topOne.usedMapping,'0');
 assert.equal(classifySmartObjects(topOne.objects,{name:'Two.psd'}).path,'0');
});

test('the artwork-layer picker also lists layers saved before `kind` was stored',()=>{
 const client=readFileSync(new URL('../src/mockup-generator-client.js',import.meta.url),'utf8');
 assert.match(client,/filter\(t=>\(t\.kind==='smart'\|\|!t\.kind\)&&t\.visible\)/);
 assert.match(client,/some\(x=>\(x\.kind==='smart'\|\|!x\.kind\)&&x\.visible&&x\.path===path\)/);
});

test('an artwork layer in Multiply (and below 100% opacity) blends with the texture under it',needsReader,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const W=200,H=160,quad=[[50,20],[150,20],[150,140],[50,140]];
  const paper=(x,y)=>[230-((x*7+y*3)%40),220-((x*5)%30),210-((y*11)%35)];
  const old=[200,200,200];
  const build=(mode,opacity)=>({width:W,height:H,
   imageData:image(W,H,(x,y)=>{
    const p=paper(x,y);
    if(!inQuad(quad,x,y))return p;
    return p.map((v,i)=>lerp(v,mode==='multiply'?v*old[i]/255:old[i],opacity));
   }),
   children:[
    {name:'Paper',left:0,top:0,right:W,bottom:H,imageData:image(W,H,paper)},
    {name:'Design',blendMode:mode,opacity,left:50,top:20,right:150,bottom:140,imageData:image(100,120,()=>[...old,255]),
     placedLayer:{id:GUID,type:'raster',transform:quad.flat(),width:400,height:500}}
   ],linkedFiles:[{id:GUID,name:'art.png',data:new Uint8Array([1])}]});
  const art=path.join(dir,'art.png');await quadrantArtwork(art);
  for(const [mode,opacity] of [['multiply',1],['normal',0.7]]){
   const psdPath=path.join(dir,mode+'.psd'),out=path.join(dir,mode+'.jpg');
   await fs.writeFile(psdPath,agPsd.writePsdBuffer(build(mode,opacity)));
   const result=await processor.renderMockupOnPC({psdPath,artworkPath:art,outputPath:out,templateName:mode+'.psd',fitMode:'cover'});
   assert.ok(result.fidelity.meanPixelError<2,mode+' '+JSON.stringify(result.fidelity));
   const {at}=await pixels(out);
   for(const [x,y,colour] of [[70,40,QUADRANTS.tl],[130,40,QUADRANTS.tr],[70,120,QUADRANTS.bl],[130,120,QUADRANTS.br]]){
    const p=paper(x,y);
    const expected=p.map((v,i)=>lerp(v,mode==='multiply'?v*colour[i]/255:colour[i],opacity));
    near(at(x,y),expected,12,mode+' at '+x+','+y);
   }
   near(at(10,10),paper(10,10),8,mode+' paper outside');
  }
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('a layer with an out-of-range secondary mask (canvas 2.psd) no longer fails the PSD',needsReader,async()=>{
 const {patchAgPsd}=await import('../worker/patch-ag-psd.mjs');
 assert.ok(patchAgPsd().every(line=>/patched/.test(line)),'the worker patches ag-psd');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-psd-'));
 try{
  const scene=frameScene();
  const wall=scene.psd.children[0];
  // Photoshop writes "real" user masks with bounds far outside the canvas.
  wall.mask={left:0,top:0,right:240,bottom:180,defaultColor:255,imageData:image(240,180,()=>[255,255,255])};
  wall.realMask={left:-20000,top:0,right:20000,bottom:2,defaultColor:255,imageData:image(40000,2,()=>[255,255,255])};
  const psdPath=path.join(dir,'canvas 2.psd'),art=path.join(dir,'art.png'),out=path.join(dir,'out.jpg');
  await fs.writeFile(psdPath,agPsd.writePsdBuffer(scene.psd));
  await quadrantArtwork(art);
  const result=await processor.renderMockupOnPC({psdPath,artworkPath:art,outputPath:out,templateName:'canvas 2.psd'});
  assert.deepEqual(result.dimensions,{width:240,height:180});
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('a paper-texture smart object over the artwork is not mistaken for it (mockup 11.psd)',needsReader,()=>{
 const {psd}=frameScene();
 const art=psd.children[1].children[0];art.name='Layer 4';
 // Same size as the artwork, multiplied over it, named like the real template's layer.
 psd.children.push({name:'imgbin_paper-texture-png',blendMode:'multiply',left:60,top:30,right:180,bottom:160,
  imageData:image(120,130,()=>[240,235,225,255]),
  placedLayer:{id:GUID2,type:'raster',transform:[60,30,180,30,180,160,60,160],width:120,height:130}});
 psd.linkedFiles.push({id:GUID2,name:'paper.png',data:new Uint8Array([1])});
 const prepared=native.prepareFromPsd(readBack(psd));
 assert.equal(prepared.needsMapping,false);
 assert.equal(prepared.usedMapping,'2.1');
});
