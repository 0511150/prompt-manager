import {test} from 'node:test';
import assert from 'node:assert/strict';
import {failedAttempt,normalizeAttempts,WINDOW_MS} from '../src/ban-policy.mjs';
import {createSession,verifySession,sealWorkspace,unsealWorkspace} from '../src/server-crypto.mjs';
test('fixed temporary bans, rolling 24 hour threshold and permanent ban persistence',()=>{
 let now=1000000,row;
 for(let ban=1;ban<=5;ban++){
  for(let n=0;n<5;n++)row=failedAttempt(row,now+n);
  assert.equal(row.banTimes.length,ban);
  if(ban<5){assert.equal(row.until,now+4+WINDOW_MS);assert.equal(row.permanent,false);const unchanged=failedAttempt(row,now+5);assert.equal(unchanged.banTimes.length,ban);now=row.until+1;row=normalizeAttempts(row,now);assert.equal(row.count,0);}
 }
 assert.equal(row.permanent,true);assert.equal(normalizeAttempts(row,now+7*24*60*60*1000).permanent,true);
 const rolling=failedAttempt({count:4,start:now,until:0,last:now,permanent:false,banTimes:[now-24*60*60*1000,now-24*60*60*1000+1,now-1000]},now);
 assert.equal(rolling.banTimes.length,3);assert.equal(rolling.permanent,false);assert.equal(rolling.until,now+WINDOW_MS);
});

test('session integrity, expiry and password-change invalidation',async()=>{
 const env={SESSION_SECRET:'test-signing-secret',ACCESS_PASSWORD_HASH:'test-password-verifier'},now=Date.now();
 const {token}=await createSession(env,now);assert(await verifySession(token,env,now));
 assert.equal(await verifySession(token+'x',env,now),null);
 assert.equal(await verifySession(token,env,now+12*60*60*1000+1),null);
 assert.equal(await verifySession(token,{...env,ACCESS_PASSWORD_HASH:'new-verifier'},now),null);
});
test('single workspace and backup encryption reject wrong key and tampering',async()=>{
 const key=btoa('a'.repeat(32)),state={message:'private prompt',values:{email:'private@example.com'}};
 const payload=await sealWorkspace(state,key);assert(!JSON.stringify(payload).includes('private'));
 assert.deepEqual(await unsealWorkspace(payload,key),state);
 await assert.rejects(unsealWorkspace(payload,btoa('b'.repeat(32))));
 const other=await sealWorkspace(state,key);assert.notEqual(payload.iv,other.iv);
});
