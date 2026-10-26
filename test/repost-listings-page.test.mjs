import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderRepostListingsPage} from '../src/repost-listings-page.mjs';
import {renderDailyListingsPage} from '../src/daily-listings-page.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('the Listing Reposter is laid out like Daily Listings: how many, its mockup preset, the ChatGPT instructions',()=>{
 const html=renderRepostListingsPage();
 assert.match(html,/<input type="number" id="rp-count" class="count" min="1" max="50" value="20">/);
 for(const id of ['rp-start','rp-stop','rp-resume','rp-retry','rp-rows','mp-tabs','mp-groups','ai-model','ai-instructions','ai-save','mg-org-modal'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/<section class="card" id="mockup-presets" data-for="repost">/);
 assert.match(html,/href="\/listing-reposter\/one"/);
 assert.match(html,/<script src="\/ai-seo-client\.js" defer><\/script><script src="\/mockup-presets-client\.js" defer><\/script><script src="\/repost-listings-client\.js" defer>/);
 // Daily Listings sends renewals there and keeps its own preset choice.
 const daily=renderDailyListingsPage();
 assert.match(daily,/<section class="card" id="mockup-presets">/);
 assert.match(daily,/href="\/listing-reposter">Open the Listing Reposter/);
 assert.doesNotMatch(daily,/rn-start/);
 const server=read('src/server.mjs');
 assert.match(server,/url\.searchParams\.get\('for'\)==='repost'\?REPOST_PRESET_KEY:BATCH_PRESET_KEY/);
 assert.match(server,/body\.for==='repost'\?REPOST_PRESET_KEY:BATCH_PRESET_KEY/);
 assert.match(server,/finalizeReplacement\(await getEtsySession\(\),id,'PUBLISH AND DEACTIVATE'\)/);
 assert.match(read('src/mockup-presets-client.js'),/request\('\/api\/batch\/presets'\+\(FOR\?'\?for='\+FOR:''\)\)/);
});

test('refresh first, repost later: the two ages and the renewal window are settings, sent with Start and remembered',()=>{
 const html=renderRepostListingsPage();
 assert.match(html,/Refresh after <input type="number" id="rp-refresh" class="count" min="1" max="36" value="4"> months/);
 assert.match(html,/Repost after <input type="number" id="rp-repost" class="count" min="2" max="48" value="12"> months/);
 assert.match(html,/Renewing within <input type="number" id="rp-window" class="count" min="1" max="120" value="7"> days/);
 const client=read('src/repost-listings-client.js');
 assert.match(client,/void run\('\/api\/renewer\/start',\{count:n,rules:r,confirm:CONFIRM\}\)/);
 assert.match(client,/el\('rp-refresh'\)\.value=String\(data\.rules\.refreshMonths\)/);
 const server=read('src/server.mjs');
 assert.match(server,/const rules=checkRules\(body\.rules\);\n      await putJsonObject\(RENEWER_RULES_KEY,/);
 assert.match(server,/startRenewal\(renewalDeps\(\),\{count:body\.count,preset,rules\}\)/);
 // A refresh changes the listing itself: its photos (in place, never left without any) and its details.
 assert.match(server,/replacePhotos:refreshListingPhotos,\n    updateDetails:refreshListingDetails,/);
 assert.match(server,/const placed=await replaceListingPhotos\(\{session,listingId,photos,altText:manifest\.title\|\|''\}\);/);
 assert.match(server,/rank,overwrite:replace,altText,\.\.\.args\}\)/);
 assert.match(server,/forgetRefreshed:listingId=>changeRefreshed\(listings=>\{delete listings\[String\(listingId\)\]\}\),/);
});
