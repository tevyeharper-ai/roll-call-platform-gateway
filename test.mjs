import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createServer, loadConfig } from './server.mjs';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pub = publicKey.export({type:'spki',format:'pem'}).toString();
const priv = privateKey.export({type:'pkcs8',format:'pem'}).toString();
const consumers=['events','field','experiential','asmbly'];
const config = loadConfig({
  PORT:'0', RC_GATEWAY_SERVICE_ID:'roll-call-platform-gateway:p3.2-test', RC_GATEWAY_ENV:'staging',
  RC_GATEWAY_PUBLIC_KEY_PEM:pub, RC_GATEWAY_PRIVATE_KEY_PEM:priv,
  RC_REFERENCE_CONSUMERS:consumers.join(',')
});
let server, base;

test.before(async()=>{ server=createServer(config); server.listen(0,'127.0.0.1'); await once(server,'listening'); base=`http://127.0.0.1:${server.address().port}`; });
test.after(()=>server.close());

async function get(path, headers={}) { const r=await fetch(base+path,{headers}); return {r,b:await r.json()}; }
async function post(path, body) { const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return {r,b:await r.json()}; }
function sign(payload, key=privateKey) {
  const header={alg:'RS256',typ:'JWT',kid:config.keyId};
  const h=Buffer.from(JSON.stringify(header)).toString('base64url');
  const p=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s=crypto.sign('RSA-SHA256',Buffer.from(`${h}.${p}`),key).toString('base64url');
  return `${h}.${p}.${s}`;
}
function claim(overrides={}) { const now=Math.floor(Date.now()/1000); return {principal_id:'user-1',principal_type:'human',tenant_id:'tenant-1',application_id:'events',workspace_id:'ops',environment:'staging',permissions:['events.read'],roles:['operator'],assurance:'staging-test',iat:now-1,exp:now+300,assertion_id:'assert-1',trace_id:'tr-1',correlation_id:'corr-1',...overrides}; }

test('health remains compatible', async()=>{ const {r,b}=await get('/health'); assert.equal(r.status,200); assert.equal(b.status,'ok'); assert.equal(b.service_id,config.serviceId); });
test('metadata preserves existing consumers and advertises ASMBLY', async()=>{ const {r,b}=await get('/bootstrap/v1/metadata'); assert.equal(r.status,200); assert.equal(b.service_id,config.serviceId); assert.equal(b.version,'P3.2.0'); assert.deepEqual(b.reference_consumers,consumers); });
test('ready remains green with ASMBLY added', async()=>{ const {r,b}=await get('/ready'); assert.equal(r.status,200); assert.equal(b.status,'ready'); assert.deepEqual(b.consumers,consumers); });
for (const consumer of consumers) test(`${consumer} reference returns governed contract`, async()=>{ const headers={'x-roll-call-context-id':'ctx-1','x-roll-call-request-id':'req-1','x-roll-call-trace-id':'tr-1','x-roll-call-correlation-id':'corr-1'}; const {r,b}=await get(`/v1/${consumer}/reference`,headers); assert.equal(r.status,200); assert.equal(b.consumer,consumer); assert.equal(b.contract_version,'P3.2'); assert.equal(b.correlation_id,'corr-1'); assert.equal(r.headers.get('x-roll-call-correlation-id'),'corr-1'); });
test('ASMBLY reference is contract metadata only and exposes no app data',async()=>{const {r,b}=await get('/v1/asmbly/reference');assert.equal(r.status,200);assert.deepEqual(Object.keys(b).sort(),['consumer','context_id','contract_version','correlation_id','environment','gateway_service_id','request_id','status','trace_id'].sort());assert.equal(JSON.stringify(b).includes('event'),false);assert.equal(JSON.stringify(b).includes('place'),false);});
test('unsupported reference fails closed', async()=>{ const {r,b}=await get('/v1/unknown/reference'); assert.equal(r.status,404); assert.equal(b.error,'unsupported_consumer'); });
test('identity metadata exposes public verification only', async()=>{ const {r,b}=await get('/v1/identity/metadata'); assert.equal(r.status,200); assert.equal(b.issuance_available,false); assert.equal(b.algorithm,'RS256'); assert.ok(b.public_jwk?.n); assert.equal(JSON.stringify(b).includes('PRIVATE KEY'),false); });
test('valid identity assertion verifies', async()=>{ const {r,b}=await post('/v1/identity/assertions/verify',{assertion:sign(claim())}); assert.equal(r.status,200); assert.equal(b.ok,true); assert.equal(b.principal.principal_id,'user-1'); });
test('expired assertion fails', async()=>{ const now=Math.floor(Date.now()/1000); const {r,b}=await post('/v1/identity/assertions/verify',{assertion:sign(claim({iat:now-100,exp:now-1}))}); assert.equal(r.status,401); assert.equal(b.error,'assertion_expired'); });
test('tampered assertion fails', async()=>{ const a=sign(claim()).split('.'); const tampered=Buffer.from(JSON.stringify(claim({tenant_id:'tenant-evil'}))).toString('base64url'); const {r,b}=await post('/v1/identity/assertions/verify',{assertion:`${a[0]}.${tampered}.${a[2]}`}); assert.equal(r.status,401); assert.equal(b.error,'assertion_signature_invalid'); });
test('wrong environment assertion fails', async()=>{ const {r,b}=await post('/v1/identity/assertions/verify',{assertion:sign(claim({environment:'production'}))}); assert.equal(r.status,401); assert.equal(b.error,'assertion_environment_mismatch'); });
test('assertion issuance is intentionally unavailable', async()=>{ const {r,b}=await post('/v1/identity/assertions',{principal_id:'x'}); assert.equal(r.status,501); assert.equal(b.error,'identity_assertion_issuance_not_available'); });
