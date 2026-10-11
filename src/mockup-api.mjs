import {GetObjectCommand} from '@aws-sdk/client-s3';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';
import {
 listMockupTemplates,getMockupTemplate,reserveMockupTemplate,confirmMockupTemplateUpload,updateMockupTemplate,
 deleteMockupTemplate,listMockupJobs,getMockupJob,createMockupJob,markMockupArtworkUploaded,
 controlMockupJob,claimMockupWork,completeMockupItem,failMockupItem,putMockupJob,
 classifySmartObjects,mockupOutputKey,getMockupItemDownload,registerMockupTemplatePreview,deleteMockupOutput,
 hasActiveMockupLease,MOCKUP_LEASE_MS,updateMockupItemProgress,MOCKUP_ROOT
} from './mockup-generator.mjs';
import {
 signedArtworkUploadUrl,signedArtworkUrl,getArtworkObject,artworkObjectExists,deleteArtworkObject,r2Client,r2Config
} from './r2.mjs';
import {randomUUID} from 'node:crypto';
import {streamMockupZip} from './mockup-zip.mjs';

const ID='[a-f0-9-]{36}';
const maxLength=200;
function isId(v){return /^[a-f0-9-]{36}$/.test(v||'')}
const str=v=>String(v??'').slice(0,maxLength);
function checkOrigin(req){
 const h=String(req.headers.host||'');
 const origin=String(req.headers.origin||'');
 const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0];
 if(req.headers['sec-fetch-site']==='cross-site'||origin&&origin!==proto+'://'+h)
  throw Error('Cross-origin changes are not allowed.');
 if(!String(req.headers['content-type']||'').includes('application/json'))throw Error('JSON body required.');
}
function ownerCheck(body){
 if(!isId(body?.owner))throw Error('A worker session ID is required.');
 return body.owner;
}
async function streamObject(res,key,name=''){
 const client=r2Client(),config=r2Config();
 const result=await client.send(new GetObjectCommand({Bucket:config.bucket,Key:key}));
 res.writeHead(200,{
  'content-type':result.ContentType||'application/octet-stream',
  'content-length':result.ContentLength,
  'cache-control':'private, no-store',
  'x-content-type-options':'nosniff',
  ...(name?{'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)}:{})
 });
 await pipeline(result.Body,res);
}
function makeError(error){
 const msg=String(error?.message||error||'Unexpected error');
 return {ok:false,error:msg.slice(0,450)};
}
export async function handleMockupAPI(req,res,url,{authenticated,workerAuthorized=()=>false,readJson,sendJson}){
 if(!url.pathname.startsWith('/api/mockups/'))return false;
 if(!authenticated(req,res))return true;
 if(req.method!=='GET'){
  try{checkOrigin(req)}catch(e){sendJson(res,403,makeError(e));return true;}
 }
 const send=(code,body)=>sendJson(res,code,{ok:true,...body});
 const parts=url.pathname.replace(/^\/api\/mockups\//,'').split('/').filter(Boolean);
 try{
  // The local crop/PSD worker uses the same bearer token and queue as production crops.
  if(parts[0]==='worker'){
   if(!workerAuthorized(req))return sendJson(res,403,{ok:false,error:'PC worker token required.'}),true;
   if(req.method==='POST'&&parts[1]==='claim'&&parts.length===2){
    const body=await readJson(req),owner=ownerCheck(body);
    const v=String(body.version||'0').split('.').map(Number);
    if(!(v[0]>4||(v[0]===4&&(v[1]>0||(v[1]===0&&v[2]>=1))))){
     sendJson(res,426,{ok:false,error:'PC mockup worker version 4.0.1 or newer is required. Update the worker folder and restart it.'});return true;
    }
    const jobs=(await listMockupJobs()).filter(j=>j.artworkUploaded&&!j.paused&&!j.deleted&&
      j.templates?.some(t=>t.status==='queued'||t.status==='processing')&&!hasActiveMockupLease(j))
      .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    for(const candidate of jobs){
     let claimed;
     try{claimed=await claimMockupWork(candidate.id,owner)}
     catch(error){if(/processing|lease|paused/i.test(String(error?.message)))continue;throw error}
     if(!claimed?.item)continue;
     const template=await getMockupTemplate(claimed.item.id);
     const key=mockupOutputKey(candidate.id,template.id);
     return send(200,{job:claimed.job,item:claimed.item,template,
       templateUrl:await signedArtworkUrl(template.key,3600),
       artworkUrl:await signedArtworkUrl(claimed.job.artworkKey,3600),
       output:{key,uploadUrl:await signedArtworkUploadUrl(key,'image/jpeg',3600)}}),true;
    }
    return send(200,{job:null,item:null}),true;
   }
   if(req.method==='POST'&&parts.length===5&&parts[2]==='templates'&&parts[4]==='progress'&&isId(parts[1])&&isId(parts[3])){
    const body=await readJson(req);
    return send(200,{job:await updateMockupItemProgress(parts[1],ownerCheck(body),parts[3],str(body.stage))}),true;
   }
   sendJson(res,404,{ok:false,error:'Unknown PC worker mockup operation.'});return true;
  }
  if(parts[0]==='templates'){
   if(req.method==='GET'&&parts.length===1)return send(200,{templates:await listMockupTemplates()}),true;
   if(req.method==='POST'&&parts.length===1){
    const t=await reserveMockupTemplate(await readJson(req));
    return send(201,{template:t,uploadUrl:await signedArtworkUploadUrl(t.key,'application/octet-stream',3600)}),true;
   }
   const id=parts[1];
   if(!isId(id))throw Error('Invalid template ID.');
   if(req.method==='POST'&&parts[2]==='confirm'){
    return send(200,{template:await confirmMockupTemplateUpload(id)}),true;
   }
   if(req.method==='POST'&&parts[2]==='update'){
    return send(200,{template:await updateMockupTemplate(id,await readJson(req))}),true;
   }
   if(req.method==='POST'&&parts[2]==='inspect'){
    const body=await readJson(req),t=await getMockupTemplate(id);
    const classified=classifySmartObjects(body.objects,t);
    const template=await updateMockupTemplate(id,{smartObjects:classified.objects});
    return send(200,{classification:classified,template}),true;
   }
   if(req.method==='POST'&&parts[2]==='preview'){
    const t=await getMockupTemplate(id);
    const key='mockup-generator/v1/silvia/templates/'+id+'/preview-'+randomUUID()+'.jpg';
    return send(200,{key,uploadUrl:await signedArtworkUploadUrl(key,'image/jpeg',3600)}),true;
   }
   if(req.method==='POST'&&parts[2]==='preview-confirm'){
    const body=await readJson(req),key=str(body.key);
    if(!key.startsWith('mockup-generator/v1/silvia/templates/'+id+'/preview-')||!key.endsWith('.jpg'))
      throw Error('Invalid preview location.');
    const data=await getArtworkObject(key);
    if(data.body.length>3*1024*1024)throw Error('Preview must be under 3MB.');
    const info=await sharp(data.body).metadata();
    if(info.format!=='jpeg'||info.width>1800||info.height>1800)throw Error('Invalid template preview.');
    return send(200,{template:await registerMockupTemplatePreview(id,key)}),true;
   }
   if(req.method==='DELETE'&&parts.length===2)return send(200,await deleteMockupTemplate(id)),true;
  }
  if(parts[0]==='jobs'){
   if(req.method==='GET'&&parts.length===1)return send(200,{jobs:await listMockupJobs()}),true;
   if(req.method==='POST'&&parts.length===1){
    const job=await createMockupJob(await readJson(req));
    return send(201,{job,uploadUrl:await signedArtworkUploadUrl(job.artworkKey,'application/octet-stream',3600)}),true;
   }
   const id=parts[1];if(!isId(id))throw Error('Invalid batch ID.');
   if(req.method==='GET'&&parts.length===2)return send(200,{job:await getMockupJob(id)}),true;
   if(req.method==='POST'&&parts[2]==='artwork-confirm'){
    return send(200,{job:await markMockupArtworkUploaded(id)}),true;
   }
   if(req.method==='POST'&&parts[2]==='control'){
    const body=await readJson(req);
    return send(200,{job:await controlMockupJob(id,str(body.action),ownerCheck(body))}),true;
   }
   if(req.method==='POST'&&parts[2]==='claim'){
    const body=await readJson(req),owner=ownerCheck(body);
    const claimed=await claimMockupWork(id,owner);
    if(!claimed.item)return send(200,claimed),true;
    const template=await getMockupTemplate(claimed.item.id);
    const key=mockupOutputKey(id,template.id);
    return send(200,{...claimed,template,
      output:{key,uploadUrl:await signedArtworkUploadUrl(key,'image/jpeg',3600)}}),true;
   }
   if(req.method==='POST'&&parts[2]==='heartbeat'){
    const body=await readJson(req),owner=ownerCheck(body),j=await getMockupJob(id);
    if(!hasActiveMockupLease(j)||j.lease.owner!==owner)throw Error('This browser no longer owns the batch.');
    const now=Date.now();
    j.lease.renewedAt=new Date(now).toISOString();
    j.lease.expiresAt=new Date(now+MOCKUP_LEASE_MS).toISOString();
    await putMockupJob(j);return send(200,{lease:j.lease,status:j.status,paused:j.paused}),true;
   }
   if(req.method==='POST'&&parts[2]==='complete'){
    const body=await readJson(req),owner=ownerCheck(body),itemId=str(body.templateId),key=str(body.outputKey);
    const j=await getMockupJob(id);
    const item=j.templates.find(x=>x.id===itemId);
    if(!item)throw Error('Output does not belong to this batch.');
    if(!key.startsWith('mockup-generator/v1/silvia/jobs/'+id+'/outputs/'+itemId+'/')||!key.endsWith('.jpg'))
     throw Error('Output path is not valid for this job.');
    if(!body.visibilityVerified||!body.mappingVerified||!body.artworkReplaced)
     throw Error('The artwork replacement, target Smart Object, and original layer visibility must be verified.');
    const data=await getArtworkObject(key);
    if(!data.body.length||data.body.length>60*1024*1024)throw Error('Invalid mockup JPG size.');
    if(data.body[0]!==255||data.body[1]!==216)throw Error('Output is not a JPEG.');
    const metadata=await sharp(data.body,{limitInputPixels:24_000_001}).metadata();
    if(metadata.format!=='jpeg'||metadata.width*metadata.height>24_000_000||
       metadata.width<150||metadata.height<150)throw Error('Export does not meet the 24MP JPG requirements.');
    const old=item.outputKey;
    const result=await completeMockupItem(id,owner,itemId,{outputKey:key,
     dimensions:{width:metadata.width,height:metadata.height},mapping:str(body.mapping)});
    if(old&&old!==key)await deleteArtworkObject(old).catch(()=>{});
    return send(200,{job:result}),true;
   }
   if(req.method==='POST'&&parts[2]==='fail'){
    const body=await readJson(req);
    return send(200,{job:await failMockupItem(id,ownerCheck(body),str(body.templateId),
     str(body.error||'Photopea processing failed'),!!body.needsMapping)}),true;
   }
   if(req.method==='DELETE'&&parts[2]==='download'&&isId(parts[3])){
    return send(200,{job:await deleteMockupOutput(id,parts[3])}),true;
   }
   if(req.method==='GET'&&parts[2]==='download-all'){
    await streamMockupZip(res,id);return true;
   }
   if(req.method==='GET'&&parts[2]==='thumbnail'&&isId(parts[3])){
    // Small previews avoid loading full-resolution 24MP JPGs into a long scrolling list.
    const d=await getMockupItemDownload(id,parts[3]);
    const original=await getArtworkObject(d.key);
    if(!original.body.length||original.body.length>60*1024*1024)
     throw Error('Generated preview source is too large.');
    const thumbnail=await sharp(original.body,{limitInputPixels:24_000_001})
     .rotate().resize(280,280,{fit:'inside',withoutEnlargement:true})
     .jpeg({quality:72}).toBuffer();
    res.writeHead(200,{
     'content-type':'image/jpeg','content-length':thumbnail.length,
     'cache-control':'private, max-age=180','x-content-type-options':'nosniff'
    });
    res.end(thumbnail);return true;
   }
   if(req.method==='GET'&&parts[2]==='download'&&isId(parts[3])){
    const d=await getMockupItemDownload(id,parts[3]);
    return streamObject(res,d.key,d.name).then(()=>true);
   }
   if(req.method==='DELETE'&&parts.length===2){
    const j=await getMockupJob(id);
    if(j.status==='running'&&Date.parse(j.lease?.expiresAt)>Date.now())
      throw Error('Pause this batch before deleting it.');
    for(const t of j.templates)if(t.outputKey)await deleteArtworkObject(t.outputKey);
    await deleteArtworkObject(j.artworkKey);
    j.deleted=true;j.status='deleted';await putMockupJob(j);
    return send(200,{deleted:true}),true;
   }
  }
  if(parts[0]==='file'&&req.method==='GET'){
    const kind=parts[1],id=parts[2];
    if(!isId(id))throw Error('Invalid source ID.');
    if(kind==='template'){
      const t=await getMockupTemplate(id);if(t.status!=='ready')throw Error('Template not ready.');
      await streamObject(res,t.key);return true;
    }
    if(kind==='preview'){
      const t=await getMockupTemplate(id);
      if(!t.previewKey)throw Error('Template preview unavailable.');
      await streamObject(res,t.previewKey);return true;
    }
    if(kind==='artwork'){
      const j=await getMockupJob(id);if(!j.artworkUploaded)throw Error('Artwork not uploaded.');
      await streamObject(res,j.artworkKey);return true;
    }
  }
  sendJson(res,404,{ok:false,error:'Unknown mockup-generator operation.'});
 }catch(error){
  if(!res.headersSent)sendJson(res,400,makeError(error));
  else res.destroy(error);
 }
 return true;
}
