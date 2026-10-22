import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSensariaShipment,carrierNamedNear,isUspsTrackingNumber,extractGmailLinks,carrierForUrl
} from '../src/sensaria-gmail-parser.mjs';
import {carrierFromTrackingLink} from '../src/tracking-link-resolver.mjs';

const order={supplier:'sensaria',supplierOrderId:'4591174',receiptId:'4201324221'};
const email=(body,extra={})=>({from:'Sensaria <updates@gooten.com>',subject:'Your order has shipped',body,...extra});
const b64=text=>Buffer.from(text).toString('base64url');

test('the carrier written next to the tracking number is used, but never one of two',()=>{
 assert.equal(carrierNamedNear('Your FedEx tracking number: 771234567890','771234567890'),'FedEx');
 assert.equal(carrierNamedNear('Tracking number: 1234567890 (DHL Express)','1234567890'),'DHL');
 assert.equal(carrierNamedNear('Shipped with USPS Ground Advantage. Tracking: 9101123456789000000013','9101123456789000000013'),'USPS');
 assert.equal(carrierNamedNear('Tracking: 771234567890','771234567890','Your FedEx package is on its way'),'FedEx');
 // DHL eCommerce numbers are tracked by the postal service, not DHL.
 assert.equal(carrierNamedNear('DHL eCommerce tracking number: 4202 GM1234567890','GM1234567890'),'');
 assert.equal(carrierNamedNear('Ships by UPS or FedEx. Tracking number: 771234567890','771234567890'),'');
 // "ups" is a word; only UPS in capitals is the carrier.
 assert.equal(carrierNamedNear('Pick ups are closed. Tracking number: 771234567890','771234567890'),'');
 // A carrier named far from the number does not count.
 assert.equal(carrierNamedNear('FedEx '+'x'.repeat(200)+' Tracking number: 771234567890','771234567890'),'');
});

test('a FedEx or DHL email that names the carrier by the number is matched',()=>{
 const fedex=parseSensariaShipment(email('Order 4591174 has shipped! FedEx Tracking Number: 771234567890'),[order]);
 assert.equal(fedex.status,'matched');
 assert.equal(fedex.carrier,'FedEx');
 assert.equal(fedex.trackingNumber,'771234567890');
 const dhl=parseSensariaShipment(email('Order 4591174 was shipped. Tracking number: 1234567890 (DHL Express)'),[order]);
 assert.equal(dhl.carrier,'DHL');
 // Digits alone still say nothing.
 const plain=parseSensariaShipment(email('Order 4591174 has shipped. Tracking number: 771234567890'),[order]);
 assert.equal(plain.status,'review');
 assert.match(plain.reason,/carrier/i);
});

test('USPS numbers are recognised by their check digit',()=>{
 assert.equal(isUspsTrackingNumber('9101123456789000000013'),true);
 assert.equal(isUspsTrackingNumber('9101123456789000000014'),false);
 assert.equal(isUspsTrackingNumber('910112345678900000001'),false);
 assert.equal(isUspsTrackingNumber('LZ473124829US'),true);
 assert.equal(isUspsTrackingNumber('LZ473124828US'),false);
 assert.equal(isUspsTrackingNumber('AA473124829GB'),false,'another country\'s post');
 const usps=parseSensariaShipment(email('Order 4591174 has shipped. Tracking number: 9101123456789000000013'),[order]);
 assert.equal(usps.status,'matched');
 assert.equal(usps.carrier,'USPS');
});

test('a direct link counts only on the carrier\'s own website',()=>{
 assert.equal(carrierForUrl('https://www.fedex.com/fedextrack/?trknbr=771234567890'),'FedEx');
 assert.equal(carrierForUrl('https://tools.usps.com/go/TrackConfirmAction?tLabels=9101'),'USPS');
 assert.equal(carrierForUrl('https://www.dhl.com/us-en/home/tracking.html?tracking-id=1234567890'),'DHL');
 assert.equal(carrierForUrl('https://track.gooten.com/?carrier=fedex.com'),'');
 assert.equal(carrierForUrl('https://fedex.com.example.net/track'),'');
 const linked=parseSensariaShipment(email('Order 4591174 has shipped. Tracking number: 771234567890',
  {links:[{url:'https://www.fedex.com/fedextrack/?trknbr=771234567890',text:'Track package'}]}),[order]);
 assert.equal(linked.carrier,'FedEx');
 assert.equal(linked.trackingUrl,'https://www.fedex.com/fedextrack/?trknbr=771234567890');
});

test('the email\'s Track button is found in the HTML; unsubscribe links never are',()=>{
 const html='<p>Order 4591174 has shipped.</p><p>Tracking number: 771234567890</p>'+
  '<a href="https://u1.ct.sendgrid.net/ls/click?upn=AAA&amp;x=1"><img alt="Track your package" src="x.png"></a>'+
  '<a href="https://u1.ct.sendgrid.net/ls/click?upn=BBB">Shop new art</a>'+
  '<a href="https://u1.ct.sendgrid.net/ls/click?upn=CCC">Unsubscribe from tracking emails</a>';
 const payload={mimeType:'multipart/alternative',parts:[
  {mimeType:'text/plain',body:{data:b64('Order 4591174 has shipped. Tracking number: 771234567890\nTrack your package: https://u1.ct.sendgrid.net/ls/click?upn=AAA&x=1')}},
  {mimeType:'text/html',body:{data:b64(html)}}
 ]};
 const links=extractGmailLinks(payload);
 assert.ok(links.some(link=>link.url==='https://u1.ct.sendgrid.net/ls/click?upn=AAA&x=1'&&/Track your package/.test(link.text)));
 const result=parseSensariaShipment(email('Order 4591174 has shipped. Tracking number: 771234567890',{links}),[order]);
 assert.equal(result.status,'review');
 assert.deepEqual(result.trackingLinks,['https://u1.ct.sendgrid.net/ls/click?upn=AAA&x=1']);
});

test('where the Track button redirects decides the carrier, only with this tracking number in it',()=>{
 const base=email('Order 4591174 has shipped. Tracking number: 771234567890');
 const fedex={carrier:'FedEx',url:'https://www.fedex.com/fedextrack/?trknbr=771234567890'};
 const matched=parseSensariaShipment({...base,resolvedLink:fedex},[order]);
 assert.equal(matched.status,'matched');
 assert.equal(matched.carrier,'FedEx');
 assert.equal(matched.trackingUrl,fedex.url);
 const other=parseSensariaShipment({...base,resolvedLink:{carrier:'FedEx',url:'https://www.fedex.com/fedextrack/?trknbr=999999999999'}},[order]);
 assert.equal(other.status,'review');
 assert.deepEqual(other.trackingLinks,[],'a resolved email is not followed again');
});

function fakeWeb(routes){
 const asked=[];
 const fetchImpl=async(url,options)=>{
  asked.push(url);
  assert.equal(options.redirect,'manual');
  const location=routes[url];
  return {status:location?302:200,headers:new Headers(location?{location}:{}),body:null};
 };
 const lookupImpl=async host=>host.endsWith('.lan')?[{address:'192.168.1.10'}]:[{address:'93.184.216.34'}];
 return {asked,options:{fetchImpl,lookupImpl}};
}

test('the redirect is followed by its headers only, and the carrier\'s own site is never requested',async()=>{
 const web=fakeWeb({
  'https://u1.ct.sendgrid.net/ls/click?upn=AAA':'https://track.gooten.com/r/abc',
  'https://track.gooten.com/r/abc':'https://www.fedex.com/fedextrack/?trknbr=771234567890'
 });
 const found=await carrierFromTrackingLink('https://u1.ct.sendgrid.net/ls/click?upn=AAA','771234567890',web.options);
 assert.deepEqual(found,{carrier:'FedEx',url:'https://www.fedex.com/fedextrack/?trknbr=771234567890'});
 assert.deepEqual(web.asked,['https://u1.ct.sendgrid.net/ls/click?upn=AAA','https://track.gooten.com/r/abc']);
});

test('a redirect that ends off a carrier site, without the number, or at a private address gives nothing',async()=>{
 const page=fakeWeb({'https://u1.ct.sendgrid.net/a':'https://track.gooten.com/status/771234567890'});
 assert.equal(await carrierFromTrackingLink('https://u1.ct.sendgrid.net/a','771234567890',page.options),null);
 const wrong=fakeWeb({'https://u1.ct.sendgrid.net/b':'https://www.fedex.com/en-us/tracking.html'});
 assert.equal(await carrierFromTrackingLink('https://u1.ct.sendgrid.net/b','771234567890',wrong.options),null);
 const inside=fakeWeb({'https://u1.ct.sendgrid.net/c':'https://router.lan/admin'});
 assert.equal(await carrierFromTrackingLink('https://u1.ct.sendgrid.net/c','771234567890',inside.options),null);
 assert.deepEqual(inside.asked,['https://u1.ct.sendgrid.net/c'],'the private address is never requested');
 const raw=fakeWeb({});
 assert.equal(await carrierFromTrackingLink('https://127.0.0.1/x','771234567890',raw.options),null);
 assert.equal(await carrierFromTrackingLink('ftp://example.com/x','771234567890',raw.options),null);
 assert.deepEqual(raw.asked,[]);
 const loop=fakeWeb({'https://a.example.com/1':'https://a.example.com/1'});
 assert.equal(await carrierFromTrackingLink('https://a.example.com/1','771234567890',loop.options),null);
 assert.ok(loop.asked.length<=5,'at most five redirects');
});

test('a carrier link without this tracking number, or another carrier named for a UPS number, decides nothing',()=>{
 const footer=parseSensariaShipment(email('Order 4591174 has shipped. Tracking number: 771234567890',
  {links:[{url:'https://www.ups.com/us/en/home',text:'We ship with UPS'}]}),[order]);
 assert.equal(footer.status,'review');
 const contradiction=parseSensariaShipment(email('Order 4591174 has shipped. Carrier: FedEx. Tracking number: 1Z0V1W590338116384'),[order]);
 assert.equal(contradiction.status,'review');
 assert.deepEqual(contradiction.trackingLinks,[]);
 const ups=parseSensariaShipment(email('Order 4591174 has shipped. UPS tracking number: 1Z0V1W590338116384'),[order]);
 assert.equal(ups.carrier,'UPS');
 // A carrier named for a USPS number wins: FedEx Ground Economy uses them.
 const economy=parseSensariaShipment(email('Order 4591174 has shipped. FedEx Ground Economy tracking number: 9101123456789000000013'),[order]);
 assert.equal(economy.carrier,'FedEx');
});

test('in plain text, the words before a link stop at the previous link',()=>{
 const text='Track your package: https://u1.ct.sendgrid.net/a\nhttps://u1.ct.sendgrid.net/b';
 const links=extractGmailLinks({mimeType:'text/plain',body:{data:b64(text)}});
 assert.match(links[0].text,/Track your package/);
 assert.doesNotMatch(links[1].text,/Track/);
});
