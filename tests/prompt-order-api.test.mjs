import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {resolve} from 'node:path';
import {contentVersion,diffWorkspace,comparable} from '../src/edit-protocol.js';
import {promptOrderId,reorderPrompt,sortedPrompts} from '../src/prompt-order.js';

test('sorting persists independently of a document lease and is recoverable from encrypted history',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'order-test',modules:true,scriptPath:resolve('dist/worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{AUTH_GUARD:{className:'AuthGuard',useSQLite:true},ACCESS_CONTROL:{className:'AccessControl',useSQLite:true},WORKSPACE_EDITOR:{className:'WorkspaceEditor',useSQLite:true}},r2Buckets:['VAULTS'],bindings:{ACCESS_PASSWORD:'local-order-test-password'}}));
 const origin='https://order.invalid';let cookie;
 const req=(path,body)=>mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const read=async client=>{const response=await req('/api/edit/state?client='+client);assert.equal(response.status,200);return response.json();};
 const save=async(client,before,after)=>{const response=await req('/api/edit/save',{client,changes:diffWorkspace(before,after),leases:{}});return response;};
 try{
  const login=await req('/auth/login',{password:'local-order-test-password'});assert.equal(login.status,200);cookie=login.headers.get('Set-Cookie').split(';')[0];
  const a=crypto.randomUUID(),b=crypto.randomUUID(),first=await read(a),file=first.state.prompts.find(p=>p.id==='study');
  const lease=await req('/api/edit/lease',{action:'acquire',client:a,document:file.id,baseVersion:await contentVersion(file)});assert.equal(lease.status,200);
  const sorted=structuredClone(first.state);reorderPrompt(sorted,'work','study','review',false,await promptOrderId('work'));
  const saved=await save(b,first.state,sorted);assert.equal(saved.status,200,await saved.clone().text());
  const latest=await read(a);assert.deepEqual(sortedPrompts(latest.state,'work').map(p=>p.id),['study','review']);assert(latest.locks.some(l=>l.id===file.id&&l.owned),'metadata sorting does not release a document lease');assert.deepEqual(latest.state.prompts.map(p=>comparable('prompts',p)),first.state.prompts.map(p=>comparable('prompts',p)));
  assert.equal((await save(b,first.state,sorted)).status,200,'sort retries are idempotent');
  const conflicting=structuredClone(first.state);conflicting.promptOrders.push({id:await promptOrderId('work'),folder:'work',ids:['review','study']});assert.equal((await save(b,first.state,conflicting)).status,409);
  const independent=structuredClone(first.state);independent.promptOrders.push({id:await promptOrderId('writing'),folder:'writing',ids:['email']});assert.equal((await save(b,first.state,independent)).status,200,'another folder order merges with concurrent sorting');
  const history=await (await req('/api/history')).json();assert.equal(history.items.length,1);const archived=await (await req('/api/history/'+history.items[0].id)).json();assert.deepEqual(sortedPrompts(archived.state,'work').map(p=>p.id),['study','review']);
  const bucket=await mf.getR2Bucket('VAULTS');for(const object of (await bucket.list()).objects){assert(object.key==='workspace/current.json'||object.key.startsWith('workspace/history/'));assert(!(await (await bucket.get(object.key)).text()).includes('promptOrders'));}
 }finally{await mf.dispose();}
});
