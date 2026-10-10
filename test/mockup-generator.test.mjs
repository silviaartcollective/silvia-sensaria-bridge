import test from 'node:test';
import assert from 'node:assert/strict';
import {knownMockupArtworkTarget,classifySmartObjects,max24MP,safeFilename,outputFileName,validateMappingPath} from '../src/mockup-generator.mjs';
test('verified close-up artwork is layer 5; other ambiguous layers require review',()=>{
 for(const name of ['Vertical Close up framed black mockup.psd','Vertical Close up framed dark wood mockup.psd','Vertical Close up framed light wood mockup.psd']){
  assert.equal(knownMockupArtworkTarget(name),'5');
  const selection=classifySmartObjects([{path:'Scene/1',name:'1',kind:'smart',visible:true},{path:'5',name:'5',kind:'smart',visible:true}],{name});
  assert.equal(selection.path,'5');
 }
 assert.equal(classifySmartObjects([{path:'A',name:'A',kind:'smart',visible:true},{path:'B',name:'B',kind:'smart',visible:true}],{name:'Other.psd'}).status,'needs_mapping');
 assert.equal(classifySmartObjects([{path:'A',name:'A',kind:'smart',visible:true},{path:'B',name:'B',kind:'smart',visible:false}],{name:'Other.psd'}).path,'A');
});
test('24MP downscale preserves aspect; correct naming, strict ids',()=>{
 assert.deepEqual(max24MP(4000,6000),{width:4000,height:6000});
 const result=max24MP(6000,8000);
 assert.ok(result.width*result.height<=24000000);
 assert.ok(Math.abs(result.width/result.height-.75)<.0003);
 assert.equal(outputFileName('Blue Framed Canvas.psb'),'Blue Framed Canvas.jpg');
 assert.equal(safeFilename('../'),'.._');
 assert.equal(validateMappingPath('5'),'5');
});
