import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {resolve} from 'node:path';
import {diffWorkspace,contentVersion} from '../src/edit-protocol.js';
import {movePromptPresets,presetsForPrompt} from '../src/preset-scopes.js';

test('scoped combinations persist through Worker saves, file moves and encrypted backups',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'preset-scope-test',modules:true,scriptPath:resolve('dist/worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{AUTH_GUARD:{className:'AuthGuard',useSQLite:true},ACCESS_CONTROL:{className:'AccessControl',useSQLite:true},WORKSPACE_EDITOR:{className:'WorkspaceEditor',useSQLite:true}},r2Buckets:['VAULTS'],bindings:{ACCESS_PASSWORD:'local-preset-scope-test-only'}}));const origin='https://preset.invalid',client=crypto.randomUUID();let cookie;
 const req=(path,body)=>mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const save=async(before,next,leases={})=>{const r=await req('/api/edit/save',{client,changes:diffWorkspace(before,next),leases});assert.equal(r.status,200,await r.clone().text());return (await r.json()).state;};
 try{
  const login=await req('/auth/login',{password:'local-preset-scope-test-only'});assert.equal(login.status,200);cookie=login.headers.get('Set-Cookie').split(';')[0];let before=(await (await req('/api/edit/state?client='+client)).json()).state,next=structuredClone(before);next.presets.push({id:'private-root',name:'Private root',scope:'prompt:welcome',values:{email:'private@example.test'}});before=await save(before,next);assert.equal(presetsForPrompt(before,before.prompts.find(p=>p.id==='review')).length,0);
  let p=before.prompts.find(p=>p.id==='welcome');const input=structuredClone(p.values),otherInput=structuredClone(before.prompts.find(p=>p.id==='review').values);let grant=await req('/api/edit/lease',{action:'acquire',document:p.id,client,baseVersion:await contentVersion(p)});assert.equal(grant.status,200);let token=(await grant.json()).token;next=structuredClone(before);p=next.prompts.find(p=>p.id==='welcome');movePromptPresets(next,p,'work');p.folder='work';before=await save(before,next,{welcome:token});assert(presetsForPrompt(before,before.prompts.find(p=>p.id==='review')).some(p=>p.id==='private-root'));assert.deepEqual(before.prompts.find(p=>p.id==='welcome').values,input);
  p=before.prompts.find(p=>p.id==='welcome');grant=await req('/api/edit/lease',{action:'acquire',document:p.id,client,baseVersion:await contentVersion(p)});assert.equal(grant.status,200);token=(await grant.json()).token;next=structuredClone(before);p=next.prompts.find(p=>p.id==='welcome');movePromptPresets(next,p,null);p.folder=null;before=await save(before,next,{welcome:token});const privateCopy=presetsForPrompt(before,before.prompts.find(p=>p.id==='welcome'))[0];assert(privateCopy);assert.notEqual(privateCopy.id,'private-root');assert.equal(privateCopy.scope,'prompt:welcome');assert.deepEqual(before.prompts.find(p=>p.id==='review').values,otherInput);
  const sealed=await (await req('/api/backup',before)).json();assert.equal(sealed.encrypted,true);const restored=await (await req('/api/backup/decrypt',sealed)).json();assert.deepEqual(restored,before);assert((await (await req('/api/history')).json()).items.length>0);
 }finally{await mf.dispose();}
});
