import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {originalEtsyCreationTimestamp,sortConverterListingsOldestFirst} from '../src/converter-listing-order.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('original listing creation date ignores Etsy renewal and last-updated date',()=>{
 const renewed={listingId:101,title:'First artwork',original_creation_timestamp:1577836800,
   creation_timestamp:1800000000,updated_timestamp:1900000000};
 const recent={listingId:102,title:'New artwork',original_creation_timestamp:1767225600,
   creation_timestamp:1767225600,updated_timestamp:1767225600};
 assert.equal(originalEtsyCreationTimestamp(renewed),1577836800);
 assert.deepEqual(sortConverterListingsOldestFirst([recent,renewed]).map(v=>v.listingId),[101,102]);
});

test('sorts all listings oldest to newest, including drafts, with stable fallback',()=>{
 const records=[
  {listingId:600,original_creation_timestamp:1500000200,state:'active'},
  {listingId:610,original_creation_timestamp:1500000100,state:'draft'},
  {listingId:20},
  {listingId:12},
  {listingId:605,original_creation_timestamp:1500000100}
 ];
 assert.deepEqual(sortConverterListingsOldestFirst(records).map(x=>x.listingId),[605,610,600,12,20]);
 assert.equal(originalEtsyCreationTimestamp({original_creation_tsz:1510000000}),1510000000);
 assert.equal(originalEtsyCreationTimestamp({created_timestamp:1520000000}),1520000000);
 assert.equal(originalEtsyCreationTimestamp({original_creation_timestamp:1510000000000}),1510000000);
 assert.equal(originalEtsyCreationTimestamp({}),null);
 assert.deepEqual(sortConverterListingsOldestFirst([{listingId:800,originalCreationTimestamp:1700000000},{listingId:900,originalCreationTimestamp:1600000000}]).map(x=>x.listingId),[900,800]);
 assert.deepEqual(records.map(x=>x.listingId),[600,610,20,12,605],'source array unchanged');
});

test('converter sorts by true original timestamp rather than Etsy updated order',()=>{
 const server=read('src/server.mjs'),ui=read('src/listing-converter-page.mjs');
 const start=server.indexOf('async function converterListingRows(session)');
 const end=server.indexOf('function sendJson(',start);
 assert.ok(start!==-1&&end>start);
 const fragment=server.slice(start,end);
 assert.ok(fragment.includes('originalCreationTimestamp: originalEtsyCreationTimestamp(listing)'));
 assert.ok(fragment.includes('return { listings: sortConverterListingsOldestFirst(rows), converterMap };'));
 assert.ok(ui.includes('Oldest originally listed first'));
 assert.ok(ui.includes('item.originalListedAt'));
});
