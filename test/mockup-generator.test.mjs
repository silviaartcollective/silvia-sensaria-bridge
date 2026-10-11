import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {knownMockupArtworkTarget,classifySmartObjects,max24MP,safeFilename,outputFileName,validateMappingPath,markMockupItemFailed} from '../src/mockup-generator.mjs';
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

test('late worker errors never overwrite a verified JPG',()=>{
 const completed={status:'completed',outputKey:'already-verified.jpg',
  dimensions:{width:4000,height:6000},error:null,progress:'Ready'};
 const before=structuredClone(completed);
 assert.equal(markMockupItemFailed(completed,'ReferenceError: startedAt is not defined'),false);
 assert.deepEqual(completed,before);
 assert.throws(()=>markMockupItemFailed({status:'queued'},'stale error'),/not claimed for processing/);
 const running={status:'processing',error:null};
 assert.equal(markMockupItemFailed(running,'PSD load failed',false),true);
 assert.equal(running.status,'failed');
 assert.equal(running.error,'PSD load failed');
 const needsMapping={status:'processing',error:null};
 assert.equal(markMockupItemFailed(needsMapping,'Select visible artwork layer',true),true);
 assert.equal(needsMapping.status,'needs_mapping');
});
test('PC PSD worker records start time and cannot fail an already-completed upload',()=>{
 const worker=readFileSync(new URL('../worker/index.mjs',import.meta.url),'utf8');
 assert.match(worker,/async function processPSDJob\(app,claim\)\{\s*const startedAt=Date\.now\(\);/);
 assert.match(worker,/await queue\(\(\)=>api\.mockupComplete[\s\S]*?completionRecorded=true;/);
 assert.match(worker,/catch\(error\)\{\s*if\(completionRecorded\)\{/);
});
