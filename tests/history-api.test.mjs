import {test} from 'node:test';
import assert from 'node:assert/strict';
test('authenticated R2 history API previews, restores and preserves the state before restore',async()=>{
 const base='http://127.0.0.1:8787',headers={Origin:base,'Content-Type':'application/json'};
 const login=await fetch(base+'/auth/login',{method:'POST',headers,body:JSON.stringify({password:'local-integration-password-only'})});assert.equal(login.status,200);
 const auth={...headers,Cookie:login.headers.get('Set-Cookie').split(';')[0]};
 const read=await fetch(base+'/api/workspace',{headers:auth});let tag=read.headers.get('ETag');const original=await read.json(),s=structuredClone(original);
 for(const title of ['History API A','History API B']){s.prompts[0].title=title;const save=await fetch(base+'/api/workspace',{method:'PUT',headers:{...auth,'X-Workspace-Revision':tag},body:JSON.stringify(s)});assert.equal(save.status,200,await save.text());tag=save.headers.get('ETag');}
 const history=await (await fetch(base+'/api/history',{headers:auth})).json();assert(history.items.length>0);assert.equal(history.limit,100);
 const selected=history.items[0];const preview=await (await fetch(base+'/api/history/'+selected.id,{headers:auth})).json();assert.equal(preview.state.prompts[0].title,'History API A');
 const restore=await fetch(base+'/api/history/'+selected.id+'/restore',{method:'POST',headers:{...auth,'X-Workspace-Revision':tag}});assert.equal(restore.status,200,await restore.clone().text());assert.equal((await restore.json()).state.prompts[0].title,'History API A');tag=restore.headers.get('ETag');
 const after=await (await fetch(base+'/api/history',{headers:auth})).json();assert.equal(after.items[0].reason,'restore');const prior=await (await fetch(base+'/api/history/'+after.items[0].id,{headers:auth})).json();assert.equal(prior.state.prompts[0].title,'History API B');
 const reset=await fetch(base+'/api/workspace',{method:'PUT',headers:{...auth,'X-Workspace-Revision':tag},body:JSON.stringify(original)});assert.equal(reset.status,200);
 await fetch(base+'/auth/logout',{method:'POST',headers:auth});
 assert.equal((await fetch(base+'/api/history',{headers:auth})).status,401);
});
