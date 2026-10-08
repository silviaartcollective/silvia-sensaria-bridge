import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { r2Client, r2Config, getJsonObject, putJsonObject } from './r2.mjs';
import { getShopReceipt, createReceiptShipment } from './etsy.mjs';
import { getGelatoOrderTracking } from './gelato.mjs';
import { getPrintifyOrderTracking } from './printify.mjs';
import { getProdigiOrder } from './prodigi.mjs';
import { getArteloOrder } from './artelo.mjs';
import { getPrintShrimpOrder } from './printshrimp.mjs';

const base = 'tracking/etsy/';
const SUPPLIERS = new Set(['sensaria','gelato','printify','prodigi','artelo','printshrimp']);
const text = value => String(value ?? '').trim();
export function receiptId(value) {
  const id = text(value);
  if (!/^[1-9][0-9]{0,19}$/.test(id)) throw new Error('Enter a valid numeric Etsy receipt ID.');
  return id;
}
function key(id) { return base + receiptId(id) + '/record.json'; }
function validSupplier(value) {
  const supplier = text(value).toLowerCase();
  if (!SUPPLIERS.has(supplier)) throw new Error('Select a supported supplier.');
  return supplier;
}
function orderId(value) {
  const id = text(value);
  if (!id || id.length > 180 || /[\r\n]/.test(id)) throw new Error('Enter a supplier order ID (maximum 180 characters).');
  return id;
}
function shopSession(session) {
  return { shopId: session.shop.shop_id, keystring: session.keystring,
    sharedSecret: session.sharedSecret, accessToken: session.accessToken };
}
export async function readTrackingRecord(id) {
  try { return await getJsonObject(key(id)); }
  catch (error) {
    if ([404,'NoSuchKey','NotFound','NoSuchBucket'].includes(error?.$metadata?.httpStatusCode) ||
        ['NoSuchKey','NotFound'].includes(error?.name)) return null;
    throw error;
  }
}
export async function listTrackingRecords(session) {
  const client = r2Client(), config = r2Config(), keys = [];
  let cursor;
  do {
    const data = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket, Prefix: base, ContinuationToken: cursor, MaxKeys: 1000
    }));
    for (const entry of data.Contents || []) {
      if (/^tracking\/etsy\/[1-9][0-9]{0,19}\/record\.json$/.test(entry.Key || '')) keys.push(entry.Key);
    }
    cursor = data.IsTruncated ? data.NextContinuationToken : null;
    if (keys.length >= 1000) break;
  } while (cursor);
  keys.sort((a,b) => b.localeCompare(a,undefined,{numeric:true}));
  const records = [];
  for (let i=0;i<Math.min(keys.length,300);i+=12) {
    const group = await Promise.all(keys.slice(i,i+12).map(async k => {
      try { const doc=await getJsonObject(k); return String(doc.shopId)===String(session.shop.shop_id) ? doc : null; }
      catch { return null; }
    }));
    records.push(...group.filter(Boolean));
  }
  return { records, count:records.length, truncated:keys.length>300 };
}
export async function verifyEtsyReceipt(session, id) {
  const receipt = await getShopReceipt({ ...shopSession(session), receiptId:receiptId(id) });
  if (receipt?.receipt_id == null || String(receipt.receipt_id) !== receiptId(id))
    throw new Error('Etsy did not return the requested receipt.');
  if (receipt.shop_id && String(receipt.shop_id) !== String(session.shop.shop_id))
    throw new Error('This Etsy receipt belongs to a different shop.');
  if (receipt.is_canceled === true || receipt.was_canceled === true)
    throw new Error('The Etsy order has been canceled.');
  if (receipt.is_paid === false || receipt.was_paid === false)
    throw new Error('This Etsy receipt is not paid.');
  return receipt;
}
export function receiptShipments(receipt) {
  const result = Array.isArray(receipt?.shipments) ? receipt.shipments : [];
  return result.map(entry => ({
    trackingNumber:text(entry.tracking_code || entry.tracking_number || entry.trackingCode),
    carrier:text(entry.carrier_name || entry.carrier || entry.carrierName),
    shippedAt:entry.shipment_notification_timestamp || entry.shipped_timestamp || null
  })).filter(s=>s.trackingNumber);
}
export async function linkTrackingOrder(session, input) {
  const id = receiptId(input.receiptId);
  const supplier = validSupplier(input.supplier);
  const supplierOrderId = orderId(input.supplierOrderId);
  const old = await readTrackingRecord(id);
  if (old && String(old.shopId)!==String(session.shop.shop_id)) throw new Error('Shop mismatch.');
  if (old && (old.supplier !== supplier || old.supplierOrderId !== supplierOrderId) &&
      !Boolean(input.confirmReplace)) throw new Error('Supplier link already exists. Confirm replacing it explicitly.');
  if (old?.shipments?.length && (old.supplier !== supplier || old.supplierOrderId !== supplierOrderId))
    throw new Error('This order already has staged shipments. Resolve them before changing its supplier link.');
  const receipt = await verifyEtsyReceipt(session,id);
  const doc = {
    ...old, receiptId:id, shopId:String(session.shop.shop_id), supplier, supplierOrderId,
    etsyStatus: { isShipped:!!receipt.is_shipped, shipments:receiptShipments(receipt) },
    shipments:old?.shipments || [], linkedAt:old?.linkedAt || new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  await putJsonObject(key(id),doc);
  return doc;
}
function safeTracking(value) {
  const s=text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{4,79}$/.test(s)) throw new Error('Invalid or missing tracking number.');
  return s;
}
function safeTrackingUrl(value) {
  const s=text(value);
  if (!s) return '';
  try { const u=new URL(s); return u.protocol==='https:'||u.protocol==='http:' ? s.slice(0,1000) : ''; }
  catch { return ''; }
}
export function suggestCarrier(url) {
  const s=safeTrackingUrl(url);
  if (!s) return '';
  let host;try {host=new URL(s).hostname.toLowerCase();}catch{return '';}
  const rules=[[/^(.*\.)?ups\.com$/,'UPS'],[/^(.*\.)?fedex\.com$/,'FedEx'],
    [/^(.*\.)?usps\.com$/,'USPS'],[/^(.*\.)?dhl\.com$/,'DHL'],
    [/^(.*\.)?canadapost(?:-postescanada)?\.ca$/,'Canada Post'],
    [/^(.*\.)?purolator\.com$/,'Purolator'],[/^(.*\.)?ontrac\.com$/,'OnTrac'],
    [/^(.*\.)?dpd\.(com|co\.uk|de|fr)$/,'DPD']];
  return rules.find(([re])=>re.test(host))?.[1] || '';
}
export function normalizedShipment(input) {
  const trackingNumber=safeTracking(input.trackingNumber);
  const trackingUrl=safeTrackingUrl(input.trackingUrl);
  const carrier=text(input.carrier).slice(0,100);
  const source=text(input.source).slice(0,30);
  const shipmentId=text(input.shipmentId).slice(0,100);
  const status=text(input.status).toLowerCase();
  if (!carrier) throw new Error('Confirm a carrier for tracking '+trackingNumber+'.');
  if (!['shipped','fulfilled','delivered'].includes(status))
    throw new Error('Shipment must be confirmed shipped before it can be staged.');
  return { trackingNumber, trackingUrl, carrier, shipmentId, status, source,
    stagedAt:new Date().toISOString(), etsySentAt:null };
}
export async function stageShipment(session, input) {
  const id=receiptId(input.receiptId);
  const doc=await readTrackingRecord(id);
  if (!doc || String(doc.shopId)!==String(session.shop.shop_id))
    throw new Error('Link this receipt to a supplier first.');
  if (input.supplier && validSupplier(input.supplier)!==doc.supplier) throw new Error('Supplier mismatch.');
  if (input.supplierOrderId && text(input.supplierOrderId)!==doc.supplierOrderId)
    throw new Error('Supplier order reference mismatch.');
  const item=normalizedShipment(input);
  const receipt=await verifyEtsyReceipt(session,id);
  const existingOnEtsy=receiptShipments(receipt).find(s=>s.trackingNumber.toUpperCase()===item.trackingNumber.toUpperCase());
  if(existingOnEtsy) throw new Error('This tracking number already exists on Etsy.');
  const duplicate=(doc.shipments||[]).find(s=>s.trackingNumber.toUpperCase()===item.trackingNumber.toUpperCase());
  if (duplicate) return { duplicate:true, record:doc };
  doc.shipments.push(item);
  doc.updatedAt=new Date().toISOString();
  doc.etsyStatus={isShipped:!!receipt.is_shipped,shipments:receiptShipments(receipt)};
  await putJsonObject(key(id),doc);
  return { duplicate:false, record:doc };
}
export function parseCsv(csv) {
  const source=String(csv||'').replace(/^\uFEFF/,'');
  if(!source.trim()||source.length>1500000) throw new Error('CSV missing or over 1.5MB.');
  const lines=[];let cell='',row=[],quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else{quoted=!quoted;}}
    else if(ch===','&&!quoted){row.push(cell);cell='';}
    else if((ch==='\r'||ch==='\n')&&!quoted){
      if(ch==='\r'&&source[i+1]==='\n')i++;
      row.push(cell);if(row.some(x=>x.trim()))lines.push(row);row=[];cell='';
    }else cell+=ch;
  }
  if(quoted)throw new Error('Unclosed CSV quotation marks.');
  row.push(cell);if(row.some(x=>x.trim()))lines.push(row);
  if(lines.length>2500)throw new Error('Too many CSV rows; export a smaller date range.');
  const names=lines.shift()||[];
  const cols=names.map(s=>s.trim().toLowerCase().replace(/[\s_-]+/g,''));
  if(!cols.includes('shipmenttrackingnumber')) throw new Error('Missing ShipmentTrackingNumber column. Export the Sensaria order report, not the order-upload CSV.');
  if(!cols.includes('partnerorderreferencenumber')&&!cols.includes('ordernumber'))
    throw new Error('Missing PartnerOrderReferenceNumber / OrderNumber column.');
  const get=(cells,...keys)=>{for(const key of keys){const i=cols.indexOf(key.toLowerCase().replace(/[\s_-]+/g,''));if(i>=0&&cells[i])return text(cells[i]);}return '';};
  return lines.map((cells,index)=>({
    row:index+2,
    partnerReference:get(cells,'PartnerOrderReferenceNumber'),
    supplierOrderId:get(cells,'OrderNumber'),
    trackingNumber:get(cells,'ShipmentTrackingNumber'),
    trackingUrl:get(cells,'ShipmentTrackingURL'),
    shipmentId:get(cells,'Shipment Id'),
    status:get(cells,'OrderStatus'),
    shippingDate:get(cells,'Shipping Date')
  }));
}
export function sensariaCandidates(csv, records) {
  const map=new Map((records||[]).filter(x=>x.supplier==='sensaria').map(x=>[x.receiptId,x]));
  const results=[],errors=[],seen=new Set();
  for(const row of parseCsv(csv)) {
    if(!row.trackingNumber)continue;
    const ref=row.partnerReference;
    const id=/^[1-9]\d{0,19}$/.test(ref) ? ref :
      /^(?:ETSY|RECEIPT)[-#\s:]([1-9]\d{0,19})$/i.exec(ref)?.[1];
    const linked=id?map.get(id):[...map.values()].find(d=>row.supplierOrderId&&d.supplierOrderId===row.supplierOrderId);
    if(!linked){errors.push({row:row.row,reason:'No linked Sensaria Etsy receipt matches this report row.'});continue;}
    if(id && linked.receiptId!==id){errors.push({row:row.row,reason:'Conflicting Etsy receipt reference.'});continue;}
    if(row.supplierOrderId && linked.supplierOrderId!==row.supplierOrderId &&
      !(id && linked.supplierOrderId===ref)){
      errors.push({row:row.row,reason:'Sensaria order number does not match the linked order.'});continue;
    }
    const state=row.status.toLowerCase();
    const validShipmentDate=/^\d{4}-\d{2}-\d{2}/.test(row.shippingDate);
    const shippedStatus=/^(shipped|delivered|fulfilled)$/.test(state);
    if(!shippedStatus&&!validShipmentDate){
      errors.push({row:row.row,reason:'Not confirmed shipped; waiting for shipping date/status.'});continue;
    }
    const key=linked.receiptId+'|'+row.trackingNumber.toUpperCase();
    if(seen.has(key))continue;seen.add(key);
    const carrier=suggestCarrier(row.trackingUrl);
    results.push({receiptId:linked.receiptId,supplier:'sensaria',
      supplierOrderId:linked.supplierOrderId,trackingNumber:row.trackingNumber,
      trackingUrl:row.trackingUrl,shipmentId:row.shipmentId,status:'shipped',carrier,
      shippingDate:row.shippingDate,source:'sensaria_csv',needsCarrier:!carrier});
  }
  return {rows:results,skipped:errors,needsCarrier:results.filter(r=>!r.carrier).length};
}
export function supplierShipments(supplier,payload) {
  if(supplier==='gelato'){
    const status=text(payload?.fulfillmentStatus).toLowerCase();
    if(status!=='shipped')return {status:status||'unknown',shipments:[]};
    const shipment=payload.shipment||{};
    return {status,shipments:(shipment.packages||[]).filter(p=>p.trackingCode).map(p=>({
      trackingNumber:p.trackingCode,trackingUrl:p.trackingUrl,
      carrier:suggestCarrier(p.trackingUrl)||text(shipment.shipmentMethodName).split(' ')[0],
      shipmentId:p.id,status:'shipped',source:'gelato_api'}))};
  }
  if(supplier==='printify'){
    const status=text(payload?.status).toLowerCase();
    if(!['fulfilled','delivered','shipped'].includes(status))return {status:status||'unknown',shipments:[]};
    return {status,shipments:(payload.shipments||[]).filter(s=>s.number).map(s=>({
      trackingNumber:s.number,trackingUrl:s.url,carrier:text(s.carrier),
      shipmentId:text(s.id||''),status:'shipped',source:'printify_api'}))};
  }

  if(supplier==='prodigi'){
    const order=payload?.order||payload;
    const rows=Array.isArray(order?.shipments)?order.shipments:[];
    return {status:text(order?.status?.stage||'unknown').toLowerCase(),
      shipments:rows.filter(s=>text(s?.status).toLowerCase()==='shipped'&&s?.tracking?.number)
        .map(s=>({trackingNumber:s.tracking.number,trackingUrl:s.tracking.url||'',
          carrier:text(typeof s.carrier==='string'?s.carrier:s.carrier?.name||s.carrier?.code)||
            suggestCarrier(s.tracking.url),
          shipmentId:text(s.id),status:'shipped',source:'prodigi_api'}))};
  }
  if(supplier==='artelo'){
    const order=payload?.order||payload;
    const state=text(order?.shippingStatus||order?.status).toLowerCase();
    if(!['shipped','delivered'].includes(state))return {status:state||'unknown',shipments:[]};
    return {status:state,
      shipments:(Array.isArray(order?.shipments)?order.shipments:[])
        .filter(s=>s.trackingNumber)
        .map(s=>({trackingNumber:s.trackingNumber,trackingUrl:s.trackingUrl||'',
          carrier:text(s.carrierCode||s.carrier)||suggestCarrier(s.trackingUrl),
          shipmentId:text(s.id),status:'shipped',source:'artelo_api'}))};
  }
  if(supplier==='printshrimp'){
    const order=payload?.order||payload?.data?.order||payload;
    const state=text(order?.shipping_status||order?.shippingStatus||order?.status).toLowerCase();
    if(!['shipped','delivered','fulfilled'].includes(state))
      return {status:state||'unknown',shipments:[]};
    // No verified PrintShrimp response example yet: require an explicit shipped
    // state AND shipment-level tracking to avoid false shipment notifications.
    const rows=Array.isArray(order?.shipments)?order.shipments:[];
    return {status:state,shipments:rows.filter(s=>s?.tracking_number && s?.carrier)
      .map(s=>({trackingNumber:s.tracking_number,trackingUrl:s.tracking_url||'',
        carrier:text(s.carrier),shipmentId:text(s.id),status:'shipped',source:'printshrimp_api'}))};
  }
  return {status:'api_adapter_pending',shipments:[]};
}
export async function checkSupplierTracking(session,id) {
  const doc=await readTrackingRecord(id);
  if(!doc||String(doc.shopId)!==String(session.shop.shop_id))throw new Error('Order must be linked first.');
  const receipt=await verifyEtsyReceipt(session,id);
  let fetched;
  if(doc.supplier==='gelato')fetched=await getGelatoOrderTracking(doc.supplierOrderId);
  else if(doc.supplier==='printify')fetched=await getPrintifyOrderTracking(doc.supplierOrderId);
  else if(doc.supplier==='prodigi')fetched=await getProdigiOrder(doc.supplierOrderId);
  else if(doc.supplier==='artelo')fetched=await getArteloOrder(doc.supplierOrderId);
  else if(doc.supplier==='printshrimp')fetched=await getPrintShrimpOrder({orderId:doc.supplierOrderId});
  else throw new Error('This provider needs a CSV upload or a tracking adapter. API lookup is not active yet.');
  const normalized=supplierShipments(doc.supplier,fetched);
  const saved=[];
  for(const input of normalized.shipments){
    if(!input.carrier){saved.push({trackingNumber:input.trackingNumber,queued:false,reason:'Carrier needs confirmation'});continue;}
    try {
      const shipment=normalizedShipment(input);
      if(receiptShipments(receipt).some(v=>v.trackingNumber.toUpperCase()===shipment.trackingNumber.toUpperCase())){
        saved.push({trackingNumber:shipment.trackingNumber,queued:false,reason:'Already on Etsy'});continue;
      }
      if((doc.shipments||[]).some(v=>v.trackingNumber.toUpperCase()===shipment.trackingNumber.toUpperCase())){
        saved.push({trackingNumber:shipment.trackingNumber,queued:false,reason:'Already staged'});continue;
      }
      doc.shipments ||= [];doc.shipments.push(shipment);
      saved.push({trackingNumber:shipment.trackingNumber,queued:true});
    }catch(e){saved.push({trackingNumber:input.trackingNumber,queued:false,reason:String(e.message||e)});}
  }
  doc.lastCheckAt=new Date().toISOString();doc.supplierStatus=normalized.status;
  doc.etsyStatus={isShipped:!!receipt.is_shipped,shipments:receiptShipments(receipt)};
  doc.updatedAt=new Date().toISOString();await putJsonObject(key(id),doc);
  return {status:normalized.status,results:saved,record:doc};
}
export async function checkEtsyShipmentStatus(session,id) {
  const doc=await readTrackingRecord(id);
  if(!doc||String(doc.shopId)!==String(session.shop.shop_id))throw new Error('Linked receipt required.');
  const receipt=await verifyEtsyReceipt(session,id);
  doc.etsyStatus={isShipped:!!receipt.is_shipped,shipments:receiptShipments(receipt)};
  doc.updatedAt=new Date().toISOString();await putJsonObject(key(id),doc);
  return doc;
}

const pendingEtsyShipments = new Set();
export function etsyCarrierCode(carrier) {
  const values = {
    'USPS':'usps','UPS':'ups','FEDEX':'fedex','DHL':'dhl',
    'CANADA POST':'canada-post','PUROLATOR':'purolator',
    'DPD':'dpd','ONTRAC':'ontrac','OTHER':'other'
  };
  const code=values[text(carrier).toUpperCase()];
  if(!code)throw new Error('Unknown Etsy carrier. Confirm tracking manually in Etsy.');
  return code;
}
export function prepareStagedEtsyShipment(record, receipt, input, shopId) {
  const id=receiptId(input?.receiptId);
  if(!record||record.receiptId!==id||String(record.shopId)!==String(shopId))
    throw new Error('Etsy receipt must be linked to the supplier order first.');
  const shipment=(record.shipments||[]).find(s=>text(s.trackingNumber).toUpperCase()===text(input.trackingNumber).toUpperCase());
  if(!shipment)throw new Error('Tracking number is not staged for this Etsy receipt.');
  if(!['shipped','fulfilled','delivered'].includes(text(shipment.status).toLowerCase()))
    throw new Error('Tracking must be confirmed shipped before completion.');
  if(receipt.is_canceled===true||receipt.was_canceled===true)
    throw new Error('Canceled Etsy receipts cannot be completed.');
  if(receipt.was_paid!==true && receipt.is_paid!==true)
    throw new Error('Etsy receipt must be verified paid.');
  if(receipt.shop_id && String(receipt.shop_id)!==String(shopId))
    throw new Error('Wrong Etsy shop.');
  const found=receiptShipments(receipt).some(s=>s.trackingNumber.toUpperCase()===shipment.trackingNumber.toUpperCase());
  if(!found && (receipt.is_shipped===true||receipt.was_shipped===true))
    throw new Error('Etsy already marks this receipt shipped with other tracking. Review manually in Etsy.');
  return {receiptId:id,trackingNumber:shipment.trackingNumber,carrier:etsyCarrierCode(shipment.carrier),alreadyOnEtsy:found};
}
export async function sendStagedShipmentToEtsy(session,input) {
  if(String(process.env.ETSY_SHIPMENT_SUBMISSION_ENABLED||'').toLowerCase()!=='true')
    throw new Error('Etsy shipment submission is disabled. Etsy must approve this endpoint, then enable ETSY_SHIPMENT_SUBMISSION_ENABLED.');
  if(input?.confirm!=='MARK SHIPPED ON ETSY')
    throw new Error('Explicit MARK SHIPPED ON ETSY confirmation required. Etsy emails the buyer.');
  const id=receiptId(input.receiptId);
  if(pendingEtsyShipments.has(id))throw new Error('Shipment submission is already processing for this receipt.');
  pendingEtsyShipments.add(id);
  try {
    const record=await readTrackingRecord(id);
    const receipt=await verifyEtsyReceipt(session,id);
    const plan=prepareStagedEtsyShipment(record,receipt,input,session.shop.shop_id);
    if(!plan.alreadyOnEtsy){
      try {
        await createReceiptShipment({
          ...shopSession(session),receiptId:id,trackingCode:plan.trackingNumber,
          carrierName:plan.carrier
        });
      }catch(error){
        if(/\b403\b|Unauthorized/i.test(String(error.message||error)))
          throw new Error('Etsy API access denied (403): shipping updates require separate createReceiptShipment approval. Complete manually in Etsy until access is granted.');
        throw error;
      }
    }
    // Etsy is always checked first on retries, to avoid a second customer notification.
    const now=new Date().toISOString();
    const updated={...record,
      shipments:record.shipments.map(s=>text(s.trackingNumber).toUpperCase()===plan.trackingNumber.toUpperCase()
        ? {...s,etsySentAt:s.etsySentAt||now}:s),
      etsyStatus:{isShipped:true,shipments:[
        ...receiptShipments(receipt).filter(s=>s.trackingNumber.toUpperCase()!==plan.trackingNumber.toUpperCase()),
        {trackingNumber:plan.trackingNumber,carrier:plan.carrier,shippedAt:now}
      ]},
      updatedAt:now};
    await putJsonObject(key(id),updated);
    return {record:updated,alreadyOnEtsy:plan.alreadyOnEtsy,etsySubmitted:!plan.alreadyOnEtsy};
  }finally{pendingEtsyShipments.delete(id);}
}
