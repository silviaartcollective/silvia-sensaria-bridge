// Listing templates: the defaults the Product Creator fills in for a new Etsy
// listing, one set per artwork orientation (Listings → Templates). Every field
// is optional; an empty one keeps the Product Creator's automatic default (the
// shop's most common setting, or the built-in description).
import {getJsonObject,putJsonObject,isMissingR2Object} from './r2.mjs';
import {canonicalWallArtStyle} from './etsy-style.mjs';
import {masterListingTags} from './master-listings.mjs';

export const TEMPLATE_ORIENTATIONS=Object.freeze(['portrait','landscape','square','panoramic']);
const KEY='settings/listing-templates.json';
const ETSY_IDS=['shipping_profile_id','readiness_state_id','shop_section_id','return_policy_id','production_partner_id'];
// 0 means "none" where Etsy allows it (no shop section, no production partner).
const NONE_ALLOWED=new Set(['shop_section_id','production_partner_id']);
const CHOICES={who_made:['i_did','collective','someone_else'],when_made:['made_to_order','2020_2026']};
export const DESCRIPTION_PLACEHOLDER='{{SHORT_SEO_DESCRIPTION}}';

const unset=value=>value===undefined||value===null||value==='';
const yesNo=(value,label)=>{
  if(unset(value))return null;
  if(value===true||value==='true')return true;
  if(value===false||value==='false')return false;
  throw Error(label+' must be yes, no, or automatic.');
};

// Checks one orientation's template and keeps only known fields.
export function cleanListingTemplate(input){
  const source=input&&typeof input==='object'?input:{};
  const out={};
  if(!unset(source.listing_style)){
    const style=canonicalWallArtStyle(source.listing_style);
    if(!style)throw Error('Choose a valid Etsy Style.');
    out.listing_style=style;
  }
  const tags=masterListingTags(Array.isArray(source.tags)?source.tags:String(source.tags||'').split(','));
  if(tags.length)out.tags=tags;
  for(const field of ETSY_IDS){
    if(unset(source[field]))continue;
    const id=Number(source[field]);
    if(!Number.isSafeInteger(id)||id<0||(id===0&&!NONE_ALLOWED.has(field)))throw Error('Invalid '+field.replace(/_/g,' ')+'.');
    out[field]=id;
  }
  for(const [field,options] of Object.entries(CHOICES)){
    if(unset(source[field]))continue;
    if(!options.includes(String(source[field])))throw Error('Invalid '+field.replace(/_/g,' ')+'.');
    out[field]=String(source[field]);
  }
  const supply=yesNo(source.is_supply,'Finished product'),renew=yesNo(source.should_auto_renew,'Auto renew');
  if(supply!==null)out.is_supply=supply;
  if(renew!==null)out.should_auto_renew=renew;
  const description=String(source.description_template||'').replace(/\r\n/g,'\n');
  if(description.trim()){
    if(!description.includes(DESCRIPTION_PLACEHOLDER))
      throw Error('The description template needs '+DESCRIPTION_PLACEHOLDER+' where the artwork\'s SEO description goes.');
    if(description.length>12000)throw Error('The description template must be 12,000 characters or fewer.');
    out.description_template=description;
  }
  return out;
}

export async function loadListingTemplates(){
  let stored=null;
  try{stored=await getJsonObject(KEY)}catch(error){if(!isMissingR2Object(error))throw error}
  const orientations={};
  for(const orientation of TEMPLATE_ORIENTATIONS){
    // A stored template that no longer validates is ignored, not used half-way.
    try{orientations[orientation]=cleanListingTemplate(stored?.orientations?.[orientation])}
    catch{orientations[orientation]={}}
  }
  return {orientations,updatedAt:stored?.updatedAt||null};
}

export async function saveListingTemplate(orientation,input){
  if(!TEMPLATE_ORIENTATIONS.includes(orientation))throw Error('Choose vertical, horizontal, square or panoramic.');
  const template=cleanListingTemplate(input);
  const current=await loadListingTemplates();
  const next={orientations:{...current.orientations,[orientation]:template},updatedAt:new Date().toISOString()};
  await putJsonObject(KEY,next);
  return next;
}

// The description for a new listing: the orientation's template, else the built-in one.
export function listingDescription(template,builtIn,{seoDescription='',shopSectionName='',shopSectionUrl=''}={}){
  return String(template?.description_template||builtIn)
    .replace(DESCRIPTION_PLACEHOLDER,seoDescription)
    .replace('{{SHOP_SECTION_NAME}}',shopSectionName)
    .replace('{{SHOP_SECTION_URL}}',shopSectionUrl);
}
