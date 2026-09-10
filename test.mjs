import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const port = 18787;
const child = spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),RC_WORDPRESS_ORIGIN:'https://example.invalid',RC_GATEWAY_PRIVATE_KEY_PEM:privateKey,RC_GATEWAY_PUBLIC_KEY_PEM:publicKey},stdio:['ignore','pipe','pipe']});
await new Promise(r=>setTimeout(r,500));
try {
  const health = await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json());
  if (health.product !== 'roll-call-platform-gateway') throw new Error('health failed');
  const meta = await fetch(`http://127.0.0.1:${port}/bootstrap/v1/metadata`).then(r=>r.json());
  if (!meta.public_key_pem.includes('BEGIN PUBLIC KEY')) throw new Error('metadata key failed');
  const deny = await fetch(`http://127.0.0.1:${port}/v1/protected`).then(r=>r.json());
  if (deny.status !== 'denied_closed') throw new Error('deny closed failed');
  console.log('P3.1.1_GATEWAY_TEST_OK');
} finally { child.kill('SIGTERM'); }
