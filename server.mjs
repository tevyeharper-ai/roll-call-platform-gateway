import http from 'node:http';
import crypto from 'node:crypto';

const VERSION = '3.1.1';
const SERVICE_ID = process.env.RC_GATEWAY_SERVICE_ID || 'roll-call-gateway:p3.1.1';
const WP_ORIGIN = (process.env.RC_WORDPRESS_ORIGIN || '').replace(/\/$/, '');
const PRIVATE_KEY = (process.env.RC_GATEWAY_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n');
const PUBLIC_KEY = (process.env.RC_GATEWAY_PUBLIC_KEY_PEM || '').replace(/\\n/g, '\n');
const CONSUMERS = new Set((process.env.RC_REFERENCE_CONSUMERS || 'events').split(',').map(v => v.trim()).filter(Boolean));
const PORT = Number(process.env.PORT || 8787);

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(data);
}
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function fingerprint(pem) { return crypto.createHash('sha256').update(pem).digest('hex'); }
function canonical({timestamp,method,path,requestId,traceId,correlationId,contextId,body}) {
  return [timestamp, method.toUpperCase(), path, requestId, traceId, correlationId, contextId, crypto.createHash('sha256').update(body || '').digest('hex')].join('\n');
}
function sign(message) {
  if (!PRIVATE_KEY) throw new Error('gateway_private_key_missing');
  return crypto.sign('sha256', Buffer.from(message), PRIVATE_KEY).toString('base64');
}
async function reference(consumer, req, res) {
  if (!CONSUMERS.has(consumer)) return json(res, 404, {status:'disabled',consumer});
  if (!WP_ORIGIN) return json(res, 503, {status:'unready',reason:'wordpress_origin_missing'});
  if (!PRIVATE_KEY || !PUBLIC_KEY) return json(res, 503, {status:'unready',reason:'gateway_service_identity_missing'});
  const requestId = id('req');
  const traceId = id('tr');
  const correlationId = id('corr');
  const contextId = String(req.headers['x-roll-call-context-id'] || '');
  const path = `/wp-json/roll-call-platform/v1/${consumer}/reference`;
  const timestamp = String(Math.floor(Date.now()/1000));
  const message = canonical({timestamp,method:'GET',path,requestId,traceId,correlationId,contextId,body:''});
  const signature = sign(message);
  let upstream;
  try {
    upstream = await fetch(`${WP_ORIGIN}${path}`, {headers:{
      'x-roll-call-service': SERVICE_ID,
      'x-roll-call-timestamp': timestamp,
      'x-roll-call-signature': signature,
      'x-roll-call-request-id': requestId,
      'x-roll-call-trace-id': traceId,
      'x-roll-call-correlation-id': correlationId,
      'x-roll-call-context-id': contextId,
      'accept':'application/json'
    }});
  } catch (e) {
    return json(res, 502, {status:'failed',consumer,reason:'wordpress_unreachable',detail:String(e?.message||e)});
  }
  let body = null;
  try { body = await upstream.json(); } catch { body = {raw: await upstream.text()}; }
  if (!upstream.ok) return json(res, upstream.status, {status:'failed',consumer,upstream:body,request_id:requestId,trace_id:traceId,correlation_id:correlationId});
  return json(res, 200, {...body,status:'ok',consumer,request_id:requestId,trace_id:traceId,correlation_id:correlationId,gateway_version:VERSION});
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') return json(res, 200, {status:'ok',product:'roll-call-platform-gateway',version:VERSION,service_id:SERVICE_ID});
  if (url.pathname === '/version') return json(res, 200, {product:'roll-call-platform-gateway',version:VERSION});
  if (url.pathname === '/ready') {
    const ready = Boolean(WP_ORIGIN && PRIVATE_KEY && PUBLIC_KEY);
    return json(res, ready ? 200 : 503, {status:ready?'ready':'unready',reference_mode:true,wordpress_origin:WP_ORIGIN || null,consumers:[...CONSUMERS],protected_operations:'deny_closed'});
  }
  if (url.pathname === '/bootstrap/v1/metadata') {
    if (!PUBLIC_KEY) return json(res, 503, {status:'unready',reason:'gateway_public_key_missing'});
    return json(res, 200, {status:'ok',product:'roll-call-platform-gateway',version:VERSION,service_id:SERVICE_ID,public_key_pem:PUBLIC_KEY,public_key_fingerprint:fingerprint(PUBLIC_KEY),wordpress_origin:WP_ORIGIN || null,reference_consumers:[...CONSUMERS],protected_operations:'deny_closed'});
  }
  const m = url.pathname.match(/^\/v1\/(events|field|experiential)\/reference$/);
  if (m) return reference(m[1], req, res);
  if (url.pathname.startsWith('/v1/')) return json(res, 503, {status:'denied_closed',reason:'identity_access_not_bound',next_foundation:'P3.2 Identity 2.0'});
  return json(res, 404, {status:'not_found'});
});
server.listen(PORT, '0.0.0.0', () => console.log(`Roll Call Platform Gateway P3.1.1 listening on ${PORT}`));
