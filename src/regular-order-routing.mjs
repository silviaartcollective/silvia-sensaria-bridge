import crypto from 'node:crypto';
import {readOrder,saveReview,paidReceipt,validReceiptId} from './custom-order-store.mjs';
import {lookupCustomSize} from './custom-size-lookup.mjs';
import {resolveProviderArtworkAsset} from './fulfillment-assets.mjs';
import {artworkObjectExists} from './r2.mjs';

const PREFIX='SAC';
const SIZES=['8x10','11x14','12x16','12x18','16x20','16x24','18x24','24x36','30x40','40x60'];
const FRAME={NAT:'Natural',BRN:'Brown',BLK:'Black',WHT:'White'};
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const words=v=>String(v??'').trim();
export function shippingAddressDigest(receipt) {
 const fields=['name','first_line','second_line','city','state','zip','country_iso'];
 if(!words(receipt?.first_line)||!words(receipt?.city)||!words(receipt?.country_iso))
   throw new Error('Etsy shipping address is incomplete. Verify it manually before preparing supplier fulfillment.');
 return crypto.createHash('sha256').update(
   JSON.stringify(fields.map(key=>words(receipt[key]).toLowerCase()))
 ).digest('hex');
}
export function parseFulfillmentSku(sku){
  const value=words(sku).toUpperCase();
  const match=new RegExp('^('+PREFIX+'[0-9]{4,})-(FC|P|C)-([0-9]{3,4})(?:-(NAT|BRN|BLK|WHT))?$').exec(value);
  if(!match)throw new Error('This item does not have a converted '+PREFIX+' variant SKU. Review fulfillment manually.');
  const [,artworkId,productCode,encoded,finishCode]=match;
  const size=SIZES.find(s=>s.replace('x','')===encoded);
  if(!size)throw new Error('Size in converted SKU is not in the approved product catalog.');
  if((productCode==='FC'&&!finishCode)||(productCode!=='FC'&&finishCode))
    throw new Error('Framed canvas SKU must include a known frame colour; non-framed products must not include one.');
  const [width,height]=size.split('x').map(Number);
  return {sku:value,artworkId,productCode,size,width,height,frame:finishCode?FRAME[finishCode]:'',finishCode:finishCode||'NONE'};
}
export function eligibleRegularReceipt(order,expectedShopId) {
  const receipt=order?.staged?.receipt||{};
  if(receipt.was_paid!==true&&receipt.is_paid!==true)throw new Error('Etsy must explicitly confirm this receipt was paid.');
  if(!paidReceipt(receipt,order?.staged?.source)||receipt.is_canceled||receipt.was_canceled||receipt.is_cancelled)
    throw new Error('Canceled or unpaid receipts cannot enter fulfillment.');
  if(receipt.is_shipped===true||receipt.was_shipped===true||(receipt.shipments||[]).length>0)
    throw new Error('Etsy already considers the receipt shipped; no new supplier order should be placed.');
  if(receipt.shop_id&&String(receipt.shop_id)!==String(expectedShopId))
    throw new Error('This receipt belongs to another Etsy shop.');
  if(order?.review?.classification==='custom')throw new Error('Custom purchases must use Custom Orders.');
  if(['approved_for_manual_order','manually_ordered','supplier_submitted','submitted','fulfilled'].includes(order?.review?.status))
    throw new Error('The order has already been placed or fulfilled. Do not submit another.');
  if(order?.review?.approval?.supplierOrderSubmitted || order?.review?.supplierOrderId)
    throw new Error('Supplier order already recorded for this receipt.');
  const transactions=Array.isArray(receipt.transactions)?receipt.transactions:[];
  if(transactions.length!==1||Number(transactions[0].quantity)!==1)
    throw new Error('One purchased item with quantity one is required for safe routing; review bundles and multi-item orders manually.');
  const countryCode=words(receipt.country_iso).toUpperCase();
  if(!/^[A-Z]{2}$/.test(countryCode))
    throw new Error('Etsy shipping country is missing or invalid. Verify the destination before quoting.');
  const addressDigest=shippingAddressDigest(receipt);
  const item=parseFulfillmentSku(transactions[0].sku);
  return {receiptId:validReceiptId(receipt.receipt_id||receipt.id),countryCode,item,
    buyer:words(receipt.name)||'Etsy buyer',quantity:1,addressDigest,sourceListingId:transactions[0].listing_id||null};
}
export function rankEligibleOffers(lookup) {
 const choices=Object.entries(lookup?.suppliers||{}).flatMap(([key,v])=>{
   const quote=Number(v?.totalUsd),modeled=Number(v?.modeledLandedUsd??v?.totalUsd);
   if(!v?.eligible||v?.status!=='available'||!Number.isFinite(quote)||quote<=0||
      !Number.isFinite(modeled)||modeled<=0)return [];
   return [{supplier:key,provider:v.provider||key,quotedTotalUsd:money(quote),
     modeledLandedUsd:money(modeled),shippingUsd:v.shippingCost??null,
     currency:'USD',basis:words(v.basis),quoteDetails:v.meta||{}}];
 });
 return choices.sort((a,b)=>a.modeledLandedUsd-b.modeledLandedUsd);
}
export function quoteSignature(plan) {
 return crypto.createHash('sha256').update(JSON.stringify({
  receiptId:plan.receiptId,shopId:plan.shopId,sku:plan.sku,
  countryCode:plan.countryCode,addressDigest:plan.addressDigest,artworkId:plan.artworkId,assetKey:plan.assetKey,
  supplier:plan.supplier,cost:plan.quotedTotalUsd,modeled:plan.modeledLandedUsd,
  generatedAt:plan.generatedAt
 })).digest('hex');
}
export async function prepareRegularRoute(receiptId,shopId){
 const order=await readOrder(receiptId);
 const {item,countryCode,buyer,addressDigest,sourceListingId}=eligibleRegularReceipt(order,shopId);
 const asset=await resolveProviderArtworkAsset({artworkId:item.artworkId,size:item.size});
 if(!(await artworkObjectExists(asset.key)))
   throw new Error('Artwork crop is marked ready but the image is missing from R2.');
 const live=await lookupCustomSize({
   countryCode,productCode:item.productCode,width:item.width,height:item.height,
   frame:item.frame,shippingMode:'included'
 });
 const eligible=rankEligibleOffers(live);
 if(!eligible.length)throw new Error('No supplier returned a complete eligible production + shipping quote. Review manually.');
 const winner=eligible[0],generatedAt=new Date().toISOString();
 const plan={
  version:1,receiptId:validReceiptId(receiptId),shopId:String(shopId),
  buyer,sourceListingId,addressDigest,sku:item.sku,artworkId:item.artworkId,
  productCode:item.productCode,size:item.size,frame:item.frame,countryCode,
  assetKey:asset.key,assetRatio:asset.ratio,assetWidth:asset.width,assetHeight:asset.height,
  supplier:winner.supplier,provider:winner.provider,quotedTotalUsd:winner.quotedTotalUsd,
  modeledLandedUsd:winner.modeledLandedUsd,shippingUsd:winner.shippingUsd,
  alternatives:eligible.map(v=>({supplier:v.supplier,provider:v.provider,
    quotedTotalUsd:v.quotedTotalUsd,modeledLandedUsd:v.modeledLandedUsd})),
  quoteBasis:winner.basis,quoteDetails:winner.quoteDetails,
  generatedAt,expiresAt:new Date(Date.now()+30*60*1000).toISOString(),
  submissionStatus:'not_submitted',reviewRequired:true
 };
 plan.signature=quoteSignature(plan);
 const review={...order.review,classification:'regular',status:'awaiting_supplier_approval',
  regularPlan:plan,approval:null,updatedAt:generatedAt};
 await saveReview(receiptId,review);
 return {plan,review};
}
export async function approveRegularRoute(receiptId,shopId,input){
 const order=await readOrder(receiptId);
 const current=eligibleRegularReceipt(order,shopId);
 const review=order.review,plan=review?.regularPlan;
 if(review?.status!=='awaiting_supplier_approval'||!plan)
   throw new Error('Prepare a regular-order quote before approval.');
 if(plan.signature!==quoteSignature(plan))
   throw new Error('Stored supplier recommendation was modified. Rebuild the quote.');
 if(plan.shopId!==String(shopId)||plan.receiptId!==validReceiptId(receiptId) ||
  plan.sku!==current.item.sku||plan.countryCode!==current.countryCode||
  plan.addressDigest!==current.addressDigest)
   throw new Error('The Etsy order changed since preparation. Rebuild the quote.');
 if(Date.now()>Date.parse(plan.expiresAt)||!Number.isFinite(Date.parse(plan.expiresAt)))
   throw new Error('The quote is older than 30 minutes. Refresh prices first.');
 if(input?.confirm!=='APPROVE FOR REVIEW'||
    input?.addressVerified!==true||input?.artworkVerified!==true||
    input?.variantVerified!==true||input?.priceVerified!==true)
   throw new Error('Verify Etsy address, artwork/crop, supplier variant and quoted total.');
 const currentAsset=await resolveProviderArtworkAsset({artworkId:plan.artworkId,size:plan.size});
 if(currentAsset.key!==plan.assetKey||!(await artworkObjectExists(plan.assetKey)))
   throw new Error('The fulfillment artwork has changed or disappeared. Rebuild the quote.');
 const now=new Date().toISOString();
 const approved={...review,status:'approved_for_manual_order',
   updatedAt:now,approval:{approvedAt:now,method:'review_only',
     supplierOrderSubmitted:false,planSignature:plan.signature}};
 await saveReview(receiptId,approved);
 return approved;
}
