import pg from 'pg';const {Client}=pg;
function qi(v){return '"'+String(v).replaceAll('"','""')+'"';}function ql(v){return "'"+String(v).replaceAll("'","''")+"'";}
const url=String(process.env.ACCESS_ADMIN_DATABASE_URL||'').trim(),password=String(process.env.ACCESS_RUNTIME_DB_PASSWORD||'').trim(),role=String(process.env.ACCESS_RUNTIME_DB_USER||'platform_access_runtime').trim();
if(!url)throw new Error('ACCESS_ADMIN_DATABASE_URL_required');if(password.length<32)throw new Error('ACCESS_RUNTIME_DB_PASSWORD_too_short');
const c=new Client({connectionString:url,ssl:false});await c.connect();
try{
 const exists=await c.query('select 1 from pg_roles where rolname=$1',[role]);
 if(!exists.rowCount)await c.query(`create role ${qi(role)} login password ${ql(password)} nosuperuser nocreatedb nocreaterole noinherit`);
 else await c.query(`alter role ${qi(role)} with login password ${ql(password)} nosuperuser nocreatedb nocreaterole noinherit`);
 await c.query('begin');
 await c.query('create schema if not exists platform_access');
 await c.query(`revoke all on schema public from ${qi(role)}`);
 await c.query(`revoke all on schema identity_control from ${qi(role)}`).catch(()=>{});
 await c.query(`grant usage on schema platform_access to ${qi(role)}`);
 await c.query(`create table if not exists platform_access.organizations(id text primary key,slug text unique not null,display_name text not null,kind text not null,parent_id text references platform_access.organizations(id),status text not null default 'active',created_at timestamptz not null default now())`);
 await c.query(`create table if not exists platform_access.memberships(issuer text not null,subject_id text not null,organization_id text not null references platform_access.organizations(id),role text not null,status text not null default 'active',created_at timestamptz not null default now(),primary key(issuer,subject_id,organization_id,role))`);
 await c.query(`create table if not exists platform_access.role_grants(role text not null,resource text not null,action text not null,inherit_descendants boolean not null default false,primary key(role,resource,action))`);
 await c.query(`create table if not exists platform_access.access_decision_receipts(id text primary key,request_id text not null,trace_id text not null,correlation_id text not null,client_id text not null,issuer text,subject_id text,organization_id text,resource text,action text,decision text not null,reason text not null,policy_version text not null,identity_acr text,created_at timestamptz not null default now())`);
 const orgs=[['black-sands-ventures','black-sands-ventures','Black Sands Ventures','portfolio',null],['roll-call','roll-call','Roll Call','subsidiary','black-sands-ventures'],['asmbly','asmbly','ASMBLY','subsidiary','black-sands-ventures'],['gravy','gravy','Gravy','subsidiary','black-sands-ventures'],['space-cadet','space-cadet','Space Cadet','subsidiary','black-sands-ventures'],['roll-call-events','roll-call-events','Roll Call Events','division','roll-call'],['roll-call-field','roll-call-field','Roll Call Field','division','roll-call'],['roll-call-venue','roll-call-venue','Roll Call Venue','division','roll-call'],['roll-call-members','roll-call-members','Roll Call Members','division','roll-call'],['brdcst','brdcst','BRDCST','division','roll-call']];
 for(const o of orgs)await c.query('insert into platform_access.organizations(id,slug,display_name,kind,parent_id) values($1,$2,$3,$4,$5) on conflict(id) do update set slug=excluded.slug,display_name=excluded.display_name,kind=excluded.kind,parent_id=excluded.parent_id,status=\'active\'',[...o]);
 const grants=[['owner','work','read',true],['owner','calendar','read',true],['owner','portfolio','read',true],['operator','work','read',false],['operator','calendar','read',false],['viewer','work','read',false],['viewer','calendar','read',false]];
 for(const g of grants)await c.query('insert into platform_access.role_grants(role,resource,action,inherit_descendants) values($1,$2,$3,$4) on conflict(role,resource,action) do update set inherit_descendants=excluded.inherit_descendants',g);
 await c.query(`revoke all on all tables in schema platform_access from ${qi(role)}`);
 await c.query(`grant select on platform_access.organizations,platform_access.memberships,platform_access.role_grants to ${qi(role)}`);
 await c.query(`grant select,insert on platform_access.access_decision_receipts to ${qi(role)}`);
 await c.query('commit');
 console.log(JSON.stringify({ok:true,contract:'platform-access-db-p3.3',schema:'platform_access',runtime_role:role,organizations:orgs.length,grants:grants.length,identity_schema_access:false},null,2));
}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{await c.end();}
