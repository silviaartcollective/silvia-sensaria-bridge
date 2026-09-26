import { readFileSync } from 'node:fs';
import sharp from 'sharp';

sharp.cache(false);
sharp.concurrency(1);

const specs = JSON.parse(
  readFileSync(new URL('../config/production-specs.json', import.meta.url), 'utf8')
);

function normalizeOrientation(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'landscape' || v === 'horizontal') return 'landscape';
  return 'portrait';
}

function swapIfLandscape(dimensions, orientation) {
  if (normalizeOrientation(orientation) !== 'landscape') return { ...dimensions };
  return { width: dimensions.height, height: dimensions.width };
}

export function productionSpecFor({ format, size, orientation = 'portrait' }) {
  const normalizedFormat = String(format || '').toUpperCase();
  const normalizedOrientation = normalizeOrientation(orientation);

  if (normalizedFormat === 'P') {
    const spec = specs.poster[size];
    if (!spec) throw new Error(`No Matte Poster Paper production spec for ${size}`);
    return {
      kind: 'poster',
      format: normalizedFormat,
      size,
      orientation: normalizedOrientation,
      dpi: specs.dpi,
      finished: spec.finished,
      output: swapIfLandscape(spec.portraitPx, normalizedOrientation),
      template: spec.template || null,
      note: spec.note || null
    };
  }

  if (normalizedFormat === 'C' || normalizedFormat === 'FC') {
    const spec = specs.canvas[size];
    if (!spec) throw new Error(`No Canvas production spec for ${size}`);
    return {
      kind: 'canvas',
      format: normalizedFormat,
      size,
      orientation: normalizedOrientation,
      dpi: specs.dpi,
      finished: spec.finished,
      face: swapIfLandscape(spec.facePortraitPx, normalizedOrientation),
      output: swapIfLandscape(spec.productionPortraitPx, normalizedOrientation),
      mirrorBleedPx: Math.round(specs.canvasMirrorBleedInches * specs.dpi),
      safeInsetPx: Math.round(specs.safeInsetInches * specs.dpi),
      template: normalizedFormat === 'FC'
        ? String(spec.template).replace('canvas-1.25bar-', 'canvas-1.25bar-framed-')
        : spec.template
    };
  }

  throw new Error(`Unsupported production format: ${format}`);
}

export function productionObjectKey({ artworkId, format, size, orientation = 'portrait' }) {
  const id = String(artworkId || '').trim().toUpperCase();
  if (!/^SAC\d+$/.test(id)) throw new Error(`Invalid artwork ID: ${artworkId}`);
  const o = normalizeOrientation(orientation);
  const family = String(format || '').toUpperCase() === 'P' ? 'poster' : 'canvas';
  return `artworks/${id}/production/${family}/${size}-${o}.jpg`;
}

export function masterObjectKey(artworkId, extension = 'jpg') {
  const id = String(artworkId || '').trim().toUpperCase();
  if (!/^SAC\d+$/.test(id)) throw new Error(`Invalid artwork ID: ${artworkId}`);
  const ext = String(extension || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `artworks/${id}/source/${id}-master.${ext}`;
}

export function mockupObjectKey(artworkId, index, extension = 'jpg') {
  const id = String(artworkId || '').trim().toUpperCase();
  if (!/^SAC\d+$/.test(id)) throw new Error(`Invalid artwork ID: ${artworkId}`);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`Invalid mockup index: ${index}`);
  const ext = String(extension || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `artworks/${id}/mockups/${id}-mockup-${String(n).padStart(2, '0')}.${ext}`;
}

export function manifestObjectKey(artworkId) {
  const id = String(artworkId || '').trim().toUpperCase();
  if (!/^SAC\d+$/.test(id)) throw new Error(`Invalid artwork ID: ${artworkId}`);
  return `artworks/${id}/manifest.json`;
}

function productionPipeline({ input, format, size, orientation = 'portrait', focalPoint = 'centre' }) {
  const spec = productionSpecFor({ format, size, orientation });
  const base = sharp(input, {
    failOn: 'warning',
    limitInputPixels: false,
    sequentialRead: true
  })
    .rotate();

  if (spec.kind === 'poster') {
    return base
      .resize(spec.output.width, spec.output.height, {
        fit: 'cover',
        position: focalPoint
      })
      .withMetadata({ density: spec.dpi })
      .jpeg({
        quality: 96,
        chromaSubsampling: '4:4:4',
        progressive: true
      });
  }

  const bleed = spec.mirrorBleedPx;
  return base
    .resize(spec.face.width, spec.face.height, {
      fit: 'cover',
      position: focalPoint
    })
    .extend({
      top: bleed,
      bottom: bleed,
      left: bleed,
      right: bleed,
      extendWith: 'mirror'
    })
    .withMetadata({ density: spec.dpi })
    .jpeg({
      quality: 96,
      chromaSubsampling: '4:4:4',
      progressive: true
    });
}

export async function renderProductionArtwork({
  input,
  format,
  size,
  orientation = 'portrait',
  focalPoint = 'centre'
}) {
  return productionPipeline({ input, format, size, orientation, focalPoint }).toBuffer();
}

export async function renderProductionArtworkToFile({
  input,
  outputPath,
  format,
  size,
  orientation = 'portrait',
  focalPoint = 'centre'
}) {
  if (!outputPath) throw new Error('Production outputPath is required');
  return productionPipeline({ input, format, size, orientation, focalPoint }).toFile(outputPath);
}

export function publicProductionSpecs() {
  return {
    dpi: specs.dpi,
    canvasMirrorBleedInches: specs.canvasMirrorBleedInches,
    safeInsetInches: specs.safeInsetInches,
    poster: specs.poster,
    canvas: specs.canvas,
    framedCanvas: specs.framedCanvas
  };
}
