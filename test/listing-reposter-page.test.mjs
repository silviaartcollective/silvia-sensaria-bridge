import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderListingReposterPage} from '../src/listing-reposter-page.mjs';
test('reposter admin editor renders valid client JavaScript and a two-step workflow',()=>{
 const html=renderListingReposterPage('Test Shop');
 assert.match(html,/Listing Reposter/);
 assert.match(html,/Prepare replacement draft/);
 assert.match(html,/Publish new listing and deactivate old/);
 assert.match(html,/mockups.*type="file"|type="file".*multiple/);
 assert.ok(html.includes('Test Shop'));
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match,'client script present');
 assert.doesNotThrow(()=>new vm.Script(match[1]));
});
