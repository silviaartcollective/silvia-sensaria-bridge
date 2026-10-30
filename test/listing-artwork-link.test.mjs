import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { linkedListingArtwork, unlinkedListingReason } from '../src/listing-converter-link.mjs';

const ready = extra => ({ status: 'ready', master: { key: 'artworks/SAC0024/master.jpeg' }, ...extra });
const manifests = { SAC0024: ready({ sourceEtsyListingId: 111 }), SAC0030: ready({ etsyDraftListingId: 4443042195 }),
  SAC0040: { status: 'uploading', master: { key: 'artworks/SAC0040/master.jpeg' } } };
const loadManifest = async id => manifests[id] || null;
const skus = id => [id + '-P-1218', id + '-C-2436', id + '-FC-2436-BLK'];

test('a listing is linked by the converter map, its manifest, or SKUs that all name the artwork', async () => {
  // Converted, and reposted once from the converted listing.
  const map = { listings: { 111: { artworkId: 'SAC0024', status: 'reposted' }, 222: { artworkId: 'SAC0024', status: 'converted', replacedFromListingId: 111 } } };
  assert.equal((await linkedListingArtwork({ listingId: 222, map, loadManifest })).source, 'converter');
  // The manifest records the listing ID (Product Creator).
  const recorded = await linkedListingArtwork({ listingId: 4443042195, listing: { skus: skus('SAC0030') }, map: { listings: {} }, loadManifest });
  assert.deepEqual([recorded.artworkId, recorded.source], ['SAC0030', 'product-creator']);
  // Copied or reposted outside the app: a new listing ID, every SKU still SAC0024's.
  const copied = await linkedListingArtwork({ listingId: 4443042195, listing: { skus: skus('SAC0024') }, map: { listings: {} }, loadManifest });
  assert.deepEqual([copied.artworkId, copied.source], ['SAC0024', 'skus']);
  // A converted listing whose converter chain is broken still checks out by its SKUs.
  const broken = { listings: { 333: { artworkId: 'SAC0024', status: 'converted' } } };
  assert.equal(await linkedListingArtwork({ listingId: 333, map: broken, loadManifest }), null, 'without the Etsy listing');
  assert.equal((await linkedListingArtwork({ listingId: 333, listing: { skus: skus('SAC0024') }, map: broken, loadManifest })).source, 'skus');
});

test('a listing that does not check out is refused, with the reason', async () => {
  const none = { listings: {} };
  const refuse = async (listingId, listing, map = none) => {
    assert.equal(await linkedListingArtwork({ listingId, listing, map, loadManifest }), null);
    return unlinkedListingReason({ listingId, listing, map, loadManifest });
  };
  assert.match(await refuse(5, { skus: ['GELATO-1', 'GELATO-2'] }), /none of its Etsy SKUs starts with a SAC artwork ID.*Gelato → Silvia Converter/);
  assert.match(await refuse(5, { skus: ['GELATO-1'] }, { listings: { 5: { artworkId: 'SAC0024', status: 'reserved' } } }),
    /Converting this listing to SAC0024 was never finished/);
  assert.match(await refuse(5, { skus: [...skus('SAC0024'), 'OLD-123'] }), /Some of this listing's Etsy SKUs do not start with SAC0024 \(OLD-123\)/);
  assert.match(await refuse(5, { skus: skus('SAC0040') }), /SAC0040's artwork in R2 is not finished \(its status is "uploading"\)/);
  assert.match(await refuse(5, { skus: skus('SAC0099') }), /SAC0099 has no artwork record in R2/);
  assert.equal(await linkedListingArtwork({ listingId: 5, listing: { skus: ['SAC0024-P-1218', 'SAC0030-P-1218'] }, map: none, loadManifest }), null, 'mixed artworks are not guessed');
});

test('the re-upload route reads the Etsy listing when the converter map does not settle it, and checks the named artwork', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /if\(!linked&&!etsyListing\)\{\n      etsyListing=await readListing\(\);/);
  assert.match(server, /if\(req\.method==='POST'&&body\.artworkId&&String\(body\.artworkId\)\.toUpperCase\(\)!==artworkId\)/);
  assert.match(server, /conversionUnfinished:mapping\?\.status==='reserved'&&!artworkIdFromSkus\(x\.skus\)/);
  const client = readFileSync(new URL('../src/listings-client.js', import.meta.url), 'utf8');
  assert.match(client, /if\(row\.artworkId&&row\.conversionUnfinished\)body\.append\(finishArea\(row\)\);/);
});

test('an unfinished conversion is finished from its card through the converter queue, with the saved artwork', () => {
  const client = readFileSync(new URL('../src/listings-client.js', import.meta.url), 'utf8');
  const finish = client.slice(client.indexOf('async function finishConversion(row){'), client.indexOf('function paintDrawer(){'));
  assert.match(finish, /if\(!confirm\('Finish converting listing #'\+id\+' to '\+row\.artworkId/);
  assert.match(finish, /request\('\/api\/listing-converter\/convert',\{listingId:id,artworkId:row\.artworkId\}\)/);
  assert.match(finish, /request\('\/api\/listing-converter\/queue\/'\+encodeURIComponent\(job\.id\)\)/);
  assert.match(finish, /if\(job\?\.status!=='completed'\)throw Error/);
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /status:'completed',progress:'Etsy conversion verified',result\}\);\n    \/\/ The Listings page shows the listing as converted on its next refresh\.\n    masterListingPageCache\.clear\(\);/);
});
