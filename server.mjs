import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const VERSION = 'P3.2.0';
const SERVICE = 'roll-call-platform-gateway';
const DEFAULT_CONSUMERS = ['events', 'field', 'experiential', 'asmbly'];
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
function base64url(input) { return Buffer.from(input).toString('base64url'); }
function decodeBase64urlJson(input) { return JSON.parse(Buffer.from(input, 'base64url').toString('utf8')); }
function keyId(publicKeyPem) { return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 24); }
function exportPublicJwk(publicKeyPem) {
  try { return crypto.createPublicKey(publicKeyPem).export({ format: 'jwk' }); }
  catch { return null; }
}
function requiredIdentityClaims(payload) {
  const required = ['principal_id','principal_type','tenant_id','application_id','workspace_id','environment','iat','exp','assertion_id','trace_id','correlation_id'];
  return required.filter(k => payload?.[k] === undefined || payload?.[k] === null || payload?.[k] === '');
}

export function loadConfig(env = process.env) {
  const serviceId = env.RC_GATEWAY_SERVICE_ID || 'roll-call-platform-gateway:p3.2-staging';
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
    wordpressOrigin: env.RC_WORDPRESS_ORIGIN || null
  };
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
    if (raw.length > 512_000) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
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

export function createServer(config = loadConfig()) {
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
          environment:config.environment, reference_consumers:config.consumers, signing
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
          status:'ready', service_id:config.serviceId, version:VERSION, environment:config.environment, consumers:config.consumers
        }, correlation);
      }

      const ref = url.pathname.match(/^\/v1\/(events|field|experiential|asmbly)\/reference$/);
      if (req.method === 'GET' && ref) {
        const consumer = ref[1];
        if (!config.consumers.includes(consumer)) return send(res, 404, { error:'unsupported_consumer', consumer }, correlation);
        return send(res, 200, {
          status:'ok', consumer, contract_version:'P3.2', gateway_service_id:config.serviceId,
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
        return send(res, 501, {
          error:'identity_assertion_issuance_not_available',
          reason:'Platform Identity 2.0 authoritative issuer not yet connected to this Gateway release.'
        }, correlation);
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
      identity_verification:Boolean(config.publicKeyPem), identity_issuance:false, timestamp:nowIso()
    }));
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
