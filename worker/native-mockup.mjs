// Native PSD mockups on the shared PC worker — no Photoshop, Photopea or browser.
//
// Each PSD is prepared ONCE (cached on disk):
//  - Photoshop's own saved composite of the scene is kept as the base image, so
//    layers BELOW the artwork (including their effects) never need recompositing;
//  - the artwork Smart Object's four corners (perspective included) give the
//    placement; its masks / clipping give the visible area;
//  - layers ABOVE the artwork (shadows, glare, frame edges, plants …) are cropped
//    to the artwork area with their blend mode, opacity, masks and clipping.
// The preparation is verified against Photoshop's composite using the PSD's
// original Smart Object pixels. Templates that cannot be reproduced exactly are
// rejected with the reason instead of producing a wrong mockup.
//
// Each render then only warps the new artwork into the corners, re-applies the
// layers above it inside that area and encodes the JPEG.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const PREP_VERSION = 3;
const MAX_CANVAS_PIXELS = 100_000_000;
const OUTPUT_MAX_PIXELS = 24_000_000;
const MAX_FILE_BYTES = 1_500 * 1024 * 1024;
const BASE = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'pod-worker-cache', 'native-psd-v2');
const MAX_PREPARED_TEMPLATES = Math.max(4, Number(process.env.POD_PREPARED_PSD_LIMIT) || 80);

export class NativeMockupUnsupported extends Error {
  constructor(reason) { super(reason); this.name = 'NativeMockupUnsupported'; }
}
const unsupported = reason => { throw new NativeMockupUnsupported(reason); };

// ---------------------------------------------------------------- PSD reading
let agPsdPromise = null;
async function loadAgPsd() {
  if (!agPsdPromise) {
    agPsdPromise = import('ag-psd').then(mod => {
      // ag-psd needs an image-data factory in Node, otherwise every PSD with a
      // layer mask fails to load ("Canvas not initialized").
      mod.initializeCanvas(
        () => { throw new Error('Canvas rendering is not used by the native PSD renderer.'); },
        (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
      );
      return mod;
    }).catch(error => {
      agPsdPromise = null;
      unsupported('Native PSD parser unavailable; run setup-worker.cmd to install ag-psd. ' + String(error?.message || error).slice(0, 120));
    });
  }
  return agPsdPromise;
}

// Smart Object paths: indexes into ag-psd's `children` arrays joined with "."
// (unchanged format, so mappings saved by earlier worker versions stay valid).
export function nativeSmartObjects(psd) {
  const objects = [];
  const visit = (layers, prefix = '', visible = true) => {
    (layers || []).forEach((layer, index) => {
      const id = prefix ? prefix + '.' + index : String(index);
      const shown = visible && layer.visible !== false && layer.hidden !== true;
      if (layer.placedLayer) objects.push({ path: id, name: String(layer.name || 'Smart Object'), kind: 'smart', visible: shown });
      if (Array.isArray(layer.children)) visit(layer.children, id, shown);
    });
  };
  visit(psd.children);
  return objects;
}

const activeMask = mask => mask && !mask.disabled && (mask.imageData || Number(mask.defaultColor ?? 255) < 255) ? mask : null;
const effectsActive = layer => {
  const fx = layer.effects;
  if (!fx || fx.disabled) return false;
  return Object.entries(fx).some(([key, value]) => key !== 'disabled' && key !== 'scale' &&
    (Array.isArray(value) ? value.some(v => v?.enabled !== false) : value && value.enabled !== false));
};

// Flattens the layer tree into a bottom→top list (ag-psd orders children bottom
// first). Group opacity and masks are carried onto children; clipping bases are
// resolved per group, like Photoshop.
export function flattenLayers(psd) {
  const entries = [], notes = [];
  const walk = (children, prefix, ctx) => {
    let base = -1;
    (children || []).forEach((layer, index) => {
      const id = prefix ? prefix + '.' + index : String(index);
      const visible = ctx.visible && layer.hidden !== true && layer.visible !== false;
      const opacity = Number(layer.opacity ?? 1);
      if (Array.isArray(layer.children)) {
        const mode = String(layer.blendMode || 'pass through');
        if (visible && mode !== 'pass through' && mode !== 'normal')
          notes.push('group "' + layer.name + '" uses ' + mode + ' blending');
        if (visible && layer.clipping) notes.push('group "' + layer.name + '" is clipped');
        if (visible && effectsActive(layer)) notes.push('group "' + layer.name + '" has layer effects');
        walk(layer.children, id, {
          visible, opacity: ctx.opacity * opacity,
          masks: activeMask(layer.mask) ? [...ctx.masks, layer.mask] : ctx.masks
        });
        base = -1;
        return;
      }
      const entry = {
        path: id, name: String(layer.name || ''), layer, visible,
        blend: String(layer.blendMode || 'normal'),
        opacity: ctx.opacity * opacity,
        fill: Number(layer.fillOpacity ?? 1),
        masks: activeMask(layer.mask) ? [...ctx.masks, layer.mask] : ctx.masks,
        ownMasks: activeMask(layer.mask) ? [layer.mask] : [],
        clipBase: -1,
        adjustment: Boolean(layer.adjustment),
        effects: effectsActive(layer)
      };
      if (layer.clipping) {
        entry.clipBase = base;
        if (base < 0 && visible) notes.push('layer "' + entry.name + '" is clipped to a group');
      } else base = entries.length;
      entries.push(entry);
    });
  };
  walk(psd.children, '', { visible: true, opacity: 1, masks: [] });
  return { entries, notes };
}

// --------------------------------------------------------------- geometry
export function homography(src, dst) {
  // Solves the 3×3 projective map taking src[i] → dst[i] (four points each).
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
    if (Math.abs(A[pivot][c]) < 1e-12) unsupported('Smart Object corners are degenerate.');
    [A[c], A[pivot]] = [A[pivot], A[c]]; [b[c], b[pivot]] = [b[pivot], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((value, i) => value / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
export const applyHomography = (H, x, y) => {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
};

// ag-psd reports an untouched "custom" warp (an identity grid) for ordinary
// Smart Objects; only a real deformation is unsupported.
export function warpIsIdentity(warp) {
  if (!warp || !warp.style || warp.style === 'none') return true;
  if (warp.style !== 'custom') return Math.abs(Number(warp.value || 0)) < 1e-6 &&
    !Number(warp.perspective || 0) && !Number(warp.perspectiveOther || 0);
  const points = warp.customEnvelopeWarp?.meshPoints;
  const bounds = warp.bounds;
  const u = Number(warp.uOrder || 4), v = Number(warp.vOrder || 4);
  if (!Array.isArray(points) || !bounds || points.length !== u * v) return false;
  const left = Number(bounds.left?.value ?? 0), top = Number(bounds.top?.value ?? 0);
  const right = Number(bounds.right?.value ?? 0), bottom = Number(bounds.bottom?.value ?? 0);
  const w = right - left, h = bottom - top, tolerance = Math.max(w, h) * 0.004 + 0.01;
  for (let row = 0; row < v; row++) for (let col = 0; col < u; col++) {
    const p = points[row * u + col];
    if (Math.abs(p.x - (left + w * col / (u - 1))) > tolerance ||
        Math.abs(p.y - (top + h * row / (v - 1))) > tolerance) return false;
  }
  return true;
}

export function smartObjectGeometry(layer) {
  const info = layer?.placedLayer;
  if (!info) unsupported('The selected layer is not a Smart Object.');
  const raw = Array.isArray(info.nonAffineTransform) && info.nonAffineTransform.length === 8
    ? info.nonAffineTransform : info.transform;
  if (!Array.isArray(raw) || raw.length !== 8 || raw.some(v => !Number.isFinite(Number(v))))
    unsupported('Smart Object corner coordinates are missing.');
  if (!warpIsIdentity(info.warp)) unsupported('The artwork Smart Object uses a Warp transform, which the native renderer cannot reproduce.');
  if (info.filter?.list?.some(f => f?.enabled !== false))
    unsupported('The artwork Smart Object has Smart Filters, which the native renderer cannot reproduce.');
  const quad = [[+raw[0], +raw[1]], [+raw[2], +raw[3]], [+raw[4], +raw[5]], [+raw[6], +raw[7]]];
  const contentWidth = Number(info.width) || Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const contentHeight = Number(info.height) || Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]);
  if (!(contentWidth > 0 && contentHeight > 0)) unsupported('Smart Object content size is invalid.');
  return { quad, contentWidth, contentHeight };
}

// ---------------------------------------------------------------- pixels
function cropLayerRGBA(layer, box) {
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  const img = layer.imageData;
  if (!img?.data) return out;
  const lx = Math.round(Number(layer.left || 0)), ly = Math.round(Number(layer.top || 0));
  const x0 = Math.max(box.left, lx), y0 = Math.max(box.top, ly);
  const x1 = Math.min(box.left + box.width, lx + img.width), y1 = Math.min(box.top + box.height, ly + img.height);
  for (let y = y0; y < y1; y++) {
    const src = ((y - ly) * img.width + (x0 - lx)) * 4, dst = ((y - box.top) * box.width + (x0 - box.left)) * 4;
    out.set(img.data.subarray(src, src + (x1 - x0) * 4), dst);
  }
  return out;
}
// Combined mask (0..1) of every active mask on a layer and its parent groups.
function maskProduct(masks, box) {
  const out = new Float32Array(box.width * box.height).fill(1);
  for (const mask of masks) {
    const fallback = Number(mask.defaultColor ?? 255) / 255;
    const img = mask.imageData;
    const mx = Math.round(Number(mask.left || 0)), my = Math.round(Number(mask.top || 0));
    for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
      const cx = box.left + x - mx, cy = box.top + y - my;
      const value = img && cx >= 0 && cy >= 0 && cx < img.width && cy < img.height
        ? img.data[(cy * img.width + cx) * 4] / 255 : fallback;
      out[y * box.width + x] *= value;
    }
  }
  return out;
}
// Effective alpha (0..1) of an entry inside the box, without clipping applied.
// `ownOnly` leaves out the parent groups' masks (for layers clipped to the
// artwork, which share those masks with it).
function entryAlpha(entry, box, rgba, ownOnly = false) {
  const masks = maskProduct(ownOnly ? entry.ownMasks : entry.masks, box);
  const out = new Float32Array(box.width * box.height);
  const scale = entry.opacity * entry.fill;
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3] / 255 * masks[i] * scale;
  return out;
}

const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
const softLight = (b, s) => s <= 0.5 ? 2 * b * s + b * b * (1 - 2 * s) : 2 * b * (1 - s) + Math.sqrt(b) * (2 * s - 1);
const dodge = (b, s) => b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s));
const burn = (b, s) => b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
export const BLENDS = {
  'normal': (b, s) => s,
  'multiply': (b, s) => b * s,
  'screen': (b, s) => b + s - b * s,
  'overlay': (b, s) => b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s),
  'darken': Math.min,
  'lighten': Math.max,
  'color dodge': dodge,
  'color burn': burn,
  'linear dodge': (b, s) => Math.min(1, b + s),
  'linear burn': (b, s) => Math.max(0, b + s - 1),
  'hard light': (b, s) => s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s),
  'soft light': softLight,
  'vivid light': (b, s) => s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * (s - 0.5)),
  'linear light': (b, s) => clamp(b + 2 * s - 1),
  'pin light': (b, s) => s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1),
  'difference': (b, s) => Math.abs(b - s),
  'exclusion': (b, s) => b + s - 2 * b * s,
  'subtract': (b, s) => Math.max(0, b - s),
  'divide': (b, s) => s <= 0 ? 1 : Math.min(1, b / s)
};
const blendFor = mode => BLENDS[mode === 'pass through' ? 'normal' : mode];

// A prepared layer above the artwork, stored only over the region where it is
// visible (sub-box of the artwork box) to keep memory and render time small.
function packAbove(name, blend, rgba, alpha, clipToArt, box) {
  let x0 = box.width, y0 = box.height, x1 = -1, y1 = -1;
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    if (alpha[y * box.width + x] > 0.002) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const sub = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const rgb = new Uint8Array(sub.width * sub.height * 3), a = new Uint8Array(sub.width * sub.height);
  for (let y = 0; y < sub.height; y++) for (let x = 0; x < sub.width; x++) {
    const src = (sub.y + y) * box.width + sub.x + x, dst = y * sub.width + x;
    rgb[dst * 3] = rgba[src * 4]; rgb[dst * 3 + 1] = rgba[src * 4 + 1]; rgb[dst * 3 + 2] = rgba[src * 4 + 2];
    a[dst] = Math.round(alpha[src] * 255);
  }
  return { name, blend, clipToArt, sub, rgb, a, fn: blendFor(blend) };
}

// Applies the prepared above-artwork layers to an opaque colour (0..1 floats)
// at artwork-box pixel (x, y). The artwork's own coverage is applied afterwards
// by the caller, so layers clipped to the artwork use only their own alpha.
function applyAbove(above, x, y, r, g, b) {
  for (const layer of above) {
    const lx = x - layer.sub.x, ly = y - layer.sub.y;
    if (lx < 0 || ly < 0 || lx >= layer.sub.width || ly >= layer.sub.height) continue;
    const j = ly * layer.sub.width + lx;
    const a = layer.a[j] / 255;
    if (a <= 0) continue;
    const blend = layer.fn;
    const sr = layer.rgb[j * 3] / 255, sg = layer.rgb[j * 3 + 1] / 255, sb = layer.rgb[j * 3 + 2] / 255;
    r = r * (1 - a) + blend(r, sr) * a;
    g = g * (1 - a) + blend(g, sg) * a;
    b = b * (1 - a) + blend(b, sb) * a;
  }
  return [r, g, b];
}

// Fraction of each artwork-box pixel inside the Smart Object's corners: exact
// inside/outside from the pixel corners, 4×4 supersampling only on edges.
function coverageFor(H, contentWidth, contentHeight, box) {
  const inside = (px, py) => {
    const [u, v] = applyHomography(H, px, py);
    return u >= 0 && v >= 0 && u <= contentWidth && v <= contentHeight;
  };
  const W = box.width + 1, corners = new Uint8Array(W * (box.height + 1));
  for (let y = 0; y <= box.height; y++) for (let x = 0; x <= box.width; x++) corners[y * W + x] = inside(box.left + x, box.top + y) ? 1 : 0;
  const out = new Float32Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const n = corners[y * W + x] + corners[y * W + x + 1] + corners[(y + 1) * W + x] + corners[(y + 1) * W + x + 1];
    if (n === 4) { out[y * box.width + x] = 1; continue; }
    if (n === 0) continue;
    let hits = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++)
      if (inside(box.left + x + (sx + 0.5) / 4, box.top + y + (sy + 0.5) / 4)) hits++;
    out[y * box.width + x] = hits / 16;
  }
  return out;
}

function sampleBilinear(art, width, height, u, v) {
  const x = Math.min(width - 1, Math.max(0, u - 0.5)), y = Math.min(height - 1, Math.max(0, v - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const top = art[(y0 * width + x0) * 3 + c] * (1 - fx) + art[(y0 * width + x1) * 3 + c] * fx;
    const bottom = art[(y1 * width + x0) * 3 + c] * (1 - fx) + art[(y1 * width + x1) * 3 + c] * fx;
    out[c] = (top * (1 - fy) + bottom * fy) / 255;
  }
  return out;
}

// --------------------------------------------------------------- preparation
function selectArtwork(psd, entries, mapping) {
  const objects = nativeSmartObjects(psd);
  const visible = objects.filter(o => o.visible);
  const wanted = mapping?.path != null ? String(mapping.path) : null;
  if (wanted != null && !visible.some(o => o.path === wanted))
    unsupported('The saved artwork Smart Object was not found among visible layers in this PSD.');
  if (wanted == null && visible.length !== 1) return { objects, needsMapping: true };
  const pathId = wanted ?? visible[0].path;
  const index = entries.findIndex(e => e.path === pathId);
  if (index < 0) unsupported('The artwork Smart Object could not be located in the layer stack.');
  return { objects, index, pathId };
}

// Builds the prepared template in memory from a parsed PSD (exported for tests).
export function prepareFromPsd(psd, mapping = null) {
  if (psd.colorMode !== 3) unsupported('Only RGB PSD templates are supported (this one is not RGB).');
  if (psd.bitsPerChannel !== 8) unsupported('Only 8-bit PSD templates are supported; convert it to 8 bits/channel in Photoshop.');
  if (!(psd.width > 0 && psd.height > 0) || psd.width * psd.height > MAX_CANVAS_PIXELS)
    unsupported('PSD canvas size is outside the native limit (100 megapixels).');
  const composite = psd.imageData;
  if (!composite?.data || composite.width !== psd.width || composite.height !== psd.height)
    unsupported('The PSD has no saved composite image. Re-save it in Photoshop with "Maximize PSD and PSB File Compatibility" turned on.');

  const { entries, notes } = flattenLayers(psd);
  const selection = selectArtwork(psd, entries, mapping);
  if (selection.needsMapping)
    return { needsMapping: true, objects: selection.objects, usedMapping: null,
      reason: 'This PSD has several visible Smart Objects. Select the artwork layer.' };
  const art = entries[selection.index];
  if (!art.visible) unsupported('The artwork Smart Object is hidden.');
  if (art.blend !== 'normal' && art.blend !== 'pass through')
    unsupported('The artwork layer uses "' + art.blend + '" blending; set it to Normal for native rendering.');
  if (art.opacity * art.fill < 0.995)
    unsupported('The artwork layer opacity is below 100%; set it to 100% for native rendering.');
  const reasons = [...notes];
  if (art.effects) reasons.push('the artwork layer has layer effects');
  const { quad, contentWidth, contentHeight } = smartObjectGeometry(art.layer);
  const H = homography(quad, [[0, 0], [contentWidth, 0], [contentWidth, contentHeight], [0, contentHeight]]);

  const xs = quad.map(p => p[0]), ys = quad.map(p => p[1]);
  const left = Math.max(0, Math.floor(Math.min(...xs)) - 2), top = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const right = Math.min(psd.width, Math.ceil(Math.max(...xs)) + 2), bottom = Math.min(psd.height, Math.ceil(Math.max(...ys)) + 2);
  if (right - left < 8 || bottom - top < 8) unsupported('The artwork area is outside the canvas or too small.');
  const box = { left, top, width: right - left, height: bottom - top };

  // Visible area of the artwork: its corners × its masks × its clipping base.
  const quadCoverage = coverageFor(H, contentWidth, contentHeight, box);
  const artMasks = maskProduct(art.masks, box);
  let clipAlpha = null;
  if (art.clipBase >= 0) {
    const base = entries[art.clipBase];
    clipAlpha = entryAlpha(base, box, cropLayerRGBA(base.layer, box));
  }
  const coverage = new Uint8Array(box.width * box.height);
  for (let i = 0; i < coverage.length; i++) coverage[i] = Math.round(255 * quadCoverage[i] * artMasks[i] * (clipAlpha ? clipAlpha[i] : 1));

  // Layers above the artwork, cropped to where they are visible over it.
  const above = [];
  for (let index = selection.index + 1; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry.visible) continue;
    if (entry.adjustment) { reasons.push('adjustment layer "' + entry.name + '" is above the artwork'); continue; }
    const img = entry.layer.imageData;
    const lx = Number(entry.layer.left || 0), ly = Number(entry.layer.top || 0);
    if (!img || lx >= box.left + box.width || ly >= box.top + box.height || lx + img.width <= box.left || ly + img.height <= box.top) continue;
    if (!blendFor(entry.blend)) { reasons.push('layer "' + entry.name + '" uses "' + entry.blend + '" blending'); continue; }
    if (entry.effects) reasons.push('layer "' + entry.name + '" above the artwork has layer effects');
    const rgba = cropLayerRGBA(entry.layer, box);
    const clipToArt = entry.clipBase === selection.index;
    const alpha = entryAlpha(entry, box, rgba, clipToArt);
    if (entry.clipBase >= 0) {
      if (!clipToArt) {
        const base = entries[entry.clipBase];
        const baseAlpha = entryAlpha(base, box, cropLayerRGBA(base.layer, box));
        for (let i = 0; i < alpha.length; i++) alpha[i] *= baseAlpha[i];
      }
    }
    const packed = packAbove(entry.name, entry.blend, rgba, alpha, clipToArt, box);
    if (packed) above.push(packed);
  }

  // Fidelity: rebuild the artwork area with the PSD's own Smart Object pixels
  // and compare it with Photoshop's composite.
  const artPixels = cropLayerRGBA(art.layer, box);
  let compared = 0, error = 0, outliers = 0, rasterOutside = 0, rasterTotal = 0;
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const i = y * box.width + x;
    const rasterAlpha = artPixels[i * 4 + 3] / 255;
    if (rasterAlpha > 0.5) { rasterTotal++; if (quadCoverage[i] < 0.5) rasterOutside++; }
    const visibleAlpha = rasterAlpha * artMasks[i] * (clipAlpha ? clipAlpha[i] : 1);
    if (visibleAlpha < 0.99 || coverage[i] < 252) continue;
    const [r, g, b] = applyAbove(above, x, y, artPixels[i * 4] / 255, artPixels[i * 4 + 1] / 255, artPixels[i * 4 + 2] / 255);
    const c = ((box.top + y) * psd.width + box.left + x) * 4;
    const delta = (Math.abs(r * 255 - composite.data[c]) + Math.abs(g * 255 - composite.data[c + 1]) + Math.abs(b * 255 - composite.data[c + 2])) / 3;
    compared++; error += delta; if (delta > 24) outliers++;
  }
  const why = () => reasons.length ? ' Likely cause: ' + [...new Set(reasons)].slice(0, 3).join('; ') + '.' : '';
  if (rasterTotal && rasterOutside / rasterTotal > 0.02)
    unsupported('The Smart Object pixels fall outside its corner points (' + (100 * rasterOutside / rasterTotal).toFixed(1) + '%).');
  if (compared < Math.max(64, box.width * box.height * 0.05))
    unsupported('Too little of the artwork area is visible to verify the template natively.' + why());
  const mean = error / compared, outlierFraction = outliers / compared;
  if (mean > 3 || outlierFraction > 0.02)
    unsupported('Native result differs from the PSD (mean error ' + mean.toFixed(2) + ', ' + (outlierFraction * 100).toFixed(2) + '% of pixels).' + why());

  return {
    needsMapping: false, width: psd.width, height: psd.height, box, quad, contentWidth, contentHeight,
    coverage, above, composite, objects: selection.objects, usedMapping: selection.pathId,
    fidelity: { meanPixelError: Number(mean.toFixed(3)), outlierFraction: Number(outlierFraction.toFixed(5)), comparedPixels: compared }
  };
}

export async function prepareNativePsd({ psdPath, mapping = null, onStage = async () => {} }) {
  const stat = await fs.stat(psdPath);
  if (stat.size > MAX_FILE_BYTES) unsupported('PSD is larger than the 1.5 GB native limit.');
  const hash = crypto.createHash('sha256').update(JSON.stringify([
    path.basename(psdPath), stat.size, stat.mtimeMs, mapping?.path ?? '', PREP_VERSION
  ])).digest('hex');
  const folder = path.join(BASE, hash), manifestPath = path.join(folder, 'manifest.json');
  try {
    const cached = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (cached.version === PREP_VERSION && cached.psdBytes === stat.size) {
      const now = new Date();
      await fs.utimes(folder, now, now).catch(() => {});
      return { ...cached, folder, preparedFromCache: true };
    }
  } catch {}

  await onStage('Preparing PSD template on PC (one time per template)');
  const { readPsd } = await loadAgPsd();
  let psd;
  try {
    psd = readPsd(await fs.readFile(psdPath), {
      useImageData: true, skipThumbnail: true, skipLinkedFilesData: true,
      totalMemoryLimit: 3 * 1024 * 1024 * 1024
    });
  } catch (error) {
    unsupported('PSD could not be read natively: ' + String(error?.message || error).slice(0, 160));
  }
  await onStage('Verifying the template against the PSD\'s saved composite');
  const prepared = prepareFromPsd(psd, mapping);
  if (prepared.needsMapping) return prepared;

  await fs.rm(folder, { recursive: true, force: true });
  await fs.mkdir(folder, { recursive: true });
  const c = prepared.composite;
  await sharp(Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength),
    { raw: { width: prepared.width, height: prepared.height, channels: 4 }, limitInputPixels: false })
    .removeAlpha().png({ compressionLevel: 1 }).toFile(path.join(folder, 'composite.png'));
  await fs.writeFile(path.join(folder, 'coverage.u8'), prepared.coverage);
  const above = [];
  for (let n = 0; n < prepared.above.length; n++) {
    const layer = prepared.above[n];
    await fs.writeFile(path.join(folder, 'above-' + n + '.rgb'), layer.rgb);
    await fs.writeFile(path.join(folder, 'above-' + n + '.a'), layer.a);
    above.push({ name: layer.name, blend: layer.blend, clipToArt: layer.clipToArt, sub: layer.sub });
  }
  const manifest = {
    version: PREP_VERSION, psdBytes: stat.size, width: prepared.width, height: prepared.height,
    box: prepared.box, quad: prepared.quad, contentWidth: prepared.contentWidth, contentHeight: prepared.contentHeight,
    above, objects: prepared.objects, usedMapping: prepared.usedMapping, fidelity: prepared.fidelity
  };
  await fs.writeFile(manifestPath + '.tmp', JSON.stringify(manifest));
  await fs.rename(manifestPath + '.tmp', manifestPath);
  await prunePrepared(folder).catch(() => {});
  return { ...manifest, folder, preparedFromCache: false };
}

// Keeps the most recently used prepared templates; older ones are rebuilt on demand.
async function prunePrepared(keep) {
  const names = await fs.readdir(BASE);
  const folders = [];
  for (const name of names) {
    const folder = path.join(BASE, name);
    if (folder === keep) continue;
    const info = await fs.stat(folder).catch(() => null);
    if (info?.isDirectory()) folders.push({ folder, used: info.mtimeMs });
  }
  folders.sort((a, b) => b.used - a.used);
  for (const { folder } of folders.slice(MAX_PREPARED_TEMPLATES - 1))
    await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
}

// ------------------------------------------------------------------ render
async function loadPrepared(prepared) {
  const { folder } = prepared;
  const coverage = new Uint8Array(await fs.readFile(path.join(folder, 'coverage.u8')));
  const above = [];
  for (let i = 0; i < prepared.above.length; i++) {
    const meta = prepared.above[i];
    above.push({ ...meta, fn: blendFor(meta.blend),
      rgb: new Uint8Array(await fs.readFile(path.join(folder, 'above-' + i + '.rgb'))),
      a: new Uint8Array(await fs.readFile(path.join(folder, 'above-' + i + '.a'))) });
  }
  const base = await sharp(path.join(folder, 'composite.png'), { limitInputPixels: false }).removeAlpha().raw().toBuffer();
  return { coverage, above, base };
}

// Pure compositing step (exported for tests): writes the warped artwork and the
// layers above it into `base` (RGB, full canvas) inside the artwork box.
export function compositeArtwork({ base, width, box, quad, coverage, above, art, artWidth, artHeight }) {
  const Hi = homography(quad, [[0, 0], [artWidth, 0], [artWidth, artHeight], [0, artHeight]]);
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const i = y * box.width + x, c = coverage[i] / 255;
    if (c <= 0) continue;
    const [u, v] = applyHomography(Hi, box.left + x + 0.5, box.top + y + 0.5);
    const [sr, sg, sb] = sampleBilinear(art, artWidth, artHeight, u, v);
    const [r, g, b] = applyAbove(above, x, y, sr, sg, sb);
    const p = ((box.top + y) * width + box.left + x) * 3;
    base[p] = Math.round(base[p] * (1 - c) + r * 255 * c);
    base[p + 1] = Math.round(base[p + 1] * (1 - c) + g * 255 * c);
    base[p + 2] = Math.round(base[p + 2] * (1 - c) + b * 255 * c);
  }
  return base;
}

export async function renderPreparedMockup({ prepared, artworkPath, outputPath, fitMode = 'contain' }) {
  const { box, quad, contentWidth, contentHeight, width, height } = prepared;
  const { coverage, above, base } = await loadPrepared(prepared);
  // Resample the artwork only as finely as the placement needs.
  const side = Math.max(...quad.map((p, i) => Math.hypot(quad[(i + 1) % 4][0] - p[0], quad[(i + 1) % 4][1] - p[1])));
  const scale = Math.min(1, (side * 1.25) / Math.max(contentWidth, contentHeight));
  const artWidth = Math.max(2, Math.round(contentWidth * scale)), artHeight = Math.max(2, Math.round(contentHeight * scale));
  const art = await sharp(artworkPath, { limitInputPixels: false }).rotate()
    .resize(artWidth, artHeight, { fit: fitMode === 'cover' ? 'cover' : 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer();
  compositeArtwork({ base, width, box, quad, coverage, above, art, artWidth, artHeight });
  let image = sharp(base, { raw: { width, height, channels: 3 }, limitInputPixels: false });
  if (width * height > OUTPUT_MAX_PIXELS) {
    const ratio = Math.sqrt(OUTPUT_MAX_PIXELS / (width * height));
    image = image.resize(Math.floor(width * ratio), Math.floor(height * ratio), { kernel: 'lanczos3' });
  }
  return image.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(outputPath);
}

export async function renderMockupNative({ psdPath, artworkPath, outputPath, mapping = null, fitMode = 'contain', onStage = async () => {} }) {
  const started = Date.now();
  const prepared = await prepareNativePsd({ psdPath, mapping, onStage });
  if (prepared.needsMapping) return { engine: 'native', needsMapping: true, objects: prepared.objects, usedMapping: null, reason: prepared.reason };
  await onStage(prepared.preparedFromCache ? 'Rendering mockup on PC (template already prepared)' : 'Template verified; rendering mockup on PC');
  const result = await renderPreparedMockup({ prepared, artworkPath, outputPath, fitMode });
  return {
    engine: 'native', objects: prepared.objects, usedMapping: prepared.usedMapping, needsMapping: false,
    dimensions: { width: result.width, height: result.height }, size: result.size,
    renderMs: Date.now() - started, preparedFromCache: prepared.preparedFromCache, fidelity: prepared.fidelity
  };
}
