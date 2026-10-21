import {getJsonObject,putJsonObject,isMissingR2Object} from './r2.mjs';
import {gmailAccessToken,gmailConnectionStatus} from './gmail-oauth.mjs';
import {listTrackingRecords,stageShipment,linkTrackingOrder,verifyEtsyReceipt,readTrackingRecord,sendStagedShipmentToEtsy} from './order-tracking.mjs';
import {trustedSensariaDomains,parseSensariaShipment,extractGmailText} from './sensaria-gmail-parser.mjs';

const STATE_KEY='integrations/gmail/silvia/sensaria-scan-v1.json';
const SETTINGS_KEY='integrations/gmail/silvia/tracking-settings-v1.json';
let running=null;
// autoCompleteEtsy: verified Gmail tracking is sent to Etsy straight away
// (Etsy marks the order shipped and emails the buyer). Off until switched on.
export async function gmailTrackingSettings(){
  try{const saved=await getJsonObject(SETTINGS_KEY);return {autoCompleteEtsy:saved?.autoCompleteEtsy===true}}
  catch(error){if(isMissingR2Object(error))return {autoCompleteEtsy:false};throw error;}
}
export async function saveGmailTrackingSettings(input){
  const settings={autoCompleteEtsy:input?.autoCompleteEtsy===true,updatedAt:new Date().toISOString()};
  await putJsonObject(SETTINGS_KEY,settings);
  return settings;
}
async function state(){
  try{return await getJsonObject(STATE_KEY);}
  catch(error){if(isMissingR2Object(error))return {processed:[],lastRun:null};throw error;}
}
async function gmailJson(url,token){
  const res=await fetch(url,{headers:{authorization:'Bearer '+token},
    signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('Gmail API error '+res.status+
    (res.status===401?' — reconnect Gmail from Order Tracking.':''));
  return res.json();
}
export async function gmailTrackingStatus(){
  const connected=await gmailConnectionStatus();
  const saved=connected.connected?await state():{lastRun:null};
  return {...connected,...await gmailTrackingSettings(),scanning:Boolean(running),lastRun:saved.lastRun||null};
}
export async function scanSensariaGmail(session){
  if(running)return {alreadyRunning:true,...(await gmailTrackingStatus())};
  const work=doScan(session);
  running=work;
  try{return await work;}finally{if(running===work)running=null;}
}
async function doScan(session){
  const connected=await gmailConnectionStatus();
  if(!connected.connected)throw Error('Connect a Gmail account before checking Sensaria tracking.');
  const linked=(await listTrackingRecords(session)).records.filter(x=>x.supplier==='sensaria');
  const settings=await gmailTrackingSettings();
  const token=await gmailAccessToken();
  const senders=trustedSensariaDomains();
  const query='{'+senders.map(x=>'from:'+x).join(' ')+'} newer_than:45d -in:spam -in:trash';
  const ids=[],seenIds=new Set();
  let pageToken='';
  for(let page=0;page<2;page++){
    const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q',query);url.searchParams.set('maxResults','75');
    if(pageToken)url.searchParams.set('pageToken',pageToken);
    const result=await gmailJson(url,token);
    for(const message of result.messages||[]){
      const id=String(message.id||'');
      if(id&&!seenIds.has(id)){seenIds.add(id);ids.push(id);}
    }
    pageToken=result.nextPageToken||'';
    if(!pageToken)break;
  }
  const prior=await state(),processed=new Set((prior.processed||[]).slice(-500));
  const candidates=ids.filter(id=>!processed.has(id));
  const summary={checkedAt:new Date().toISOString(),scanned:candidates.length,
    staged:0,duplicates:0,ignored:0,linked:0,needsReview:[],matched:[],completedOnEtsy:[],
    autoCompleteEtsy:settings.autoCompleteEtsy,messagesFound:ids.length,completed:true};
  const review=item=>{if(summary.needsReview.length<25)summary.needsReview.push(item)};
  // Etsy is asked once per number per scan.
  const receipts=new Map();
  const openReceipt=id=>{
    if(!receipts.has(id))receipts.set(id,verifyEtsyReceipt(session,id).catch(()=>null));
    return receipts.get(id);
  };
  // Limit concurrency to keep Gmail/API quotas and Etsy verifications bounded.
  const inspected=[];
  for(let i=0;i<candidates.length;i+=4){
    const batch=await Promise.all(candidates.slice(i,i+4).map(async id=>{
      try{
        const message=await gmailJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+
          encodeURIComponent(id)+'?format=full',token);
        const headers=Object.fromEntries((message.payload?.headers||[])
          .map(h=>[String(h.name||'').toLowerCase(),String(h.value||'')]));
        const body=extractGmailText(message.payload);
        return {id,result:parseSensariaShipment({
          from:headers.from,subject:headers.subject,body,messageId:id
        },linked)};
      }catch(error){return {id,error:String(error.message||error)};}
    }));
    inspected.push(...batch);
  }
  for(const row of inspected){
    if(row.error){
      summary.needsReview.push({reason:'Unable to read a Gmail message: '+row.error.slice(0,120)});
      continue;
    }
    let r=row.result;
    if(r.status==='ignored'){summary.ignored++;processed.add(row.id);continue;}
    if(r.status==='check_receipt'){
      // The email names the Etsy order by its receipt number (the CSV's PO Number):
      // exactly one number must be a paid, open receipt of this shop.
      const open=[];
      for(const id of r.candidates)if(await openReceipt(id))open.push(id);
      if(open.length!==1){
        review({reason:open.length?'More than one Etsy order number in the email.':'No Etsy order of this shop found in the email.',
          trackingNumber:r.trackingNumber});
        continue;
      }
      try{
        const existing=await readTrackingRecord(open[0]);
        if(!existing){
          await linkTrackingOrder(session,{receiptId:open[0],supplier:'sensaria',supplierOrderId:open[0]});
          summary.linked++;
        }else if(existing.supplier!=='sensaria')throw Error('This Etsy order is linked to '+existing.supplier+', not Sensaria.');
        r={...r,status:'matched',receiptId:open[0],supplierOrderId:''};
      }catch(error){
        review({receiptId:open[0],trackingNumber:r.trackingNumber,reason:String(error.message||error).slice(0,180)});
        continue;
      }
    }
    if(r.status!=='matched'){
      review({reason:r.reason,receiptId:r.receiptId||'',trackingNumber:r.trackingNumber||''});
      // Unmatched messages can become matchable when a supplier ID is linked.
      continue;
    }
    try{
      const result=await stageShipment(session,{
        receiptId:r.receiptId,supplier:'sensaria',...(r.supplierOrderId?{supplierOrderId:r.supplierOrderId}:{}),
        trackingNumber:r.trackingNumber,carrier:r.carrier,trackingUrl:r.trackingUrl,
        source:'sensaria_gmail',status:'shipped',shipmentId:r.sourceMessageId
      });
      processed.add(row.id);
      if(result.duplicate){summary.duplicates++;continue;}
      summary.staged++;
      summary.matched.push({receiptId:r.receiptId,carrier:r.carrier,trackingNumber:r.trackingNumber});
    }catch(error){
      const msg=String(error.message||error);
      if(/already exists on Etsy/i.test(msg)){summary.duplicates++;processed.add(row.id);continue;}
      review({receiptId:r.receiptId,trackingNumber:r.trackingNumber,reason:msg.slice(0,180)});
    }
  }
  if(settings.autoCompleteEtsy)await completeOnEtsy(session,summary,review);
  const last={processed:[...processed].slice(-500),lastRun:summary};
  await putJsonObject(STATE_KEY,last);
  return summary;
}

// Sends every Gmail shipment that is staged but not yet on Etsy, including ones
// staged before automatic completion was switched on. sendStagedShipmentToEtsy
// re-reads the order first: a canceled order, or one Etsy already shows shipped
// with other tracking, is left for review, and a retry never notifies twice.
async function completeOnEtsy(session,summary,review){
  const pending=(await listTrackingRecords(session)).records.filter(record=>record.supplier==='sensaria')
    .flatMap(record=>(record.shipments||[]).filter(s=>s.source==='sensaria_gmail'&&!s.etsySentAt)
      .map(s=>({receiptId:record.receiptId,trackingNumber:s.trackingNumber,carrier:s.carrier})));
  for(const item of pending.slice(0,25)){
    try{
      const sent=await sendStagedShipmentToEtsy(session,{receiptId:item.receiptId,trackingNumber:item.trackingNumber,
        confirm:'MARK SHIPPED ON ETSY'});
      summary.completedOnEtsy.push({...item,alreadyOnEtsy:Boolean(sent.alreadyOnEtsy)});
    }catch(error){
      review({receiptId:item.receiptId,trackingNumber:item.trackingNumber,
        reason:'Staged, but Etsy was not updated: '+String(error.message||error).slice(0,160)});
    }
  }
}
