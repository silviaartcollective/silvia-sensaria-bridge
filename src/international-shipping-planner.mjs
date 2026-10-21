import {readFileSync} from 'node:fs';
import {
  basicShippingRateUsd,shippingZoneForAddress,
  sensariaShippingGroupFor,sensariaTaxRateForAddress
} from './pricing.mjs';

const rates=JSON.parse(readFileSync(new URL('../config/shipping-rates.json',import.meta.url),'utf8'));
const existing=JSON.parse(readFileSync(new URL('../config/etsy-shipping-profile.json',import.meta.url),'utf8'));
const sizeMatrix=JSON.parse(readFileSync(new URL('../config/size-matrix.json',import.meta.url),'utf8'));
const round=n=>Number(Number(n).toFixed(2));
const VALID_FORMATS=new Set(['P','C','FC']);
const isoRegion=new Intl.DisplayNames(['en'],{type:'region'});
const knownExisting=new Set((existing.destinations||[]).map(x=>x.countryIso));
export const shippingRateCapture=rates.source.capturedAt;
export const internationalShippingWarning='PLANNING ONLY. Captured shipping rates are not a current confirmed supplier quote. Etsy charges a single shipping-profile price for all variations within a listing; taxes, customs, regulatory requirements and shop currency must be verified before publishing.';

export function previewShippingCountry({format='FC',size='40x60',country='US',state='',feePercent=12,bufferPercent=15,maxSupplierCostUsd=150}={}){
  const f=String(format).toUpperCase(),s=String(size).trim(),cc=String(country).trim().toUpperCase();
  if(!VALID_FORMATS.has(f))throw Error('Select poster, canvas or framed canvas.');
  if(!/^\d{1,3}x\d{1,3}$/i.test(s))throw Error('Select a valid artwork size.');
  if(!/^[A-Z]{2}$/.test(cc))throw Error('Invalid country code.');
  const fee=Number(feePercent),buffer=Number(bufferPercent),ceiling=Number(maxSupplierCostUsd);
  if(!Number.isFinite(fee)||fee<0||fee>35||!Number.isFinite(buffer)||buffer<0||buffer>100||
     !Number.isFinite(ceiling)||ceiling<0||ceiling>2000)
    throw Error('Invalid shipping-fee or cost-limit setting.');
  const zone=shippingZoneForAddress({country:cc,state});
  const group=sensariaShippingGroupFor({format:f,size:s});
  const supplier=zone?basicShippingRateUsd({format:f,size:s,country:cc,state}):null;
  const tax=sensariaTaxRateForAddress({country:cc,state});
  const reasons=[];
  if(!zone||zone==='UNDELIVERABLE'||supplier===null||!Number.isFinite(supplier)){
    reasons.push('Sensaria has no captured Basic rate or flags this destination as undeliverable.');
  }else if(supplier>ceiling){
    reasons.push('Captured supplier shipping exceeds the selected cost ceiling.');
  }
  if(cc==='US'&&!state){
    const exceptions=['AK','HI'].map(st=>basicShippingRateUsd({format:f,size:s,country:cc,state:st}));
    if(exceptions.some(amount=>amount!==supplier))
      reasons.push('Alaska and Hawaii have separate Sensaria prices, but an Etsy country-level profile cannot set a different price by US state.');
  }
  if(tax.rate===null)reasons.push('Supplier checkout tax is unverified and excluded from this shipping quote.');
  const eligible=Boolean(zone&&zone!=='UNDELIVERABLE'&&supplier!==null&&Number.isFinite(supplier)&&supplier<=ceiling);
  // Fee reserve applies to collected shipping, not the existing artwork price.
  // Buffer protects the shipping portion only. This is NOT a full profit estimate.
  const recommendation=eligible?round((supplier*(1+buffer/100))/(1-fee/100)):null;
  return {
    country:cc,name:isoRegion.of(cc)||cc,zone:zone||'UNKNOWN',format:f,size:s,
    group,capturedBasicShippingUsd:supplier===null?null:round(supplier),
    estimatedCustomerShippingUsd:recommendation,
    feeReservePercent:fee,bufferPercent:buffer,
    taxVerified:tax.rate!==null,taxStatus:tax.status,
    existingFreeShippingCountry:knownExisting.has(cc),
    candidate:eligible,requiresReview:true,reasons,
    captureDate:shippingRateCapture
  };
}

export function internationalShippingPreview({format='FC',size='40x60',feePercent=12,bufferPercent=15,maxSupplierCostUsd=150}={}){
  const countries=[];
  const seen=new Set();
  for(const zone of ['1A','1B','1C','2A','2B','3A','3B','4','4NZ','5','ROW','UNDELIVERABLE']){
    for(const country of rates.zones[zone]?.countries||[]){
      if(seen.has(country))continue;
      seen.add(country);
      // Old catalog codes (e.g. XZ, AN) are not approved for automatic Etsy publishing.
      const doc=previewShippingCountry({format,size,country,feePercent,bufferPercent,maxSupplierCostUsd});
      const obsolete=['AN','XZ'].includes(country);
      if(obsolete){doc.candidate=false;doc.reasons.push('Historic/nonstandard country code: cannot publish as an Etsy destination.');}
      countries.push(doc);
    }
  }
  countries.sort((a,b)=>Number(b.existingFreeShippingCountry)-Number(a.existingFreeShippingCountry) ||
    a.name.localeCompare(b.name));
  return {
    previewOnly:true,updatedEtsy:false,
    capturedAt:shippingRateCapture,source:rates.source.name,
    format,size,feePercent:Number(feePercent),bufferPercent:Number(bufferPercent),
    maxSupplierCostUsd:Number(maxSupplierCostUsd),
    warning:internationalShippingWarning,
    countries,
    summary:{
      alreadyInFreeShipping: countries.filter(x=>x.existingFreeShippingCountry).length,
      capturedWithinCostLimit:countries.filter(x=>x.candidate).length,
      notCovered:countries.filter(x=>!x.candidate).length,
      unverifiedTaxes:countries.filter(x=>x.candidate&&!x.taxVerified).length
    }
  };
}

// A single Etsy shipping profile applies to every variant in that listing.
// Country-specific profile charges must use the MOST expensive enabled size,
// or variants must be split into different listings/profiles.
export function listingWorstCaseShippingPreview({country='US',feePercent=12,bufferPercent=15,maxSupplierCostUsd=150}={}){
  const candidates=[];
  for(const [size,formats] of Object.entries(sizeMatrix)){
    for(const [format,key] of [['P','fineArtPrint'],['C','canvas'],['FC','framedCanvas']]){
      if(formats?.[key]!==true)continue;
      try{candidates.push(previewShippingCountry({format,size,country,feePercent,bufferPercent,maxSupplierCostUsd:2000}));}
      catch{/* Unknown legacy size cannot be quoted. */}
    }
  }
  const unknown=candidates.filter(x=>x.capturedBasicShippingUsd===null);
  const max=candidates.filter(x=>x.capturedBasicShippingUsd!==null)
    .sort((a,b)=>b.capturedBasicShippingUsd-a.capturedBasicShippingUsd)[0]||null;
  const hasUnsupported=unknown.length>0;
  const maxCost=max?.capturedBasicShippingUsd??null;
  return {
    country:String(country).toUpperCase(),variantCount:candidates.length,
    unknownRateVariants:unknown.map(x=>x.format+' '+x.size),
    worstCase:max?{format:max.format,size:max.size,group:max.group,
      capturedBasicShippingUsd:max.capturedBasicShippingUsd}:null,
    estimatedOneProfileChargeUsd:(!hasUnsupported&&maxCost!==null&&maxCost<=Number(maxSupplierCostUsd))
      ?round((maxCost*(1+Number(bufferPercent)/100))/(1-Number(feePercent)/100)):null,
    safeToAutoPublish:false,
    reason:hasUnsupported
      ?'At least one enabled listing variation has no recorded Sensaria shipping rate.'
      :'Etsy shipping charges cannot vary by listing variation; this is only a conservative single-profile estimate.'
  };
}
