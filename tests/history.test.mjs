import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState} from '../src/model.js';
import {sealWorkspace,unsealWorkspace} from '../src/server-crypto.mjs';
import {CURRENT_KEY,HISTORY_PREFIX,readWorkspace,saveWorkspace,listHistory,readHistory,restoreHistory,pruneHistory} from '../src/workspace-store.mjs';
class Bucket{
 objects=new Map();seq=0;beforeCurrentPut=null;
 async get(key){const row=this.objects.get(key);if(!row)return null;return {...row,json:async()=>JSON.parse(row.body)};}
 async put(key,body,options={}){if(key===CURRENT_KEY&&this.beforeCurrentPut)await this.beforeCurrentPut();const previous=this.objects.get(key),check=options.onlyIf;
  if(check?.etagDoesNotMatch==='*'&&previous)return null;
  if(check?.etagMatches&&previous?.etag!==check.etagMatches)return null;
  const etag=String(++this.seq),row={body,etag,httpEtag:'"'+etag+'"',uploaded:new Date()};this.objects.set(key,row);return row;
 }
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.objects.delete(key);}
 async list({prefix}){return {objects:[...this.objects].filter(([key])=>key.startsWith(prefix)).map(([key,row])=>({key,uploaded:row.uploaded})),truncated:false};}
}
const env=()=>({VAULTS:new Bucket(),DATA_KEY:btoa('d'.repeat(32))});
async function save(e,s,tag,reason){const result=await saveWorkspace(e,s,tag,reason);await pruneHistory(e,result.droppedKeys);return result;}

test('retains exactly 100 previous states and restores without losing the pre-restore state',async()=>{
 const e=env(),s=freshState();s.prompts[0].title='Edit 0';let tag=(await save(e,s,'"new"')).etag;
 for(let i=1;i<=105;i++){s.prompts[0].title='Edit '+i;tag=(await save(e,s,tag)).etag;}
 const h=await listHistory(e);assert.equal(h.limit,100);assert.equal(h.items.length,100);
 assert.equal((await readHistory(e,h.items[0].id)).state.prompts[0].title,'Edit 104');
 assert.equal((await readHistory(e,h.items.at(-1).id)).state.prompts[0].title,'Edit 5');
 assert.equal([...e.VAULTS.objects.keys()].filter(k=>k.startsWith(HISTORY_PREFIX)).length,100);
 const restored=await restoreHistory(e,h.items.at(-1).id,tag);await pruneHistory(e,restored.droppedKeys);
 assert.equal((await readWorkspace(e)).state.prompts[0].title,'Edit 5');
 const after=await listHistory(e);assert.equal(after.items.length,100);assert.equal(after.items[0].reason,'restore');
 assert.equal((await readHistory(e,after.items[0].id)).state.prompts[0].title,'Edit 105');
 for(const [key,row] of e.VAULTS.objects){assert(key===CURRENT_KEY||key.startsWith(HISTORY_PREFIX));assert(!row.body.includes('Edit 105'));}
});
test('UI navigation does not consume history; imported content does',async()=>{
 const e=env(),s=freshState();let tag=(await save(e,s,'"new"')).etag;
 s.active='review';s.tabs.push('review');s.folders[0].open=false;s.prompts[0].updated=Date.now()+100;
 tag=(await save(e,s,tag)).etag;assert.equal((await listHistory(e)).items.length,0);
 s.prompts[0].body='Imported prompt';tag=(await save(e,s,tag,'import')).etag;
 const h=await listHistory(e);assert.equal(h.items.length,1);assert.equal(h.items[0].reason,'import');
 assert.notEqual((await readHistory(e,h.items[0].id)).state.prompts[0].body,'Imported prompt');
 assert.equal((await readWorkspace(e)).state.prompts[0].body,'Imported prompt');
});
test('legacy v2 current object upgrades in place and retains the original content',async()=>{
 const e=env(),s=freshState(),legacy=await sealWorkspace(s,e.DATA_KEY);await e.VAULTS.put(CURRENT_KEY,JSON.stringify(legacy));
 const before=await readWorkspace(e);assert.deepEqual(before.state,s);
 const edited=structuredClone(s);edited.prompts[0].body='New content';await save(e,edited,before.etag);
 const h=await listHistory(e);assert.equal(h.items.length,1);assert.deepEqual((await readHistory(e,h.items[0].id)).state,s);
});
test('stale revisions and concurrent saves cannot overwrite current content or leave failed candidates',async()=>{
 const e=env(),s=freshState();let tag=(await save(e,s,'"new"')).etag;
 const a=structuredClone(s),b=structuredClone(s);a.prompts[0].title='A';b.prompts[0].title='B';
 let waiting=0,release;const barrier=new Promise(resolve=>{release=resolve;});
 e.VAULTS.beforeCurrentPut=async()=>{waiting++;if(waiting===2)release();await barrier;};
 const outcomes=await Promise.allSettled([saveWorkspace(e,a,tag),saveWorkspace(e,b,tag)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
 e.VAULTS.beforeCurrentPut=null;
 const h=await listHistory(e);assert.equal(h.items.length,1);
 assert.equal([...e.VAULTS.objects.keys()].filter(k=>k.startsWith(HISTORY_PREFIX)).length,1);
 await assert.rejects(restoreHistory(e,h.items[0].id,tag),e=>e.status===409);
 assert(['A','B'].includes((await readWorkspace(e)).state.prompts[0].title));
});
test('cleanup removes abandoned history only, never current data or newly written candidates',async()=>{
 const e=env(),s=freshState();await save(e,s,'"new"');
 const old=HISTORY_PREFIX+'abandoned.json',fresh=HISTORY_PREFIX+'in-flight.json';
 await e.VAULTS.put(old,'{}');e.VAULTS.objects.get(old).uploaded=new Date(Date.now()-3600000);
 await e.VAULTS.put(fresh,'{}');await pruneHistory(e);
 assert(!e.VAULTS.objects.has(old));assert(e.VAULTS.objects.has(fresh));assert(e.VAULTS.objects.has(CURRENT_KEY));
});
