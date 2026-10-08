import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkIdFromInventory,cropOutputKeyForJob,isStagedRevisionJob} from '../src/artwork-revision.mjs';
test('revisions preserve the exact artwork ID from all enabled variant SKUs',()=>{
 const products={products:[
  {sku:'SAC0001-P-2436',offerings:[{is_enabled:true}]},
  {sku:'SAC0001-FC-2436-BRN',offerings:[{is_enabled:true}]}
 ]};
 assert.equal(artworkIdFromInventory(products),'SAC0001');
 assert.throws(()=>artworkIdFromInventory({products:[{sku:'legacy_123',offerings:[{is_enabled:true}]}]}),/converted/);
});
test('revision crop output keys are immutable and do not overwrite active artwork',()=>{
 const job={artworkId:'SAC0001',masterKey:'artworks/SAC0001/revisions/135db7a1-7a45-4f70-8c0c-826548f60767/master.jpg'};
 assert.equal(isStagedRevisionJob(job),true);
 assert.equal(cropOutputKeyForJob(job,'2x3'),
   'artworks/SAC0001/revisions/135db7a1-7a45-4f70-8c0c-826548f60767/fulfillment/2x3.jpg');
 assert.equal(cropOutputKeyForJob({artworkId:'SAC0001',masterKey:'artworks/SAC0001/master.jpg'},'2x3'),
   'artworks/SAC0001/fulfillment/2x3.jpg');
 assert.throws(()=>cropOutputKeyForJob(job,'wrong'),/Invalid/);
});
