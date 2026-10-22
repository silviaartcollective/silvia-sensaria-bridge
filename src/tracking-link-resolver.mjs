// Follows a shipment email's "Track package" link through its redirects
// (Sensaria's links go through an email click tracker) to see which carrier's
// site it ends on. Only the redirect headers are read: no page is loaded, the
// carrier's own site is never requested, and only public hosts are asked.
import {lookup} from 'node:dns/promises';
import net from 'node:net';
import {carrierForUrl} from './sensaria-gmail-parser.mjs';

const MAX_HOPS=5;
function privateAddress(address){
  if(net.isIPv4(address)){
    const [a,b]=address.split('.').map(Number);
    return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||
      (a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19));
  }
  const value=address.toLowerCase();
  if(value.startsWith('::ffff:'))return privateAddress(value.slice(7));
  return value==='::'||value==='::1'||/^f[cd]/.test(value)||/^fe[89ab]/.test(value)||value.startsWith('ff');
}
async function publicHost(hostname,lookupImpl){
  if(!hostname||net.isIP(hostname)||!hostname.includes('.')||/(^|\.)(localhost|local|internal)$/i.test(hostname))return false;
  const addresses=await lookupImpl(hostname,{all:true}).catch(()=>[]);
  return addresses.length>0&&addresses.every(entry=>!privateAddress(entry.address));
}
// {carrier,url} when the link redirects to a carrier's site with this
// tracking number in the address, else null.
export async function carrierFromTrackingLink(link,trackingNumber,{fetchImpl=fetch,lookupImpl=lookup}={}){
  const number=String(trackingNumber||'').toUpperCase();
  if(!number)return null;
  let url=String(link||'');
  for(let hop=0;hop<=MAX_HOPS;hop++){
    let parsed;
    try{parsed=new URL(url)}catch{return null}
    if(parsed.protocol!=='https:'&&parsed.protocol!=='http:')return null;
    const carrier=carrierForUrl(parsed.href);
    if(carrier)return parsed.href.toUpperCase().includes(number)?{carrier,url:parsed.href}:null;
    if(hop===MAX_HOPS||!await publicHost(parsed.hostname,lookupImpl))return null;
    const response=await fetchImpl(parsed.href,{redirect:'manual',signal:AbortSignal.timeout(6000),
      headers:{'user-agent':'Mozilla/5.0 (compatible; SilviaTracking/1.0)'}});
    try{await response.body?.cancel()}catch{}
    const location=response.headers?.get?.('location');
    if(response.status<300||response.status>=400||!location)return null;
    url=new URL(location,parsed.href).href;
  }
  return null;
}
