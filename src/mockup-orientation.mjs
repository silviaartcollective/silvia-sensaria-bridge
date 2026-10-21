import {PANORAMIC_LAYOUT_RATIO} from './panoramic-layout.mjs';
// Template orientation is determined by the frame/Smart Object placement,
 // NOT by the dimensions of the entire PSD background.
export function artworkOrientationFromPixels(width,height){
 const w=Number(width),h=Number(height);
 if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)
  throw Error('Artwork dimensions could not be verified.');
 if(w===h)return 'square';
 return w>h?'landscape':'portrait';
}
// An artwork 1.85:1 or wider (2:1, 3:1 …) is panoramic: the same rule that gives
// its Etsy listing the panoramic size set (src/panoramic-layout.mjs). It gets
// panoramic templates; its crops stay landscape. The PC worker uses the same
// ratio for templates (worker/local-templates.mjs).
export const PANORAMIC_RATIO=PANORAMIC_LAYOUT_RATIO;
export function mockupOrientationFromPixels(width,height){
 const orientation=artworkOrientationFromPixels(width,height);
 return orientation==='landscape'&&Number(width)/Number(height)>=PANORAMIC_RATIO?'panoramic':orientation;
}
// The mockup orientation of an uploaded artwork, from its master's size when known.
export function mockupOrientationOf(manifest){
 const {width,height}=manifest?.master||{};
 if(Number(width)>0&&Number(height)>0)return mockupOrientationFromPixels(width,height);
 return manifest?.orientation||'unclassified';
}
export function normalizeTemplateOrientation(value){
 const v=String(value||'unclassified').trim().toLowerCase();
 if(v==='vertical')return 'portrait';
 if(v==='horizontal')return 'landscape';
 if(v==='panorama')return 'panoramic';
 if(['portrait','landscape','square','panoramic','unclassified'].includes(v))return v;
 throw Error('Choose vertical, horizontal, square-compatible or panoramic template orientation.');
}
export function templateMatchesArtwork(template,orientation){
 const artwork=normalizeTemplateOrientation(orientation);
 const kind=normalizeTemplateOrientation(template?.orientation);
 if(artwork==='unclassified')return false;
 if(artwork==='square')return kind==='square'||template?.squareCompatible===true;
 return kind===artwork;
}
export function validateTemplateSelection(templates,orientation){
 if(!['portrait','landscape','square','panoramic'].includes(String(orientation)))
  throw Error('Detect the master artwork orientation before queueing mockups.');
 const mismatch=(templates||[]).find(t=>!templateMatchesArtwork(t,orientation));
 if(mismatch)throw Error('Template "'+String(mismatch.name||mismatch.id||'unknown')+
  '" is not designated for '+orientation+' artwork. Change its template orientation in the saved library.');
 return templates;
}
