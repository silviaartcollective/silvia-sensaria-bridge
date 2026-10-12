// The wall-decor Style taxonomy values shown by Etsy's listing editor.
export const ETSY_WALL_ART_STYLES=Object.freeze([
  "Art deco",
  "Bohemian & eclectic",
  "Coastal & tropical",
  "Contemporary",
  "Country & farmhouse",
  "Gothic",
  "Lodge",
  "Mid-century",
  "Minimalist",
  "Rustic & primitive",
  "Victorian"
]);
const normalized=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
export function canonicalWallArtStyle(value){
 if(!String(value||'').trim())return '';
 return ETSY_WALL_ART_STYLES.find(option=>normalized(option)===normalized(value))||null;
}
export function styleAttributes(defaults,requestedStyle){
 const style=canonicalWallArtStyle(requestedStyle);
 if(style===null)throw Error('Unsupported Etsy Style: '+String(requestedStyle||'').slice(0,80));
 return Object.entries(defaults||{}).map(([attributeName,values])=>({
   attributeName,
   values:attributeName==='Style'&&style?[style]:values,
   optional:attributeName==='Sustainability'
 }));
}
