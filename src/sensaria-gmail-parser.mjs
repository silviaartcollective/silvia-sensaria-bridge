// Strict, untrusted-email parser for Sensaria/Gooten shipment messages.
export const SENSARIA_MAIL_DEFAULT_DOMAINS=['sensaria.com','gooten.com'];
export function trustedSensariaDomains(config=process.env.GMAIL_SENSARIA_SENDER_DOMAINS){
  const overrides=String(config||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const values=[...SENSARIA_MAIL_DEFAULT_DOMAINS,...overrides];
  if(values.some(x=>!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))throw Error('Invalid Sensaria sender domain configuration.');
  return [...new Set(values)];
}
export function emailSenderAddress(from){
  const match=String(from||'').match(/<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/i)||
    String(from||'').match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  return String(match?.[1]||'').toLowerCase();
}
export function isTrustedSensariaSender(from,domains=trustedSensariaDomains()){
  const domain=emailSenderAddress(from).split('@')[1]||'';
  return domains.some(d=>domain===d||domain.endsWith('.'+d));
}
export function safeTrackingNumber(value){
  const clean=String(value||'').trim().replace(/[^A-Za-z0-9-]/g,'');
  return /^[A-Za-z0-9][A-Za-z0-9-]{7,59}$/.test(clean)?clean:'';
}
function unescapeHtml(text){
  return String(text).replace(/&(?:amp|nbsp|lt|gt|quot|#39|#x27);/gi,m=>
    ({'&amp;':'&','&nbsp;':' ','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x27;':"'"})[m.toLowerCase()]||m);
}
export function cleanMessageBody(value){
  return unescapeHtml(String(value||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').slice(0,100000);
}
export function decodeGmailBody(data){
  if(typeof data!=='string'||data.length>1800000)return '';
  return Buffer.from(data.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8').slice(0,300000);
}
export function extractGmailText(payload){
  const plain=[],html=[];
  function walk(part,depth){
    if(!part||depth>7)return;
    const type=String(part.mimeType||'').toLowerCase();
    const bytes=part.body?.data;
    if(bytes&&!part.filename){
      if(type.startsWith('text/plain'))plain.push(decodeGmailBody(bytes));
      else if(type.startsWith('text/html'))html.push(decodeGmailBody(bytes));
    }
    for(const sub of (part.parts||[]).slice(0,20))walk(sub,depth+1);
  }
  walk(payload,0);
  return cleanMessageBody(plain.join(' ')||html.join(' '));
}
export function carrierFromShipment(text,url=''){
  const body=String(text||'');
  const host=String(url||'').toLowerCase();
  const match=body.match(/(?:carrier|shipped\s+(?:via|with)|shipping\s+(?:company|provider))\s*[:\-]?\s*(UPS|USPS|FedEx|DHL|Canada Post|Purolator|OnTrac|DPD)\b/i);
  const carrier=match?.[1];
  if(carrier)return ({fedex:'FedEx',usps:'USPS',ups:'UPS',dhl:'DHL',ontrac:'OnTrac',dpd:'DPD'}[carrier.toLowerCase()]||carrier);
  for(const [pattern,name] of [
    [/ups\.com/,'UPS'],[/fedex\.com/,'FedEx'],[/usps\.com/,'USPS'],
    [/dhl\.com/,'DHL'],[/ontrac\.com/,'OnTrac'],
    [/canadapost\.ca/,'Canada Post'],[/purolator\.com/,'Purolator'],[/dpd\./,'DPD']
  ])if(pattern.test(host))return name;
  return '';
}
export function parseSensariaShipment({from,subject='',body='',messageId=''},records=[]){
  if(!isTrustedSensariaSender(from))return {status:'ignored',reason:'Untrusted sender'};
  const content=cleanMessageBody(body),title=cleanMessageBody(subject);
  if(!/\b(shipp?ed|shipment|tracking|on (?:its|the) way|out for delivery|in transit)\b/i.test(title+' '+content))
    return {status:'ignored',reason:'Not a shipment update'};
  // A tracking number in a label-created or preproduction message does not
  // prove the shipment actually left the supplier. Require explicit shipped
  // language before any automatic staging.
  if(!/\b(shipped|has shipped|was shipped|on (?:its|the) way|in transit|dispatched|out for delivery|delivered)\b/i.test(title+' '+content))
    return {status:'review',reason:'Tracking email does not explicitly confirm shipment.'};
  const labels=[
    /(?:tracking\s*(?:number|no\.?|code|#)?|tracking\s*ID)\s*[:#=\-]\s*([A-Za-z0-9][A-Za-z0-9-]{7,59})\b/gi,
    /\b(1Z[A-Z0-9]{16})\b/gi
  ];
  const trackings=[...new Set(labels.flatMap(re=>[...content.matchAll(re)].map(m=>safeTrackingNumber(m[1]))).filter(Boolean))];
  if(trackings.length!==1)return {status:'review',reason:trackings.length?'Multiple tracking numbers: review manually.':'No unambiguous tracking number found.'};
  const urls=[...String(body).matchAll(/https?:\/\/[^\s"'<>)]{8,500}/gi)]
    .map(x=>x[0].replace(/(?:&amp;|[.,;]+)$/gi,'')); 
  const url=urls.find(x=>/(?:ups|fedex|usps|dhl|canadapost|ontrac|purolator|dpd)/i.test(x))||'';
  const carrier=carrierFromShipment(title+' '+content,url);
  const refs=(records||[]).filter(r=>r?.supplier==='sensaria'&&
    /^\d{5,18}$/.test(String(r?.supplierOrderId||''))&&
    new RegExp('(^|[^0-9])'+String(r.supplierOrderId)+'([^0-9]|$)').test(title+' '+content));
  // The order number in a shipment email must identify exactly one already
  // linked receipt. A customer name or artwork title never counts as proof.
  if(refs.length!==1)return {
    status:'review',reason:refs.length>1?'Supplier order ID is ambiguous.':'No linked Sensaria order ID found in the shipment email.',
    trackingNumber:trackings[0],carrier
  };
  if(!carrier)return {status:'review',receiptId:refs[0].receiptId,
    trackingNumber:trackings[0],reason:'Carrier could not be verified.'};
  return {
    status:'matched',receiptId:String(refs[0].receiptId),
    supplierOrderId:String(refs[0].supplierOrderId),
    trackingNumber:trackings[0],carrier,
    trackingUrl:url,sourceMessageId:String(messageId).slice(0,100)
  };
}
