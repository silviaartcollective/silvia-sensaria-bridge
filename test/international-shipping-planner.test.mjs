import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  previewShippingCountry,internationalShippingPreview,listingWorstCaseShippingPreview
} from '../src/international-shipping-planner.mjs';

test('40x60 large framed canvas respects different Sensaria zone shipping rates',()=>{
  const rates={US:0,GB:0,CA:75,DE:75,AU:5,NZ:150,JP:600};
  for(const [country,cost] of Object.entries(rates)){
    const row=previewShippingCountry({format:'FC',size:'40x60',country});
    assert.equal(row.capturedBasicShippingUsd,cost,country);
    assert.equal(row.group,'Canvas Large');
  }
});
test('high-priced routes and undeliverable countries stay excluded',()=>{
  const jp=previewShippingCountry({country:'JP',format:'FC',size:'40x60'});
  assert.equal(jp.candidate,false);
  assert.equal(jp.estimatedCustomerShippingUsd,null);
  const ru=previewShippingCountry({country:'RU',format:'FC',size:'40x60'});
  assert.equal(ru.candidate,false);
  assert.equal(ru.capturedBasicShippingUsd,null);
  const nz=previewShippingCountry({country:'NZ',format:'FC',size:'40x60'});
  assert.equal(nz.candidate,true);
  assert.ok(nz.estimatedCustomerShippingUsd>150);
});
test('US pricing flags Alaska/Hawaii as different from mainland',()=>{
  const us=previewShippingCountry({country:'US',format:'FC',size:'40x60'});
  assert.ok(us.reasons.some(reason=>/Alaska and Hawaii/i.test(reason)));
  const alaska=previewShippingCountry({country:'US',state:'AK',format:'FC',size:'40x60'});
  assert.equal(alaska.zone,'3A');
  assert.equal(alaska.capturedBasicShippingUsd,150);
});
test('world preview is read-only, refuses antique country codes, and warns about taxes',()=>{
  const result=internationalShippingPreview({format:'FC',size:'40x60'});
  assert.equal(result.updatedEtsy,false);
  assert.equal(result.previewOnly,true);
  assert.ok(result.summary.notCovered>0);
  assert.ok(result.summary.unverifiedTaxes>0);
  assert.ok(result.countries.find(x=>x.country==='JP'));
  assert.equal(result.countries.find(x=>x.country==='XZ').candidate,false);
});
test('listing-level conservative exposure is required when one Etsy profile covers all SKU variations',()=>{
  const exposure=listingWorstCaseShippingPreview({country:'JP'});
  assert.ok(exposure.variantCount>10);
  assert.equal(exposure.safeToAutoPublish,false);
  assert.ok(exposure.worstCase||exposure.unknownRateVariants.length);
});
test('preview routes never update Etsy or supplier data',()=>{
  const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.match(server,/url\.pathname==='\/api\/international-shipping\/preview'/);
  assert.match(server,/internationalShippingPreview\(options\)/);
  assert.match(server,/readOnly:true/);
  assert.match(server,/url\.pathname==='\/international-shipping'/);
});
