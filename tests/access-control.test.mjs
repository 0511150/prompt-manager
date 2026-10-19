import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {normalizeIp} from '../src/ip.js';

test('IP validation canonicalizes IPv6 and rejects wildcard, CIDR and forwarding-header tricks',()=>{
 assert.equal(normalizeIp('2001:0DB8:0:0:0:0:0:1'),'2001:db8::1');
 assert.equal(normalizeIp(' 203.0.113.10 '),'203.0.113.10');
 for(const value of ['203.0.113.999','203.0.113.1, 127.0.0.1','1.2.3.4/0','*','http://example.com','[::1]','1.2.3.04','::1%lo'])assert.equal(normalizeIp(value),null,value);
});

test('deployment password, safe rotation, persistent bans and authenticated allowlist',async()=>{
 const persist=await mkdtemp(join(tmpdir(),'prompt-access-test-'));
 let deployedPassword='local-deployment-password-only';
 const create=()=>new Miniflare({...convertV4MiniflareOptions({name:'access-test',modules:true,scriptPath:resolve('dist/worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{AUTH_GUARD:{className:'AuthGuard',useSQLite:true},ACCESS_CONTROL:{className:'AccessControl',useSQLite:true},WORKSPACE_EDITOR:{className:'WorkspaceEditor',useSQLite:true}},r2Buckets:['VAULTS'],durableObjectsPersist:persist,bindings:deployedPassword===undefined?{}:{ACCESS_PASSWORD:deployedPassword}}),resourcePersistencePath:join(persist,'resources'),isolatedResourcePersistencePath:join(persist,'isolated')});
 let mf=create();
 const origin='https://prompt-test.invalid',owner='198.51.100.10',attacker='198.51.100.20';
 const req=(path,{method='GET',body,ip=owner,cookie,originHeader=origin}={})=>mf.dispatchFetch(origin+path,{method,headers:{Origin:originHeader,'CF-Connecting-IP':ip,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const pages=await Promise.all(Array.from({length:4},()=>req('/')));
  for(const page of pages)assert.match(await page.text(),/访问验证/);
  assert.equal((await req('/app.js')).status,401);
  assert.equal((await req('/api/security')).status,401);
  const ownerLogin=await req('/auth/login',{method:'POST',body:{password:deployedPassword}});assert.equal(ownerLogin.status,200);
  let cookie=ownerLogin.headers.get('Set-Cookie').split(';')[0];
  const before=JSON.parse(JSON.stringify(await (await mf.getDurableObjectNamespace('ACCESS_CONTROL')).getByName('workspace-access').getCredentials()));assert(before.PASSWORD_SALT);assert(!JSON.stringify(before).includes(deployedPassword));
  assert.equal((await req('/auth/setup',{method:'POST',body:{password:'replacement-password-only'},cookie})).status,404,'removed browser setup endpoint must not reset the password');
  for(const path of ['/setup.html','/setup.js'])assert.equal((await req(path,{cookie})).status,404);
  const first=await req('/api/workspace',{cookie}),initial=await first.json();assert.equal(first.status,200);
  const save=await mf.dispatchFetch(origin+'/api/workspace',{method:'PUT',headers:{Origin:origin,'CF-Connecting-IP':owner,Cookie:cookie,'Content-Type':'application/json','X-Workspace-Revision':first.headers.get('ETag')},body:JSON.stringify(initial)});assert.equal(save.status,200);
  const backup=await req('/api/backup',{method:'POST',body:initial,cookie});const sealed=await backup.json();assert.equal(backup.status,200);assert.equal(sealed.encrypted,true);assert(!JSON.stringify(sealed).includes(initial.prompts[0].body));
  const decrypted=await req('/api/backup/decrypt',{method:'POST',body:sealed,cookie});assert.deepEqual(await decrypted.json(),initial);
  const wrong=()=>req('/auth/login',{method:'POST',body:{password:'wrong'},ip:attacker});
  for(let n=0;n<4;n++)assert.equal((await wrong()).status,401);
  let snapshot=await (await req('/api/security',{cookie})).json();assert.equal(snapshot.items.find(x=>x.ip===attacker).count,4);
  const good=await req('/auth/login',{method:'POST',body:{password:deployedPassword},ip:attacker});assert.equal(good.status,200);
  snapshot=await (await req('/api/security',{cookie})).json();assert(!snapshot.items.some(x=>x.ip===attacker),'successful login clears all IP counters');
  for(let n=0;n<5;n++)await wrong();assert.equal((await wrong()).status,429);
  assert.equal((await req('/api/security',{method:'POST',body:{action:'allow',ip:attacker}})).status,401);
  assert.equal((await req('/api/security',{method:'POST',body:{action:'allow',ip:attacker},cookie,originHeader:'https://other.invalid'})).status,403);
  const change=async(action,ip=attacker)=>req('/api/security',{method:'POST',body:{action,ip},cookie});
  assert.equal((await change('allow')).status,200);
  for(let n=0;n<7;n++)assert.equal((await wrong()).status,401,'whitelist bypasses bans but never password validation');
  assert.equal((await req('/api/workspace',{ip:attacker})).status,401);
  assert.equal((await change('deny')).status,200);
  const control=(await mf.getDurableObjectNamespace('ACCESS_CONTROL')).getByName('workspace-access');
  const now=Date.now();await control.writeIp(attacker,{count:4,start:now,until:0,last:now,permanent:false,banTimes:[now-4000,now-3000,now-2000,now-1000]});
  const fifth=await wrong();assert.equal(fifth.status,429);assert.equal((await fifth.json()).permanent,true);assert.equal(fifth.headers.get('Retry-After'),null);
  const oldPassword=deployedPassword;deployedPassword+='-rotated';
  await mf.dispose();mf=create();
  assert.equal((await wrong()).status,429,'permanent bans persist across runtime restart');
  assert.equal((await req('/api/workspace',{cookie})).status,401,'password change invalidates existing sessions');
  assert.equal((await req('/auth/login',{method:'POST',body:{password:oldPassword}})).status,401);
  const login=await req('/auth/login',{method:'POST',body:{password:deployedPassword}});assert.equal(login.status,200,'owner password persists across restart');cookie=login.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await change('unban')).status,200);assert.equal((await wrong()).status,401);
  assert.equal((await change('allow','*')).status,400);
  const credentials=await (await mf.getDurableObjectNamespace('ACCESS_CONTROL')).getByName('workspace-access').getCredentials();assert(credentials.PASSWORD_SALT);assert(!JSON.stringify(credentials).includes(deployedPassword));assert.equal(credentials.DATA_KEY,before.DATA_KEY);assert.equal(credentials.SESSION_SECRET,before.SESSION_SECRET);assert.notEqual(credentials.ACCESS_PASSWORD_HASH,before.ACCESS_PASSWORD_HASH);
  assert.deepEqual(await (await req('/api/workspace',{cookie})).json(),initial,'password rotation preserves encrypted R2 contents');
  assert.deepEqual(await (await req('/api/backup/decrypt',{method:'POST',body:sealed,cookie})).json(),initial,'existing backups still decrypt after password rotation');
  deployedPassword=undefined;await mf.dispose();mf=create();
  assert.equal((await req('/auth/login',{method:'POST',body:{password:oldPassword+'-rotated'}})).status,200,'stored credentials remain compatible when upgrading an existing installation');
 }finally{await mf.dispose();const target=resolve(persist);if(dirname(target)!==resolve(tmpdir())||!target.split(/[\\/]/).at(-1).startsWith('prompt-access-test-'))throw Error('Unsafe test directory');await rm(target,{recursive:true,force:true});}
});
