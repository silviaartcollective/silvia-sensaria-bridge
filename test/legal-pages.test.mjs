import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderPrivacyPage,renderTermsPage} from '../src/legal-pages.mjs';

test('public privacy policy and terms for the Google consent screen', () => {
  const privacy=renderPrivacyPage(),terms=renderTermsPage();
  assert.match(privacy,/<title>Privacy policy · Silvia Art Collective<\/title>/);
  assert.match(privacy,/read-only access/);
  assert.match(privacy,/Limited Use/);
  assert.match(terms,/<title>Terms of service · Silvia Art Collective<\/title>/);
  assert.doesNotMatch(privacy+terms,/@/,'no email address published');
  const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
  const health=server.indexOf("url.pathname === '/health'"),legal=server.indexOf("url.pathname === '/privacy' || url.pathname === '/terms'");
  assert.ok(legal>health&&legal<server.indexOf("url.pathname === '/login'"),'served before sign-in is required');
});
