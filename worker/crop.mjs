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
      const actual=dimensions.width>dimensions.height?'landscape':
        dimensions.height>dimensions.width?'portrait':'square';
      const requested=String(orientation||'').trim().toLowerCase();
      if(actual==='square')throw Error('Square artwork requires dedicated square production ratios.');
      if((requested==='landscape'||requested==='portrait')&&requested!==actual)
        throw Error('Master orientation mismatch: actual image is '+actual+
          ', but crop job is '+requested+'. Reconfirm artwork upload and queue a corrected crop job.');
      return actual;
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
  // Reference dimensions indicate the aspect ratio and the nominal 300-PPI
  // goal. They are NEVER an instruction to upscale the source image.
  const requiredWidth = Number(target?.width || 0);
  const requiredHeight = Number(target?.height || 0);
  if (!requiredWidth || !requiredHeight) {
    throw new Error(`Missing production target for ${ratio}.`);
  }
  const crop = calculateCenterCrop(master.width, master.height, requiredWidth, requiredHeight);
  return {
    required: { width: requiredWidth, height: requiredHeight },
    crop,
    upscaled: false,
    recommendedPixelsMet: crop.width >= requiredWidth && crop.height >= requiredHeight
  };
}

export async function generateProductionCrop({
  masterPath,
  outputPath,
  master,
  ratio,
  target
}) {
  const { required, crop, recommendedPixelsMet } = validateRatioSource(master, ratio, target);
  // Extract the full-resolution crop directly from the original pixels. Do not
  // enlarge tiny masters or shrink larger masters to fixed 300-PPI dimensions.
  const left = Math.floor((master.width - crop.width) / 2);
  const top = Math.floor((master.height - crop.height) / 2);
  await sharp(masterPath, { limitInputPixels: false, sequentialRead: true })
    .rotate()
    .extract({ left, top, width: crop.width, height: crop.height })
    .flatten({ background: '#ffffff' })
    .jpeg({
      quality: 88,
      chromaSubsampling: '4:2:0',
      progressive: true,
      optimiseCoding: true
    })
    .withMetadata({ density: 300 })
    .toFile(outputPath);

  const output = await sharp(outputPath).metadata();
  if (output.width !== crop.width || output.height !== crop.height) {
    throw new Error(
      `Generated ${ratio} crop is ${output.width}×${output.height}; expected native ` +
      `${crop.width}×${crop.height}.`
    );
  }
  return {
    ratio,
    width: crop.width,
    height: crop.height,
    sourceCropWidth: crop.width,
    sourceCropHeight: crop.height,
    sourceMasterWidth: master.width,
    sourceMasterHeight: master.height,
    density: Number(output.density || 300),
    recommendedPixelsMet,
    upscaled: false
  };
}
