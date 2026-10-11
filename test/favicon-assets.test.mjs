import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {buildFaviconAssets,buildIcoFromPngs,getFaviconAssets} from '../src/favicon-assets.mjs';

const pngMagic=Buffer.from([137,80,78,71,13,10,26,10]);
const source=readFileSync(new URL('../src/favicon.svg',import.meta.url),'utf8');

test('current shop favicon generates native PNG images that browsers can decode',async()=>{
 const data=await buildFaviconAssets(source);
 assert.ok(data.svg.toString().includes('<svg'));
 for(const [name,size] of [['png',64],['png32',32],['png16',16]]){
  const image=data[name];
  assert.ok(image.subarray(0,8).equals(pngMagic),name+' is a real PNG');
  const meta=await sharp(image).metadata();
  assert.equal(meta.format,'png');
  assert.equal(meta.width,size);
  assert.equal(meta.height,size);
 }
 const cached=await getFaviconAssets();
 assert.ok(cached.ico.length>100);
 assert.ok(cached.png32.equals(data.png32));
});

test('ICO contains valid 16px and 32px PNG frames, not a redirect',async()=>{
 const {ico,png16,png32}=await buildFaviconAssets(source);
 assert.equal(ico.readUInt16LE(0),0);
 assert.equal(ico.readUInt16LE(2),1);
 assert.equal(ico.readUInt16LE(4),2);
 for(const [i,size,expected] of [[0,16,png16],[1,32,png32]]){
  const slot=6+i*16;
  assert.equal(ico[slot],size);
  assert.equal(ico[slot+1],size);
  assert.equal(ico.readUInt16LE(slot+6),32);
  const length=ico.readUInt32LE(slot+8);
  const offset=ico.readUInt32LE(slot+12);
  assert.equal(length,expected.length);
  assert.ok(ico.subarray(offset,offset+8).equals(pngMagic));
  assert.ok(ico.subarray(offset,offset+length).equals(expected));
 }
 assert.throws(()=>buildIcoFromPngs([{size:16,png:Buffer.from('bad')}]),/Invalid PNG/);
});

test('favicon links are cache-busted on all HTML pages and ICO is served directly',()=>{
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes("const source = decorateAdminHtml(html)"),'central HTML response');
 assert.ok(server.includes("FAVICON_LINKS+'</head>'"));
 assert.ok(server.includes('/favicon-32.png?v=4'));
 assert.ok(server.includes('/favicon.ico?v=4'));
 assert.ok(server.includes("'/favicon.ico':[assets.ico,'image/x-icon']"));
 assert.ok(server.includes("'/favicon-32.png':[assets.png32,'image/png']"));
 assert.ok(!server.includes("location:'/favicon.svg?v=1'"),'old redirect must be removed');
});
