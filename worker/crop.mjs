import os from 'node:os';
import sharp from 'sharp';

sharp.cache(false);
sharp.concurrency(Math.max(1, Math.min(8, os.cpus().length)));

function effectiveDimensions(metadata = {}) {
  let width = Number(metadata.width || 0);
  let height = Number(metadata.height || 0);
  const exifOrientation = Number(metadata.orientation || 1);
  if ([5, 6, 7, 8].includes(exifOrientation)) [width, height] = [height, width];
  return { width, height };
}

export async function inspectMaster(masterPath, orientation) {
  const metadata = await sharp(masterPath, {
    limitInputPixels: false,
    sequentialRead: true
  }).metadata();
  const dimensions = effectiveDimensions(metadata);
  if (!dimensions.width || !dimensions.height) {
    throw new Error('Could not determine master artwork dimensions.');
  }

  return {
    ...dimensions,
    exifOrientation: Number(metadata.orientation || 1),
    orientation: (() => {
      const requested = String(orientation || '').trim().toLowerCase();
      if (requested === 'square') return 'square';
      if (requested === 'landscape' || requested === 'horizontal') return 'landscape';
      return 'portrait';
    })()
  };
}

export function calculateCenterCrop(width, height, targetWidth, targetHeight) {
  const sourceWidth = Math.max(1, Math.floor(Number(width) || 0));
  const sourceHeight = Math.max(1, Math.floor(Number(height) || 0));
  const targetRatio = Number(targetWidth) / Number(targetHeight);
  const sourceRatio = sourceWidth / sourceHeight;

  if (!Number.isFinite(targetRatio) || targetRatio <= 0) {
    throw new Error('Invalid production crop target.');
  }

  if (sourceRatio > targetRatio) {
    return {
      width: Math.max(1, Math.floor(sourceHeight * targetRatio)),
      height: sourceHeight
    };
  }
  return {
    width: sourceWidth,
    height: Math.max(1, Math.floor(sourceWidth / targetRatio))
  };
}

export function validateRatioSource(master, ratio, target) {
  const requiredWidth = Number(target?.width || 0);
  const requiredHeight = Number(target?.height || 0);
  if (!requiredWidth || !requiredHeight) {
    throw new Error(`Missing production target for ${ratio}.`);
  }

  const crop = calculateCenterCrop(
    master.width,
    master.height,
    requiredWidth,
    requiredHeight
  );

  return {
    required: {
      width: requiredWidth,
      height: requiredHeight
    },
    crop,
    upscaled: crop.width < requiredWidth || crop.height < requiredHeight
  };
}

export async function generateProductionCrop({
  masterPath,
  outputPath,
  master,
  ratio,
  target
}) {
  const { required, crop } = validateRatioSource(master, ratio, target);
  let image = sharp(masterPath, {
    limitInputPixels: false,
    sequentialRead: true
  });

  if (master.exifOrientation !== 1) image = image.rotate();

  await image
    .resize({
      width: required.width,
      height: required.height,
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: true
    })
    .flatten({ background: '#ffffff' })
    .jpeg({
      quality: 95,
      chromaSubsampling: '4:4:4',
      progressive: true,
      optimiseCoding: true
    })
    .withMetadata({ density: 300 })
    .toFile(outputPath);

  const output = await sharp(outputPath).metadata();
  if (output.width !== required.width || output.height !== required.height) {
    throw new Error(
      `Generated ${ratio} crop is ${output.width}×${output.height}; expected ` +
      `${required.width}×${required.height}.`
    );
  }

  return {
    ratio,
    width: required.width,
    height: required.height,
    sourceCropWidth: crop.width,
    sourceCropHeight: crop.height,
    density: Number(output.density || 300),
    upscaled: crop.width < required.width || crop.height < required.height
  };
}
