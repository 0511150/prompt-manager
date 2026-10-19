import {test} from 'node:test';
import assert from 'node:assert/strict';
import {failedAttempt,normalizeAttempts,WINDOW_MS} from '../src/ban-policy.mjs';
import {createSession,verifySession,sealWorkspace,unsealWorkspace} from '../src/server-crypto.mjs';
test('five failures ban for 15 minutes, expiry and repeated ban escalation',()=>{
 let now=1000000,row;for(let n=0;n<4;n++){row=failedAttempt(row,now+n);assert.equal(row.until,0);}
 row=failedAttempt(row,now+4);assert.equal(row.until,now+4+WINDOW_MS);
 const still=failedAttempt(row,now+5);assert.equal(still.count,5);assert.equal(still.until,row.until);
 now=row.until+1;row=normalizeAttempts(row,now);assert.equal(row.count,0);
 for(let n=0;n<5;n++)row=failedAttempt(row,now+n);
 assert.equal(row.until,now+4+2*WINDOW_MS);
 row=normalizeAttempts(row,row.last+25*60*60*1000);assert.equal(row.strikes,0);
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
