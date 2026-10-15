// Template orientation is determined by the frame/Smart Object placement,
 // NOT by the dimensions of the entire PSD background.
export function artworkOrientationFromPixels(width,height){
 const w=Number(width),h=Number(height);
 if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)
  throw Error('Artwork dimensions could not be verified.');
 if(w===h)return 'square';
 return w>h?'landscape':'portrait';
}
export function normalizeTemplateOrientation(value){
 const v=String(value||'unclassified').trim().toLowerCase();
 if(v==='vertical')return 'portrait';
 if(v==='horizontal')return 'landscape';
 if(['portrait','landscape','square','unclassified'].includes(v))return v;
 throw Error('Choose vertical, horizontal or square-compatible template orientation.');
}
export function templateMatchesArtwork(template,orientation){
 const artwork=normalizeTemplateOrientation(orientation);
 const kind=normalizeTemplateOrientation(template?.orientation);
 if(artwork==='unclassified')return false;
 if(artwork==='square')return kind==='square'||template?.squareCompatible===true;
 return kind===artwork;
}
export function validateTemplateSelection(templates,orientation){
 if(!['portrait','landscape','square'].includes(String(orientation)))
  throw Error('Detect the master artwork orientation before queueing mockups.');
 const mismatch=(templates||[]).find(t=>!templateMatchesArtwork(t,orientation));
 if(mismatch)throw Error('Template "'+String(mismatch.name||mismatch.id||'unknown')+
  '" is not designated for '+orientation+' artwork. Change its template orientation in the saved library.');
 return templates;
}
