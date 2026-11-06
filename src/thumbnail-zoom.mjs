// A slight centred zoom on a listing's first photo, the one Etsy shows as the
// thumbnail in search: the same effect as a few clicks of Etsy's "Adjust
// thumbnail" zoom, which the Etsy API cannot set. The photo keeps its size;
// only its edges are trimmed. THUMBNAIL_ZOOM_PERCENT in Render (default 15,
// 0 turns it off).
import sharp from 'sharp';

export function thumbnailZoomPercent(env = process.env) {
  const value = Number(env.THUMBNAIL_ZOOM_PERCENT ?? 15);
  return Number.isFinite(value) ? Math.min(50, Math.max(0, value)) : 15;
}

// The image zoomed in by `percent` (15: 15% closer), same width and height, JPEG.
export async function zoomForThumbnail(buffer, { percent = thumbnailZoomPercent() } = {}) {
  if (!(percent > 0)) return buffer;
  const image = sharp(buffer, { limitInputPixels: false }).rotate();
  const { width, height } = await image.metadata();
  if (!width || !height) return buffer;
  const scale = 1 + percent / 100;
  const cropWidth = Math.max(1, Math.round(width / scale)), cropHeight = Math.max(1, Math.round(height / scale));
  return image
    .extract({ left: Math.floor((width - cropWidth) / 2), top: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight })
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
