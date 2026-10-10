import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSignatureParts} from '../src/mockup-zip.mjs';
test('streaming ZIP writes correct PK local, descriptor, central and end headers',()=>{
 const parts=zipSignatureParts('24x36 Dark Wood Framed Canvas.jpg');
 assert.equal(parts.local.readUInt32LE(0),0x04034b50);
 assert.equal(parts.local.readUInt16LE(6)&8,8);
 assert.equal(parts.descriptor.readUInt32LE(0),0x08074b50);
 assert.equal(parts.central.readUInt32LE(0),0x02014b50);
 assert.equal(parts.end.readUInt32LE(0),0x06054b50);
 assert.equal(parts.end.readUInt16LE(8),1);
});
