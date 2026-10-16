import crypto from 'node:crypto';
import {getJsonObject,putJsonObject,isMissingR2Object} from './r2.mjs';

const KEY='integrations/gmail/sensaria-oauth-v1.json';
const SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const flowRequests=new Map();
const cachedTokens=new Map();
function config(){
  return {
    clientId:String(process.env.GMAIL_OAUTH_CLIENT_ID||'').trim(),
    clientSecret:String(process.env.GMAIL_OAUTH_CLIENT_SECRET||'').trim(),
    redirectUri:String(process.env.GMAIL_OAUTH_REDIRECT_URI||'').trim()
  };
}
export function gmailOAuthConfigured(){
  const c=config();
  return Boolean(c.clientId&&c.clientSecret&&/^https:\/\/[a-z0-9.-]+\/tracking\/gmail\/callback$/i.test(c.redirectUri)
    &&process.env.GMAIL_TOKEN_ENCRYPTION_KEY);
}
function ensureConfig(){
  if(!gmailOAuthConfigured())throw Error('Gmail OAuth is not configured. Set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REDIRECT_URI and GMAIL_TOKEN_ENCRYPTION_KEY in Render.');
  return config();
}
function encryptionKey(){
  const raw=String(process.env.GMAIL_TOKEN_ENCRYPTION_KEY||'').trim();
  const key=Buffer.from(raw,'base64');
  if(key.length!==32||key.toString('base64')!==raw)
    throw Error('GMAIL_TOKEN_ENCRYPTION_KEY must contain exactly 32 random bytes encoded as base64.');
  return key;
}
function encryptSecret(data){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);
  cipher.setAAD(Buffer.from('sensaria-gmail-oauth-v1'));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
  return {version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
    ciphertext:bytes.toString('base64')};
}
function decryptSecret(record){
  if(Number(record?.version)!==1)throw Error('Unrecognized encrypted Gmail credential version.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(record.iv,'base64'));
  decipher.setAAD(Buffer.from('sensaria-gmail-oauth-v1'));
  decipher.setAuthTag(Buffer.from(record.tag,'base64'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()
  ]).toString('utf8'));
}
async function tokenRecord(){
  try{return decryptSecret(await getJsonObject(KEY));}
  catch(error){if(isMissingR2Object(error))return null;throw error;}
}
export async function gmailConnectionStatus(){
  if(!gmailOAuthConfigured())return {configured:false,connected:false,
    message:'Gmail OAuth credentials and encryption key must be configured on Render.'};
  const token=await tokenRecord();
  return token?.refreshToken
    ?{configured:true,connected:true,emailAddress:token.emailAddress||'',connectedAt:token.connectedAt||''}
    :{configured:true,connected:false,message:'Gmail has not been authorized yet.'};
}
export function beginGmailAuthorization(){
  const c=ensureConfig(),state=crypto.randomBytes(24).toString('hex');
  const verifier=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  flowRequests.set(state,{verifier,createdAt:Date.now()});
  for(const [key,item] of flowRequests)if(Date.now()-item.createdAt>10*60*1000)flowRequests.delete(key);
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [key,value] of Object.entries({
    client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:SCOPE,
    access_type:'offline',prompt:'consent',state,code_challenge:challenge,
    code_challenge_method:'S256',include_granted_scopes:'false'
  }))url.searchParams.set(key,value);
  return url.toString();
}
async function googleTokenRequest(body){
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams(body),signal:AbortSignal.timeout(15000)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.access_token)throw Error('Google authorization was unsuccessful ('+
    (data?.error||response.status)+'). Reconnect Gmail.');
  return data;
}
export async function finishGmailAuthorization(state,code){
  const item=flowRequests.get(String(state));
  flowRequests.delete(String(state));
  if(!item||Date.now()-item.createdAt>10*60*1000||!code)
    throw Error('Gmail authorization state expired. Return to Order Tracking and connect again.');
  const c=ensureConfig();
  const token=await googleTokenRequest({
    code:String(code),client_id:c.clientId,client_secret:c.clientSecret,
    redirect_uri:c.redirectUri,grant_type:'authorization_code',code_verifier:item.verifier
  });
  if(!String(token.scope||'').split(/\s+/).includes(SCOPE))
    throw Error('Gmail read-only permission was not granted.');
  if(!token.refresh_token)throw Error('Google did not issue an offline refresh token. Reconnect Gmail.');
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{
    headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error('Google connected but mailbox validation failed.');
  const profile=await response.json();
  const record={refreshToken:token.refresh_token,emailAddress:String(profile.emailAddress||''),
    connectedAt:new Date().toISOString()};
  await putJsonObject(KEY,encryptSecret(record));
  cachedTokens.clear();
  return {connected:true,emailAddress:record.emailAddress};
}
export async function gmailAccessToken(){
  const c=ensureConfig(),record=await tokenRecord();
  if(!record?.refreshToken)throw Error('Connect Gmail from the Order Tracking page first.');
  const cached=cachedTokens.get(record.emailAddress);
  if(cached?.until>Date.now()+60000)return cached.token;
  const token=await googleTokenRequest({
    refresh_token:record.refreshToken,client_id:c.clientId,
    client_secret:c.clientSecret,grant_type:'refresh_token'
  });
  cachedTokens.set(record.emailAddress,{
    token:token.access_token,until:Date.now()+Math.min(Number(token.expires_in)||3600,3600)*1000
  });
  return token.access_token;
}
export async function disconnectGmail(){
  const record=await tokenRecord();
  if(record?.refreshToken){
    // Best-effort revocation. Credential deletion must succeed regardless of Google's availability.
    try{await fetch('https://oauth2.googleapis.com/revoke',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({token:record.refreshToken}),signal:AbortSignal.timeout(7000)
    });}catch{}
  }
  // Overwrite rather than delete to keep the authorization record durable.
  await putJsonObject(KEY,encryptSecret({refreshToken:null,emailAddress:null,disconnectedAt:new Date().toISOString()}));
  cachedTokens.clear();
}
