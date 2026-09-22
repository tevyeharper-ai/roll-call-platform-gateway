import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createServer, loadConfig, validateAccessReceipt } from './server.mjs';
import {browserCookies,cookie,sealBrowserSession,sealIdentityToken} from './browser-session.mjs';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pub = publicKey.export({type:'spki',format:'pem'}).toString();
const priv = privateKey.export({type:'pkcs8',format:'pem'}).toString();
const consumers=['events','broadcast','field','experiential','asmbly'];
const omniKey='omni-gateway-key',accessKey='gateway-access-key',ownerKey='gateway-owner-key';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const tenantId='11111111-1111-4111-8111-111111111111';
const workspaceId='22222222-2222-4222-8222-222222222222';

const config = loadConfig({
  PORT:'0', RC_GATEWAY_SERVICE_ID:'roll-call-platform-gateway:p3.6-test', RC_GATEWAY_ENV:'staging',
  RC_OIDC_ISSUER:'https://identity.test/realms/bsv-shared',RC_OIDC_CLIENT_ID:'roll-call-staging',RC_OIDC_CLIENT_SECRET:'0123456789abcdef0123456789abcdef',RC_PUBLIC_URL:'https://roll-call.test',RC_SESSION_SECRET:'abcdef0123456789abcdef0123456789',
  RC_GATEWAY_PUBLIC_KEY_PEM:pub, RC_GATEWAY_PRIVATE_KEY_PEM:priv, RC_REFERENCE_CONSUMERS:consumers.join(','),
  RC_OMNI_GATEWAY_SERVICE_KEY_SHA256:hash(omniKey),
  RC_PLATFORM_ACCESS_URL:'https://access.test',RC_PLATFORM_ACCESS_GATEWAY_KEY:accessKey,
  RC_ROLL_CALL_EVENTS_READ_URL:'https://events.test',RC_ROLL_CALL_EVENTS_READ_KEY:ownerKey,
  RC_ROLL_CALL_BROADCAST_URL:'https://broadcast.test',RC_ROLL_CALL_BROADCAST_BASE_PATH:'/app/broadcast',RC_ROLL_CALL_BROADCAST_SERVICE_KEY:'broadcast-owner-key',
  RC_ROLL_CALL_FIELD_URL:'https://field.test',RC_ROLL_CALL_FIELD_BASE_PATH:'/app/field',
  RC_ROLL_CALL_EXPERIENTIAL_URL:'https://experiential.test',RC_ROLL_CALL_EXPERIENTIAL_BASE_PATH:'/app/experiential',
  RC_EVENTS_WORKSPACE_BINDINGS_JSON:JSON.stringify({'roll-call:workspace-1':{tenant_id:tenantId,workspace_id:workspaceId}}),
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
  if(target==='https://access.test/v1/core/workspaces'){
    accessCalls.push({path:'/v1/core/workspaces',options});
    assert.equal(options.headers['x-platform-service-key'],accessKey);
    const payload=JSON.parse(options.body);
    assert.equal(payload.identity_token,'identity-token');
    return new Response(JSON.stringify({
      schema:'roll-call.workspace-discovery.v1',subject_id:'subject-1',environment:'staging',policy_version:'P3.5.0',
      workspaces:[{
        organization:{organization_id:'roll-call',name:'Roll Call',slug:'roll-call',kind:'customer'},
        workspace:{workspace_id:'workspace-1',name:'Agency Workspace',slug:'agency-workspace',default_timezone:'America/Los_Angeles'},
        roles:['owner'],effective_permissions:['*'],
        entitlements:[
          {toolkit_id:'roll-call.events',status:'active',source:'bundle'},
          {toolkit_id:'roll-call.broadcast',status:'active',source:'bundle'},
          {toolkit_id:'roll-call.field',status:'active',source:'bundle'},
          {toolkit_id:'roll-call.experiential',status:'active',source:'bundle'}
        ]
      }]
    }),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://access.test/v1/core/context'){
    accessCalls.push({path:'/v1/core/context',options});
    assert.equal(options.headers['x-platform-service-key'],accessKey);
    const payload=JSON.parse(options.body);
    return new Response(JSON.stringify({schema:'roll-call.core-context.v1',subject_id:'subject-1',organization_id:payload.organization_id,workspace:{workspace_id:payload.workspace_id,name:'Agency Workspace'},roles:['owner'],effective_permissions:['*'],entitlements:[{toolkit_id:'roll-call.events',status:'active'},{toolkit_id:'roll-call.broadcast',status:'active'},{toolkit_id:'roll-call.field',status:'active'},{toolkit_id:'roll-call.experiential',status:'active'}],environment:'staging'}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://access.test/v1/entitlements/resolve'){
    accessCalls.push({path:'/v1/entitlements/resolve',options});
    assert.equal(options.headers['x-platform-service-key'],accessKey);
    const payload=JSON.parse(options.body);
    const entitled=['roll-call.broadcast','roll-call.field','roll-call.experiential'].includes(payload.toolkit_id);
    return new Response(JSON.stringify({schema:'roll-call.toolkit-entitlement-resolution.v1',toolkit_id:payload.toolkit_id,entitled,reason:entitled?'toolkit_entitlement_active':'toolkit_entitlement_missing',environment:'staging'}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://access.test/v1/access/decisions'){
    accessCalls.push({path:'/v1/access/decisions',options});
    assert.equal(options.headers['x-platform-service-key'],accessKey);
    const payload=JSON.parse(options.body);
    const receiptIdForResource=payload.resource==='broadcast'?'cccccccc-cccc-4ccc-8ccc-cccccccccccc':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    return new Response(JSON.stringify({decision:'allow',reason:'explicit_workspace_membership',receipt_id:receiptIdForResource,subject_id:'subject-1',organization_id:payload.organization_id,workspace_id:payload.workspace_id,resource:payload.resource,action:payload.action,policy_version:'P3.5.0'}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target==='https://events.test/api/platform/events/event-123/reference'){
    assert.equal(options.headers['x-platform-service-key'],ownerKey);
    assert.equal(options.headers['x-roll-call-organization-id'],'roll-call');
    assert.equal(options.headers['x-roll-call-workspace-id'],'workspace-1');
    assert.equal(options.headers['x-roll-call-events-tenant-id'],tenantId);
    assert.equal(options.headers['x-roll-call-events-workspace-id'],workspaceId);
    assert.equal(options.headers['x-roll-call-access-receipt-id'],'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    return new Response(JSON.stringify({
      ok:true,
      contract:'roll-call.event-reference.v1',
      event_reference:{
        schema:'roll-call.event-reference.v1',event_id:'event-123',organization_id:'roll-call',workspace_id:'workspace-1',
        name:'Launch Event',status:'Planning',lifecycle:'Source of Truth',timezone:'America/Los_Angeles',public_state:'Published',
        links:{public_event_url:'https://rollcallevents.co/e/launch-event',registration_url:'https://rollcallevents.co/e/launch-event#registration',ticket_url:'https://rollcallevents.co/e/launch-event#registration'},
        source:{authority:'events.clean-host-source-of-truth.v1',application_id:'roll-call.events',updated_at:'2026-09-21T00:00:00.000Z'}
      }
    }),{status:200,headers:{'content-type':'application/json'}});
  }
  if(target.startsWith('https://field.test/app/field')){
    assert.equal(options.headers['x-roll-call-toolkit-id'],'roll-call.field');
    assert.equal(options.headers['x-roll-call-subject-id'],'subject-1');
    assert.equal(options.headers['x-roll-call-organization-id'],'roll-call');
    assert.equal(options.headers['x-roll-call-workspace-id'],'workspace-1');
    assert.ok(String(options.headers.cookie||'').length>20);
    return new Response('<!doctype html><html><body>Field routed</body></html>',{
      status:200,
      headers:{'content-type':'text/html; charset=utf-8','set-cookie':'field_session=must-not-leak; Path=/'}
    });
  }

  if(target.startsWith('https://experiential.test/api/experiential')){
    assert.equal(options.headers['x-roll-call-toolkit-id'],'roll-call.experiential');
    assert.equal(options.headers['x-roll-call-subject-id'],'subject-1');
    assert.equal(options.headers['x-roll-call-organization-id'],'roll-call');
    assert.equal(options.headers['x-roll-call-workspace-id'],'workspace-1');
    return new Response(JSON.stringify({ok:true,source:'experiential-owner'}),{
      status:200,
      headers:{'content-type':'application/json','set-cookie':'experiential_api_session=must-not-leak; Path=/'}
    });
  }

  if(target.startsWith('https://experiential.test/app/experiential')){
    assert.equal(options.headers['x-roll-call-toolkit-id'],'roll-call.experiential');
    assert.equal(options.headers['x-roll-call-subject-id'],'subject-1');
    assert.equal(options.headers['x-roll-call-organization-id'],'roll-call');
    assert.equal(options.headers['x-roll-call-workspace-id'],'workspace-1');
    assert.ok(String(options.headers.cookie||'').length>20);
    return new Response('<!doctype html><html><body>Experiential routed</body></html>',{
      status:200,
      headers:{'content-type':'text/html; charset=utf-8','set-cookie':'experiential_session=must-not-leak; Path=/'}
    });
  }
  if(target.startsWith('https://broadcast.test/app/broadcast')&&!target.includes('/api/platform/')){
    assert.equal(options.headers['x-roll-call-toolkit-id'],'roll-call.broadcast');
    assert.equal(options.headers['x-roll-call-subject-id'],'subject-1');
    assert.equal(options.headers['x-roll-call-organization-id'],'roll-call');
    assert.equal(options.headers['x-roll-call-workspace-id'],'workspace-1');
    assert.ok(String(options.headers.cookie||'').length>20);
    return new Response('<!doctype html><html><body>Broadcast routed</body></html>',{
      status:200,
      headers:{'content-type':'text/html; charset=utf-8','set-cookie':'brdcst_session=must-not-leak; Path=/'}
    });
  }
  if(target==='https://broadcast.test/app/broadcast/api/platform/events/event-123/campaign-intents'){
    assert.equal(options.method,'POST');
    assert.equal(options.headers['x-platform-service-key'],'broadcast-owner-key');
    assert.equal(options.headers['x-roll-call-subject-id'],'subject-1');
    assert.equal(options.headers['x-roll-call-events-access-receipt-id'],'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    assert.equal(options.headers['x-roll-call-broadcast-access-receipt-id'],'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const payload=JSON.parse(options.body);
    assert.equal(payload.organization_id,'roll-call');
    assert.equal(payload.workspace_id,'workspace-1');
    assert.equal(payload.intent.schema,'roll-call.event-promote-broadcast.v1');
    assert.equal(payload.intent.requested_by,'subject-1');
    assert.equal(payload.event_reference.event_id,'event-123');
    return new Response(JSON.stringify({
      ok:true,
      contract:'roll-call.event-promote-broadcast.result.v1',
      authority:'roll-call.broadcast',
      result:{
        created:true,idempotent:false,intent_id:'intent-1',campaign_id:'campaign-1',campaign_name:'Launch Event Campaign',
        status:'draft',event_id:'event-123',event_authority:'events.clean-host-source-of-truth.v1',
        broadcast_authority:'roll-call.broadcast',canonical_path:'/app/broadcast/campaigns/campaign-1',legacy_path:'/campaigns/campaign-1'
      }
    }),{status:201,headers:{'content-type':'application/json'}});
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

test('health reports P3.7', async()=>{ const {r,b}=await get('/health'); assert.equal(r.status,200); assert.equal(b.status,'ok'); assert.equal(b.version,'P3.7.0'); });
function shellCookieHeader(){
  const identity={sub:'subject-1',issuer:'https://identity.test/realms/bsv-shared',name:'Test Operator',email:'operator@example.test',acr:'aal2',amr:['pwd','otp'],expiresAt:Date.now()+600000};
  const session=sealBrowserSession(identity,config.browserAuth);
  const token=sealIdentityToken('identity-token',config.browserAuth);
  return cookie(browserCookies.session,session,{maxAge:600})+'; '+cookie(browserCookies.identity,token,{maxAge:600});
}

test('shared shell session resolves identity through Platform Access',async()=>{
  const {r,b}=await get('/v1/shell/session?organization_id=roll-call&workspace_id=workspace-1&toolkit=broadcast',{cookie:shellCookieHeader()});
  assert.equal(r.status,200);
  assert.equal(b.authenticated,true);
  assert.equal(b.schema,'roll-call.shell-session.v1');
  assert.equal(b.shell.actor.subject_id,'subject-1');
  assert.equal(b.shell.workspace.workspace_id,'workspace-1');
  assert.equal(b.shell.active_toolkit,'roll-call.broadcast');
  assert.equal(b.shell.toolkits.find(x=>x.toolkit_id==='roll-call.broadcast').entitled,true);
  assert.ok(b.authorization.effective_permissions.includes('*'));
  assert.equal(b.identity.acr,'aal2');
  assert.equal(Object.hasOwn(b,'identity_token'),false);
});
test('shared shell session rejects missing browser identity',async()=>{
  const {r,b}=await get('/v1/shell/session?workspace_id=workspace-1&toolkit=broadcast');
  assert.equal(r.status,401);
  assert.equal(b.error,'roll_call_session_required');
});
test('shared shell session resolves Experiential entitlement',async()=>{
  const {r,b}=await get('/v1/shell/session?organization_id=roll-call&workspace_id=workspace-1&toolkit=experiential',{cookie:shellCookieHeader()});
  assert.equal(r.status,200);
  assert.equal(b.shell.active_toolkit,'roll-call.experiential');
  assert.equal(b.shell.toolkits.find(x=>x.toolkit_id==='roll-call.experiential').entitled,true);
});

test('Broadcast same-origin route redirects unauthenticated browser to shared login',async()=>{
  const r=await fetch(base+'/app/broadcast',{redirect:'manual'});
  assert.equal(r.status,302);
  assert.match(r.headers.get('location')||'',/^\/api\/auth\/login\?returnTo=/);
});
test('Broadcast same-origin route proxies entitled shared session and strips toolkit cookies',async()=>{
  const r=await fetch(base+'/app/broadcast',{headers:{cookie:shellCookieHeader()}});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('x-roll-call-route-owner'),'roll-call.broadcast');
  assert.equal(r.headers.get('x-roll-call-same-origin'),'true');
  assert.equal(r.headers.get('set-cookie'),null);
  assert.match(await r.text(),/Broadcast routed/);
});

test('Field same-origin route redirects unauthenticated browser to shared login',async()=>{
  const r=await fetch(base+'/app/field',{redirect:'manual'});
  assert.equal(r.status,302);
  assert.match(r.headers.get('location')||'',/^\/api\/auth\/login\?returnTo=/);
});

test('Field same-origin route proxies entitled shared session and strips toolkit cookies',async()=>{
  const r=await fetch(base+'/app/field',{headers:{cookie:shellCookieHeader()}});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('x-roll-call-route-owner'),'roll-call.field');
  assert.equal(r.headers.get('x-roll-call-same-origin'),'true');
  assert.equal(r.headers.get('set-cookie'),null);
  assert.match(await r.text(),/Field routed/);
});

test('Experiential same-origin route redirects unauthenticated browser to shared login',async()=>{
  const r=await fetch(base+'/app/experiential',{redirect:'manual'});
  assert.equal(r.status,302);
  assert.match(r.headers.get('location')||'',/^\/api\/auth\/login\?returnTo=/);
});

test('Experiential same-origin route proxies entitled shared session and strips toolkit cookies',async()=>{
  const r=await fetch(base+'/app/experiential',{headers:{cookie:shellCookieHeader()}});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('x-roll-call-route-owner'),'roll-call.experiential');
  assert.equal(r.headers.get('x-roll-call-same-origin'),'true');
  assert.equal(r.headers.get('set-cookie'),null);
  assert.match(await r.text(),/Experiential routed/);
});

test('Experiential API is routed through the same governed session boundary',async()=>{
  const r=await fetch(base+'/api/experiential/programs',{headers:{cookie:shellCookieHeader()}});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('x-roll-call-route-owner'),'roll-call.experiential');
  assert.equal(r.headers.get('x-roll-call-same-origin'),'true');
  assert.equal(r.headers.get('set-cookie'),null);
  const b=await r.json();
  assert.equal(b.source,'experiential-owner');
});

test('metadata advertises Broadcast, Field, Experiential and Roll Call Core', async()=>{ const {r,b}=await get('/bootstrap/v1/metadata'); assert.equal(r.status,200); assert.deepEqual(b.reference_consumers,consumers); assert.equal(b.omni_read_broker.available,true); assert.equal(b.roll_call_core.available,true); assert.equal(b.roll_call_browser_session.available,true); assert.equal(b.roll_call_field_route.available,true); assert.equal(b.roll_call_field_route.path_prefix,'/app/field'); assert.equal(b.roll_call_experiential_route.available,true); assert.equal(b.roll_call_experiential_route.path_prefix,'/app/experiential'); });
test('readiness includes Core, browser session, Broadcast, Field and Experiential same-origin state', async()=>{ const {r,b}=await get('/ready'); assert.equal(r.status,200); assert.equal(b.status,'ready'); assert.equal(b.omni_read_ready,true); assert.equal(b.roll_call_core_ready,true); assert.equal(b.roll_call_browser_session_ready,true); assert.equal(b.roll_call_broadcast_same_origin_ready,true); assert.equal(b.roll_call_field_same_origin_ready,true); assert.equal(b.roll_call_experiential_same_origin_ready,true); });
test('OMNI broker readiness remains independently green',async()=>{const {r,b}=await get('/v1/omni/readiness');assert.equal(r.status,200);assert.equal(b.organization_id,'roll-call-events');});
for (const consumer of consumers) test(`${consumer} reference is governed`, async()=>{ const {r,b}=await get(`/v1/${consumer}/reference`); assert.equal(r.status,200); assert.equal(b.consumer,consumer); assert.equal(b.contract_version,'P3.4'); });
test('unsupported reference fails closed',async()=>{const {r,b}=await get('/v1/unknown/reference');assert.equal(r.status,404);assert.equal(b.error,'unsupported_consumer');});

test('identity metadata remains verification-only', async()=>{ const {r,b}=await get('/v1/identity/metadata'); assert.equal(r.status,200); assert.equal(b.issuance_available,false); });
test('valid identity assertion verifies', async()=>{ const {r,b}=await post('/v1/identity/assertions/verify',{assertion:sign(claim())}); assert.equal(r.status,200); assert.equal(b.ok,true); });
test('expired assertion fails', async()=>{ const now=Math.floor(Date.now()/1000); const {r}=await post('/v1/identity/assertions/verify',{assertion:sign(claim({iat:now-100,exp:now-1}))}); assert.equal(r.status,401); });
test('wrong environment assertion fails', async()=>{ const {r}=await post('/v1/identity/assertions/verify',{assertion:sign(claim({environment:'production'}))}); assert.equal(r.status,401); });
test('issuance remains unavailable', async()=>{ const {r}=await post('/v1/identity/assertions',{principal_id:'x'}); assert.equal(r.status,501); });

test('Core context forwards through Gateway service identity',async()=>{const {r,b}=await post('/v1/core/context',{identity_token:'token',organization_id:'roll-call',workspace_id:'workspace-1'},{'x-roll-call-correlation-id':'corr-core'});assert.equal(r.status,200);assert.equal(b.schema,'roll-call.core-context.v1');assert.equal(b.entitlements.some(e=>e.toolkit_id==='roll-call.broadcast'),true);const call=accessCalls.find(x=>x.path==='/v1/core/context'&&x.options.headers['x-roll-call-correlation-id']==='corr-core');assert.ok(call);assert.equal(call.options.headers['x-roll-call-correlation-id'],'corr-core');});
test('Broadcast entitlement resolves independently through Gateway',async()=>{const {r,b}=await post('/v1/entitlements/resolve',{identity_token:'token',organization_id:'roll-call',workspace_id:'workspace-1',toolkit_id:'roll-call.broadcast'});assert.equal(r.status,200);assert.equal(b.entitled,true);assert.equal(b.toolkit_id,'roll-call.broadcast');});
test('Gateway brokers canonical Event reference after access decision',async()=>{
  const {r,b}=await post('/v1/events/event-123/reference',{identity_token:'token',organization_id:'roll-call',workspace_id:'workspace-1'});
  assert.equal(r.status,200);
  assert.equal(b.contract,'roll-call.event-reference.v1');
  assert.equal(b.event_reference.event_id,'event-123');
  assert.equal(b.authorization.decision,'allow');
  assert.equal(b.authorization.receipt_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
});

test('Gateway brokers Event reference from sealed browser session without exposing identity token',async()=>{
  const r=await fetch(base+'/v1/events/event-123/reference',{
    method:'POST',
    headers:{'content-type':'application/json',cookie:shellCookieHeader()},
    body:JSON.stringify({organization_id:'roll-call',workspace_id:'workspace-1'})
  });
  const b=await r.json();
  assert.equal(r.status,200);
  assert.equal(b.contract,'roll-call.event-reference.v1');
  assert.equal(b.event_reference.event_id,'event-123');
});
test('Event reference fails closed when shared workspace has no Events binding',async()=>{
  const {r,b}=await post('/v1/events/event-123/reference',{identity_token:'token',organization_id:'roll-call',workspace_id:'unbound'});
  assert.equal(r.status,409);
  assert.equal(b.error,'events_workspace_binding_missing');
});
test('Event promote creates Broadcast-owned Campaign with two authorization receipts',async()=>{
  const {r,b}=await post('/v1/events/event-123/broadcast-campaign-intents',{
    identity_token:'token',
    organization_id:'roll-call',
    intent:{
      schema:'roll-call.event-promote-broadcast.v1',
      event_id:'event-123',
      workspace_id:'workspace-1',
      requested_by:'subject-1',
      source:{publication_version_id:null,use_draft_if_authorized:false},
      prefill:{objective:'Drive registrations',campaign_name:'Launch Event Campaign'},
      idempotency_key:'promote-event-123-001'
    }
  });
  assert.equal(r.status,201);
  assert.equal(b.contract,'roll-call.event-promote-broadcast.result.v1');
  assert.equal(b.result.broadcast_authority,'roll-call.broadcast');
  assert.equal(b.result.event_authority,'events.clean-host-source-of-truth.v1');
  assert.equal(b.result.campaign_id,'campaign-1');
  assert.equal(b.authorization.events_read_receipt_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(b.authorization.broadcast_write_receipt_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
});
test('Event promote rejects requested_by mismatch',async()=>{
  const {r,b}=await post('/v1/events/event-123/broadcast-campaign-intents',{
    identity_token:'token',organization_id:'roll-call',
    intent:{schema:'roll-call.event-promote-broadcast.v1',event_id:'event-123',workspace_id:'workspace-1',requested_by:'other-subject',source:{use_draft_if_authorized:false},idempotency_key:'mismatch-001'}
  });
  assert.equal(r.status,403);
  assert.equal(b.error,'promotion_requested_by_subject_mismatch');
});
test('Event promote rejects draft promotion until governed draft contract exists',async()=>{
  const {r,b}=await post('/v1/events/event-123/broadcast-campaign-intents',{
    identity_token:'token',organization_id:'roll-call',
    intent:{schema:'roll-call.event-promote-broadcast.v1',event_id:'event-123',workspace_id:'workspace-1',requested_by:'subject-1',source:{use_draft_if_authorized:true},idempotency_key:'draft-001'}
  });
  assert.equal(r.status,422);
  assert.equal(b.error,'draft_event_promotion_not_supported_in_p3_4');
});
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
