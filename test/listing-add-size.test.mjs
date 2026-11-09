// Listings → editor → Add a size: a size the listing does not have yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {planAddSize,addSizeToInventory,parseSizeInput} from '../src/listing-add-size.mjs';
import {ladderEstimate} from '../src/listing-add-size.mjs';
import {SILVIA_RETAIL_PRICE_LADDER_USD,SILVIA_SIZE_LABELS,silviaVariantSku,retailPriceForProductKey,productKeyFromVariationValues,normalizeSize} from '../src/variants.mjs';

const shop={labels:SILVIA_SIZE_LABELS,sku:silviaVariantSku,price:retailPriceForProductKey,productKey:productKeyFromVariationValues,normalizeSize,ladder:SILVIA_RETAIL_PRICE_LADDER_USD};
const STYLES=['Matte Paper Poster','Canvas','Framed Canvas - Matte Black'];
const row=(size,style,price,on=true)=>({sku:on?'SAC0007-x':'',product_id:1,
  property_values:[{property_id:513,property_name:'Size',scale_id:null,value_ids:[1],values:[size]},
    {property_id:514,property_name:'Product - Style',scale_id:null,value_ids:[2],values:[style]}],
  offerings:[{offering_id:9,price:{amount:Math.round(price*100),divisor:100,currency_code:'USD'},quantity:on?999:0,is_enabled:on,readiness_state_id:55}]});
const inventory=()=>({products:[
  ...STYLES.map(s=>row('30x40 cm / 12x16″',s,50)),
  ...STYLES.map(s=>row('60x90 cm / 24x36″',s,150))],
  price_on_property:[513,514],quantity_on_property:[513,514],sku_on_property:[513,514],readiness_state_on_property:[]});
const sizes=inv=>[...new Set(inv.products.map(p=>p.property_values[0].values[0]))];

test('a standard size is suggested with the shop label and ladder prices', () => {
  const plan=planAddSize(shop,inventory(),'18x24');
  assert.equal(plan.size,'18x24');assert.equal(plan.label,SILVIA_SIZE_LABELS['18x24']);assert.equal(plan.standard,true);
  assert.deepEqual(plan.styles.map(s=>s.style),STYLES);
  for(const s of plan.styles)assert.equal(s.suggestedPrice,retailPriceForProductKey(s.key));
});

test('a custom size gets a cm / inch label, no price suggestion, and goes in size order', () => {
  const inv=inventory();
  const plan=planAddSize(shop,inv,'20 x 26');
  assert.equal(plan.label,'51x66 cm / 20x26″');assert.equal(plan.standard,false);
  // Priced from the ladder: between its 18x24 (432 sq in) and 20x30 (600 sq in) prices.
  const L=SILVIA_RETAIL_PRICE_LADDER_USD;
  for(const s of plan.styles){
    const f=s.key.split('|')[0];
    assert.equal(s.estimated,true);
    assert.ok(s.suggestedPrice>L[f]['18x24']&&s.suggestedPrice<L[f]['20x30'],s.style+' '+s.suggestedPrice);
  }
  const {inventory:out,added}=addSizeToInventory(shop,inv,{size:'20x26',artworkId:'SAC0007',quantity:5,
    rows:[{style:'Canvas',enabled:true,price:139.5},{style:'Framed Canvas - Matte Black',enabled:true,price:189},{style:'Matte Paper Poster',enabled:false}]});
  assert.equal(added,2);
  assert.deepEqual(sizes(out),['30x40 cm / 12x16″','51x66 cm / 20x26″','60x90 cm / 24x36″']);
  const added3=out.products.slice(3,6);
  assert.deepEqual(added3.map(p=>p.property_values[1].values[0]),STYLES,'one row per style already on the listing');
  const canvas=added3[1],framed=added3[2],poster=added3[0];
  assert.equal(canvas.sku,'SAC0007-C-2026');assert.equal(framed.sku,'SAC0007-FC-2026-BLK');assert.equal(poster.sku,'');
  assert.deepEqual(canvas.offerings,[{price:139.5,quantity:5,is_enabled:true,readiness_state_id:55}]);
  assert.deepEqual(poster.offerings,[{price:50,quantity:0,is_enabled:false,readiness_state_id:55}],'off, at the lowest price');
  assert.deepEqual(canvas.property_values.map(p=>[p.property_id,p.property_name,p.value_ids.length]),[[513,'Size',0],[514,'Product - Style',0]]);
  assert.equal(inv.products.length,6,'the original inventory is not changed');
  // A larger size than any goes last.
  assert.deepEqual(sizes(addSizeToInventory(shop,inv,{size:'30x40',rows:[{style:'Canvas',enabled:true,price:300}]}).inventory).at(-1),SILVIA_SIZE_LABELS['30x40']);
});

test('ladder estimates: same shape, by area, beyond the ends by price per square inch', () => {
  const ladder={C:{'12x16':100,'24x36':300,'10x10':80,'20x20':200,'10x30':150}};
  assert.equal(ladderEstimate(ladder,'C','18x24'),Number((100+200*(432-192)/(864-192)).toFixed(2)));
  assert.equal(ladderEstimate(ladder,'C','30x45'),Number((300*1350/864).toFixed(2)));
  assert.equal(ladderEstimate(ladder,'C','15x15'),Number((80+120*(225-100)/300).toFixed(2)),'squares priced from squares');
  assert.equal(ladderEstimate(ladder,'X','18x24'),null);
});

test('refuses what it should', () => {
  assert.throws(()=>planAddSize(shop,inventory(),'24x36'),/already on this listing/);
  assert.throws(()=>parseSizeInput('24x36x2'),/whole inches/);
  assert.throws(()=>parseSizeInput('2x3'),/4 to 99/);
  assert.throws(()=>parseSizeInput('24.5x36'),/whole inches/);
  assert.throws(()=>planAddSize(shop,{products:[{property_values:[{property_name:'Colour',values:['Red']}],offerings:[]}]},'18x24'),/not Size and Product - Style/);
  assert.throws(()=>addSizeToInventory(shop,inventory(),{size:'18x24',rows:[{style:'Canvas',enabled:false}]}),/at least one style/);
  assert.throws(()=>addSizeToInventory(shop,inventory(),{size:'18x24',rows:[{style:'Canvas',enabled:true,price:0}]}),/price/);
  assert.throws(()=>addSizeToInventory(shop,inventory(),{size:'18x24',rows:[{style:'Neon',enabled:true,price:9}]}),/Unknown style/);
  assert.throws(()=>addSizeToInventory(shop,inventory(),{size:'18x24',quantity:0,rows:[{style:'Canvas',enabled:true,price:9}]}),/Quantity/);
});

test('the editor previews, then adds with the confirmation and the inventory fingerprint', () => {
  const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.match(server,/\(details\|inventory\|options\|add-size\)/);
  assert.match(server,/if\(input\.preview===true\)return sendJson\(res,200,\{ok:true,plan:planAddSize\(shop,existing,input\.size\)\}\);/);
  assert.match(server,/input\.confirm!=='ADD SILVIA SIZE'/);
  assert.match(server,/input\.fingerprint!==inventoryEditorFingerprint\(existing\)\)\s*return sendJson\(res,409/);
  const client=readFileSync(new URL('../src/listings-client.js',import.meta.url),'utf8');
  assert.doesNotThrow(()=>new vm.Script(client));
  assert.match(client,/confirm:'ADD SILVIA SIZE',\s*fingerprint:current\.inventoryHash/);
  const page=readFileSync(new URL('../src/listings-page.mjs',import.meta.url),'utf8');
  assert.match(server,/const crop=await ensureSizeCrop\(artworkId,result\.plan\.size\)/);
  assert.match(server,/if\(ratio&&fulfillmentRatiosForOrientation\(manifest\.orientation,manifest\.master\)\.includes\(ratio\)\)/);
  assert.match(server,/await createCropJob\(\{artworkId,masterKey:manifest\.master\.key,orientation:manifest\.orientation,\s*width:manifest\.master\.width,height:manifest\.master\.height,size\}\)/);
  for(const id of ['add-size-input','add-size-preview','add-size-rows','add-size-save','add-size-status'])assert.ok(page.includes('id=\\"'+id+'\\"'),id);
});
