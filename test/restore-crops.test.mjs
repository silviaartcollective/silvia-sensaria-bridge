// Crops the manifest lost but status.json still has are put back, only when
// they were made from the current master and their files are in R2.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {restoreRatiosFromStatus} from '../src/fulfillment-assets.mjs';

const ID='SAC0021',MASTER='artworks/SAC0021/master.jpg';
const asset=(ratio,extra={})=>({ratio,key:'artworks/SAC0021/fulfillment/'+ratio+'.jpg',width:3600,height:4800,orientation:'portrait',
  productionReady:true,sourceMasterKey:MASTER,...extra});
const manifest=()=>({artworkId:ID,orientation:'portrait',master:{key:MASTER,width:9000,height:12000}});
function deps({status,files=null,latest=manifest()}){
  const saved=[];
  return {saved,getJsonObject:async()=>status,artworkObjectExists:async key=>files?files.includes(key):true,
    updateArtworkManifest:async(id,mutate)=>{const doc=JSON.parse(JSON.stringify(latest));mutate(doc);saved.push(doc);return doc;}};
}
const ALL=['2x3','3x4','4x5','11x14','5x7','14x15'];

test('restores the crops from status.json made from the current master', async () => {
  const d=deps({status:{status:'completed',assets:Object.fromEntries(ALL.map(r=>[r,asset(r)]))}});
  const out=await restoreRatiosFromStatus(ID,manifest(),d);
  assert.deepEqual(Object.keys(out.fulfillmentRatios).sort(),[...ALL].sort());
  assert.equal(out.fulfillmentRatios['3x4'].productionReady,true);
  assert.ok(out.fulfillmentRatios['3x4'].restoredFromStatusAt);
  assert.equal(out.fulfillmentRatiosReady,true);
});

test('never restores crops of an earlier master, missing files, wrong keys or an unfinished run', async () => {
  const old=deps({status:{status:'completed',assets:{'3x4':asset('3x4',{sourceMasterKey:'artworks/SAC0021/old.jpg'})}}});
  assert.equal(await restoreRatiosFromStatus(ID,manifest(),old),null);
  assert.equal(old.saved.length,0);
  assert.equal(await restoreRatiosFromStatus(ID,manifest(),deps({status:{status:'completed',assets:{'3x4':asset('3x4')}},files:[]})),null);
  assert.equal(await restoreRatiosFromStatus(ID,manifest(),deps({status:{status:'completed',assets:{'3x4':asset('3x4',{key:'artworks/SAC0022/fulfillment/3x4.jpg'})}}})),null);
  assert.equal(await restoreRatiosFromStatus(ID,manifest(),deps({status:{status:'processing',assets:{'3x4':asset('3x4')}}})),null);
  assert.equal(await restoreRatiosFromStatus(ID,manifest(),deps({status:{status:'completed',assets:{'3x4':asset('3x4',{width:4800,height:3600})}}})),null,'landscape file for a portrait master');
  // The master changed meanwhile: nothing is written.
  await assert.rejects(restoreRatiosFromStatus(ID,manifest(),deps({status:{status:'completed',assets:{'3x4':asset('3x4')}},
    latest:{...manifest(),master:{key:'artworks/SAC0021/new.jpg'}}})),/master changed/);
});

test('orders use it before giving up, and the message says how to fix it', () => {
  const src=readFileSync(new URL('../src/fulfillment-assets.mjs',import.meta.url),'utf8');
  assert.match(src,/const repaired = await restoreRatiosFromStatus\(id, manifest\)/);
  assert.match(src,/click Regenerate crops from stored master/);
});
