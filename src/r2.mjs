import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function r2Config() {
  return {
    accountId: required('R2_ACCOUNT_ID'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    bucket: required('R2_BUCKET_NAME'),
    endpoint: process.env.R2_ENDPOINT || `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    region: process.env.R2_REGION || 'auto'
  };
}

export function r2Client() {
  const config = r2Config();
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

export async function checkR2Connection() {
  const config = r2Config();
  const client = r2Client();
  const result = await client.send(new ListObjectsV2Command({
    Bucket: config.bucket,
    MaxKeys: 1
  }));

  return {
    connected: true,
    bucket: config.bucket,
    objectCountHint: Number(result.KeyCount || 0),
    hasObjects: Number(result.KeyCount || 0) > 0
  };
}

export async function putArtworkObject({ key, body, contentType }) {
  const config = r2Config();
  const client = r2Client();
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));
  return { bucket: config.bucket, key };
}

export async function putArtworkFile({ key, filePath, contentType }) {
  const config = r2Config();
  const client = r2Client();
  const stat = statSync(filePath);
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: stat.size,
    ContentType: contentType
  }));
  return { bucket: config.bucket, key, size: stat.size };
}

export async function signedArtworkUrl(key, expiresIn = 60 * 60) {
  const config = r2Config();
  const client = r2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn }
  );
}

export async function getArtworkObject(key) {
  const config = r2Config();
  const client = r2Client();
  const result = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: key
  }));
  const bytes = await result.Body.transformToByteArray();
  return {
    body: Buffer.from(bytes),
    contentType: result.ContentType || 'application/octet-stream',
    contentLength: result.ContentLength || bytes.length,
    etag: result.ETag || null
  };
}

export async function downloadArtworkObjectToFile(key, filePath) {
  const config = r2Config();
  const client = r2Client();
  const result = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: key
  }));
  await pipeline(result.Body, createWriteStream(filePath));
  return {
    filePath,
    contentType: result.ContentType || 'application/octet-stream',
    contentLength: Number(result.ContentLength || 0) || statSync(filePath).size,
    etag: result.ETag || null
  };
}

export function isMissingR2Object(error) {
  // New Cloudflare R2 buckets report S3 NoSuchKey with this exact message:
  // "The specified key does not exist." Missing queue data means empty queue.
  const status=Number(error?.$metadata?.httpStatusCode||0);
  const code=String(error?.name||error?.Code||error?.code||'').toLowerCase();
  const message=String(error?.message||'').toLowerCase();
  return status===404 || ['nosuchkey','notfound','nosuchobject'].includes(code) ||
    /the specified key does not exist|(?:key|object) does not exist|not.?found|no such key/i.test(message);
}

export async function artworkObjectInfo(key) {
  const client=r2Client(),config=r2Config();
  const response=await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:String(key)}));
  return {size:Number(response.ContentLength||0),contentType:String(response.ContentType||'')};
}

export async function artworkObjectExists(key) {
  const config = r2Config();
  const client = r2Client();
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (error) {
    if (isMissingR2Object(error)) return false;
    throw error;
  }
}

export async function putJsonObject(key, value) {
  return putArtworkObject({
    key,
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json; charset=utf-8'
  });
}

export async function getJsonObject(key) {
  const object = await getArtworkObject(key);
  return JSON.parse(object.body.toString('utf8'));
}

export async function signedArtworkUploadUrl(key, contentType, expiresIn = 15 * 60) {
  const config = r2Config();
  const client = r2Client();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType || 'application/octet-stream'
    }),
    { expiresIn }
  );
}

export async function listArtworkManifestKeys() {
  const config = r2Config();
  const client = r2Client();
  const keys = [];
  let continuationToken;

  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: 'artworks/SAC',
      ContinuationToken: continuationToken
    }));
    for (const object of result.Contents || []) {
      if (/^artworks\/SAC\d+\/manifest\.json$/.test(object.Key || '')) {
        keys.push(object.Key);
      }
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

export async function nextArtworkId() {
  const keys = await listArtworkManifestKeys();
  let max = 0;
  for (const key of keys) {
    const match = key.match(/^artworks\/SAC(\d+)\/manifest\.json$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `SAC${String(max + 1).padStart(4, '0')}`;
}

// R2 server-side copy: keeps large master and crop images off the Render app's memory.
export async function copyArtworkObject(sourceKey,targetKey) {
  const config=r2Config(),client=r2Client();
  const source=String(sourceKey||''),target=String(targetKey||'');
  if(!source||!target||source===target)throw Error('Distinct source and destination keys required.');
  const original=await artworkObjectInfo(source);
  const escapedSource=source.split('/').map(encodeURIComponent).join('/');
  await client.send(new CopyObjectCommand({
    Bucket:config.bucket,Key:target,
    CopySource:encodeURIComponent(config.bucket)+'/'+escapedSource,
    MetadataDirective:'COPY'
  }));
  const copied=await artworkObjectInfo(target);
  if(original.size!==copied.size||copied.size<1)
    throw Error('R2 copy size verification failed for '+target);
  return {key:target,size:copied.size,contentType:copied.contentType};
}
export async function listArtworkObjectKeys(prefix) {
  const config=r2Config(),client=r2Client(),keys=[];
  const normalized=String(prefix||'');
  if(!normalized||!normalized.endsWith('/'))throw Error('R2 listing requires an exact folder prefix.');
  let continuationToken;
  do{
    const batch=await client.send(new ListObjectsV2Command({
      Bucket:config.bucket,Prefix:normalized,ContinuationToken:continuationToken
    }));
    for(const item of batch.Contents||[])if(item.Key?.startsWith(normalized))keys.push(item.Key);
    continuationToken=batch.IsTruncated?batch.NextContinuationToken:undefined;
  }while(continuationToken);
  return keys;
}
export async function deleteArtworkObject(key) {
  const config = r2Config();
  const client = r2Client();
  await client.send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: key
  }));
  return { bucket: config.bucket, key };
}
