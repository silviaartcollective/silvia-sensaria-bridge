import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
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

export async function artworkObjectExists(key) {
  const config = r2Config();
  const client = r2Client();
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (error) {
    const code = error?.$metadata?.httpStatusCode;
    if (code === 404 || error?.name === 'NotFound') return false;
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

export async function deleteArtworkObject(key) {
  const config = r2Config();
  const client = r2Client();
  await client.send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: key
  }));
  return { bucket: config.bucket, key };
}
