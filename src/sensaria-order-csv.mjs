import {parseFulfillmentSku,shippingAddressDigest,quoteSignature} from './regular-order-routing.mjs';

export function validateSensariaCsvOrder(order,receipt,shopId) {
  const review=order?.review||{};
  const plan=review.regularPlan;
  if(String(review.classification||'')!=='regular' ||
     !['awaiting_supplier_approval','approved_for_manual_order'].includes(String(review.status||'')) ||
     !plan || String(plan.supplier||'').toLowerCase()!=='sensaria') {
    throw new Error('An active Sensaria supplier recommendation is required before downloading its CSV.');
  }
  if(plan.signature!==quoteSignature(plan))
    throw new Error('Supplier recommendation integrity check failed. Refresh the quote.');
  if(review.supplierOrderId || review.approval?.supplierOrderSubmitted)
    throw new Error('This order was already submitted to a supplier; duplicate CSV preparation is blocked.');
  if(receipt?.was_paid!==true && receipt?.is_paid!==true)
    throw new Error('Etsy no longer confirms that the order is paid.');
  if(receipt?.was_canceled||receipt?.is_canceled||receipt?.is_cancelled ||
     /cancel(?:ed|led)/i.test(String(receipt?.status||'')))
    throw new Error('Cancelled Etsy orders cannot produce a supplier CSV.');
  if(receipt?.was_shipped||receipt?.is_shipped ||
     (Array.isArray(receipt?.shipments) && receipt.shipments.length))
    throw new Error('This Etsy order is already shipped.');
  const id=String(receipt?.receipt_id||receipt?.id||'');
  if(!/^[1-9]\d{0,19}$/.test(id) || String(plan.receiptId)!==id ||
     String(plan.shopId)!==String(shopId) ||
     (receipt.shop_id && String(receipt.shop_id)!==String(shopId)))
    throw new Error('Etsy receipt does not match the authorized shop and recommendation.');
  const lines=Array.isArray(receipt?.transactions)?receipt.transactions:[];
  if(lines.length!==1 || Number(lines[0]?.quantity)!==1)
    throw new Error('Only one-item Etsy receipts can use the automatic supplier CSV.');
  const parsed=parseFulfillmentSku(lines[0].sku);
  if(String(plan.sku)!==parsed.sku ||
     String(plan.artworkId)!==parsed.artworkId ||
     String(plan.size)!==parsed.size ||
     String(plan.productCode)!==parsed.productCode ||
     String(plan.countryCode)!==String(receipt.country_iso||'').toUpperCase() ||
     plan.addressDigest!==shippingAddressDigest(receipt))
    throw new Error('Etsy purchase details changed. Refresh supplier recommendation before CSV download.');
  if(review.status==='awaiting_supplier_approval' &&
     Number.isFinite(Date.parse(plan.expiresAt)) && Date.now()>Date.parse(plan.expiresAt))
    throw new Error('Supplier quote expired. Refresh the live recommendation before downloading a CSV.');
  return {plan,parsed};
}
