// A panoramic listing is a *layout*, not a new physical image orientation.
// Keep the master and crop worker orientation as landscape. Only the Etsy
// variation inventory uses the panoramic size and pricing ladder.
export function listingLayoutForManifest(manifest){
 const orientation=String(manifest?.orientation||manifest?.master?.orientation||'').trim().toLowerCase();
 if(orientation!=='landscape')return orientation;
 const w=Number(manifest?.master?.width||0),h=Number(manifest?.master?.height||0);
 if(w>0&&h>0&&w/h>=1.85)return 'panoramic';
 return 'landscape';
}
