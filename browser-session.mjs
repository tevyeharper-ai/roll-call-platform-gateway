import crypto from 'node:crypto';

export const browserCookies={
  session:'__Host-roll_call_session',
  identity:'__Host-roll_call_identity',
  state:'__Host-roll_call_oidc_state',
  verifier:'__Host-roll_call_pkce',
  nonce:'__Host-roll_call_nonce',
  returnTo:'__Host-roll_call_return',
  transaction:'__Host-roll_call_oidc_tx',
  recovery:'__Host-roll_call_oidc_recovery'
};

function clean(value){return String(value??'').trim();}
function strip(value){return clean(value).replace(/\/+$/,'');}
function b64(value){return Buffer.from(value).toString('base64url');}
function decodePart(value){return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}
function safeEqual(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}

export function loadBrowserAuthConfig(env=process.env){
  const issuer=strip(env.RC_OIDC_ISSUER);
  const clientId=clean(env.RC_OIDC_CLIENT_ID);
  const clientSecret=clean(env.RC_OIDC_CLIENT_SECRET);
  const publicUrl=strip(env.RC_PUBLIC_URL);
  const sessionSecret=clean(env.RC_SESSION_SECRET);
  const callbackUrl=publicUrl?publicUrl+'/auth/callback':'';
  return {issuer,clientId,clientSecret,publicUrl,callbackUrl,sessionSecret};
}

export function browserAuthFailures(config){
  const failures=[];
  if(!config.issuer.startsWith('https://'))failures.push('oidc_issuer_invalid');
  if(!config.clientId)failures.push('oidc_client_id_missing');
  if(config.clientSecret.length<32)failures.push('oidc_client_secret_too_short');
  if(!config.publicUrl.startsWith('https://'))failures.push('public_url_invalid');
  if(config.sessionSecret.length<32)failures.push('session_secret_too_short');
  return failures;
}

export function parseCookies(header=''){
  const out={};
  for(const part of String(header||'').split(';')){
    const i=part.indexOf('=');
    if(i<=0)continue;
    const name=part.slice(0,i).trim(),value=part.slice(i+1).trim();
    if(name)out[name]=value;
  }
  return out;
}
export function cookie(name,value,{maxAge=600,httpOnly=true,sameSite='Lax'}={}){
  const parts=[name+'='+value,'Path=/','Secure'];
  if(httpOnly)parts.push('HttpOnly');
  if(sameSite)parts.push('SameSite='+sameSite);
  if(Number.isFinite(maxAge))parts.push('Max-Age='+Math.max(0,Math.floor(maxAge)));
  return parts.join('; ');
}
export function clearCookie(name){return cookie(name,'',{maxAge:0});}

function key(secret){return crypto.createHash('sha256').update(secret).digest();}
function seal(value,label,secret){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key(secret),iv);
  cipher.setAAD(Buffer.from(label));
  const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return 'v1.'+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
function open(value,label,secret){
  try{
    if(!String(value||'').startsWith('v1.'))return null;
    const raw=Buffer.from(String(value).slice(3),'base64url');
    if(raw.length<29)return null;
    const iv=raw.subarray(0,12),tag=raw.subarray(12,28),encrypted=raw.subarray(28);
    const decipher=crypto.createDecipheriv('aes-256-gcm',key(secret),iv);
    decipher.setAAD(Buffer.from(label));decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');
  }catch{return null;}
}

export function sealBrowserSession(session,config){
  return seal(JSON.stringify(session),'roll-call-session-v1',config.sessionSecret);
}
export function openBrowserSession(value,config){
  try{
    const raw=open(value,'roll-call-session-v1',config.sessionSecret);
    if(!raw)return null;
    const session=JSON.parse(raw);
    if(!session?.sub||!session?.issuer||!session?.expiresAt||session.expiresAt<=Date.now())return null;
    return session;
  }catch{return null;}
}
export function sealIdentityToken(token,config){return seal(token,'roll-call-identity-token-v1',config.sessionSecret);}
export function openIdentityToken(value,config){return open(value,'roll-call-identity-token-v1',config.sessionSecret);}

function sealOidcTransaction(value,config){
  return seal(JSON.stringify(value),'roll-call-oidc-transaction-v1',config.sessionSecret);
}
function openOidcTransaction(value,config){
  try{
    const raw=open(value,'roll-call-oidc-transaction-v1',config.sessionSecret);
    if(!raw)return null;
    const tx=JSON.parse(raw);
    if(!tx?.state||!tx?.verifier||!tx?.nonce||!tx?.returnTo||!tx?.createdAt)return null;
    if(Date.now()-Number(tx.createdAt)>30*60*1000)return null;
    return tx;
  }catch{return null;}
}
function sealStateEnvelope(value,config){
  return seal(JSON.stringify(value),'roll-call-oidc-state-envelope-v1',config.sessionSecret);
}
function openStateEnvelope(value,config){
  try{
    const raw=open(value,'roll-call-oidc-state-envelope-v1',config.sessionSecret);
    if(!raw)return null;
    const state=JSON.parse(raw);
    if(!state?.id||!state?.returnTo||!state?.createdAt)return null;
    if(Date.now()-Number(state.createdAt)>30*60*1000)return null;
    return state;
  }catch{return null;}
}
export function recoverBrowserReturnTo(state,config){
  const recovered=openStateEnvelope(state,config);
  return recovered?.returnTo?safeReturnTo(recovered.returnTo):null;
}

export function safeReturnTo(value){
  const v=String(value||'').trim();
  if(!v.startsWith('/')||v.startsWith('//')||v.startsWith('/auth/')||v.startsWith('/api/auth/'))return '/app';
  return v;
}
export function randomBase64Url(bytes=32){return crypto.randomBytes(bytes).toString('base64url');}
export function pkceChallenge(verifier){return crypto.createHash('sha256').update(verifier).digest('base64url');}

export async function discoverOidc(config,fetchImpl=fetch){
  const response=await fetchImpl(config.issuer+'/.well-known/openid-configuration',{headers:{accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw new Error('oidc_discovery_failed');
  const body=await response.json();
  if(body.issuer!==config.issuer)throw new Error('oidc_issuer_mismatch');
  for(const key of ['authorization_endpoint','token_endpoint','jwks_uri'])if(!String(body[key]||'').startsWith('https://'))throw new Error('oidc_'+key+'_invalid');
  return body;
}

export async function beginBrowserLogin(config,{returnTo='/app'}={},fetchImpl=fetch){
  const discovery=await discoverOidc(config,fetchImpl);
  const returnPath=safeReturnTo(returnTo);
  const verifier=randomBase64Url(48),nonce=randomBase64Url(32);
  const state=sealStateEnvelope({id:randomBase64Url(24),returnTo:returnPath,createdAt:Date.now()},config);
  const transaction=sealOidcTransaction({state,verifier,nonce,returnTo:returnPath,createdAt:Date.now()},config);
  const target=new URL(discovery.authorization_endpoint);
  target.searchParams.set('client_id',config.clientId);
  target.searchParams.set('redirect_uri',config.callbackUrl);
  target.searchParams.set('response_type','code');
  target.searchParams.set('scope','openid profile email');
  target.searchParams.set('state',state);
  target.searchParams.set('nonce',nonce);
  target.searchParams.set('code_challenge',pkceChallenge(verifier));
  target.searchParams.set('code_challenge_method','S256');
  return {
    authorizationUrl:target.toString(),
    cookies:[
      cookie(browserCookies.transaction,transaction,{maxAge:1800}),
      clearCookie(browserCookies.state),
      clearCookie(browserCookies.verifier),
      clearCookie(browserCookies.nonce),
      clearCookie(browserCookies.returnTo)
    ]
  };
}

async function verifyIdToken(token,config,discovery,nonce,fetchImpl=fetch){
  const parts=String(token||'').split('.');
  if(parts.length!==3)throw new Error('id_token_format_invalid');
  const header=decodePart(parts[0]),claims=decodePart(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw new Error('id_token_algorithm_invalid');
  if(claims.iss!==config.issuer)throw new Error('id_token_issuer_invalid');
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!aud.includes(config.clientId))throw new Error('id_token_audience_invalid');
  if(typeof claims.exp!=='number'||claims.exp*1000<=Date.now())throw new Error('id_token_expired');
  if(!safeEqual(claims.nonce,nonce))throw new Error('id_token_nonce_invalid');
  if(typeof claims.sub!=='string'||!claims.sub)throw new Error('id_token_subject_missing');
  const jwksResponse=await fetchImpl(discovery.jwks_uri,{headers:{accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(7000)});
  if(!jwksResponse.ok)throw new Error('oidc_jwks_failed');
  const jwks=await jwksResponse.json();
  const jwk=(jwks.keys||[]).find(item=>item.kid===header.kid&&item.kty==='RSA');
  if(!jwk)throw new Error('oidc_signing_key_missing');
  const verified=crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),crypto.createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  if(!verified)throw new Error('id_token_signature_invalid');
  return {
    sub:claims.sub,issuer:claims.iss,
    preferredUsername:typeof claims.preferred_username==='string'?claims.preferred_username:null,
    name:typeof claims.name==='string'?claims.name:null,
    email:typeof claims.email==='string'?claims.email:null,
    emailVerified:claims.email_verified===true,
    acr:typeof claims.acr==='string'?claims.acr:null,
    amr:Array.isArray(claims.amr)?claims.amr.filter(v=>typeof v==='string'):[],
    authTime:typeof claims.auth_time==='number'?claims.auth_time:null,
    expiresAt:claims.exp*1000
  };
}

export async function completeBrowserLogin(config,{code,expectedState,state,verifier,nonce},fetchImpl=fetch){
  if(!code||!state||!expectedState||!safeEqual(state,expectedState)||!verifier||!nonce)throw new Error('identity_state_invalid');
  const discovery=await discoverOidc(config,fetchImpl);
  const credentials=Buffer.from(config.clientId+':'+config.clientSecret).toString('base64');
  const response=await fetchImpl(discovery.token_endpoint,{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+credentials,accept:'application/json'},
    body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:config.callbackUrl,code_verifier:verifier}).toString(),
    redirect:'error',signal:AbortSignal.timeout(10000)
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.id_token)throw new Error('oidc_token_exchange_failed');
  const identity=await verifyIdToken(body.id_token,config,discovery,nonce,fetchImpl);
  const expiresIn=Math.max(60,Math.min(3600,Math.floor((identity.expiresAt-Date.now())/1000)));
  return {
    identity,
    idToken:body.id_token,
    cookies:[
      cookie(browserCookies.session,sealBrowserSession(identity,config),{maxAge:expiresIn}),
      cookie(browserCookies.identity,sealIdentityToken(body.id_token,config),{maxAge:expiresIn}),
      clearCookie(browserCookies.transaction),clearCookie(browserCookies.recovery),
      clearCookie(browserCookies.state),clearCookie(browserCookies.verifier),clearCookie(browserCookies.nonce),clearCookie(browserCookies.returnTo)
    ]
  };
}

export function readBrowserCredentials(cookieHeader,config){
  const jar=parseCookies(cookieHeader);
  const tx=openOidcTransaction(jar[browserCookies.transaction],config);
  return {
    session:openBrowserSession(jar[browserCookies.session],config),
    identityToken:openIdentityToken(jar[browserCookies.identity],config),
    returnTo:tx?.returnTo||(jar[browserCookies.returnTo]?Buffer.from(jar[browserCookies.returnTo],'base64url').toString('utf8'):null),
    state:tx?.state||jar[browserCookies.state]||null,
    verifier:tx?.verifier||jar[browserCookies.verifier]||null,
    nonce:tx?.nonce||jar[browserCookies.nonce]||null,
    transactionPresent:Boolean(tx),
    recovery:jar[browserCookies.recovery]||null
  };
}

export function loginRecoveryCookies(){
  return [
    clearCookie(browserCookies.transaction),
    clearCookie(browserCookies.state),
    clearCookie(browserCookies.verifier),
    clearCookie(browserCookies.nonce),
    clearCookie(browserCookies.returnTo),
    cookie(browserCookies.recovery,'1',{maxAge:300})
  ];
}

export function logoutCookies(){
  return [browserCookies.session,browserCookies.identity,browserCookies.transaction,browserCookies.recovery,browserCookies.state,browserCookies.verifier,browserCookies.nonce,browserCookies.returnTo].map(clearCookie);
}
