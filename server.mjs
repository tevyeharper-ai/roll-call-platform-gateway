import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const VERSION = 'P3.4.0';
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

export function loadConfig(env = process.env) {
  const serviceId = env.RC_GATEWAY_SERVICE_ID || 'roll-call-platform-gateway:p3.4-staging';
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
    wordpressOrigin: env.RC_WORDPRESS_ORIGIN || null,
    platformAccess: {
      url: cleanUrl(env.RC_PLATFORM_ACCESS_URL),
      serviceKey: String(env.RC_PLATFORM_ACCESS_GATEWAY_KEY || '').trim()
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
          roll_call_core:{available:platformAccessFailures(config).length===0,context_endpoint:'/v1/core/context',entitlement_endpoint:'/v1/entitlements/resolve',access_decision_endpoint:'/v1/access/decisions'}
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
          roll_call_core_ready:platformAccessFailures(config).length===0
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
      roll_call_core_ready:platformAccessFailures(config).length===0,timestamp:nowIso()
    }));
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
