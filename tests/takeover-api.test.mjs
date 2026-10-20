import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {resolve,join} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {contentVersion,diffWorkspace} from '../src/edit-protocol.js';

test('explicit per-file takeover fences and persistently revokes the displaced page without affecting other files',async()=>{
 const persist=await mkdtemp(join(tmpdir(),'prompt-takeover-'));
 const create=()=>new Miniflare({...convertV4MiniflareOptions({name:'takeover-test',modules:[{type:'ESModule',path:resolve('dist/worker.mjs')}],compatibilityDate:'2026-10-19',durableObjects:{AUTH_GUARD:{className:'AuthGuard',useSQLite:true},ACCESS_CONTROL:{className:'AccessControl',useSQLite:true},WORKSPACE_EDITOR:{className:'WorkspaceEditor',useSQLite:true}},r2Buckets:['VAULTS'],durableObjectsPersist:persist,bindings:{ACCESS_PASSWORD:'local-takeover-password-only'}}),resourcePersistencePath:join(persist,'resources'),isolatedResourcePersistencePath:join(persist,'isolated')});
 let mf=create();const origin='https://takeover.invalid';
 const req=(path,{cookie,method='GET',body,headers={}}={})=>mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const login=await req('/auth/login',{method:'POST',body:{password:'local-takeover-password-only'}});assert.equal(login.status,200);const cookie=login.headers.get('Set-Cookie').split(';')[0],a=crypto.randomUUID(),b=crypto.randomUUID();
  const read=async client=>(await req('/api/edit/state?client='+client,{cookie})).json(),initial=await read(a);
  const lease=async(client,action,id,state=initial.state,token)=>req('/api/edit/lease',{cookie,method:'POST',body:{client,action,document:id,baseVersion:await contentVersion(state.prompts.find(p=>p.id===id)||null),token}});
  const save=async(client,id,before,text,token)=>{const next=structuredClone(before);next.prompts.find(p=>p.id===id).body=text;return req('/api/edit/save',{cookie,method:'POST',body:{client,changes:diffWorkspace(before,next),leases:{[id]:token}}});};
  const oldLease=await (await lease(a,'acquire','email')).json(),independent=await (await lease(a,'acquire','review')).json();
  assert.equal((await lease(b,'acquire','email')).status,423);
  const takeoverBody={client:b,action:'takeover',document:'email',baseVersion:await contentVersion(initial.state.prompts.find(p=>p.id==='email'))};
  assert.equal((await req('/api/edit/lease',{method:'POST',body:takeoverBody})).status,401);
  assert.equal((await req('/api/edit/lease',{cookie,method:'POST',body:takeoverBody,headers:{Origin:'https://foreign.invalid'}})).status,403);
  assert.equal((await req('/api/edit/lease',{cookie,method:'POST',body:{...takeoverBody,baseVersion:'stale'}})).status,409);
  assert.equal((await lease(a,'renew','email',initial.state,oldLease.token)).status,200,'failed takeover preserves original lease');
  const takeover=await lease(b,'takeover','email');assert.equal(takeover.status,200);const newLease=await takeover.json();assert.notEqual(oldLease.token,newLease.token);
  const displaced=await read(a);assert.deepEqual(displaced.revoked,['email']);assert(displaced.locks.some(lock=>lock.id==='review'&&lock.owned));assert.deepEqual((await read(b)).revoked,[]);
  const renewal=await lease(a,'renew','email',initial.state,oldLease.token);assert.equal(renewal.status,423);assert.equal((await renewal.json()).revoked,true);
  assert.equal((await save(a,'email',initial.state,'displaced overwrite',oldLease.token)).status,423);
  assert.equal((await lease(a,'release','email',initial.state,oldLease.token)).status,200);
  assert.equal((await lease(b,'renew','email',initial.state,newLease.token)).status,200,'old page cannot release the new lease');
  assert.equal((await save(b,'email',initial.state,'new owner text',newLease.token)).status,200);
  assert.equal((await save(a,'review',initial.state,'independent file text',independent.token)).status,200,'another file held by the displaced page remains writable');
  let latest=await read(a);assert.equal(latest.state.prompts.find(p=>p.id==='email').body,'new owner text');
  assert.equal((await lease(a,'acquire','email',latest.state)).status,423,'automatic acquisition stays blocked after the new owner saves');
  await mf.dispose();mf=create();latest=await read(a);assert.deepEqual(latest.revoked,['email']);assert.equal((await lease(a,'acquire','email',latest.state)).status,423,'revocation survives restart');
  const manual=await lease(a,'takeover','email',latest.state);assert.equal(manual.status,200);assert.deepEqual((await read(a)).revoked,[],'manual reacquisition clears only this page and file revocation');
 }finally{await mf.dispose();await rm(persist,{recursive:true,force:true});}
});
