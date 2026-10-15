// Calculate a native-resolution, center-cropped production image. The desired
// production dimensions are a maximum, never an instruction to upscale.
// 48 MP keeps large 40x60 requests bounded on the small Render worker.
export const MAX_PRODUCTION_FACE_PIXELS = 48_000_000;

export function boundedProductionGeometry({
  sourceWidth, sourceHeight, targetWidth, targetHeight,
  maxPixels = MAX_PRODUCTION_FACE_PIXELS
}) {
  const numbers=[sourceWidth,sourceHeight,targetWidth,targetHeight,maxPixels].map(Number);
  if(numbers.some(x=>!Number.isFinite(x)||x<=0))
    throw Error('Production source/target dimensions must be positive.');
  const [w,h,tw,th,maxArea]=numbers;
  const ratio=tw/th;
  let cw=w, ch=Math.floor(w/ratio);
  if(ch>h){ch=h;cw=Math.floor(h*ratio);}
  cw=Math.max(1,Math.min(Math.floor(w),cw));
  ch=Math.max(1,Math.min(Math.floor(h),ch));
  const scale=Math.min(1,tw/cw,th/ch,Math.sqrt(maxArea/(cw*ch)));
  const ow=Math.max(1,Math.min(cw,Math.floor(cw*scale)));
  const oh=Math.max(1,Math.min(ch,Math.floor(ch*scale)));
  return {
    crop:{left:Math.floor((w-cw)/2),top:Math.floor((h-ch)/2),width:cw,height:ch},
    output:{width:ow,height:oh},
    resized:ow!==cw||oh!==ch,
    upscaled:false
  };
}
