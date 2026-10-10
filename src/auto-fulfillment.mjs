import {readOrder,saveReview,inferOrder,validReceiptId} from './custom-order-store.mjs';
import {prepareRegularRoute} from './regular-order-routing.mjs';

const locked = new Set();
const LIMIT=50;
export function automaticPreparationDecision(order,{force=false,now=Date.now()}={}){
 const review=order?.review||{};
 const receipt=order?.staged?.receipt||{};
 const status=String(review.status||'');
 if(receipt.is_shipped===true||receipt.was_shipped===true||
    receipt.is_cancelled||receipt.is_canceled||receipt.was_canceled||
    Array.isArray(receipt.shipments)&&receipt.shipments.length>0)
   return {action:'skip',reason:'Already shipped or canceled Etsy receipt.'};
 if(receipt.was_paid===false||receipt.is_paid===false)
   return {action:'skip',reason:'Receipt is not paid.'};
 if(['custom','possible_custom'].includes(review.classification) ||
    (review.classification!=='regular' && inferOrder(order?.staged?.receipt).categoryHint==='possible_custom'))
   return {action:'skip',reason:'Custom or possible-custom purchases require separate review.'};
 if(['approved_for_manual_order','manually_ordered','supplier_submitted','submitted','fulfilled'].includes(status) ||
    review.approval?.supplierOrderSubmitted || review.supplierOrderId)
   return {action:'skip',reason:'Previously approved or placed supplier order cannot be repriced automatically.'};
 if(status==='awaiting_supplier_approval' && review.regularPlan)
   return {action:'skip',reason:'Supplier recommendation already prepared. Refresh only before approval.'};
 if(!force && review.automaticRouting?.status==='manual_review')
   return {action:'skip',reason:'Previous validation requires manual review.'};
 if(!force && review.automaticRouting?.status==='retry' &&
    now<Date.parse(review.automaticRouting.retryAfter||''))
   return {action:'skip',reason:'Waiting for next transient-error retry.'};
 return {action:'prepare',reason:''};
}
export function classifyAutomaticFailure(error){
 const message=String(error?.message||error||'').slice(0,450);
 const permanent=/converted .{0,30}sku|sku.*approved product|unsupported|not in the approved|one purchased item|quantity one|different etsy shop|another etsy shop|already shipped|canceled|unpaid|not.*paid|custom|missing.*country|shipping country|shipping address is incomplete|variation|incompatible|no enabled|production-ready|source artwork/i.test(message);
 return {message,kind:permanent?'manual_review':'retry'};
}
export async function automaticallyPrepareReceipt(id,shopId,{
  read=readOrder,prepare=prepareRegularRoute,save=saveReview,log=console
}={}){
 const receiptId=validReceiptId(id);
 if(locked.has(receiptId))return {receiptId,status:'already_processing'};
 locked.add(receiptId);
 try {
   const order=await read(receiptId);
   const decision=automaticPreparationDecision(order);
   if(decision.action!=='prepare')
     return {receiptId,status:'skipped',reason:decision.reason};
   try{
     const result=await prepare(receiptId,shopId);
     // The planner writes its own reviewed quote atomically at the application level.
     return {receiptId,status:'ready',supplier:result.plan.supplier,
       modeledLandedUsd:result.plan.modeledLandedUsd};
   }catch(error){
     const failure=classifyAutomaticFailure(error);
     const current=await read(receiptId);
     // Do not destroy a quote or approval that another request created meanwhile.
     if(automaticPreparationDecision(current,{force:true}).action!=='prepare')
       return {receiptId,status:'skipped',reason:'Order state changed during preparation.'};
     const now=new Date().toISOString(),auto={
       status:failure.kind,message:failure.message,attemptedAt:now,
       retryAfter:failure.kind==='retry'?new Date(Date.now()+15*60*1000).toISOString():null
     };
     await save(receiptId,{...current.review,
       status:current.review?.status||'needs_review',
       automaticRouting:auto,updatedAt:now});
     log.warn?.('[auto-fulfillment] '+receiptId+' '+failure.kind+': '+failure.message);
     return {receiptId,status:failure.kind,reason:failure.message};
   }
 }finally{locked.delete(receiptId)}
}
export function selectAutomaticCandidates(receipts,existingReviews,limit=LIMIT,now=Date.now()){
 const result=[];
 for(const record of receipts||[]){
   const id=String(record?.receipt_id||record?.id||'');
   if(!/^[1-9]\d{0,19}$/.test(id))continue;
   if(record?.was_paid!==true&&record?.is_paid!==true)continue;
   if(record?.is_shipped===true||record?.was_shipped===true||
      record?.is_canceled||record?.was_canceled||record?.is_cancelled)continue;
   const review=existingReviews?.[id]||null;
   if(automaticPreparationDecision({staged:{receipt:record},review},{now}).action==='prepare'){
     result.push(id);
   }
   if(result.length>=Math.min(50,Math.max(1,limit)))break;
 }
 return result;
}
