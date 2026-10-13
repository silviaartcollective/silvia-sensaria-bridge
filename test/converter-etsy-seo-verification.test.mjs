import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {listingSeoPreservation,describeEtsyDescriptionDifference} from '../src/converter-description.mjs';

const source=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function ensureConverterListingSeo(');
const end=source.indexOf('async function performListingConversion(body)');
assert.ok(start>0&&end>start,'converter SEO verifier must be present');

function setup(initial,{ignoreWrites=false}={}){
 let current={...initial},writes=[];
 const ctx=vm.createContext({
  getListing:async()=>({...current}),
  listingSeoPreservation,describeEtsyDescriptionDifference,
  withEtsyListingRetry:async fn=>fn(),
  updateListing:async args=>{
   writes.push({...args.listing});
   if(!ignoreWrites)current={...current,...args.listing};
  },
  sleepMs:async()=>{},
  Number,Error,String,Promise
 });
 vm.runInContext(source.slice(start,end)+'\nglobalThis.ensure=ensureConverterListingSeo;',ctx);
 return {ensure:ctx.ensure,writes,current:()=>current};
}
const expected='Floral SEO text\nhttps://www.etsy.com/shop/SilviaArtCollective?ref=dashboard-header&section_id=60115369';

test('Etsy entity escaping is treated as equivalent and does not trigger unnecessary updates',async()=>{
 const f=setup({description:expected.replace('&section_id=','&amp;section_id='),shop_section_id:49});
 await f.ensure({shop:{shop_id:1},keystring:'k',sharedSecret:'s',accessToken:'t'},123,expected,49);
 assert.equal(f.writes.length,0);
});

test('missing original shop link is restored and shop section ID is verified',async()=>{
 const f=setup({description:'Only part of the description',shop_section_id:7});
 const after=await f.ensure({shop:{shop_id:1},keystring:'k',sharedSecret:'s',accessToken:'t'},123,expected,49);
 assert.deepEqual(JSON.parse(JSON.stringify(f.writes)),[{description:expected,shop_section_id:49}]);
 assert.equal(after.description,expected);
 assert.equal(after.shop_section_id,49);
});

test('persistent real description loss is not silently classified as preserved',async()=>{
 const f=setup({description:'Only part',shop_section_id:49},{ignoreWrites:true});
 await assert.rejects(()=>f.ensure({shop:{shop_id:1},keystring:'k',sharedSecret:'s',accessToken:'t'},123,expected,49),/At text character/);
 assert.equal(f.writes.length,1);
});
