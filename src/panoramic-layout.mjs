// A panoramic listing is a *layout*, not a new physical image orientation.
// Keep the master and crop worker orientation as landscape. Only the Etsy
// variation inventory uses the panoramic size and pricing ladder.
// Mockups use the same ratio (src/mockup-orientation.mjs).
export const PANORAMIC_LAYOUT_RATIO=1.85;
export function listingLayoutForManifest(manifest){
 const orientation=String(manifest?.orientation||manifest?.master?.orientation||'').trim().toLowerCase();
 if(orientation!=='landscape')return orientation;
 const w=Number(manifest?.master?.width||0),h=Number(manifest?.master?.height||0);
 if(w>0&&h>0&&w/h>=PANORAMIC_LAYOUT_RATIO)return 'panoramic';
 return 'landscape';
}

// Reconverted listings must use the new, verified R2 master dimensions. The
// previous manifest remains active until Etsy has accepted the replacement
// inventory, so using it here would quietly leave the wrong size ladder.
export function listingLayoutForReconversion(manifest, replacementRecord = null) {
 if (!replacementRecord) return listingLayoutForManifest(manifest);
 const orientation=String(replacementRecord.orientation||'').trim().toLowerCase();
 const previous=String(manifest?.orientation||'').trim().toLowerCase();
 const geometry=replacementRecord.masterGeometry;
 const width=Number(geometry?.width),height=Number(geometry?.height);
 if(!width||!height||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
  throw Error('Verified replacement master dimensions are required before changing Etsy variants.');
 if(orientation!==previous || (geometry?.orientation&&String(geometry.orientation).toLowerCase()!==orientation))
  throw Error('Replacement orientation differs from the original listing; no Etsy inventory changes allowed.');
 return listingLayoutForManifest({orientation,master:{width,height}});
}
