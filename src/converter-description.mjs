// Etsy can return HTML-escaped punctuation and whitespace-normalized descriptions.
// Compare the buyer-visible text while retaining ALL words, numbers and URLs.
const HTML_ENTITIES={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
function decodeEtsyEntities(value) {
 return String(value).replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|quot|apos|lt|gt|nbsp);/gi,(match,name)=>{
  if(name[0]!=='#')return HTML_ENTITIES[name.toLowerCase()] ?? match;
  const hex=name[1]?.toLowerCase()==='x';
  const n=Number.parseInt(name.slice(hex?2:1),hex?16:10);
  return Number.isInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)
   ?String.fromCodePoint(n):match;
 });
}
export function normalizeEtsyDescription(value) {
 return decodeEtsyEntities(String(value??''))
  .normalize('NFC')
  .replace(/[\u00a0\u202f]/g,' ')
  .replace(/\uFEFF/g,'')
  .replace(/\r\n?/g,'\n')
  .replace(/[ \t]*\n[ \t]*/g,' ')
  .replace(/[ \t]+/g,' ')
  .trim();
}
export function sameEtsyDescription(actual,expected){
 return normalizeEtsyDescription(actual)===normalizeEtsyDescription(expected);
}
export function listingSeoPreservation(listing,expectedDescription,originalShopSectionId){
 const originalSection=Number(originalShopSectionId);
 const descriptionPreserved=sameEtsyDescription(listing?.description,expectedDescription);
 const sectionPreserved=!Number.isInteger(originalSection)||originalSection<=0||
  Number(listing?.shop_section_id)===originalSection;
 return {ok:descriptionPreserved&&sectionPreserved,descriptionPreserved,sectionPreserved};
}
// Diagnostic only: never print the entire shop description or an access token.
export function describeEtsyDescriptionDifference(actual,expected){
 const received=normalizeEtsyDescription(actual),wanted=normalizeEtsyDescription(expected);
 if(received===wanted)return 'Etsy returned equivalent text.';
 let position=0;
 while(position<Math.min(received.length,wanted.length)&&received[position]===wanted[position])position++;
 const excerpt=s=>JSON.stringify(s.slice(Math.max(0,position-18),Math.min(s.length,position+32)));
 return 'At text character '+(position+1)+'; expected '+excerpt(wanted)+
  ', Etsy returned '+excerpt(received)+' (expected '+wanted.length+
  ' characters; Etsy '+received.length+').';
}
