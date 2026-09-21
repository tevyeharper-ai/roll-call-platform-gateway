import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createServer, loadConfig, validateAccessReceipt } from './server.mjs';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pub = publicKey.export({type:'spki',format:'pem'}).toString();
const priv = privateKey.export({type:'pkcs8',format:'pem'}).toString();
const consumers=['events','broadcast','field','experiential','asmbly'];
const omniKey='omni-gateway-key',accessKey='gateway-access-key',ownerKey='gateway-owner-key';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const tenantId='11111111-1111-4111-8111-111111111111';
const workspaceId='22222222-2222-4222-8222-222222222222';

const config = loadConfig({
  PORT:'0', RC_GATEWAY_SERVICE_ID:'roll-call-platform-gateway:p3.4-test', RC_GATEWAY_ENV:'staging',
  RC_GATEWAY_PUBLIC_KEY_PEM:pub, RC_GATEWAY_PRIVATE_KEY_PEM:priv, RC_REFERENCE_CONSUMERS:consumers.join(','),
  RC_OMNI_GATEWAY_SERVICE_KEY_SHA256:hash(omniKey),
  RC_PLATFORM_ACCESS_URL:'https://access.test',RC_PLATFORM_ACCESS_GATEWAY_KEY:accessKey,
  RC_ROLL_CALL_EVENTS_READ_URL:'https://events.test',RC_ROLL_CALL_EVENTS_READ_KEY:ownerKey,
  RC_OMNI_ROLL_CALL_ORGANIZATION_ID:'roll-call-events',RC_OMNI_ROLL_CALL_TENANT_ID:tenantId,RC_OMNI_ROLL_CALL_WORKSPACE_ID:workspaceId,
  RC_ACCESS_RECEIPT_MAX_AGE_SECONDS:'120'
});
let server,base;
const receiptId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function receipt(overrides={}){return {id:receiptId,client_id:'omni-preview',subject_id:'subject-1',organization_id:'roll-call-events',resource:'work',action:'read',decision:'allow',created_at:new Date().toISOString(),...overrides};}

const accessCalls=[];
const fetchImpl=async(url,options={})=>{
  const target=String(url);
  if(target.startsWith('https://access.test/v1/audit/receipts/')){
    assert.equal(options.headers['x-platform-service-key'],accessKey);
    return new Response(JSON.stringify({status:'ok',receipt:receipt()}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://access.test/v1/core/context'){
    accessCalls.push({path:'/v1/core/context',options});
    assert.equal(options.headers['x-platform-service-key'],accessKey);
    const payload=JSON.parse(options.body);
    return new Response(JSON.stringify({schema:'roll-call.core-context.v1',subject_id:'subject-1',organization_id:payload.organization_id,workspace:{workspace_id:payload.workspace_id,name:'Agency Workspace'},roles:['owner'],effective_permissions:['*'],entitlements:[{toolkit_id:'roll-call.events',status:'active'},{toolkit_id:'roll-call.broadcast',status:'active'}],environment:'staging'}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://access.test/v1/entitlements/resolve'){
    accessCalls.push({path:'/v1/entitlements/resolve',options});
    assert.equal(options.headers['x-platform-service-key'],accessKey);
    const payload=JSON.parse(options.body);
    return new Response(JSON.stringify({schema:'roll-call.toolkit-entitlement-resolution.v1',toolkit_id:payload.toolkit_id,entitled:payload.toolkit_id==='roll-call.broadcast',reason:payload.toolkit_id==='roll-call.broadcast'?'toolkit_entitlement_active':'toolkit_entitlement_missing',environment:'staging'}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://access.test/v1/access/decisions'){
    accessCalls.push({path:'/v1/access/decisions',options});
    assert.equal(options.headers['x-platform-service-key'],accessKey);
    const payload=JSON.parse(options.body);
    return new Response(JSON.stringify({decision:'allow',reason:'explicit_workspace_membership',receipt_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',subject_id:'subject-1',organization_id:payload.organization_id,workspace_id:payload.workspace_id,resource:payload.resource,action:payload.action,policy_version:'P3.4.0'}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://events.test/api/platform/omni/work'){
    assert.equal(options.headers['x-platform-service-key'],ownerKey);
    assert.equal(options.headers['x-roll-call-tenant-id'],tenantId);
    assert.equal(options.headers['x-roll-call-workspace-id'],workspaceId);
    return new Response(JSON.stringify({ok:true,contract_version:'roll-call-events.omni-work.v1',authority:['Roll Call Events','Business Operations'],scope:{tenant_id:tenantId,workspace_id:workspaceId},work:{metrics:{upcoming_events:1}}}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://events.test/api/platform/omni/calendar'){
    return new Response(JSON.stringify({ok:true,contract_version:'roll-call-events.omni-calendar.v1',authority:'Roll Call Events',scope:{tenant_id:tenantId,workspace_id:workspaceId},calendar:{entries:[]}}),{status:200,headers:{'content-type':'application/json'}});
  }
  throw new Error('unexpected_fetch:'+url);
};

test.before(async()=>{ server=createServer(config,{fetchImpl}); server.listen(0,'127.0.0.1'); await once(server,'listening'); base=`http://127.0.0.1:${server.address().port}`; });
test.after(()=>server.close());
async function get(path, headers={}) { const r=await fetch(base+path,{headers}); return {r,b:await r.json()}; }
async function post(path, body, headers={}) { const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}); return {r,b:await r.json()}; }
function sign(payload, key=privateKey) {
  const header={alg:'RS256',typ:'JWT',kid:config.keyId};
  const h=Buffer.from(JSON.stringify(header)).toString('base64url'),p=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s=crypto.sign('RSA-SHA256',Buffer.from(`${h}.${p}`),key).toString('base64url');return `${h}.${p}.${s}`;
}
function claim(overrides={}) { const now=Math.floor(Date.now()/1000); return {principal_id:'user-1',principal_type:'human',tenant_id:'tenant-1',application_id:'events',workspace_id:'ops',environment:'staging',permissions:['events.read'],roles:['operator'],assurance:'staging-test',iat:now-1,exp:now+300,assertion_id:'assert-1',trace_id:'tr-1',correlation_id:'corr-1',...overrides}; }

test('health reports P3.4', async()=>{ const {r,b}=await get('/health'); assert.equal(r.status,200); assert.equal(b.status,'ok'); assert.equal(b.version,'P3.4.0'); });
test('metadata advertises Broadcast and Roll Call Core', async()=>{ const {r,b}=await get('/bootstrap/v1/metadata'); assert.equal(r.status,200); assert.deepEqual(b.reference_consumers,consumers); assert.equal(b.omni_read_broker.available,true); assert.equal(b.roll_call_core.available,true); });
test('readiness includes Core and OMNI state', async()=>{ const {r,b}=await get('/ready'); assert.equal(r.status,200); assert.equal(b.status,'ready'); assert.equal(b.omni_read_ready,true); assert.equal(b.roll_call_core_ready,true); });
test('OMNI broker readiness remains independently green',async()=>{const {r,b}=await get('/v1/omni/readiness');assert.equal(r.status,200);assert.equal(b.organization_id,'roll-call-events');});
for (const consumer of consumers) test(`${consumer} reference is governed`, async()=>{ const {r,b}=await get(`/v1/${consumer}/reference`); assert.equal(r.status,200); assert.equal(b.consumer,consumer); assert.equal(b.contract_version,'P3.4'); });
test('unsupported reference fails closed',async()=>{const {r,b}=await get('/v1/unknown/reference');assert.equal(r.status,404);assert.equal(b.error,'unsupported_consumer');});

test('identity metadata remains verification-only', async()=>{ const {r,b}=await get('/v1/identity/metadata'); assert.equal(r.status,200); assert.equal(b.issuance_available,false); });
test('valid identity assertion verifies', async()=>{ const {r,b}=await post('/v1/identity/assertions/verify',{assertion:sign(claim())}); assert.equal(r.status,200); assert.equal(b.ok,true); });
test('expired assertion fails', async()=>{ const now=Math.floor(Date.now()/1000); const {r}=await post('/v1/identity/assertions/verify',{assertion:sign(claim({iat:now-100,exp:now-1}))}); assert.equal(r.status,401); });
test('wrong environment assertion fails', async()=>{ const {r}=await post('/v1/identity/assertions/verify',{assertion:sign(claim({environment:'production'}))}); assert.equal(r.status,401); });
test('issuance remains unavailable', async()=>{ const {r}=await post('/v1/identity/assertions',{principal_id:'x'}); assert.equal(r.status,501); });

test('Core context forwards through Gateway service identity',async()=>{const {r,b}=await post('/v1/core/context',{identity_token:'token',organization_id:'roll-call',workspace_id:'workspace-1'},{'x-roll-call-correlation-id':'corr-core'});assert.equal(r.status,200);assert.equal(b.schema,'roll-call.core-context.v1');assert.equal(b.entitlements.some(e=>e.toolkit_id==='roll-call.broadcast'),true);const call=accessCalls.find(x=>x.path==='/v1/core/context');assert.equal(call.options.headers['x-roll-call-correlation-id'],'corr-core');});
test('Broadcast entitlement resolves independently through Gateway',async()=>{const {r,b}=await post('/v1/entitlements/resolve',{identity_token:'token',organization_id:'roll-call',workspace_id:'workspace-1',toolkit_id:'roll-call.broadcast'});assert.equal(r.status,200);assert.equal(b.entitled,true);assert.equal(b.toolkit_id,'roll-call.broadcast');});
test('Gateway forwards workspace-scoped access decision',async()=>{const {r,b}=await post('/v1/access/decisions',{identity_token:'token',organization_id:'roll-call',workspace_id:'workspace-1',resource:'broadcast',action:'write'});assert.equal(r.status,200);assert.equal(b.decision,'allow');assert.equal(b.resource,'broadcast');assert.equal(b.workspace_id,'workspace-1');});

test('receipt validation rejects stale, mismatched and denied receipts',()=>{
  assert.equal(validateAccessReceipt(receipt({decision:'deny'}),{organizationId:'roll-call-events',resource:'work'}).ok,false);
  assert.equal(validateAccessReceipt(receipt({organization_id:'asmbly'}),{organizationId:'roll-call-events',resource:'work'}).ok,false);
  assert.equal(validateAccessReceipt(receipt({resource:'calendar'}),{organizationId:'roll-call-events',resource:'work'}).ok,false);
  assert.equal(validateAccessReceipt(receipt({created_at:new Date(Date.now()-300000).toISOString()}),{organizationId:'roll-call-events',resource:'work',maxAgeSeconds:120}).ok,false);
});
test('OMNI read requires service authentication',async()=>{const {r}=await post('/v1/omni/work/read',{access_receipt_id:receiptId});assert.equal(r.status,401);});
test('OMNI Work read remains compatible',async()=>{const {r,b}=await post('/v1/omni/work/read',{access_receipt_id:receiptId},{'x-platform-service-key':omniKey});assert.equal(r.status,200);assert.equal(b.resource,'work');assert.equal(b.data.metrics.upcoming_events,1);});
test('OMNI Calendar read remains compatible',async()=>{const calendarReceipt=receipt({resource:'calendar'});const localFetch=async(url,options={})=>{if(String(url).startsWith('https://access.test/v1/audit/receipts/'))return new Response(JSON.stringify({status:'ok',receipt:calendarReceipt}),{status:200,headers:{'content-type':'application/json'}});return fetchImpl(url,options);};const s=createServer(config,{fetchImpl:localFetch});s.listen(0,'127.0.0.1');await once(s,'listening');const r=await fetch(`http://127.0.0.1:${s.address().port}/v1/omni/calendar/read`,{method:'POST',headers:{'content-type':'application/json','x-platform-service-key':omniKey},body:JSON.stringify({access_receipt_id:receiptId})});const b=await r.json();s.close();assert.equal(r.status,200);assert.equal(b.resource,'calendar');assert.deepEqual(b.data.entries,[]);});
