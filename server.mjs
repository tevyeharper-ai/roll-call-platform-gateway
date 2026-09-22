import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { Readable } from 'node:stream';
import {beginBrowserLogin,browserAuthFailures,completeBrowserLogin,loadBrowserAuthConfig,logoutCookies,readBrowserCredentials,safeReturnTo} from './browser-session.mjs';

const VERSION = 'P3.6.0';
const SERVICE = 'roll-call-platform-gateway';
const DEFAULT_CONSUMERS = ['events', 'broadcast', 'field', 'experiential', 'asmbly'];
const CORRELATION_HEADERS = [
  'x-roll-call-context-id',
  'x-roll-call-request-id',
  'x-roll-call-trace-id',
  'x-roll-call-correlation-id'
];

function nonempty(value) { return typeof value === 'string' && value.trim() !== ''; }
function nowIso() { return new Date().toISOString(); }
function parseConsumers(raw = '') {
  const values = String(raw || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  return [...new Set(values.length ? values : DEFAULT_CONSUMERS)];
}
function decodeBase64urlJson(input) { return JSON.parse(Buffer.from(input, 'base64url').toString('utf8')); }
function keyId(publicKeyPem) { return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 24); }
function exportPublicJwk(publicKeyPem) {
  try { return crypto.createPublicKey(publicKeyPem).export({ format: 'jwk' }); }
  catch { return null; }
}
function sha256(value){ return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function secureHashMatch(raw, expectedHash){
  if(!raw || !expectedHash) return false;
  const left=Buffer.from(sha256(raw)), right=Buffer.from(String(expectedHash));
  return left.length===right.length && crypto.timingSafeEqual(left,right);
}
function requiredIdentityClaims(payload) {
  const required = ['principal_id','principal_type','tenant_id','application_id','workspace_id','environment','iat','exp','assertion_id','trace_id','correlation_id'];
  return required.filter(k => payload?.[k] === undefined || payload?.[k] === null || payload?.[k] === '');
}
function cleanUrl(value=''){ return String(value||'').trim().replace(/\/$/,''); }
function uuid(value){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||'')); }
function parseWorkspaceBindings(raw=''){
  if(!String(raw||'').trim())return {};
  try{
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    return value;
  }catch{return {};}
}
function workspaceBinding(bindings,organizationId,workspaceId){
  const value=bindings?.[organizationId+':'+workspaceId]||bindings?.[workspaceId]||null;
  if(!value||typeof value!=='object')return null;
  const tenantId=String(value.tenant_id||'').trim(),eventsWorkspaceId=String(value.workspace_id||'').trim();
  return tenantId&&eventsWorkspaceId?{tenant_id:tenantId,workspace_id:eventsWorkspaceId}:null;
}

export function loadConfig(env = process.env) {
  const serviceId = env.RC_GATEWAY_SERVICE_ID || 'roll-call-platform-gateway:p3.6-staging';
  const environment = env.RC_GATEWAY_ENV || env.NODE_ENV || 'development';
  const publicKeyPem = env.RC_GATEWAY_PUBLIC_KEY_PEM || '';
  const privateKeyPem = env.RC_GATEWAY_PRIVATE_KEY_PEM || '';
  const consumers = parseConsumers(env.RC_REFERENCE_CONSUMERS);
  return {
    port: Number(env.PORT || 8080),
    serviceId,
    environment,
    publicKeyPem,
    privateKeyPem,
    keyId: nonempty(publicKeyPem) ? keyId(publicKeyPem) : null,
    consumers,
    browserAuth:loadBrowserAuthConfig(env),
    wordpressOrigin: env.RC_WORDPRESS_ORIGIN || null,
    platformAccess: {
      url: cleanUrl(env.RC_PLATFORM_ACCESS_URL),
      serviceKey: String(env.RC_PLATFORM_ACCESS_GATEWAY_KEY || '').trim()
    },
    eventsOwner:{
      baseUrl:cleanUrl(env.RC_ROLL_CALL_EVENTS_READ_URL),
      serviceKey:String(env.RC_ROLL_CALL_EVENTS_READ_KEY||'').trim(),
      workspaceBindings:parseWorkspaceBindings(env.RC_EVENTS_WORKSPACE_BINDINGS_JSON)
    },
    broadcastOwner:{
      baseUrl:cleanUrl(env.RC_ROLL_CALL_BROADCAST_URL),
      serviceKey:String(env.RC_ROLL_CALL_BROADCAST_SERVICE_KEY||'').trim()
    },
    omni: {
      serviceKeyHash: String(env.RC_OMNI_GATEWAY_SERVICE_KEY_SHA256 || '').trim(),
      accessUrl: cleanUrl(env.RC_PLATFORM_ACCESS_URL),
      accessServiceKey: String(env.RC_PLATFORM_ACCESS_GATEWAY_KEY || '').trim(),
      ownerBaseUrl: cleanUrl(env.RC_ROLL_CALL_EVENTS_READ_URL),
      ownerServiceKey: String(env.RC_ROLL_CALL_EVENTS_READ_KEY || '').trim(),
      organizationId: String(env.RC_OMNI_ROLL_CALL_ORGANIZATION_ID || 'roll-call-events').trim(),
      tenantId: String(env.RC_OMNI_ROLL_CALL_TENANT_ID || '').trim(),
      workspaceId: String(env.RC_OMNI_ROLL_CALL_WORKSPACE_ID || '').trim(),
      maxReceiptAgeSeconds: Number(env.RC_ACCESS_RECEIPT_MAX_AGE_SECONDS || 120)
    }
  };
}

export function platformAccessFailures(config){
  const f=[];
  if(!config.platformAccess.url.startsWith('https://'))f.push('platform_access_url_invalid');
  if(!config.platformAccess.serviceKey)f.push('platform_access_gateway_key_missing');
  return f;
}

export function omniReadFailures(config){
  const f=[];
  if(!/^[a-f0-9]{64}$/i.test(config.omni.serviceKeyHash))f.push('omni_gateway_service_key_hash_missing');
  if(!config.omni.accessUrl.startsWith('https://'))f.push('platform_access_url_invalid');
  if(!config.omni.accessServiceKey)f.push('platform_access_gateway_key_missing');
  if(!config.omni.ownerBaseUrl.startsWith('https://'))f.push('roll_call_events_read_url_invalid');
  if(!config.omni.ownerServiceKey)f.push('roll_call_events_read_key_missing');
  if(config.omni.organizationId!=='roll-call-events')f.push('roll_call_events_organization_invalid');
  if(!uuid(config.omni.tenantId))f.push('roll_call_events_tenant_id_invalid');
  if(!uuid(config.omni.workspaceId))f.push('roll_call_events_workspace_id_invalid');
  if(!Number.isFinite(config.omni.maxReceiptAgeSeconds)||config.omni.maxReceiptAgeSeconds<30||config.omni.maxReceiptAgeSeconds>600)f.push('receipt_age_window_invalid');
  return f;
}

function requestCorrelation(req) {
  const incoming = {};
  for (const name of CORRELATION_HEADERS) incoming[name] = String(req.headers[name] || '');
  if (!incoming['x-roll-call-request-id']) incoming['x-roll-call-request-id'] = `req_${crypto.randomUUID()}`;
  if (!incoming['x-roll-call-trace-id']) incoming['x-roll-call-trace-id'] = `tr_${crypto.randomUUID()}`;
  if (!incoming['x-roll-call-correlation-id']) incoming['x-roll-call-correlation-id'] = `corr_${crypto.randomUUID()}`;
  return incoming;
}

function send(res, status, payload, correlation = null) {
  const body = JSON.stringify(payload, null, 2);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  };
  if (correlation) for (const [k,v] of Object.entries(correlation)) if (v) headers[k] = v;
  res.writeHead(status, headers);
  res.end(body);
}

function redirect(res,location,{cookies=[]}={}){
  const headers={location,'cache-control':'no-store','x-content-type-options':'nosniff'};
  if(cookies.length)headers['set-cookie']=cookies;
  res.writeHead(302,headers);res.end();
}
function toolkitId(value=''){
  const raw=String(value||'').trim().toLowerCase();
  const map={events:'roll-call.events',broadcast:'roll-call.broadcast',field:'roll-call.field',experiential:'roll-call.experiential'};
  return map[raw]||(['roll-call.events','roll-call.broadcast','roll-call.field','roll-call.experiential'].includes(raw)?raw:null);
}
function shellToolkits(entitlements=[]){
  const active=new Map(entitlements.map(item=>[item.toolkit_id,item]));
  return [
    ['roll-call.events','Events','/app/events'],
    ['roll-call.broadcast','Broadcast','/app/broadcast'],
    ['roll-call.field','Field','/app/field'],
    ['roll-call.experiential','Experiential','/app/experiential']
  ].map(([id,label,href])=>({toolkit_id:id,label,href,entitled:active.has(id),status:active.get(id)?.status||null}));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 128_000) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('invalid_json'), { statusCode: 400 }); }
}

export function verifyAssertion(assertion, config, clock = () => Math.floor(Date.now()/1000)) {
  if (!nonempty(assertion)) return { ok: false, error: 'assertion_required' };
  if (!nonempty(config.publicKeyPem)) return { ok: false, error: 'verification_key_unavailable' };
  const parts = assertion.split('.');
  if (parts.length !== 3) return { ok: false, error: 'assertion_format_invalid' };
  let header, payload;
  try { header = decodeBase64urlJson(parts[0]); payload = decodeBase64urlJson(parts[1]); }
  catch { return { ok: false, error: 'assertion_decode_failed' }; }
  if (header.alg !== 'RS256') return { ok: false, error: 'assertion_alg_invalid' };
  if (header.typ && header.typ !== 'JWT') return { ok: false, error: 'assertion_type_invalid' };
  if (header.kid && config.keyId && header.kid !== config.keyId) return { ok: false, error: 'assertion_kid_mismatch' };
  const signature = Buffer.from(parts[2], 'base64url');
  const verified = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), config.publicKeyPem, signature);
  if (!verified) return { ok: false, error: 'assertion_signature_invalid' };
  const missing = requiredIdentityClaims(payload);
  if (missing.length) return { ok: false, error: 'assertion_claims_missing', missing };
  const now = clock();
  if (!Number.isFinite(Number(payload.iat)) || !Number.isFinite(Number(payload.exp))) return { ok: false, error: 'assertion_time_invalid' };
  if (Number(payload.iat) > now + 60) return { ok: false, error: 'assertion_not_yet_valid' };
  if (Number(payload.exp) <= now) return { ok: false, error: 'assertion_expired' };
  if (payload.environment !== config.environment) return { ok: false, error: 'assertion_environment_mismatch' };
  return { ok: true, principal: payload };
}

function omniServiceAuthorized(req,config){
  return secureHashMatch(String(req.headers['x-platform-service-key']||''),config.omni.serviceKeyHash);
}

async function fetchJson(fetchImpl,url,options={}){
  const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});
  const body=await response.json().catch(()=>null);
  return {response,body};
}

function broadcastAppRoutingFailures(config){
  const failures=[];
  if(!config.broadcastOwner.baseUrl.startsWith('https://'))failures.push('broadcast_owner_url_invalid');
  if(browserAuthFailures(config.browserAuth).length)failures.push('roll_call_browser_session_not_ready');
  if(platformAccessFailures(config).length)failures.push('platform_access_not_ready');
  return failures;
}

function proxyRequestHeaders(req,correlation,session){
  const headers={};
  const blocked=new Set(['host','connection','transfer-encoding','content-length','upgrade','proxy-connection']);
  for(const [key,value] of Object.entries(req.headers)){
    if(blocked.has(key.toLowerCase())||value===undefined)continue;
    headers[key]=Array.isArray(value)?value.join(', '):String(value);
  }
  headers['x-forwarded-prefix']='/app/broadcast';
  headers['x-roll-call-toolkit-id']='roll-call.broadcast';
  headers['x-roll-call-subject-id']=String(session?.shell?.actor?.subject_id||'');
  headers['x-roll-call-organization-id']=String(session?.shell?.organization?.organization_id||'');
  headers['x-roll-call-workspace-id']=String(session?.shell?.workspace?.workspace_id||'');
  for(const [key,value] of Object.entries(correlation))if(value)headers[key]=value;
  return headers;
}

function proxyResponseHeaders(response,config){
  const headers={};
  const blocked=new Set(['connection','transfer-encoding','content-length','content-encoding','set-cookie','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade']);
  for(const [key,value] of response.headers.entries()){
    if(blocked.has(key.toLowerCase()))continue;
    if(key.toLowerCase()==='location'){
      const owner=config.broadcastOwner.baseUrl;
      headers[key]=value.startsWith(owner)?value.slice(owner.length)||'/app/broadcast':value;
      continue;
    }
    headers[key]=value;
  }
  headers['x-roll-call-route-owner']='roll-call.broadcast';
  headers['x-roll-call-same-origin']='true';
  return headers;
}

async function proxyBroadcastApp({req,res,url,config,fetchImpl,correlation}){
  const failures=broadcastAppRoutingFailures(config);
  if(failures.length)return send(res,503,{error:'broadcast_same_origin_not_ready',failures},correlation);

  const shell=await resolveShellSession({
    config,
    fetchImpl,
    correlation,
    cookieHeader:req.headers.cookie||'',
    query:new URLSearchParams('toolkit=broadcast')
  });

  if(shell.status!==200){
    if(shell.status===401&&(req.method==='GET'||req.method==='HEAD')){
      const returnTo=url.pathname+url.search;
      return redirect(res,'/api/auth/login?returnTo='+encodeURIComponent(returnTo));
    }
    return send(res,shell.status,shell.body,correlation);
  }

  const target=config.broadcastOwner.baseUrl+url.pathname+url.search;
  const method=String(req.method||'GET').toUpperCase();
  const options={
    method,
    headers:proxyRequestHeaders(req,correlation,shell.body),
    redirect:'manual',
    signal:AbortSignal.timeout(30000)
  };
  if(!['GET','HEAD'].includes(method)){
    options.body=req;
    options.duplex='half';
  }

  const response=await fetchImpl(target,options);
  const headers=proxyResponseHeaders(response,config);
  res.writeHead(response.status,headers);
  if(method==='HEAD'||!response.body){res.end();return;}
  Readable.fromWeb(response.body).pipe(res);
}

async function forwardPlatformAccess({config,fetchImpl,correlation,path,payload}){
  const failures=platformAccessFailures(config);
  if(failures.length)return {ok:false,status:503,body:{error:'platform_access_not_ready',failures}};
  const result=await fetchJson(fetchImpl,config.platformAccess.url+path,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'accept':'application/json',
      'x-platform-service-key':config.platformAccess.serviceKey,
      'x-roll-call-request-id':correlation['x-roll-call-request-id'],
      'x-roll-call-trace-id':correlation['x-roll-call-trace-id'],
      'x-roll-call-correlation-id':correlation['x-roll-call-correlation-id'],
      'x-roll-call-context-id':correlation['x-roll-call-context-id']||''
    },
    body:JSON.stringify(payload||{})
  });
  return {ok:result.response.ok,status:result.response.status,body:result.body||{error:'platform_access_empty_response'}};
}


async function resolveShellSession({config,fetchImpl,correlation,cookieHeader,query}){
  const failures=browserAuthFailures(config.browserAuth);
  if(failures.length)return {status:503,body:{authenticated:false,error:'roll_call_browser_auth_not_ready',failures}};
  const credentials=readBrowserCredentials(cookieHeader,config.browserAuth);
  if(!credentials.session||!credentials.identityToken)return {status:401,body:{authenticated:false,error:'roll_call_session_required'}};

  const discovered=await forwardPlatformAccess({
    config,fetchImpl,correlation,path:'/v1/core/workspaces',
    payload:{identity_token:credentials.identityToken}
  });
  if(!discovered.ok)return {status:discovered.status,body:{authenticated:true,error:'workspace_discovery_failed',detail:discovered.body}};
  const workspaces=Array.isArray(discovered.body?.workspaces)?discovered.body.workspaces:[];
  if(!workspaces.length)return {status:403,body:{authenticated:true,error:'no_authorized_roll_call_workspace',workspaces:[]}};

  const requestedWorkspace=String(query.get('workspace_id')||'').trim();
  const requestedOrganization=String(query.get('organization_id')||'').trim();
  let candidates=workspaces;
  if(requestedWorkspace)candidates=candidates.filter(item=>item?.workspace?.workspace_id===requestedWorkspace);
  if(requestedOrganization)candidates=candidates.filter(item=>item?.organization?.organization_id===requestedOrganization);
  if(!candidates.length)return {status:403,body:{authenticated:true,error:'workspace_not_authorized',workspaces:workspaces.map(item=>({organization:item.organization,workspace:item.workspace}))}};
  if(candidates.length>1&&!requestedWorkspace)return {status:409,body:{
    authenticated:true,error:'workspace_selection_required',
    workspaces:candidates.map(item=>({organization:item.organization,workspace:item.workspace,entitlements:item.entitlements}))
  }};
  const selected=candidates[0];

  const context=await forwardPlatformAccess({
    config,fetchImpl,correlation,path:'/v1/core/context',
    payload:{
      identity_token:credentials.identityToken,
      organization_id:selected.organization.organization_id,
      workspace_id:selected.workspace.workspace_id
    }
  });
  if(!context.ok)return {status:context.status,body:{authenticated:true,error:'core_context_failed',detail:context.body}};

  const entitlements=Array.isArray(context.body?.entitlements)?context.body.entitlements:[];
  const toolkits=shellToolkits(entitlements);
  const requestedToolkit=toolkitId(query.get('toolkit')||'');
  const firstEntitled=toolkits.find(item=>item.entitled)?.toolkit_id||null;
  const activeToolkit=requestedToolkit||firstEntitled;
  if(requestedToolkit&&!toolkits.find(item=>item.toolkit_id===requestedToolkit&&item.entitled)){
    return {status:403,body:{authenticated:true,error:'toolkit_entitlement_required',toolkit_id:requestedToolkit,toolkits}};
  }
  if(!activeToolkit)return {status:403,body:{authenticated:true,error:'no_active_toolkit_entitlement',toolkits}};

  return {status:200,body:{
    authenticated:true,
    schema:'roll-call.shell-session.v1',
    shell:{
      schema:'roll-call.application-shell.v1',
      organization:{organization_id:selected.organization.organization_id,name:selected.organization.name},
      workspace:{workspace_id:selected.workspace.workspace_id,name:selected.workspace.name},
      actor:{
        subject_id:credentials.session.sub,
        display_name:credentials.session.name||credentials.session.preferredUsername||credentials.session.email||'Roll Call User',
        avatar_url:null
      },
      toolkits,
      active_toolkit:activeToolkit,
      navigation:{
        marketplace_href:'/app/marketplace',
        avery_available:true,
        settings_href:'/app/settings',
        account_href:'/app/account'
      }
    },
    authorization:{
      roles:context.body?.roles||[],
      effective_permissions:context.body?.effective_permissions||[],
      entitlements
    },
    identity:{
      issuer:credentials.session.issuer,
      acr:credentials.session.acr||null,
      amr:credentials.session.amr||[],
      expires_at:new Date(credentials.session.expiresAt).toISOString()
    },
    environment:config.environment
  }};
}

async function readCanonicalEventReference({config,fetchImpl,correlation,eventKey,payload}){
  if(!config.eventsOwner.baseUrl.startsWith('https://')||!config.eventsOwner.serviceKey){
    return {ok:false,status:503,body:{error:'events_owner_reference_not_ready'}};
  }
  const organizationId=String(payload?.organization_id||'').trim();
  const workspaceId=String(payload?.workspace_id||'').trim();
  const identityToken=String(payload?.identity_token||'').trim();
  if(!organizationId||!workspaceId||!identityToken)return {ok:false,status:400,body:{error:'event_reference_context_required'}};
  const binding=workspaceBinding(config.eventsOwner.workspaceBindings,organizationId,workspaceId);
  if(!binding)return {ok:false,status:409,body:{error:'events_workspace_binding_missing',organization_id:organizationId,workspace_id:workspaceId}};
  const access=await forwardPlatformAccess({
    config,fetchImpl,correlation,path:'/v1/access/decisions',
    payload:{identity_token:identityToken,organization_id:organizationId,workspace_id:workspaceId,resource:'events',action:'read'}
  });
  if(!access.ok||access.body?.decision!=='allow')return {ok:false,status:access.status===401?401:403,body:{error:'event_reference_access_denied',reason:access.body?.reason||access.body?.error||'access_denied'}};
  const owner=await fetchJson(fetchImpl,config.eventsOwner.baseUrl+'/api/platform/events/'+encodeURIComponent(eventKey)+'/reference',{
    headers:{
      accept:'application/json',
      'x-platform-service-key':config.eventsOwner.serviceKey,
      'x-roll-call-organization-id':organizationId,
      'x-roll-call-workspace-id':workspaceId,
      'x-roll-call-events-tenant-id':binding.tenant_id,
      'x-roll-call-events-workspace-id':binding.workspace_id,
      'x-roll-call-subject-id':String(access.body?.subject_id||''),
      'x-roll-call-access-receipt-id':String(access.body?.receipt_id||''),
      'x-roll-call-request-id':correlation['x-roll-call-request-id'],
      'x-roll-call-trace-id':correlation['x-roll-call-trace-id'],
      'x-roll-call-correlation-id':correlation['x-roll-call-correlation-id']
    }
  });
  if(!owner.response.ok||owner.body?.ok!==true)return {ok:false,status:owner.response.status||502,body:owner.body||{error:'events_owner_reference_failed'}};
  if(owner.body?.contract!=='roll-call.event-reference.v1'||owner.body?.event_reference?.event_id==null)return {ok:false,status:502,body:{error:'events_owner_reference_contract_mismatch'}};
  return {ok:true,status:200,body:{
    ok:true,
    contract:'roll-call.event-reference.v1',
    event_reference:owner.body.event_reference,
    authorization:{decision:'allow',receipt_id:access.body.receipt_id,subject_id:access.body.subject_id}
  }};
}



async function createBroadcastCampaignFromEvent({config,fetchImpl,correlation,eventKey,payload}){
  if(!config.broadcastOwner.baseUrl.startsWith('https://')||!config.broadcastOwner.serviceKey){
    return {ok:false,status:503,body:{error:'broadcast_owner_not_ready'}};
  }
  const identityToken=String(payload?.identity_token||'').trim();
  const organizationId=String(payload?.organization_id||'').trim();
  const intent=payload?.intent||payload?.promotion_intent||{};
  const workspaceId=String(intent?.workspace_id||payload?.workspace_id||'').trim();
  if(!identityToken||!organizationId||!workspaceId)return {ok:false,status:400,body:{error:'broadcast_campaign_intent_context_required'}};
  if(intent?.schema!=='roll-call.event-promote-broadcast.v1')return {ok:false,status:400,body:{error:'broadcast_campaign_intent_schema_invalid'}};
  if(String(intent?.event_id||'')!==String(eventKey))return {ok:false,status:400,body:{error:'broadcast_campaign_intent_event_mismatch'}};
  if(intent?.source?.use_draft_if_authorized===true)return {ok:false,status:422,body:{error:'draft_event_promotion_not_supported_in_p3_4'}};

  const entitlement=await forwardPlatformAccess({
    config,fetchImpl,correlation,path:'/v1/entitlements/resolve',
    payload:{identity_token:identityToken,organization_id:organizationId,workspace_id:workspaceId,toolkit_id:'roll-call.broadcast'}
  });
  if(!entitlement.ok)return {ok:false,status:entitlement.status,body:{error:'broadcast_entitlement_resolution_failed',detail:entitlement.body}};
  if(entitlement.body?.entitled!==true)return {ok:false,status:403,body:{error:'broadcast_entitlement_required',reason:entitlement.body?.reason||'not_entitled'}};

  const broadcastAccess=await forwardPlatformAccess({
    config,fetchImpl,correlation,path:'/v1/access/decisions',
    payload:{identity_token:identityToken,organization_id:organizationId,workspace_id:workspaceId,resource:'broadcast',action:'write'}
  });
  if(!broadcastAccess.ok||broadcastAccess.body?.decision!=='allow'){
    return {ok:false,status:broadcastAccess.status===401?401:403,body:{error:'broadcast_write_access_denied',reason:broadcastAccess.body?.reason||broadcastAccess.body?.error||'access_denied'}};
  }

  const eventReference=await readCanonicalEventReference({
    config,fetchImpl,correlation,eventKey,
    payload:{identity_token:identityToken,organization_id:organizationId,workspace_id:workspaceId}
  });
  if(!eventReference.ok)return eventReference;

  const subjectId=String(broadcastAccess.body?.subject_id||eventReference.body?.authorization?.subject_id||'').trim();
  if(!subjectId)return {ok:false,status:502,body:{error:'platform_subject_missing_after_authorization'}};
  if(intent?.requested_by&&String(intent.requested_by)!==subjectId)return {ok:false,status:403,body:{error:'promotion_requested_by_subject_mismatch'}};

  const canonicalIntent={...intent,requested_by:subjectId,workspace_id:workspaceId,event_id:String(eventKey)};
  const owner=await fetchJson(fetchImpl,config.broadcastOwner.baseUrl+'/api/platform/events/'+encodeURIComponent(eventKey)+'/campaign-intents',{
    method:'POST',
    headers:{
      'content-type':'application/json',
      accept:'application/json',
      'x-platform-service-key':config.broadcastOwner.serviceKey,
      'x-roll-call-subject-id':subjectId,
      'x-roll-call-events-access-receipt-id':String(eventReference.body?.authorization?.receipt_id||''),
      'x-roll-call-broadcast-access-receipt-id':String(broadcastAccess.body?.receipt_id||''),
      'x-roll-call-request-id':correlation['x-roll-call-request-id'],
      'x-roll-call-trace-id':correlation['x-roll-call-trace-id'],
      'x-roll-call-correlation-id':correlation['x-roll-call-correlation-id']
    },
    body:JSON.stringify({
      organization_id:organizationId,
      workspace_id:workspaceId,
      subject_id:subjectId,
      event_read_access_receipt_id:eventReference.body?.authorization?.receipt_id||null,
      broadcast_write_access_receipt_id:broadcastAccess.body?.receipt_id||null,
      intent:canonicalIntent,
      event_reference:eventReference.body?.event_reference
    })
  });
  if(!owner.response.ok||owner.body?.ok!==true){
    return {ok:false,status:owner.response.status||502,body:owner.body||{error:'broadcast_owner_campaign_intent_failed'}};
  }
  return {
    ok:true,
    status:owner.response.status||201,
    body:{
      ok:true,
      contract:'roll-call.event-promote-broadcast.result.v1',
      result:owner.body.result,
      authorization:{
        subject_id:subjectId,
        events_read_receipt_id:eventReference.body?.authorization?.receipt_id||null,
        broadcast_write_receipt_id:broadcastAccess.body?.receipt_id||null,
        broadcast_entitlement:entitlement.body
      }
    }
  };
}


export function validateAccessReceipt(receipt,{organizationId,resource,action='read',maxAgeSeconds=120,now=Date.now()}){
  if(!receipt)return {ok:false,error:'access_receipt_missing'};
  if(receipt.decision!=='allow')return {ok:false,error:'access_receipt_not_allowed'};
  if(receipt.client_id!=='omni-preview')return {ok:false,error:'access_receipt_client_invalid'};
  if(receipt.organization_id!==organizationId)return {ok:false,error:'access_receipt_organization_mismatch'};
  if(receipt.resource!==resource||receipt.action!==action)return {ok:false,error:'access_receipt_scope_mismatch'};
  const created=new Date(receipt.created_at).getTime();
  if(!Number.isFinite(created))return {ok:false,error:'access_receipt_time_invalid'};
  if(created>now+30_000)return {ok:false,error:'access_receipt_future'};
  if(now-created>maxAgeSeconds*1000)return {ok:false,error:'access_receipt_expired'};
  if(!receipt.subject_id)return {ok:false,error:'access_receipt_subject_missing'};
  return {ok:true,subjectId:receipt.subject_id};
}

async function readOwnerDomain({config,fetchImpl,correlation,receiptId,resource}){
  const access=await fetchJson(fetchImpl,`${config.omni.accessUrl}/v1/audit/receipts/${encodeURIComponent(receiptId)}`,{
    headers:{accept:'application/json','x-platform-service-key':config.omni.accessServiceKey,
      'x-roll-call-request-id':correlation['x-roll-call-request-id'],
      'x-roll-call-trace-id':correlation['x-roll-call-trace-id'],
      'x-roll-call-correlation-id':correlation['x-roll-call-correlation-id']}
  });
  if(!access.response.ok||access.body?.status!=='ok')return {ok:false,status:403,error:'access_receipt_unverified'};
  const verified=validateAccessReceipt(access.body.receipt,{
    organizationId:config.omni.organizationId,resource,maxAgeSeconds:config.omni.maxReceiptAgeSeconds
  });
  if(!verified.ok)return {ok:false,status:403,error:verified.error};

  const ownerPath=resource==='work'?'/api/platform/omni/work':'/api/platform/omni/calendar';
  const owner=await fetchJson(fetchImpl,config.omni.ownerBaseUrl+ownerPath,{
    headers:{accept:'application/json','x-platform-service-key':config.omni.ownerServiceKey,
      'x-roll-call-tenant-id':config.omni.tenantId,'x-roll-call-workspace-id':config.omni.workspaceId,
      'x-roll-call-request-id':correlation['x-roll-call-request-id'],
      'x-roll-call-trace-id':correlation['x-roll-call-trace-id'],
      'x-roll-call-correlation-id':correlation['x-roll-call-correlation-id']}
  });
  if(!owner.response.ok||owner.body?.ok!==true)return {ok:false,status:502,error:'owner_domain_read_failed'};
  const expected=resource==='work'?'roll-call-events.omni-work.v1':'roll-call-events.omni-calendar.v1';
  if(owner.body.contract_version!==expected)return {ok:false,status:502,error:'owner_domain_contract_mismatch'};
  return {ok:true,subjectId:verified.subjectId,owner:owner.body};
}

export function createServer(config = loadConfig(), deps={}) {
  const fetchImpl=deps.fetchImpl||fetch;
  return http.createServer(async (req, res) => {
    const correlation = requestCorrelation(req);
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { status:'ok', service:SERVICE, service_id:config.serviceId, version:VERSION, environment:config.environment, timestamp:nowIso() }, correlation);
      }
      if (req.method === 'GET' && url.pathname === '/bootstrap/v1/metadata') {
        const signing = nonempty(config.publicKeyPem) ? {
          algorithm:'RS256', key_id:config.keyId, public_key_available:true,
          verification_endpoint:'/v1/identity/assertions/verify', metadata_endpoint:'/v1/identity/metadata',
          issuance_available:false
        } : { algorithm:'RS256', public_key_available:false, issuance_available:false };
        return send(res, 200, {
          status:'ok', service:SERVICE, service_id:config.serviceId, version:VERSION,
          environment:config.environment, reference_consumers:config.consumers, signing,
          omni_read_broker:{available:omniReadFailures(config).length===0,readiness_endpoint:'/v1/omni/readiness'},
          roll_call_core:{available:platformAccessFailures(config).length===0,context_endpoint:'/v1/core/context',workspace_discovery_endpoint:'/v1/core/workspaces',entitlement_endpoint:'/v1/entitlements/resolve',access_decision_endpoint:'/v1/access/decisions'},
          roll_call_browser_session:{available:browserAuthFailures(config.browserAuth).length===0,login_endpoint:'/api/auth/login',callback_endpoint:'/auth/callback',session_endpoint:'/v1/shell/session'},
          roll_call_broadcast_route:{available:broadcastAppRoutingFailures(config).length===0,path_prefix:'/app/broadcast',owner:config.broadcastOwner.baseUrl||null}
        }, correlation);
      }
      if (req.method === 'GET' && url.pathname === '/ready') {
        const failures = [];
        if (!nonempty(config.serviceId)) failures.push('service_id_missing');
        if (!nonempty(config.publicKeyPem)) failures.push('public_key_missing');
        if (!config.consumers.length) failures.push('reference_consumers_missing');
        return send(res, failures.length ? 503 : 200, failures.length ? {
          status:'not_ready', service_id:config.serviceId, version:VERSION, reason:failures.join(','), consumers:config.consumers
        } : {
          status:'ready', service_id:config.serviceId, version:VERSION, environment:config.environment, consumers:config.consumers,
          omni_read_ready:omniReadFailures(config).length===0,
          roll_call_core_ready:platformAccessFailures(config).length===0,
          roll_call_browser_session_ready:browserAuthFailures(config.browserAuth).length===0,
          roll_call_broadcast_same_origin_ready:broadcastAppRoutingFailures(config).length===0
        }, correlation);
      }
      if(req.method==='GET'&&url.pathname==='/v1/omni/readiness'){
        const failures=omniReadFailures(config);
        return send(res,failures.length?503:200,failures.length?{
          status:'not_ready',contract_version:'P3.3',failures
        }:{
          status:'ready',contract_version:'P3.3',organization_id:config.omni.organizationId,
          resources:['work','calendar'],access_receipt_max_age_seconds:config.omni.maxReceiptAgeSeconds
        },correlation);
      }

      const ref = url.pathname.match(/^\/v1\/(events|broadcast|field|experiential|asmbly)\/reference$/);
      if (req.method === 'GET' && ref) {
        const consumer = ref[1];
        if (!config.consumers.includes(consumer)) return send(res, 404, { error:'unsupported_consumer', consumer }, correlation);
        return send(res, 200, {
          status:'ok', consumer, contract_version:'P3.4', gateway_service_id:config.serviceId,
          environment:config.environment,
          context_id:correlation['x-roll-call-context-id'] || null,
          request_id:correlation['x-roll-call-request-id'],
          trace_id:correlation['x-roll-call-trace-id'],
          correlation_id:correlation['x-roll-call-correlation-id']
        }, correlation);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/') && url.pathname.endsWith('/reference')) {
        return send(res, 404, { error:'unsupported_consumer' }, correlation);
      }


      if(req.method==='GET'&&url.pathname==='/api/auth/login'){
        const failures=browserAuthFailures(config.browserAuth);
        if(failures.length)return send(res,503,{error:'roll_call_browser_auth_not_ready',failures},correlation);
        try{
          const begin=await beginBrowserLogin(config.browserAuth,{returnTo:safeReturnTo(url.searchParams.get('returnTo'))},fetchImpl);
          return redirect(res,begin.authorizationUrl,{cookies:begin.cookies});
        }catch(error){
          return send(res,503,{error:'oidc_login_unavailable',detail:String(error?.message||error)},correlation);
        }
      }

      if(req.method==='GET'&&url.pathname==='/auth/callback'){
        const failures=browserAuthFailures(config.browserAuth);
        if(failures.length)return send(res,503,{error:'roll_call_browser_auth_not_ready',failures},correlation);
        const credentials=readBrowserCredentials(req.headers.cookie||'',config.browserAuth);
        try{
          const completed=await completeBrowserLogin(config.browserAuth,{
            code:url.searchParams.get('code'),
            state:url.searchParams.get('state'),
            expectedState:credentials.state,
            verifier:credentials.verifier,
            nonce:credentials.nonce
          },fetchImpl);
          return redirect(res,new URL(safeReturnTo(credentials.returnTo||'/app'),config.browserAuth.publicUrl).toString(),{cookies:completed.cookies});
        }catch(error){
          return redirect(res,new URL('/?identityError='+encodeURIComponent(String(error?.message||'identity_callback_failed')),config.browserAuth.publicUrl).toString(),{cookies:logoutCookies()});
        }
      }

      if((req.method==='POST'||req.method==='GET')&&url.pathname==='/api/auth/logout'){
        return redirect(res,config.browserAuth.publicUrl||'/',{cookies:logoutCookies()});
      }

      if(req.method==='GET'&&url.pathname==='/v1/shell/session'){
        const result=await resolveShellSession({
          config,fetchImpl,correlation,cookieHeader:req.headers.cookie||'',query:url.searchParams
        });
        return send(res,result.status,result.body,correlation);
      }

      if(url.pathname==='/app/broadcast'||url.pathname.startsWith('/app/broadcast/')){
        return await proxyBroadcastApp({req,res,url,config,fetchImpl,correlation});
      }

      if (req.method === 'GET' && url.pathname === '/v1/identity/metadata') {
        const jwk = nonempty(config.publicKeyPem) ? exportPublicJwk(config.publicKeyPem) : null;
        return send(res, nonempty(config.publicKeyPem) ? 200 : 503, {
          status: nonempty(config.publicKeyPem) ? 'ok' : 'unavailable',
          contract_version:'Identity-2.0', issuer_service_id:config.serviceId, environment:config.environment,
          algorithm:'RS256', key_id:config.keyId, public_jwk:jwk,
          verification_endpoint:'/v1/identity/assertions/verify', issuance_available:false,
          required_claims:['principal_id','principal_type','tenant_id','application_id','workspace_id','environment','permissions','roles','assurance','iat','exp','assertion_id','trace_id','correlation_id']
        }, correlation);
      }
      if (req.method === 'POST' && url.pathname === '/v1/identity/assertions/verify') {
        const payload = await readJson(req);
        const result = verifyAssertion(payload.assertion, config);
        return send(res, result.ok ? 200 : 401, result, correlation);
      }
      if (req.method === 'POST' && url.pathname === '/v1/identity/assertions') {
        return send(res, 501, {error:'identity_assertion_issuance_not_available',reason:'BSV Identity is the authoritative issuer; Gateway issuance remains disabled.'}, correlation);
      }



      const broadcastIntentMatch=url.pathname.match(/^\/v1\/events\/([^/]+)\/broadcast-campaign-intents$/);
      if(req.method==='POST'&&broadcastIntentMatch){
        const payload=await readJson(req);
        const result=await createBroadcastCampaignFromEvent({config,fetchImpl,correlation,eventKey:decodeURIComponent(broadcastIntentMatch[1]),payload});
        return send(res,result.status,result.body,correlation);
      }

      const eventReferenceMatch=url.pathname.match(/^\/v1\/events\/([^/]+)\/reference$/);
      if(req.method==='POST'&&eventReferenceMatch){
        const payload=await readJson(req);
        const result=await readCanonicalEventReference({config,fetchImpl,correlation,eventKey:decodeURIComponent(eventReferenceMatch[1]),payload});
        return send(res,result.status,result.body,correlation);
      }

      if(req.method==='POST'&&['/v1/core/context','/v1/entitlements/resolve','/v1/access/decisions'].includes(url.pathname)){
        const payload=await readJson(req);
        const result=await forwardPlatformAccess({config,fetchImpl,correlation,path:url.pathname,payload});
        return send(res,result.status,result.body,correlation);
      }

      const readMatch=url.pathname.match(/^\/v1\/omni\/(work|calendar)\/read$/);
      if(req.method==='POST'&&readMatch){
        if(!omniServiceAuthorized(req,config))return send(res,401,{error:'omni_service_auth_required'},correlation);
        const failures=omniReadFailures(config);
        if(failures.length)return send(res,503,{error:'omni_read_broker_not_ready',failures},correlation);
        const payload=await readJson(req);
        if(!nonempty(payload.access_receipt_id))return send(res,400,{error:'access_receipt_id_required'},correlation);
        const resource=readMatch[1];
        const result=await readOwnerDomain({config,fetchImpl,correlation,receiptId:payload.access_receipt_id,resource});
        if(!result.ok)return send(res,result.status,{error:result.error},correlation);
        const owner=result.owner;
        return send(res,200,{
          status:'ok',contract_version:'P3.3',resource,organization_id:config.omni.organizationId,
          access_receipt_id:payload.access_receipt_id,subject_id:result.subjectId,
          owner_authority:owner.authority,owner_contract_version:owner.contract_version,
          scope:owner.scope,data:resource==='work'?owner.work:owner.calendar,
          request_id:correlation['x-roll-call-request-id'],trace_id:correlation['x-roll-call-trace-id'],correlation_id:correlation['x-roll-call-correlation-id']
        },correlation);
      }

      return send(res, 404, { error:'not_found' }, correlation);
    } catch (error) {
      return send(res, error.statusCode || 500, { error:error.message || 'internal_error' }, correlation);
    }
  });
}

export function start(env = process.env) {
  const config = loadConfig(env);
  const server = createServer(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(JSON.stringify({
      event:'gateway_started', service:SERVICE, service_id:config.serviceId, version:VERSION,
      environment:config.environment, port:config.port, reference_consumers:config.consumers,
      identity_verification:Boolean(config.publicKeyPem), identity_issuance:false,
      omni_read_ready:omniReadFailures(config).length===0,
      roll_call_core_ready:platformAccessFailures(config).length===0,
      roll_call_browser_session_ready:browserAuthFailures(config.browserAuth).length===0,
      roll_call_broadcast_same_origin_ready:broadcastAppRoutingFailures(config).length===0,timestamp:nowIso()
    }));
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
