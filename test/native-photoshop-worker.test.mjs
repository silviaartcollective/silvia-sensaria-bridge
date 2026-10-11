import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {cacheKeyFor} from '../worker/asset-cache.mjs';
import {photoshopConfig,NativePhotoshopUnavailable} from '../worker/native-photoshop.mjs';

test('R2 artwork cache keys are isolated per shop and immutable asset',()=>{
 const base={shop:'https://silvia.test',id:'template-1',key:'psds/a.psd',size:194000000};
 const key=cacheKeyFor(base);
 assert.equal(key,cacheKeyFor({...base}));
 assert.notEqual(key,cacheKeyFor({...base,shop:'https://japandi.test'}));
 assert.notEqual(key,cacheKeyFor({...base,key:'psds/b.psd'}));
 assert.equal(key.length,64);
});
test('Photoshop native config uses known Smart Object mapping name',()=>{
 const cfg=photoshopConfig({psdPath:'A.psd',artworkPath:'B.jpg',outputPath:'C.jpg',
  templateName:'mockup 19.psd',mapping:{path:'2'},
  smartObjects:[{path:'0',name:'mockup 1 (1)',visible:false},
   {path:'2',name:'5',visible:true}],fitMode:'contain',stagePath:'status.txt',reportPath:'result.json'});
 assert.equal(cfg.mappingName,'5');
 assert.equal(cfg.mappingPath,'2');
 assert.equal(cfg.fitMode,'contain');
 assert.ok(new NativePhotoshopUnavailable() instanceof Error);
});
test('native JSX selects visible Smart Object 5, exports JPG, keeps hidden layers hidden',()=>{
 let code=readFileSync(new URL('../worker/photoshop-native.jsx',import.meta.url),'utf8');
 const cfg={psd:'template.psd',artwork:'master.jpg',output:'output.jpg',
  stage:'stage.txt',report:'result.json',templateName:'mockup 19.psd',
  fitMode:'contain',mappingPath:'5',mappingName:''};
 code=code.replace(/^#target photoshop\s*/,'').replace('__MOCKUP_CONFIGURATION__',JSON.stringify(cfg));
 const data=new Map(),dim=n=>({as:()=>n}),calls=[];
 const hidden={name:'mockup 1 (1)',typename:'ArtLayer',kind:2,visible:false};
 const smart={name:'5',typename:'ArtLayer',kind:2,visible:true};
 const placeholder={name:'old',typename:'ArtLayer',kind:1,visible:true};
 const parent={layers:[hidden,{name:'Background',typename:'ArtLayer',kind:1,visible:true},smart],
  width:dim(4985),height:dim(4985),mode:1,bitsPerChannel:8,
  resizeImage(w,h){this.width=dim(w.value);this.height=dim(h.value)},
  saveAs(f){calls.push(['saveAs',f.name])},close(){calls.push(['closePSD'])}};
 const child={layers:[placeholder],width:dim(1200),height:dim(900),
  save(){calls.push(['saveSmartObject'])},close(){app.activeDocument=parent}};
 const source={name:'artwork',typename:'ArtLayer',kind:1,visible:true,
  bounds:[dim(0),dim(0),dim(800),dim(1200)],
  duplicate(doc){
   const copy={name:'Inserted',visible:true,bounds:[dim(0),dim(0),dim(800),dim(1200)],
    resize(f){this.bounds=[dim(0),dim(0),dim(800*f/100),dim(1200*f/100)]},
    translate(){}};
   doc.layers.unshift(copy);return copy;
  }};
 const art={layers:[source],activeLayer:source,close(){},flatten(){}};
 const app={displayDialogs:0,activeDocument:null,
  open(f){this.activeDocument=f.name.endsWith('.psd')?parent:art;return this.activeDocument}};
 class File{constructor(name){this.name=name}open(){return true}write(value){data.set(this.name,value)}close(){}}
 vm.runInNewContext(code,{app,File,
  executeAction(){app.activeDocument=child},stringIDToTypeID:x=>x,
  LayerKind:{SMARTOBJECT:2},DialogModes:{NO:0},SaveOptions:{DONOTSAVECHANGES:1},
  ElementPlacement:{PLACEATBEGINNING:1},AnchorPosition:{MIDDLECENTER:1},
  UnitValue:n=>({value:n}),JPEGSaveOptions:function(){},
  Extension:{LOWERCASE:1},DocumentMode:{RGB:1},ChangeMode:{RGB:1},
  BitsPerChannelType:{EIGHT:8},ResampleMethod:{BICUBIC:1}});
 const result=JSON.parse(data.get('result.json'));
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.needsMapping,false);
 assert.equal(result.usedMapping,'2');
 assert.equal(result.visibilityVerified,true);
 assert.equal(result.artworkReplaced,true);
 assert.equal(hidden.visible,false);
 assert.ok(result.dimensions.width*result.dimensions.height<=24000000);
 assert.ok(calls.some(c=>c[0]==='saveAs'&&c[1]==='output.jpg'));
 assert.ok(calls.some(c=>c[0]==='saveSmartObject'));
 assert.ok(!calls.some(c=>c[0]==='saveAs'&&c[1]==='template.psd'));
});
test('worker prefers installed Photoshop and retains Photopea fallback',()=>{
 const processor=readFileSync(new URL('../worker/mockup-processor.mjs',import.meta.url),'utf8');
 const runner=readFileSync(new URL('../worker/index.mjs',import.meta.url),'utf8');
 assert.ok(processor.includes('renderMockupWithPhotoshop'));
 assert.ok(processor.includes('NativePhotoshopUnavailable'));
 assert.ok(processor.includes('Photopea fallback'));
 assert.ok(runner.includes('downloadCached'));
 assert.ok(runner.includes('smartObjects:claim.template.smartObjects'));
});
