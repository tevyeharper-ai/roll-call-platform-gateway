import crypto from 'node:crypto';
function clean(v){return String(v??'').trim();}
export function sha256(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
export function loadConfig(env=process.env){
 const issuer=clean(env.ACCESS_IDENTITY_ISSUER),audience=clean(env.ACCESS_IDENTITY_AUDIENCE||'omni-preview'),serviceKeyHash=clean(env.ACCESS_OMNI_SERVICE_KEY_SHA256);
 return {port:Number(env.PORT||8080),environment:clean(env.ACCESS_ENVIRONMENT||'staging'),serviceId:clean(env.ACCESS_SERVICE_ID||'platform-access:p3.3-staging'),issuer,audience,serviceKeyHash,policyVersion:'P3.3.0',db:{host:clean(env.ACCESS_DB_HOST),port:Number(env.ACCESS_DB_PORT||5432),database:clean(env.ACCESS_DB_NAME),user:clean(env.ACCESS_DB_USER),password:clean(env.ACCESS_DB_PASSWORD),ssl:clean(env.ACCESS_DB_SSL)==='true'}};
}
export function configFailures(c){const f=[];if(!c.serviceId)f.push('service_id_missing');if(!c.issuer.startsWith('https://'))f.push('identity_issuer_invalid');if(!c.audience)f.push('identity_audience_missing');if(!/^[a-f0-9]{64}$/i.test(c.serviceKeyHash))f.push('service_key_hash_missing');for(const [k,v] of Object.entries(c.db)){if(k==='ssl'||k==='port')continue;if(!v)f.push('db_'+k+'_missing');}return f;}
