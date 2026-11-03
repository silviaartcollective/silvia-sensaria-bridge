// The first photo's slight zoom (Etsy thumbnail), on a generated image.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { zoomForThumbnail, thumbnailZoomPercent } from '../src/thumbnail-zoom.mjs';

// 1000×800 grey with a 60 px red border.
async function framed() {
  const inner = await sharp({ create: { width: 880, height: 680, channels: 3, background: '#808080' } }).png().toBuffer();
  return sharp({ create: { width: 1000, height: 800, channels: 3, background: '#ff0000' } })
    .composite([{ input: inner, left: 60, top: 60 }]).jpeg({ quality: 95 }).toBuffer();
}
const pixel = async (buffer, x, y) => {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]];
};

test('the photo keeps its size and its edges are trimmed, centred', async () => {
  const original = await framed();
  const [or, og] = await pixel(original, 5, 400);
  assert.ok(or > 200 && og < 60, 'the original left edge is red');
  const zoomed = await zoomForThumbnail(original, { percent: 20 }); // trims ~83 px left/right, ~66 px top/bottom
  const meta = await sharp(zoomed).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1000, 800, 'jpeg']);
  // The red border is gone from the left and top edges; the centre is unchanged.
  const [r, g] = await pixel(zoomed, 5, 400);
  assert.ok(r < 160 && g > 100, 'left edge is grey now, not red: ' + [r, g]);
  const [tr] = await pixel(zoomed, 500, 5);
  assert.ok(tr < 160, 'top edge is grey now');
  const [cr, cg] = await pixel(zoomed, 500, 400);
  assert.ok(Math.abs(cr - 128) < 12 && Math.abs(cg - 128) < 12);
});

test('0 turns it off; the amount comes from THUMBNAIL_ZOOM_PERCENT (default 15, at most 50)', async () => {
  const original = await framed();
  assert.equal(await zoomForThumbnail(original, { percent: 0 }), original);
  assert.equal(thumbnailZoomPercent({}), 15);
  assert.equal(thumbnailZoomPercent({ THUMBNAIL_ZOOM_PERCENT: '8' }), 8);
  assert.equal(thumbnailZoomPercent({ THUMBNAIL_ZOOM_PERCENT: '0' }), 0);
  assert.equal(thumbnailZoomPercent({ THUMBNAIL_ZOOM_PERCENT: '90' }), 50);
});

test('only the photo that ends up first is zoomed: the first mockup in the final order, a preset only when arranged first, photo 1 of a replacement', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /zoom:placeOf\('key:'\+item\.key\)===0,/);
  assert.match(server, /zoom:\(manifest\.etsyPhotoOrder\?\.tiles\|\|\[\]\)\[0\]==='key:'\+item\.key,/);
  assert.match(server, /if\(rank===1\)object=\{\.\.\.object,body:await zoomForThumbnail\(object\.body\)/);
  assert.match(server, /if\(photo\.zoom\)object=\{\.\.\.object,body:await zoomForThumbnail\(object\.body\)/);
});
