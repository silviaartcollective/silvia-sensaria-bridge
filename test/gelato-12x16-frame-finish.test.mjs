import test from 'node:test';
import assert from 'node:assert/strict';
import {scanGelatoComparisonRows,__test as gelato} from '../src/gelato-comparison.mjs';

test('Gelato trusts a real frame-color attribute instead of unrelated color words in the UID',()=>{
 const product={productUid:'framed_canvas_12x16-inch_black_backing',
   attributes:{FrameColor:'White',CanvasFormat:'12x16-inch'}};
 const catalog={catalogUid:'framed-canvas',title:'Framed Canvas'};
 assert.equal(gelato.productFinish(product,catalog),'white');
 assert.equal(gelato.sizeCompatible(product,gelato.parseTargetSize('12x16')),true);
 assert.equal(gelato.finishCompatible({productCode:'FC',finish:'White'},product,catalog),true);
 assert.equal(gelato.finishCompatible({productCode:'FC',finish:'Brown'},product,catalog),false);
});

test('12x16 Gelato size remains available for correct frame finish; mismatched finish is not called a missing size',async()=>{
 const originalFetch=globalThis.fetch, originalKey=process.env.GELATO_API_KEY;
 process.env.GELATO_API_KEY='test-only-no-external-request';
 const uid='framed_canvas_12x16-inch_black_backing';
 const response=body=>({ok:true,status:200,text:async()=>JSON.stringify(body)});
 globalThis.fetch=async(url,options={})=>{
  const href=String(url);
  if(href.endsWith('/v3/catalogs'))return response([{catalogUid:'framed-canvas',title:'Framed Canvas'}]);
  if(href.endsWith('/v3/catalogs/framed-canvas'))
   return response({catalogUid:'framed-canvas',title:'Framed Canvas',
    productAttributes:[{productAttributeUid:'CanvasFormat',
      values:[{productAttributeValueUid:'12x16-inch',title:'12x16 inch'}]}]});
  if(href.endsWith('/v3/catalogs/framed-canvas/products:search'))
   return response({products:[{productUid:uid,
    attributes:{CanvasFormat:'12x16-inch',FrameColor:'White'},
    supportedCountries:['CA']}]});
  if(href.includes('/v3/products/')&&href.includes('/prices'))
   return response([{productUid:uid,country:'CA',quantity:1,price:27,currency:'USD'}]);
  if(href.endsWith('/v1/prices:search'))return response({prices:[{
   productUid:uid,quantities:[{quantity:1,methods:[{
    type:'normal',avgPrice:9,minPrice:7
   }]}]}]});
  throw Error('Unexpected mocked Gelato request '+href);
 };
 try{
  const rows=[
   {productCode:'FC',size:'12x16',finish:'White'},
   {productCode:'FC',size:'12x16',finish:'Brown'}
  ];
  const result=await scanGelatoComparisonRows({rows,countryCode:'CA',fresh:true});
  const white=result.get('FC|12x16|white'),brown=result.get('FC|12x16|brown');
  assert.equal(white.status,'available');
  assert.equal(white.totalUsd,36);
  assert.equal(brown.status,'finish-no-match');
  assert.equal(brown.meta.matchingSizeProductCount,1);
  assert.match(brown.reason,/HAS 12x16/);
  assert.match(brown.reason,/NOT an unavailable size/);
 }finally{
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.GELATO_API_KEY;
  else process.env.GELATO_API_KEY=originalKey;
 }
});
