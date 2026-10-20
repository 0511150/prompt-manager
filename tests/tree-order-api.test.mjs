import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {resolve} from 'node:path';
import {contentVersion,diffWorkspace} from '../src/edit-protocol.js';
import {sortedEntries,reorderEntry,treeOrderId} from '../src/tree-order.js';

test('mixed directory order persists without document leases and file moves still require ownership',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'tree-order-test',modules:true,scriptPath:resolve('dist/worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{AUTH_GUARD:{className:'AuthGuard',useSQLite:true},ACCESS_CONTROL:{className:'AccessControl',useSQLite:true},WORKSPACE_EDITOR:{className:'WorkspaceEditor',useSQLite:true}},r2Buckets:['VAULTS'],bindings:{ACCESS_PASSWORD:'local-tree-order-test-password'}}));
 const origin='https://tree-order.invalid';let cookie;const req=(path,body)=>mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const a=crypto.randomUUID(),b=crypto.randomUUID(),read=async client=>(await req('/api/edit/state?client='+client)).json();
 const save=(client,before,after,leases={})=>req('/api/edit/save',{client,changes:diffWorkspace(before,after),leases});
 try{
  const login=await req('/auth/login',{password:'local-tree-order-test-password'});assert.equal(login.status,200);cookie=login.headers.get('Set-Cookie').split(';')[0];const first=await read(a),file=first.state.prompts.find(p=>p.id==='email');
  const lease=await (await req('/api/edit/lease',{action:'acquire',client:a,document:'email',baseVersion:await contentVersion(file)})).json();
  const folders=structuredClone(first.state);reorderEntry(folders,null,'folder:work','folder:writing',false,await treeOrderId(null));assert.equal((await save(b,first.state,folders)).status,200);
  const latest=await read(a);assert(latest.locks.some(l=>l.id==='email'&&l.owned));assert.deepEqual(sortedEntries(latest.state,null).map(e=>e.key),['prompt:welcome','folder:work','folder:writing']);
  const moved=structuredClone(latest.state);moved.prompts.find(p=>p.id==='email').folder=null;reorderEntry(moved,null,'prompt:email','folder:work',true,await treeOrderId(null));
  assert.equal((await save(b,latest.state,moved)).status,423,'cross-folder moves keep per-file protection');
  assert.equal((await save(a,latest.state,moved,{email:lease.token})).status,200);
  const saved=await read(b);assert.deepEqual(sortedEntries(saved.state,null).map(e=>e.key),['prompt:welcome','folder:work','prompt:email','folder:writing']);assert.equal(saved.state.prompts.find(p=>p.id==='email').folder,null);
  const conflict=structuredClone(first.state);reorderEntry(conflict,null,'folder:writing','prompt:welcome',false,await treeOrderId(null));assert.equal((await save(b,first.state,conflict)).status,409,'same-level concurrent ordering cannot overwrite the new order');
  const history=await (await req('/api/history')).json();const previous=await (await req('/api/history/'+history.items[0].id)).json();assert.deepEqual(sortedEntries(previous.state,null).map(e=>e.key),['prompt:welcome','folder:work','folder:writing']);
 }finally{await mf.dispose();}
});
