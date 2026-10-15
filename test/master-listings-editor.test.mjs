import test from 'node:test';
import assert from 'node:assert/strict';
import {
  masterListingTags,listingEditorFields,listingEditorFingerprint,
  validateMasterListingEdit,inventoryEditorRows,inventoryEditorFingerprint,
  applyInventoryEditorChanges
} from '../src/master-listings.mjs';
import {renderListingsPage} from '../src/listings-page.mjs';
import {readFileSync} from 'node:fs';

const old={listing_id:123,shop_id:456,title:'Original title',description:'Original description with section link',
 tags:['wall art','neutral painting'],shop_section_id:1234};
const inv={products:[{product_id:901,sku:'SAC0007-FC-4060-BLK',property_values:[
 {property_name:'Size',values:['40x60']},{property_name:'Style',values:['Framed Canvas Black']}],
 offerings:[{price:{amount:12500,divisor:100},quantity:6,is_enabled:true,readiness_state_id:1}]}],
 price_on_property:[1],quantity_on_property:[],sku_on_property:[]};

test('metadata validates limits, edits only named Etsy listing fields and preserves existing content',()=>{
 const copy=JSON.parse(JSON.stringify(old));
 const before=listingEditorFingerprint(old);
 const edit=validateMasterListingEdit({
  title:'New listing title',description:old.description,tags:['wall art','neutral painting'],
  shopSectionId:old.shop_section_id
 },old);
 assert.deepEqual(edit.patch,{title:'New listing title'});
 assert.equal(listingEditorFingerprint(old),before);
 assert.deepEqual(old,copy);
 assert.equal(listingEditorFields(old).shopSectionId,1234);
 assert.throws(()=>masterListingTags(Array(14).fill('duplicate')),/13/);
 assert.throws(()=>masterListingTags(['duplicate','Duplicate']),/Duplicate/);
 assert.throws(()=>masterListingTags(['a'.repeat(21)]),/20/);
 assert.throws(()=>validateMasterListingEdit({...edit.next,title:''},old),/Title/);
 assert.throws(()=>validateMasterListingEdit({...edit.next,description:''},old),/Description/);
});

test('variation changes preserve immutable SKUs and variation definitions',()=>{
 const first=inventoryEditorFingerprint(inv);
 const changed=applyInventoryEditorChanges(inv,[{
  productIndex:0,offeringIndex:0,productId:901,sku:'SAC0007-FC-4060-BLK',
  price:155.95,quantity:4,enabled:true
 }]);
 assert.equal(changed.products[0].sku,inv.products[0].sku);
 assert.deepEqual(changed.products[0].property_values,inv.products[0].property_values);
 assert.equal(changed.products[0].offerings[0].price,155.95);
 assert.equal(changed.products[0].offerings[0].quantity,4);
 assert.equal(inventoryEditorRows(inv)[0].offerings[0].price,125);
 assert.equal(inventoryEditorFingerprint(inv),first);
 assert.notEqual(inventoryEditorFingerprint(changed),first);
 assert.throws(()=>applyInventoryEditorChanges(inv,[{productIndex:0,offeringIndex:0,
  productId:901,sku:'WRONG',price:155,quantity:4,enabled:true}]),/changed/);
 assert.throws(()=>applyInventoryEditorChanges(inv,[{productIndex:0,offeringIndex:0,
  productId:901,sku:'SAC0007-FC-4060-BLK',price:-1,quantity:4,enabled:true}]),/prices/);
});

test('Listings tab is Silvia-only and converter stays in its tab',()=>{
 const html=renderListingsPage();
 assert.match(html,/Master Listings/);
 assert.match(html,/Gelato → Silvia Converter/);
 assert.match(html,/id="edit-title"/);
 assert.match(html,/id="save-variants"/);
 assert.match(html,/id="converter-frame"/);
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(server,/url.pathname==='\/listings'/);
 assert.match(server,/url.pathname==='\/api\/master-listings'/);
 assert.match(server,/listingEditorFingerprint\(fresh\)/);
 assert.match(server,/inventoryEditorFingerprint\(existing\)/);
 assert.match(server,/getListing\(\{listingId:id/);
 assert.match(server,/Number\(fresh\?\.shop_id\)!==Number\(session.shop.shop_id\)/);
 assert.match(server,/listing:edit.patch/);
 assert.match(server,/renderListingConverterPage\(\)\.replace/);
});
