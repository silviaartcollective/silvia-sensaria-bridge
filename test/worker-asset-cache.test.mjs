import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheKeyFor} from '../worker/asset-cache.mjs';

test('R2 artwork cache keys are isolated per shop and immutable asset',()=>{
 const base={shop:'https://silvia.test',id:'template-1',key:'psds/a.psd',size:194000000};
 const key=cacheKeyFor(base);
 assert.equal(key,cacheKeyFor({...base}));
 assert.notEqual(key,cacheKeyFor({...base,shop:'https://japandi.test'}));
 assert.notEqual(key,cacheKeyFor({...base,key:'psds/b.psd'}));
 assert.equal(key.length,64);
});
