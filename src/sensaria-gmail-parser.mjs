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
// A UPS tracking number: 1Z, 15 characters, then the check digit UPS computes
// from them (letters count as (position in the alphabet + 2) mod 10, every
// second character double). Only UPS issues numbers that pass this check.
export function isUpsTrackingNumber(value){
  const number=String(value||'').toUpperCase();
  if(!/^1Z[A-Z0-9]{16}$/.test(number))return false;
  let sum=0;
  for(let i=2;i<17;i++){
    const c=number[i],digit=/[0-9]/.test(c)?Number(c):(c.charCodeAt(0)-63)%10;
    sum+=i%2?digit*2:digit;
  }
  return (10-sum%10)%10===Number(number[17]);
}
// The email's links with the words on them (link text, image alt text, or the
// words before a plain-text URL), to find its "Track package" button.
export function extractGmailLinks(payload){
  const links=[];
  const add=(url,text)=>{
    const clean=unescapeHtml(String(url||'')).trim();
    if(/^https?:\/\/[^\s"'<>]{4,2000}$/i.test(clean)&&links.length<40)links.push({url:clean,text:cleanMessageBody(text).slice(0,120)});
  };
  function walk(part,depth){
    if(!part||depth>7)return;
    const type=String(part.mimeType||'').toLowerCase();
    if(part.body?.data&&!part.filename){
      const text=decodeGmailBody(part.body.data);
      if(type.startsWith('text/html'))
        for(const m of text.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,2000}?)<\/a>/gi))
          add(m[1],m[2]+' '+[...m[2].matchAll(/\balt\s*=\s*["']([^"']*)["']/gi)].map(x=>x[1]).join(' '));
      else if(type.startsWith('text/plain')){
        // The words before a URL, back to the previous URL at most.
        let previousEnd=0;
        for(const m of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)){
          add(m[0],text.slice(Math.max(previousEnd,m.index-60),m.index));
          previousEnd=m.index+m[0].length;
        }
      }
    }
    for(const sub of (part.parts||[]).slice(0,20))walk(sub,depth+1);
  }
  walk(payload,0);
  return links;
}
const CARRIER_HOSTS=[
  [/(^|\.)ups\.com$/,'UPS'],[/(^|\.)fedex\.com$/,'FedEx'],[/(^|\.)usps\.com$/,'USPS'],
  [/(^|\.)dhl\.(com|de)$/,'DHL'],[/(^|\.)ontrac\.com$/,'OnTrac'],
  [/(^|\.)canadapost(-postescanada)?\.ca$/,'Canada Post'],[/(^|\.)purolator\.com$/,'Purolator'],
  [/(^|\.)dpd\.(com|co\.uk|de|ie)$/,'DPD']
];
// The carrier whose own website a link is on.
export function carrierForUrl(url){
  let host='';
  try{const parsed=new URL(String(url||''));if(parsed.protocol==='https:'||parsed.protocol==='http:')host=parsed.hostname.toLowerCase()}catch{}
  return CARRIER_HOSTS.find(([pattern])=>host&&pattern.test(host))?.[1]||'';
}
// Carrier names as emails write them. UPS and DPD only in capitals ("ups" is a word).
const CARRIER_NAMES=[
  [/\bUSPS\b|\b(?:U\.\s?S\.|United States) Postal Service\b/i,'USPS'],
  [/\bUPS\b|\bUnited Parcel Service\b/,'UPS'],[/\bFed\s?Ex\b/i,'FedEx'],
  // DHL eCommerce hands parcels to the postal service: its numbers are not DHL's.
  [/\bDHL\b(?!\s*(?:e-?commerce|smart\s?mail|global\s?mail))/i,'DHL'],
  [/\bCanada Post\b/i,'Canada Post'],[/\bPurolator\b/i,'Purolator'],[/\bOnTrac\b/i,'OnTrac'],[/\bDPD\b/,'DPD']
];
const namedCarriers=text=>CARRIER_NAMES.filter(([pattern])=>pattern.test(text)).map(([,name])=>name);
// The one carrier named right by the tracking number ("FedEx tracking number:
// …", "UPS Ground …") or in the subject; none if two carriers are named.
export function carrierNamedNear(text,trackingNumber,subject=''){
  const body=String(text||''),number=String(trackingNumber||'');
  const at=number?body.toUpperCase().indexOf(number.toUpperCase()):-1;
  const near=at<0?'':body.slice(Math.max(0,at-80),at)+' '+body.slice(at+number.length,at+number.length+40);
  const names=[...new Set([...namedCarriers(near),...namedCarriers(String(subject||''))])];
  return names.length===1?names[0]:'';
}
// USPS numbers: the 22-digit domestic ones (92…95, check digit: weights 3 and
// 1 from the right) and international ones ending in US (UPU S10 check digit).
export function isUspsTrackingNumber(value){
  const number=String(value||'').toUpperCase();
  if(/^9[1-5][0-9]{20}$/.test(number)){
    let sum=0;
    for(let i=0;i<21;i++)sum+=Number(number[20-i])*(i%2?1:3);
    return (10-sum%10)%10===Number(number[21]);
  }
  const s10=number.match(/^[A-Z]{2}([0-9]{8})([0-9])US$/);
  if(!s10)return false;
  const sum=[8,6,4,2,3,5,9,7].reduce((total,weight,i)=>total+weight*Number(s10[1][i]),0);
  const check=11-sum%11;
  return (check===10?0:check===11?5:check)===Number(s10[2]);
}
export function carrierFromShipment(text,url='',trackingNumber='',subject=''){
  const body=String(text||'');
  const match=(String(subject||'')+' '+body).match(/(?:carrier|shipped\s+(?:via|with)|shipping\s+(?:company|provider))\s*[:\-]?\s*(UPS|USPS|FedEx|DHL|Canada Post|Purolator|OnTrac|DPD)\b/i);
  const found=match?({fedex:'FedEx',usps:'USPS',ups:'UPS',dhl:'DHL',ontrac:'OnTrac',dpd:'DPD'}[match[1].toLowerCase()]||match[1]):
    carrierForUrl(url)||carrierNamedNear(body,trackingNumber,subject);
  // Only UPS issues 1Z numbers: an email naming another carrier for one is
  // contradictory and goes to review. Sensaria's emails may name no carrier.
  if(isUpsTrackingNumber(trackingNumber))return !found||found==='UPS'?'UPS':'';
  // USPS numbers are also used by services the postal service delivers for
  // (FedEx Ground Economy, UPS Mail Innovations), so a named carrier comes first.
  return found||(isUspsTrackingNumber(trackingNumber)?'USPS':'');
}
// A link the email calls a tracking link, or whose address has the tracking
// number in it. Never an unsubscribe or settings link.
const isTrackingLink=(link,number)=>(/track/i.test(link.text)||String(link.url).toUpperCase().includes(number.toUpperCase()))&&
  !/unsubscribe|opt[\s_-]?out|preferences|privacy|manage/i.test(link.text+' '+link.url);
// links: the email's links (extractGmailLinks). resolvedLink: where one of its
// tracking links redirects to, found by the scanner; it counts only on the
// carrier's own site with this tracking number in it.
export function parseSensariaShipment({from,subject='',body='',messageId='',links=[],resolvedLink=null},records=[]){
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
  const allLinks=[...(Array.isArray(links)?links:[]).slice(0,40),
    ...[...String(body).matchAll(/https?:\/\/[^\s"'<>)]{8,500}/gi)].map(x=>({url:x[0].replace(/(?:&amp;|[.,;]+)$/gi,''),text:''}))];
  // A link on a carrier's site counts only with this tracking number in it.
  const forNumber=link=>String(link?.url||'').toUpperCase().includes(trackings[0].toUpperCase());
  let url=allLinks.find(link=>carrierForUrl(link.url)&&forNumber(link))?.url||'';
  let carrier=carrierFromShipment(content,url,trackings[0],title);
  const ups=isUpsTrackingNumber(trackings[0]);
  if(!carrier&&!ups&&carrierForUrl(resolvedLink?.url)&&forNumber(resolvedLink)){
    carrier=carrierForUrl(resolvedLink.url);url=String(resolvedLink.url);
  }
  if(!carrier)return {status:'review',trackingNumber:trackings[0],reason:'Carrier could not be verified.',
    trackingLinks:resolvedLink||ups?[]:[...new Set(allLinks.filter(link=>isTrackingLink(link,trackings[0])).map(link=>link.url))].slice(0,3)};
  const shipment={trackingNumber:trackings[0],carrier,trackingUrl:url,sourceMessageId:String(messageId).slice(0,100)};
  const refs=(records||[]).filter(r=>r?.supplier==='sensaria'&&
    /^\d{5,18}$/.test(String(r?.supplierOrderId||''))&&
    new RegExp('(^|[^0-9])'+String(r.supplierOrderId)+'([^0-9]|$)').test(title+' '+content));
  // The order number in a shipment email must identify exactly one already
  // linked receipt. A customer name or artwork title never counts as proof.
  if(refs.length>1)return {status:'review',reason:'Supplier order ID is ambiguous.',trackingNumber:trackings[0],carrier};
  if(refs.length===1)return {
    status:'matched',receiptId:String(refs[0].receiptId),
    supplierOrderId:String(refs[0].supplierOrderId),...shipment
  };
  // No linked order: the Sensaria CSV's PO Number is the Etsy receipt number.
  // The scanner keeps a number only if Etsy confirms it is one of this shop's
  // paid, open receipts.
  const candidates=receiptNumberCandidates(title+' '+content,trackings[0]);
  if(!candidates.length)return {status:'review',reason:'No Etsy receipt number or linked Sensaria order ID found in the shipment email.',
    trackingNumber:trackings[0],carrier};
  return {status:'check_receipt',candidates,...shipment};
}

// Numbers in the email that could be an Etsy receipt number (9–12 digits),
// other than ones inside the tracking number.
export function receiptNumberCandidates(text,trackingNumber=''){
  const tracking=String(trackingNumber);
  return [...new Set([...String(text||'').matchAll(/(?<![0-9A-Za-z])([1-9][0-9]{8,11})(?![0-9A-Za-z])/g)].map(m=>m[1]))]
    .filter(number=>!tracking.includes(number)).slice(0,5);
}
