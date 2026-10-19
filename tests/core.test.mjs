import {test} from 'node:test';
import assert from 'node:assert/strict';
import {variableNames,fillVariables,missingVariables,freshState,validateState} from '../src/model.js';
import {deriveSession,seal,unseal} from '../src/crypto.js';

test('variables are deduplicated, trimmed and preserve multiline literal values',()=>{
 const text='我的邮箱是@@ email @@，@@email@@；公式 @@math@@；缺少 @@other@@';
 assert.deepEqual(variableNames(text),['email','math','other']);
 assert.equal(fillVariables(text,{email:'test@example.com',math:'$a\\b\n$'}),'我的邮箱是test@example.com，test@example.com；公式 $a\\b\n$；缺少 @@other@@');
 assert.deepEqual(missingVariables(text,{email:'x',math:''}),['math','other']);
 assert.equal(fillVariables('@@n@@',{n:'0'}),'0');
});
test('import validates data and rejects cyclic folders or unsafe IDs',()=>{
 assert.equal(validateState(freshState()).prompts.length,4);
 const s=freshState();s.folders[0].parent='work';s.folders[1].parent='writing';assert.throws(()=>validateState(s),/循环/);
 const unsafe=freshState();unsafe.prompts[0].id='" onclick="x';assert.throws(()=>validateState(unsafe),/标识/);
});
test('vault encryption roundtrip and wrong password/tampering rejection',async()=>{
 const session=await deriveSession('Test Space','correct-test-password');
 const same=await deriveSession(' test space ','correct-test-password');
 assert.equal(session.id,same.id);assert.equal(session.token,same.token);
 const original=freshState(),payload=await seal(original,session);
 assert(!JSON.stringify(payload).includes('hello@example.com'));
 assert.deepEqual(await unseal(payload,same),original);
 const wrong=await deriveSession('test space','wrong-test-password');
 await assert.rejects(unseal(payload,wrong));
 const other=await seal(original,session);assert.notEqual(other.iv,payload.iv);
});
test('password gate: private assets, single workspace, login, backups, logout revocation',async()=>{
 const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8787',origin=new URL(base).origin;
 if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('修改数据的集成测试只允许在本机执行');
 const password=process.env.TEST_PASSWORD||'local-integration-password-only';
 const post=(path,body,extra={})=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 assert((await (await fetch(base+'/')).text()).includes('访问验证'));
 for(const path of ['/app.js','/style.css','/api/workspace','/api/vault/'+'a'.repeat(64)])assert.equal((await fetch(base+path)).status,401,path);
 assert.equal((await post('/auth/login',{password},{Origin:'https://other.example'})).status,403);
 const login=await post('/auth/login',{password});assert.equal(login.status,200,await login.text());
 const setCookie=login.headers.get('Set-Cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Strict/);
 const cookie=setCookie.split(';')[0],auth={Cookie:cookie};
 assert.equal((await fetch(base+'/app.js',{headers:auth})).status,200);
 const read=await fetch(base+'/api/workspace',{headers:auth});assert.equal(read.status,200);const saved=await read.json(),etag=read.headers.get('ETag');
 assert.equal(saved.version,1);
 const updated=structuredClone(saved);updated.prompts[0].title='Single workspace test';
 const put=body=>fetch(base+'/api/workspace',{method:'PUT',headers:{...auth,Origin:origin,'Content-Type':'application/json','X-Workspace-Revision':etag},body:JSON.stringify(body)});
 assert.equal((await put(updated)).status,200);
 assert.equal((await put(saved)).status,409);
 const beforeBackup=await (await fetch(base+'/api/history',{headers:auth})).json();
 const backup=await post('/api/backup',updated,auth);assert.equal(backup.status,200);const sealed=await backup.json();assert.equal(sealed.format,2);assert(!JSON.stringify(sealed).includes('Single workspace test'));
 const decoded=await post('/api/backup/decrypt',sealed,auth);assert.equal(decoded.status,200);assert.deepEqual(await decoded.json(),updated);
 const afterBackup=await (await fetch(base+'/api/history',{headers:auth})).json();assert.deepEqual(afterBackup.items,beforeBackup.items,'manual backups do not add R2 history');
 assert.equal((await fetch(base+'/api/vault/'+'a'.repeat(64),{headers:auth})).status,404);
 const restoreRead=await fetch(base+'/api/workspace',{headers:auth});
 const restored=await fetch(base+'/api/workspace',{method:'PUT',headers:{...auth,Origin:origin,'Content-Type':'application/json','X-Workspace-Revision':restoreRead.headers.get('ETag')},body:JSON.stringify(saved)});assert.equal(restored.status,200);
 const logout=await post('/auth/logout',{},auth);assert.equal(logout.status,200);
 assert.equal((await fetch(base+'/api/workspace',{headers:auth})).status,401,'revoked cookie must not be replayable');
 assert.equal((await fetch(base+'/api/workspace',{headers:{Cookie:cookie+'x'}})).status,401);
});

test('IP ban persists through repeated and concurrent wrong attempts and ignores forwarded IP spoofing',async()=>{
 if(process.env.TEST_BASE_URL?.startsWith('https:'))return; // Never ban a real production user IP.
 const base='http://127.0.0.1:8787',ip='198.51.100.'+(Math.floor(Math.random()*180)+20);
 const wrong=n=>fetch(base+'/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':ip,'X-Forwarded-For':'203.0.113.'+n},body:JSON.stringify({password:'wrong-password'})});
 const responses=await Promise.all(Array.from({length:8},(_,n)=>wrong(n)));
 assert.equal(responses.filter(r=>r.status===401).length,4);
 assert.equal(responses.filter(r=>r.status===429).length,4);
 const later=await wrong(99);assert.equal(later.status,429);assert(Number(later.headers.get('Retry-After'))>0);
 const goodButBanned=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify({password:'local-integration-password-only'})});assert.equal(goodButBanned.status,429);
});
