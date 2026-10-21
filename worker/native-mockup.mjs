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

const PREP_VERSION = 5;
const MAX_CANVAS_PIXELS = 100_000_000;
const OUTPUT_MAX_PIXELS = 24_000_000;
const MAX_FILE_BYTES = 1_500 * 1024 * 1024;
const BASE = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'pod-worker-cache', 'native-psd-v2');
const MAX_PREPARED_TEMPLATES = Math.max(4, Number(process.env.POD_PREPARED_PSD_LIMIT) || 300);

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

// Layer paths count from the TOP of each group, joined with "." — the numbering
// Photoshop and Photopea use, so artwork-layer choices saved by earlier worker
// versions keep pointing at the same layer. (ag-psd lists layers bottom first.)
export const layerPath = (prefix, index, count) => {
  const id = String(count - 1 - index);
  return prefix ? prefix + '.' + id : id;
};
export function nativeSmartObjects(psd) {
  const objects = [];
  const visit = (layers, prefix = '', visible = true) => {
    (layers || []).forEach((layer, index, all) => {
      const id = layerPath(prefix, index, all.length);
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
    (children || []).forEach((layer, index, all) => {
      const id = layerPath(prefix, index, all.length);
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
  if (warp.style !== 'custom') {
    // Preset warps (arc, cylinder, flag …) store their bend as `value` or `values`.
    const values = Array.isArray(warp.values) ? warp.values : [warp.value];
    return values.every(v => Math.abs(Number(v || 0)) < 1e-6) &&
      !Number(warp.perspective || 0) && !Number(warp.perspectiveOther || 0);
  }
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
function applyAbove(above, x, y, r, g, b, out) {
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
  out[0] = r; out[1] = g; out[2] = b;
  return out;
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

// --------------------------------------------------------------- preparation
// Names mockup makers give the artwork placeholder.
const ARTWORK_NAME = /\b(your|place|insert|put|add|paste)\b.*\b(design|art|artwork|image|picture|photo|poster|print|here)\b|^\s*(artwork|art|design|image|picture|photo|poster|print|painting)\s*\d*\s*$|replace|double.?click|edit\s*(me|here)|smart\s*object\s*here/i;
// Names of smart objects that decorate the scene rather than hold the artwork.
const DECORATION_NAME = /texture|paper|grain|noise|overlay|shadow|light|glare|reflect|gloss|dust|scratch|frame|border|background|\bbg\b|wall|room|floor|plant|vase|logo|watermark/i;
const quadArea = q => Math.abs(q.reduce((sum, p, i) => sum + p[0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * p[1], 0)) / 2;

// With several visible Smart Objects, picks the artwork only when that is
// clear, in this order:
//  1. exactly one is named like an artwork placeholder;
//  2. exactly one is neither a full-canvas background nor a frame-like ring
//     (mostly empty inside);
//  3. of those, exactly one is not named like a decoration (paper texture,
//     shadow, glare …);
//  4. of those, exactly one uses Normal blending (textures usually multiply).
export function guessArtworkLayer(psd, entries, visible) {
  const named = visible.filter(o => ARTWORK_NAME.test(o.name));
  if (named.length === 1) return named[0];
  const canvas = psd.width * psd.height;
  const plausible = visible.filter(o => {
    const layer = entries.find(e => e.path === o.path)?.layer;
    const img = layer?.imageData;
    const raw = layer?.placedLayer?.transform;
    if (!img?.data || !Array.isArray(raw) || raw.length !== 8) return false;
    const area = quadArea([[+raw[0], +raw[1]], [+raw[2], +raw[3]], [+raw[4], +raw[5]], [+raw[6], +raw[7]]]);
    if (!(area > 0) || area >= 0.85 * canvas) return false;
    let filled = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 128) filled++;
    return filled / area >= 0.6;
  });
  if (plausible.length === 1) return plausible[0];
  const plain = plausible.filter(o => !DECORATION_NAME.test(o.name));
  if (plain.length === 1) return plain[0];
  const pool = plain.length ? plain : plausible;
  const normal = pool.filter(o => ['normal', 'pass through'].includes(entries.find(e => e.path === o.path)?.blend));
  return normal.length === 1 ? normal[0] : null;
}

function selectArtwork(psd, entries, mapping) {
  const objects = nativeSmartObjects(psd);
  const visible = objects.filter(o => o.visible);
  const wanted = mapping?.path != null ? String(mapping.path) : null;
  const guessed = wanted == null && visible.length > 1 ? guessArtworkLayer(psd, entries, visible) : null;
  // The server accepts a single `suggested` layer when no choice is saved.
  if (guessed) guessed.suggested = true;
  const chosen = wanted != null
    ? visible.find(o => o.path === wanted) || visible.find(o => o.name === wanted)
    : visible.length === 1 ? visible[0] : guessed;
  if (!chosen) return { objects, needsMapping: true, reason: wanted != null
    ? 'The saved artwork Smart Object was not found among visible layers; select the artwork layer again.'
    : visible.length ? 'This PSD has several visible Smart Objects. Select the artwork layer.'
      : 'This PSD has no visible Smart Object to place the artwork in.' };
  const pathId = chosen.path;
  const index = entries.findIndex(e => e.path === pathId);
  if (index < 0) unsupported('The artwork Smart Object could not be located in the layer stack.');
  return { objects, index, pathId };
}

// 16-bit PSDs are read as 16-bit pixel arrays; everything else works in 8 bits.
export function normalizeDepth(psd) {
  const fix = img => {
    if (!(img?.data instanceof Uint16Array)) return;
    const data = new Uint8ClampedArray(img.data.length);
    for (let i = 0; i < data.length; i++) data[i] = img.data[i] >>> 8;
    img.data = data;
  };
  const walk = layers => (layers || []).forEach(layer => {
    fix(layer.imageData); fix(layer.mask?.imageData); fix(layer.realMask?.imageData);
    walk(layer.children);
  });
  fix(psd.imageData); walk(psd.children);
  return psd;
}

// The visible layers below the artwork, flattened onto white inside `box` (RGB).
function flattenRegion(entries, count, box) {
  const out = new Uint8Array(box.width * box.height * 3).fill(255);
  for (let k = 0; k < count; k++) {
    const e = entries[k], img = e.layer.imageData;
    if (!e.visible || e.adjustment || !img?.data) continue;
    const lx = Math.round(Number(e.layer.left || 0)), ly = Math.round(Number(e.layer.top || 0));
    if (lx >= box.left + box.width || ly >= box.top + box.height || lx + img.width <= box.left || ly + img.height <= box.top) continue;
    const rgba = cropLayerRGBA(e.layer, box), alpha = entryAlpha(e, box, rgba);
    if (e.clipBase >= 0) {
      const base = entries[e.clipBase];
      if (!base.visible) continue;
      const baseAlpha = entryAlpha(base, box, cropLayerRGBA(base.layer, box));
      for (let i = 0; i < alpha.length; i++) alpha[i] *= baseAlpha[i];
    }
    const fn = blendFor(e.blend) || BLENDS.normal;
    for (let i = 0; i < alpha.length; i++) {
      const a = alpha[i];
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const b = out[i * 3 + c] / 255, s = rgba[i * 4 + c] / 255;
        out[i * 3 + c] = Math.round(255 * (b * (1 - a) + fn(b, s) * a));
      }
    }
  }
  return out;
}
// Artwork colour (0..1, in `color`) blended over what is below it at box pixel i.
function blendArt(color, below, i, fn, opacity) {
  for (let c = 0; c < 3; c++) {
    const b = below[i * 3 + c] / 255;
    color[c] = b * (1 - opacity) + fn(b, color[c]) * opacity;
  }
  return color;
}

// A composite that is one flat colour everywhere is Photoshop's placeholder for
// a PSD saved without "Maximize PSD and PSB File Compatibility".
export function compositeIsBlank(psd) {
  const img = psd.imageData;
  if (!img?.data || img.width !== psd.width || img.height !== psd.height) return true;
  const d = img.data, n = img.width * img.height, step = Math.max(1, Math.floor(n / 60000));
  for (let i = step; i < n; i += step) {
    const p = i * 4;
    if (d[p] !== d[0] || d[p + 1] !== d[1] || d[p + 2] !== d[2]) return false;
  }
  return true;
}

// Flattens the visible layers bottom→top onto white: blend modes, opacity,
// fill, masks and clipping. Layer effects and adjustment layers are not drawn.
export function flattenScene(psd, entries) {
  const W = psd.width, H = psd.height, out = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const e of entries) {
    if (!e.visible || e.adjustment) continue;
    const img = e.layer.imageData;
    if (!img?.data) continue;
    const lx = Math.round(Number(e.layer.left || 0)), ly = Math.round(Number(e.layer.top || 0));
    const left = Math.max(0, lx), top = Math.max(0, ly);
    const box = { left, top, width: Math.min(W, lx + img.width) - left, height: Math.min(H, ly + img.height) - top };
    if (box.width <= 0 || box.height <= 0) continue;
    const rgba = cropLayerRGBA(e.layer, box), alpha = entryAlpha(e, box, rgba);
    if (e.clipBase >= 0) {
      const base = entries[e.clipBase];
      if (!base.visible) continue;
      const baseAlpha = entryAlpha(base, box, cropLayerRGBA(base.layer, box));
      for (let i = 0; i < alpha.length; i++) alpha[i] *= baseAlpha[i];
    }
    const fn = blendFor(e.blend) || BLENDS.normal;
    for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
      const i = y * box.width + x, a = alpha[i];
      if (a <= 0) continue;
      const p = ((box.top + y) * W + box.left + x) * 4;
      for (let c = 0; c < 3; c++) {
        const b = out[p + c] / 255, s = rgba[i * 4 + c] / 255;
        out[p + c] = Math.round(255 * (b * (1 - a) + fn(b, s) * a));
      }
    }
  }
  return { width: W, height: H, data: out };
}
function sceneApproximations(entries) {
  const list = [];
  for (const e of entries) {
    if (!e.visible) continue;
    if (e.adjustment) list.push('adjustment layer "' + e.name + '" not drawn');
    else if (e.effects) list.push('effects on "' + e.name + '" not drawn');
  }
  return list.slice(0, 8);
}

// Builds the prepared template in memory from a parsed PSD (exported for tests).
export function prepareFromPsd(psd, mapping = null) {
  if (psd.colorMode !== 3 && psd.colorMode !== 1)
    unsupported('Only RGB or grayscale PSD templates are supported; convert this one to RGB in Photoshop.');
  if (psd.bitsPerChannel !== 8 && psd.bitsPerChannel !== 16)
    unsupported('32-bit PSD templates are not supported; convert it to 8 or 16 bits/channel in Photoshop.');
  normalizeDepth(psd);
  if (!(psd.width > 0 && psd.height > 0) || psd.width * psd.height > MAX_CANVAS_PIXELS)
    unsupported('PSD canvas size is outside the native limit (100 megapixels).');
  const { entries, notes } = flattenLayers(psd);
  // Without "Maximize PSD and PSB File Compatibility" Photoshop saves a blank
  // composite; build the scene from its layers instead.
  const selfComposited = compositeIsBlank(psd);
  if (selfComposited) psd.imageData = flattenScene(psd, entries);
  const composite = psd.imageData;
  const selection = selectArtwork(psd, entries, mapping);
  if (selection.needsMapping)
    return { needsMapping: true, objects: selection.objects, usedMapping: null, reason: selection.reason };
  const art = entries[selection.index];
  if (!art.visible) unsupported('The artwork Smart Object is hidden.');
  // An artwork layer in Multiply (or another mode), or below 100% opacity,
  // blends with what is under it, so that is kept for every render.
  const artOpacity = Math.max(0, Math.min(1, art.opacity * art.fill));
  const artMode = art.blend === 'pass through' ? 'normal' : art.blend;
  if (!blendFor(artMode)) unsupported('The artwork layer uses "' + art.blend + '" blending, which is not supported; set it to Normal or Multiply.');
  if (artOpacity < 0.02) unsupported('The artwork layer is fully transparent.');
  const artBlend = artMode !== 'normal' || artOpacity < 0.995 ? { mode: artMode, opacity: artOpacity } : null;
  const reasons = [...notes];
  if (art.effects) reasons.push('the artwork layer has layer effects');
  // Ignored when the scene is built from layers: smart filters on the artwork.
  if (art.layer.placedLayer?.filter?.list?.some(f => f?.enabled !== false)) reasons.push('the artwork has Smart Filters');
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
  // and compare it with Photoshop's composite. Whatever the layers above cannot
  // explain (layer effects such as inner shadows, adjustment layers, unusual
  // blending) is kept as a per-pixel correction and applied to every artwork.
  const artPixels = cropLayerRGBA(art.layer, box);
  const below = artBlend ? flattenRegion(entries, selection.index, box) : null;
  const artFn = artBlend ? blendFor(artBlend.mode) : null;
  const N = box.width * box.height, out = new Float64Array(3), mixed = new Float64Array(3);
  const mul = new Uint8Array(N * 3).fill(128), add = new Uint8Array(N * 3).fill(128);
  let compared = 0, error = 0, outliers = 0, rasterOutside = 0, rasterTotal = 0, corrected = 0;
  let cx0 = box.width, cy0 = box.height, cx1 = -1, cy1 = -1;
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const i = y * box.width + x;
    const rasterAlpha = artPixels[i * 4 + 3] / 255;
    if (rasterAlpha > 0.5) { rasterTotal++; if (quadCoverage[i] < 0.5) rasterOutside++; }
    const visibleAlpha = rasterAlpha * artMasks[i] * (clipAlpha ? clipAlpha[i] : 1);
    if (visibleAlpha < 0.99 || coverage[i] < 252) continue;
    for (let ch = 0; ch < 3; ch++) mixed[ch] = artPixels[i * 4 + ch] / 255;
    if (artBlend) blendArt(mixed, below, i, artFn, artBlend.opacity);
    applyAbove(above, x, y, mixed[0], mixed[1], mixed[2], out);
    const c = ((box.top + y) * psd.width + box.left + x) * 4;
    let delta = 0, needs = false;
    for (let ch = 0; ch < 3; ch++) {
      const d = Math.abs(out[ch] * 255 - composite.data[c + ch]);
      delta += d; if (d > 2) needs = true;
    }
    delta /= 3; compared++; error += delta; if (delta > 24) outliers++;
    if (!needs) continue;
    for (let ch = 0; ch < 3; ch++) {
      const predicted = out[ch] * 255, target = composite.data[c + ch];
      const m = predicted >= 24 ? Math.min(255, Math.round(128 * target / predicted)) : 128;
      mul[i * 3 + ch] = m;
      add[i * 3 + ch] = Math.max(0, Math.min(255, Math.round(target - predicted * m / 128) + 128));
    }
    corrected++;
    if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
  }
  const why = () => reasons.length ? ' Likely cause: ' + [...new Set(reasons)].slice(0, 3).join('; ') + '.' : '';
  if (rasterTotal && rasterOutside / rasterTotal > 0.02)
    unsupported('The Smart Object pixels fall outside its corner points (' + (100 * rasterOutside / rasterTotal).toFixed(1) + '%).');
  if (compared < Math.max(64, N * 0.05))
    unsupported('Too little of the artwork area is visible to verify the template.' + why());
  const mean = error / compared, outlierFraction = outliers / compared;
  // Corrections are for effects on top of the artwork. A scene that differs
  // almost everywhere means the placement itself is wrong.
  if (!selfComposited && mean > 60 && outlierFraction > 0.6)
    unsupported('The PSD does not match its artwork Smart Object (mean difference ' + mean.toFixed(1) + ').' + why());
  let residual = null;
  if (corrected) {
    const sub = { x: cx0, y: cy0, width: cx1 - cx0 + 1, height: cy1 - cy0 + 1 };
    const subMul = new Uint8Array(sub.width * sub.height * 3), subAdd = new Uint8Array(sub.width * sub.height * 3);
    for (let y = 0; y < sub.height; y++) {
      const from = ((sub.y + y) * box.width + sub.x) * 3, to = y * sub.width * 3;
      subMul.set(mul.subarray(from, from + sub.width * 3), to);
      subAdd.set(add.subarray(from, from + sub.width * 3), to);
    }
    residual = { sub, mul: subMul, add: subAdd };
  }

  return {
    needsMapping: false, width: psd.width, height: psd.height, box, quad, contentWidth, contentHeight,
    coverage, above, residual, artBlend, below, composite, objects: selection.objects, usedMapping: selection.pathId,
    fidelity: { meanPixelError: Number(mean.toFixed(3)), outlierFraction: Number(outlierFraction.toFixed(5)),
      comparedPixels: compared, correctedFraction: Number((corrected / compared).toFixed(5)),
      ...(selfComposited ? { selfComposited: true, approximations: sceneApproximations(entries) } : {}) }
  };
}

// Where a PSD's prepared data lives. The worker's download cache names each PSD
// after its immutable R2 object, so name + size identify it. (Its modification
// time is not used: the download cache touches the file on every reuse, which
// made every render prepare the template again.)
// `psdSize` (from the template record) lets the worker find a prepared template
// without the PSD on disk, so prepared templates are never downloaded again.
// `psdVersion` identifies a PSD edited in place (a PC folder template: its path
// and modified time), so an edited file is prepared again.
async function preparedLocation(psdPath, mapping, psdSize = 0, psdVersion = '') {
  const stat = Number(psdSize) > 0 ? { size: Number(psdSize) } : await fs.stat(psdPath);
  const hash = crypto.createHash('sha256').update(JSON.stringify([
    path.basename(psdPath), stat.size, mapping?.path ?? '', PREP_VERSION, ...(psdVersion ? [String(psdVersion)] : [])
  ])).digest('hex');
  const folder = path.join(BASE, hash);
  return { stat, folder, manifestPath: path.join(folder, 'manifest.json') };
}
async function readPrepared(location) {
  try {
    const cached = JSON.parse(await fs.readFile(location.manifestPath, 'utf8'));
    if (cached.version === PREP_VERSION && cached.psdBytes === location.stat.size) return cached;
  } catch {}
  return null;
}
// Lets the worker run at most one (memory-heavy) first-time preparation at once.
export async function isTemplatePrepared({ psdPath, mapping = null, psdSize = 0, psdVersion = '' }) {
  return !!(await readPrepared(await preparedLocation(psdPath, mapping, psdSize, psdVersion)));
}
// The artwork layer's shape of a prepared template (for its orientation).
export async function preparedArtworkShape({ psdPath, mapping = null, psdSize = 0, psdVersion = '' }) {
  const prepared = await readPrepared(await preparedLocation(psdPath, mapping, psdSize, psdVersion));
  return prepared && !prepared.needsMapping && prepared.contentWidth > 0 && prepared.contentHeight > 0
    ? { width: prepared.contentWidth, height: prepared.contentHeight } : null;
}

export async function prepareNativePsd({ psdPath, mapping = null, psdSize = 0, psdVersion = '', onStage = async () => {} }) {
  const location = await preparedLocation(psdPath, mapping, psdSize, psdVersion);
  const { stat, folder, manifestPath } = location;
  if (stat.size > MAX_FILE_BYTES) unsupported('PSD is larger than the 1.5 GB limit.');
  const cached = await readPrepared(location);
  if (cached) {
    const now = new Date();
    await fs.utimes(folder, now, now).catch(() => {});
    return { ...cached, folder, preparedFromCache: true };
  }

  await onStage('Preparing PSD template on PC (one time per template)');
  const { readPsd } = await loadAgPsd();
  let psd;
  try {
    psd = readPsd(await fs.readFile(psdPath), {
      useImageData: true, skipThumbnail: true, skipLinkedFilesData: true,
      totalMemoryLimit: 3 * 1024 * 1024 * 1024
    });
  } catch (error) {
    unsupported('PSD could not be read: ' + String(error?.message || error).slice(0, 160));
  }
  await onStage('Checking the template against the PSD\'s saved composite');
  const prepared = prepareFromPsd(psd, mapping);
  if (prepared.needsMapping) {
    // Remember the answer too, so the PSD is not parsed again until a layer is chosen.
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify({ version: PREP_VERSION, psdBytes: stat.size,
      needsMapping: true, objects: prepared.objects, reason: prepared.reason }));
    return { ...prepared, preparedFromCache: false };
  }

  await fs.rm(folder, { recursive: true, force: true });
  await fs.mkdir(folder, { recursive: true });
  const c = prepared.composite;
  // Near-lossless JPEG: decodes many times faster than PNG on every render.
  await sharp(Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength),
    { raw: { width: prepared.width, height: prepared.height, channels: 4 }, limitInputPixels: false })
    .removeAlpha().jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toFile(path.join(folder, 'composite.jpg'));
  await fs.writeFile(path.join(folder, 'coverage.u8'), prepared.coverage);
  const above = [];
  for (let n = 0; n < prepared.above.length; n++) {
    const layer = prepared.above[n];
    await fs.writeFile(path.join(folder, 'above-' + n + '.rgb'), layer.rgb);
    await fs.writeFile(path.join(folder, 'above-' + n + '.a'), layer.a);
    above.push({ name: layer.name, blend: layer.blend, clipToArt: layer.clipToArt, sub: layer.sub });
  }
  if (prepared.below) await fs.writeFile(path.join(folder, 'below.rgb'), prepared.below);
  if (prepared.residual) {
    await fs.writeFile(path.join(folder, 'residual.mul'), prepared.residual.mul);
    await fs.writeFile(path.join(folder, 'residual.add'), prepared.residual.add);
  }
  const manifest = {
    version: PREP_VERSION, psdBytes: stat.size, width: prepared.width, height: prepared.height,
    box: prepared.box, quad: prepared.quad, contentWidth: prepared.contentWidth, contentHeight: prepared.contentHeight,
    above, residual: prepared.residual ? { sub: prepared.residual.sub } : null, artBlend: prepared.artBlend || null,
    objects: prepared.objects, usedMapping: prepared.usedMapping, fidelity: prepared.fidelity
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
// The small per-template data stays in memory between renders.
const preparedMemory = new Map();
async function loadPrepared(prepared) {
  const { folder } = prepared;
  if (preparedMemory.has(folder)) return preparedMemory.get(folder);
  const coverage = new Uint8Array(await fs.readFile(path.join(folder, 'coverage.u8')));
  const above = [];
  for (let i = 0; i < prepared.above.length; i++) {
    const meta = prepared.above[i];
    above.push({ ...meta, fn: blendFor(meta.blend),
      rgb: new Uint8Array(await fs.readFile(path.join(folder, 'above-' + i + '.rgb'))),
      a: new Uint8Array(await fs.readFile(path.join(folder, 'above-' + i + '.a'))) });
  }
  const residual = prepared.residual ? { sub: prepared.residual.sub,
    mul: new Uint8Array(await fs.readFile(path.join(folder, 'residual.mul'))),
    add: new Uint8Array(await fs.readFile(path.join(folder, 'residual.add'))) } : null;
  const below = prepared.artBlend ? new Uint8Array(await fs.readFile(path.join(folder, 'below.rgb'))) : null;
  const loaded = { coverage, above, residual, below, artBlend: prepared.artBlend || null };
  preparedMemory.set(folder, loaded);
  while (preparedMemory.size > 24) preparedMemory.delete(preparedMemory.keys().next().value);
  return loaded;
}

// The master artwork is decoded once and reused for every template in a batch.
let artworkMemory = null;
const ARTWORK_MAX_SIDE = 6000;
async function decodedArtwork(artworkPath) {
  const info = await fs.stat(artworkPath);
  const key = artworkPath + '|' + info.size + '|' + info.mtimeMs;
  if (artworkMemory?.key === key) return artworkMemory.decoded;
  const decoded = sharp(artworkPath, { limitInputPixels: false }).rotate()
    .resize(ARTWORK_MAX_SIDE, ARTWORK_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({ data, width: info.width, height: info.height }));
  artworkMemory = { key, decoded };
  decoded.catch(() => { if (artworkMemory?.decoded === decoded) artworkMemory = null; });
  return decoded;
}

// Pure compositing step (exported for tests): the artwork warped into the
// Smart Object corners, with the layers above and the correction applied, as an
// RGBA patch over the artwork box whose alpha is the artwork's coverage.
export function renderArtworkPatch({ box, quad, coverage, above, residual = null, artBlend = null, below = null, art, artWidth, artHeight }) {
  const artFn = artBlend ? blendFor(artBlend.mode) : null, mixed = new Float64Array(3);
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] =
    homography(quad, [[0, 0], [artWidth, 0], [artWidth, artHeight], [0, artHeight]]);
  const patch = new Uint8ClampedArray(box.width * box.height * 4), out = new Float64Array(3);
  const maxX = artWidth - 1, maxY = artHeight - 1, rowBytes = artWidth * 3;
  const rs = residual?.sub;
  for (let y = 0; y < box.height; y++) {
    const py = box.top + y + 0.5;
    for (let x = 0; x < box.width; x++) {
      const i = y * box.width + x, cov = coverage[i];
      if (!cov) continue;
      const px = box.left + x + 0.5, w = h6 * px + h7 * py + h8;
      let u = (h0 * px + h1 * py + h2) / w - 0.5, v = (h3 * px + h4 * py + h5) / w - 0.5;
      u = u < 0 ? 0 : u > maxX ? maxX : u; v = v < 0 ? 0 : v > maxY ? maxY : v;
      const x0 = u | 0, y0 = v | 0, x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = u - x0, fy = v - y0;
      const a = y0 * rowBytes + x0 * 3, b = y0 * rowBytes + x1 * 3, c = y1 * rowBytes + x0 * 3, d = y1 * rowBytes + x1 * 3;
      let r = (art[a] * (1 - fx) + art[b] * fx) * (1 - fy) + (art[c] * (1 - fx) + art[d] * fx) * fy;
      let g = (art[a + 1] * (1 - fx) + art[b + 1] * fx) * (1 - fy) + (art[c + 1] * (1 - fx) + art[d + 1] * fx) * fy;
      let bl = (art[a + 2] * (1 - fx) + art[b + 2] * fx) * (1 - fy) + (art[c + 2] * (1 - fx) + art[d + 2] * fx) * fy;
      if (artBlend) {
        mixed[0] = r / 255; mixed[1] = g / 255; mixed[2] = bl / 255;
        blendArt(mixed, below, i, artFn, artBlend.opacity);
        r = mixed[0] * 255; g = mixed[1] * 255; bl = mixed[2] * 255;
      }
      if (above.length) {
        applyAbove(above, x, y, r / 255, g / 255, bl / 255, out);
        r = out[0] * 255; g = out[1] * 255; bl = out[2] * 255;
      }
      if (rs) {
        const lx = x - rs.x, ly = y - rs.y;
        if (lx >= 0 && ly >= 0 && lx < rs.width && ly < rs.height) {
          const j = (ly * rs.width + lx) * 3;
          r = r * residual.mul[j] / 128 + residual.add[j] - 128;
          g = g * residual.mul[j + 1] / 128 + residual.add[j + 1] - 128;
          bl = bl * residual.mul[j + 2] / 128 + residual.add[j + 2] - 128;
        }
      }
      const p = i * 4;
      patch[p] = r; patch[p + 1] = g; patch[p + 2] = bl; patch[p + 3] = cov;
    }
  }
  return patch;
}

export async function renderPreparedMockup({ prepared, artworkPath, outputPath, fitMode = 'contain' }) {
  const { box, quad, contentWidth, contentHeight, width, height, folder } = prepared;
  const [{ coverage, above, residual, below, artBlend }, source] = await Promise.all([loadPrepared(prepared), decodedArtwork(artworkPath)]);
  // Resample the artwork only as finely as the placement needs.
  const side = Math.max(...quad.map((p, i) => Math.hypot(quad[(i + 1) % 4][0] - p[0], quad[(i + 1) % 4][1] - p[1])));
  const scale = Math.min(1, (side * 1.25) / Math.max(contentWidth, contentHeight));
  const artWidth = Math.max(2, Math.round(contentWidth * scale)), artHeight = Math.max(2, Math.round(contentHeight * scale));
  const art = await sharp(source.data, { raw: { width: source.width, height: source.height, channels: 3 } })
    .resize(artWidth, artHeight, { fit: fitMode === 'cover' ? 'cover' : 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer();
  const patch = renderArtworkPatch({ box, quad, coverage, above, residual, artBlend, below, art, artWidth, artHeight });
  const overlay = { input: Buffer.from(patch.buffer, patch.byteOffset, patch.byteLength),
    raw: { width: box.width, height: box.height, channels: 4 }, left: box.left, top: box.top };
  const base = sharp(path.join(folder, 'composite.jpg'), { limitInputPixels: false }).composite([overlay]);
  const jpeg = { quality: 92, chromaSubsampling: '4:4:4' };
  if (width * height <= OUTPUT_MAX_PIXELS) return base.jpeg(jpeg).toFile(outputPath);
  // sharp resizes before compositing within one pipeline, so downscale separately.
  const ratio = Math.sqrt(OUTPUT_MAX_PIXELS / (width * height));
  const full = await base.raw().toBuffer({ resolveWithObject: true });
  return sharp(full.data, { raw: full.info, limitInputPixels: false })
    .resize(Math.floor(width * ratio), Math.floor(height * ratio), { kernel: 'lanczos3' })
    .jpeg(jpeg).toFile(outputPath);
}

export async function renderMockupNative({ psdPath, artworkPath, outputPath, mapping = null, psdSize = 0, psdVersion = '', fitMode = 'contain', onStage = async () => {} }) {
  const started = Date.now();
  const prepared = await prepareNativePsd({ psdPath, mapping, psdSize, psdVersion, onStage });
  if (prepared.needsMapping) return { engine: 'native', needsMapping: true, objects: prepared.objects, usedMapping: null, reason: prepared.reason };
  await onStage(prepared.preparedFromCache ? 'Rendering mockup on PC (template already prepared)' : 'Template checked; rendering mockup on PC');
  const result = await renderPreparedMockup({ prepared, artworkPath, outputPath, fitMode });
  return {
    engine: 'native', objects: prepared.objects, usedMapping: prepared.usedMapping, needsMapping: false,
    dimensions: { width: result.width, height: result.height }, size: result.size,
    renderMs: Date.now() - started, preparedFromCache: prepared.preparedFromCache, fidelity: prepared.fidelity
  };
}
