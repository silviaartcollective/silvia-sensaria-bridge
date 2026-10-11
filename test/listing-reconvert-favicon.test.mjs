import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderListingConverterPage} from '../src/listing-converter-page.mjs';
import {hasAuthorizedConverterLink} from '../src/listing-converter-link.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('reconvert requires a newly uploaded master and new production crops',()=>{
 const html=renderListingConverterPage();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,'converter must contain an executable client script');
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.ok(html.includes("item.converted?'Reconvert listing':'Upload artwork & convert'"));
 assert.ok(html.includes("item.converted?reconvertListing(item,card):convertListing(item,card)"));
 assert.ok(html.includes('async function reconvertListing(item,card)'));
 assert.ok(html.includes('Upload the master artwork again (required)'));
 assert.ok(html.includes('Upload replacement master artwork (required)'));
 assert.ok(html.includes("const file=input?.files?.[0]"));
 assert.ok(html.includes('if(!file){'));
 assert.ok(html.includes("'/api/listing-converter/reconvert/reserve'"));
 assert.ok(html.includes("'/api/listing-converter/reconvert/crop'"));
 assert.ok(html.includes("await waitForCrop(result.job.id"));
 assert.ok(html.includes('await queuedConversion(item,card,'));
 assert.ok(html.includes('reconvert:true'));
 assert.ok(html.includes('async function refreshConversionQueue()'));
 assert.ok(html.includes('Remove from queue'));
 assert.ok(html.includes("const file=input.files?.[0];"));
 assert.ok(html.includes('const file=input.files?.[0];'),'initial conversion remains available');
 assert.ok(!html.includes("(item.converted?'disabled':'')"),'converted listing is not disabled');
});

test('reconversion reuses mapped artwork and prevents cross-listing mutations',()=>{
 const server=read('src/server.mjs');
 assert.ok(server.includes("const reconvert = body.reconvert === true;"));
 assert.ok(server.includes('prior.artworkId !== artworkId'));
 assert.ok(server.includes("prior.status !== 'converted'"));
 assert.ok(server.includes('Use the Reconvert listing button'));
 assert.ok(server.includes('reconversionHistory'));
 assert.ok(server.includes('reconversionCount'));
 assert.ok(server.includes('saved?.convertedAt || finishedAt'));
 assert.ok(server.includes('hasAuthorizedConverterLink({'));
 assert.ok(server.includes('sourceListingId: manifest.sourceEtsyListingId'));
 assert.ok(server.includes("cropJob.status !== 'completed'"));
 assert.ok(server.includes('assertConverterArtworkReady({'));
 assert.ok(server.includes('activateConverterArtworkRevision({'));
 assert.ok(server.includes("const cropJobId = String(reconvert?replacement.record.jobId"));
 assert.ok(server.includes('replacementMasterActivated:reconvert'));
 assert.ok(server.includes("url.pathname==='/api/listing-converter/reconvert/reserve'"));
 assert.ok(server.includes("url.pathname==='/api/listing-converter/reconvert/crop'"));
 assert.ok(server.includes("badSkus.length"),'postconversion SKUs must be verified');
 assert.ok(server.includes("priceVerification.changed"),'postconversion prices must be verified');
 assert.ok(server.includes("existingMediaPreserved: true"),'media stays intact');
 assert.ok(server.includes("existingSeoPreserved: true"),'SEO stays intact');
});

test('all app HTML pages include a shop-specific favicon, including login',()=>{
 const server=read('src/server.mjs');
 const favicon=read('src/favicon.svg').trim();
 assert.ok(server.includes("const source = decorateAdminHtml(html)"));
 assert.ok(server.includes('href="/favicon.svg?v=1"'));
 assert.ok(server.includes("url.pathname === '/favicon.svg'"));
 assert.ok(server.includes("'content-type': 'image/svg+xml; charset=utf-8'"));
 assert.match(favicon,/^<svg\b/);
 assert.match(favicon,/<title>(Silvia|Japandi) Art Collective<\/title>/);
 if(favicon.includes('data:image/png;base64,')){
  const value=favicon.match(/data:image\/png;base64,([^"]+)/)?.[1];
  assert.ok(value);
  const image=Buffer.from(value,'base64');
  assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.ok(image.length<15000);
 }else{
  assert.ok(favicon.includes('>JA</text>'),'Japandi favicon should use its own shop identity');
 }
});

test('reposted listings may reconvert only through a verified same-artwork ancestry',()=>{
 const links={
  100:{artworkId:'SAC123',status:'reposted'},
  101:{artworkId:'SAC123',replacedFromListingId:100,status:'reposted'},
  102:{artworkId:'SAC123',replacedFromListingId:101,status:'converted'}
 };
 const testLink=(listingId,artworkId='SAC123',reconvert=true,mappings=links)=>
  hasAuthorizedConverterLink({listingId,sourceListingId:100,artworkId,reconvert,mappings});
 assert.equal(testLink(100,'SAC123',false),true);
 assert.equal(testLink(102),true,'safe multi-hop repost should work');
 assert.equal(testLink(102,'SAC123',false),false,'ordinary conversion requires original listing');
 assert.equal(testLink(102,'SAC999'),false,'different artwork rejected');
 assert.equal(testLink(102,'SAC123',true,{...links,101:{artworkId:'SAC999',replacedFromListingId:100}}),false);
 assert.equal(testLink(102,'SAC123',true,{...links,101:{artworkId:'SAC123',replacedFromListingId:102}}),false);
 assert.equal(testLink(103),false,'unlinked Etsy listing rejected');
});
