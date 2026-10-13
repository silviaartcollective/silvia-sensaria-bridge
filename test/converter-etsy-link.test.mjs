import test from 'node:test';
import assert from 'node:assert/strict';
import {renderListingConverterPage} from '../src/listing-converter-page.mjs';

test('every converter listing renders an Etsy link that opens safely in a new tab',()=>{
 const html=renderListingConverterPage();
 assert.match(html,/class="etsy-view"/);
 assert.match(html,/View on Etsy/);
 assert.match(html,/href="https:\/\/www\.etsy\.com\/listing\/'\+encodeURIComponent\(String\(item\.listingId\)\)/);
 assert.match(html,/target="_blank" rel="noopener noreferrer"/);
 assert.match(html,/aria-label="View listing /);
});
