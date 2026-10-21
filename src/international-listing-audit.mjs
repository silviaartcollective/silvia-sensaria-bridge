import {readFileSync} from 'node:fs';
import {parseSilviaSku} from './core.mjs';
import {previewShippingCountry} from './international-shipping-planner.mjs';

const catalog=JSON.parse(readFileSync(new URL('../config/products.json',import.meta.url),'utf8'));
const round=v=>Number(Number(v).toFixed(2));
export function auditListingDestination({
 inventory,country='US',state='',feePercent=12,bufferPercent=15,
 maxSupplierCostUsd=150,shopCurrency='',usdToShopCurrency=null
}={}){
 const cc=String(country).trim().toUpperCase();
 const currency=String(shopCurrency||'').trim().toUpperCase();
 const currencyKnown=/^[A-Z]{3}$/.test(currency);
 // A USD shop needs no FX conversion. Other shops require an explicit rate.
 const rate=usdToShopCurrency===null||usdToShopCurrency===''?
   (currency==='USD'?1:null):Number(usdToShopCurrency);
 if(rate!==null&&(!Number.isFinite(rate)||rate<=0||rate>100))
  throw Error('USD-to-shop-currency conversion must be a positive verified exchange rate.');
 if(!Array.isArray(inventory?.products))throw Error('Etsy inventory is missing its product variants.');
 const variants=[],unverified=[],seen=new Set();
 for(const product of inventory.products){
   const sku=String(product?.sku||'').trim().toUpperCase();
   const enabled=(product?.offerings||[]).some(o=>o?.is_enabled===true && Number(o.quantity)>0);
   if(!enabled)continue;
   if(!sku){unverified.push('An enabled variation has no SKU');continue;}
   if(seen.has(sku))continue;
   seen.add(sku);
   let parsed;
   try{parsed=parseSilviaSku(sku);}
   catch{unverified.push('Enabled SKU '+sku+' is not a supported SAC supplier SKU');continue;}
   const key=[parsed.format,parsed.size,parsed.frame||'NONE'].join('|');
   if(!catalog[key]?.friendlySku){
     unverified.push('Enabled SKU '+sku+' has no verified Sensaria product mapping.');
     continue;
   }
   const estimate=previewShippingCountry({
     format:parsed.format,size:parsed.size,country:cc,state,
     feePercent,bufferPercent,maxSupplierCostUsd:2000
   });
   if(estimate.capturedBasicShippingUsd===null){
     unverified.push('Enabled SKU '+sku+' has no captured Sensaria Basic rate.');
   }
   variants.push({sku,format:parsed.format,size:parsed.size,frame:parsed.frame,
     basicShippingUsd:estimate.capturedBasicShippingUsd,zone:estimate.zone,
     taxVerified:estimate.taxVerified});
 }
 const biggest=variants.filter(x=>x.basicShippingUsd!==null)
   .sort((a,b)=>b.basicShippingUsd-a.basicShippingUsd)[0]||null;
 const blockers=[...unverified];
 if(!variants.length)blockers.push('No currently purchasable, verified supplier-mapped variations were found.');
 if(cc==='US'&&!state)blockers.push('US Etsy country profiles cannot distinguish Alaska or Hawaii from mainland US. Verify exposure or account for the 3A zone.');
 if(variants.some(x=>x.taxVerified===false))blockers.push('Supplier tax is not verified for all enabled variations.');
 if(biggest && biggest.basicShippingUsd>Number(maxSupplierCostUsd))
   blockers.push('Worst-case captured shipping exceeds the selected maximum supplier cost.');
 if(!biggest)blockers.push('No complete supplier shipping rate is available.');
 if(!currencyKnown)blockers.push('Etsy shop currency was not verified.');
 if(rate===null)blockers.push('Shop-currency conversion is not supplied/verified. USD amounts must not be published directly to a non-USD Etsy shop.');
 const usd=biggest && !unverified.length && biggest.basicShippingUsd<=Number(maxSupplierCostUsd)
   ?round(biggest.basicShippingUsd*(1+Number(bufferPercent)/100)/(1-Number(feePercent)/100)):null;
 return {
   previewOnly:true,updatedEtsy:false,country:cc,state:String(state||'').toUpperCase(),
   shopCurrency:currencyKnown?currency:'UNVERIFIED',
   variantCount:variants.length,variants,
   unverifiedVariants:unverified,worstCase:biggest,
   estimatedPrimaryShippingUsd:usd,
   estimatedPrimaryShippingInShopCurrency:usd!==null&&rate!==null&&currencyKnown?round(usd*rate):null,
   assumedUsdToShopCurrency:rate,
   recommendedSecondaryShipping:null,
   blockers:[...new Set(blockers)],
   safeToPublish:false,
   note:'Read-only capture-based calculation. Supplier product availability, current checkout totals, Etsy additional-item fees, taxes, duties, compliance and true origin must be verified before publishing.'
 };
}
