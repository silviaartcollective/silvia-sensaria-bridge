import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderListingReposterPage} from '../src/listing-reposter-page.mjs';
import {renderDashboard} from '../src/dashboard.mjs';
test('same-SKU artwork source editor and crop worker live polling render valid JavaScript',()=>{
 const page=renderListingReposterPage('Art Shop');
 for(const id of ['artwork-mode','artwork-upload','crop-start','crop-progress','crop-worker-status'])
  assert.ok(page.includes('id="'+id+'"'),id);
 assert.ok(page.includes('/api/crop-worker/status'));
 assert.ok(page.includes('/artwork/crop'));
 const script=page.match(/<script>([\s\S]+?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script[1]));
});
