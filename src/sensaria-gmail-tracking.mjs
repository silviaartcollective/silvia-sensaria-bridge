import {getJsonObject,putJsonObject,isMissingR2Object} from './r2.mjs';
import {gmailAccessToken,gmailConnectionStatus} from './gmail-oauth.mjs';
import {listTrackingRecords,stageShipment} from './order-tracking.mjs';
import {trustedSensariaDomains,parseSensariaShipment,extractGmailText} from './sensaria-gmail-parser.mjs';

const STATE_KEY='integrations/gmail/silvia/sensaria-scan-v1.json';
let running=null;
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
  return {...connected,scanning:Boolean(running),lastRun:saved.lastRun||null};
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
  if(!linked.length){
    const result={checkedAt:new Date().toISOString(),scanned:0,staged:0,duplicates:0,
      needsReview:[],message:'Link your Etsy receipt to its actual Sensaria order ID first. Gmail matching requires that verified link.'};
    const saved=await state();
    await putJsonObject(STATE_KEY,{processed:saved.processed||[],lastRun:result});
    return result;
  }
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
    staged:0,duplicates:0,ignored:0,needsReview:[],matched:[],
    messagesFound:ids.length,completed:true};
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
    const r=row.result;
    if(r.status==='ignored'){summary.ignored++;processed.add(row.id);continue;}
    if(r.status!=='matched'){
      if(summary.needsReview.length<25)summary.needsReview.push({
        reason:r.reason,receiptId:r.receiptId||'',trackingNumber:r.trackingNumber||''
      });
      // Unmatched messages can become matchable when a supplier ID is linked.
      continue;
    }
    try{
      const result=await stageShipment(session,{
        receiptId:r.receiptId,supplier:'sensaria',supplierOrderId:r.supplierOrderId,
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
      if(summary.needsReview.length<25)summary.needsReview.push({
        receiptId:r.receiptId,trackingNumber:r.trackingNumber,reason:msg.slice(0,180)
      });
    }
  }
  const last={processed:[...processed].slice(-500),lastRun:summary};
  await putJsonObject(STATE_KEY,last);
  return summary;
}
