import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';

// Minimal R2 stand-in: GET/HEAD/PUT/DELETE, server-side copy and listing.
const objects=new Map();
const xml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://x');
 const key=decodeURIComponent(url.pathname).replace(/^\/[^/]+\/?/,'');
 if(req.method==='GET'&&!key&&url.searchParams.get('list-type')==='2'){
  const prefix=url.searchParams.get('prefix')||'';
  const items=[...objects.entries()].filter(([k])=>k.startsWith(prefix));
  res.writeHead(200,{'content-type':'application/xml'});
  return res.end('<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>'+items.map(([k,o])=>
   '<Contents><Key>'+xml(k)+'</Key><LastModified>'+o.at+'</LastModified><Size>'+o.body.length+'</Size></Contents>').join('')+'</ListBucketResult>');
 }
 const chunks=[];for await(const c of req)chunks.push(c);
 if(req.method==='PUT'&&req.headers['x-amz-copy-source']){
  const source=decodeURIComponent(String(req.headers['x-amz-copy-source'])).replace(/^\/?[^/]+\//,'');
  objects.set(key,{...objects.get(source),at:new Date().toISOString()});
  res.writeHead(200,{'content-type':'application/xml'});
  return res.end('<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>');
 }
 if(req.method==='PUT'){
  let body=Buffer.concat(chunks);
  if(String(req.headers['content-encoding']||'').includes('aws-chunked')){
   const parts=[];let o=0;
   while(o<body.length){const e=body.indexOf('\r\n',o);const n=parseInt(body.subarray(o,e).toString().split(';')[0],16);if(!n)break;parts.push(body.subarray(e+2,e+2+n));o=e+2+n+2}
   body=Buffer.concat(parts);
  }
  objects.set(key,{body,type:req.headers['content-type']||'application/octet-stream',at:new Date().toISOString()});
  res.writeHead(200,{etag:'"x"'});return res.end();
 }
 if(req.method==='DELETE'){objects.delete(key);res.writeHead(204);return res.end()}
 const o=objects.get(key);
 if(!o){res.writeHead(404,{'content-type':'application/xml'});return res.end(req.method==='HEAD'?undefined:'<Error><Code>NoSuchKey</Code></Error>')}
 res.writeHead(200,{'content-type':o.type,'content-length':o.body.length});
 res.end(req.method==='HEAD'?undefined:o.body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
Object.assign(process.env,{R2_ACCOUNT_ID:'t',R2_ACCESS_KEY_ID:'t',R2_SECRET_ACCESS_KEY:'t',R2_BUCKET_NAME:'silvia-test',
 R2_ENDPOINT:'http://127.0.0.1:'+server.address().port,R2_REGION:'auto'});
test.after(()=>server.close());
const storage=await import('../src/artwork-storage.mjs');

test('a picked master waits in staging/ and is moved into its artwork folder at draft creation',async()=>{
 const master=Buffer.alloc(5000,7);
 const staged=await storage.stageMasterUpload({filename:'Sunset.JPG',contentType:'image/jpeg',size:master.length});
 assert.match(staged.key,/^staging\/[a-f0-9-]{36}\/master\.jpg$/);
 await fetch(staged.uploadUrl,{method:'PUT',headers:{'content-type':'image/jpeg'},body:master});
 // No artwork folder or manifest exists yet.
 assert.ok(![...objects.keys()].some(k=>k.startsWith('artworks/')));

 const reservation=await storage.reserveArtworkUpload({title:'Sunset',orientation:'portrait',
  master:{filename:'Sunset.JPG',contentType:'image/jpeg',size:master.length},stagedMaster:{stageId:staged.stageId}});
 assert.equal(reservation.uploads.master.alreadyUploaded,true);
 assert.equal(reservation.uploads.master.uploadUrl,null);
 assert.deepEqual(objects.get(reservation.uploads.master.key).body,master);
 assert.ok(!objects.has(staged.key),'the staged copy is removed');
});

test('staging uploads only the master: the master is never an Etsy photo',async()=>{
 const staged=await storage.stageMasterUpload({filename:'Dawn.png',contentType:'image/png',size:10});
 assert.deepEqual(Object.keys(staged).sort(),['contentType','key','stageId','uploadUrl']);
});

test('a staged master of the wrong size falls back to a normal upload',async()=>{
 const staged=await storage.stageMasterUpload({filename:'a.jpg',contentType:'image/jpeg',size:100});
 await fetch(staged.uploadUrl,{method:'PUT',body:Buffer.alloc(120,1)});
 const reservation=await storage.reserveArtworkUpload({master:{filename:'a.jpg',contentType:'image/jpeg',size:100},
  stagedMaster:{stageId:staged.stageId}});
 assert.equal(reservation.uploads.master.alreadyUploaded,false);
 assert.ok(reservation.uploads.master.uploadUrl);
});

test('staged masters left unused for three days are removed',async()=>{
 objects.set('staging/11111111-1111-1111-1111-111111111111/master.jpg',{body:Buffer.alloc(10),type:'image/jpeg',at:new Date(Date.now()-4*86400000).toISOString()});
 objects.set('staging/22222222-2222-2222-2222-222222222222/master.jpg',{body:Buffer.alloc(10),type:'image/jpeg',at:new Date().toISOString()});
 await storage.pruneStagedMasters();
 assert.ok(!objects.has('staging/11111111-1111-1111-1111-111111111111/master.jpg'));
 assert.ok(objects.has('staging/22222222-2222-2222-2222-222222222222/master.jpg'));
});

test('the Product Creator stages the master on pick and reuses it when the draft is created',()=>{
 const page=readFileSync(new URL('../src/product-creator.mjs',import.meta.url),'utf8');
 assert.match(page,/masterFileInput\.addEventListener\('change',\(\)=>\{/);
 assert.match(page,/stagedMaster:stageId\?\{stageId\}:null/);
 assert.match(page,/data\.uploads\.master\.alreadyUploaded\?\[\]:/);
});
