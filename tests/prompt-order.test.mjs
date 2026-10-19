import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,validateState} from '../src/model.js';
import {contentVersion,diffWorkspace,overlayChanges} from '../src/edit-protocol.js';
import {promptOrderId,reorderPrompt,sortedPrompts,normalizePromptOrders} from '../src/prompt-order.js';

test('folder sorting changes metadata only and keeps document leases valid',async()=>{
 const state=freshState(),before=structuredClone(state),version=await contentVersion(state.prompts.find(p=>p.id==='study'));
 const id=await promptOrderId('work');assert.equal(id,await promptOrderId('work'));assert.notEqual(id,await promptOrderId(null));
 assert(reorderPrompt(state,'work','study','review',false,id));
 assert.deepEqual(sortedPrompts(state,'work').map(p=>p.id),['study','review']);
 assert.deepEqual(sortedPrompts(state,'writing').map(p=>p.id),['email']);
 assert.deepEqual(sortedPrompts(state,null).map(p=>p.id),['welcome']);
 assert.equal(await contentVersion(state.prompts.find(p=>p.id==='study')),version);
 const changes=diffWorkspace(before,state);assert.equal(changes.length,1);assert.equal(changes[0].group,'promptOrders');
 assert.deepEqual(overlayChanges(before,changes),state);
 assert.equal(reorderPrompt(state,'work','study','review',false,id),false);
 assert.equal(reorderPrompt(state,'work','study','study',true,id),false);
 assert(reorderPrompt(state,'work','study',null,true,id));
 assert.deepEqual(sortedPrompts(state,'work').map(p=>p.id),['review','study']);
});

test('legacy backups load and sorting survives local export/import, moves and deletion',async()=>{
 const state=freshState();delete state.promptOrders;assert.deepEqual(validateState(state).promptOrders,[]);
 const old=structuredClone(state);delete old.promptOrders;assert.deepEqual(diffWorkspace(old,state),[]);
 reorderPrompt(state,'work','study','review',false,await promptOrderId('work'));
 assert.deepEqual(sortedPrompts(validateState(JSON.parse(JSON.stringify(state))),'work').map(p=>p.id),['study','review']);
 state.prompts.push({...structuredClone(state.prompts[0]),id:'newfile',folder:'work'});
 assert.deepEqual(sortedPrompts(state,'work').map(p=>p.id),['study','review','newfile']);
 state.prompts.find(p=>p.id==='study').folder='writing';normalizePromptOrders(state);
 assert.deepEqual(state.promptOrders[0].ids,['review']);
 state.prompts=state.prompts.filter(p=>p.id!=='review');normalizePromptOrders(state);assert.deepEqual(state.promptOrders[0].ids,[]);
 state.folders=state.folders.filter(f=>f.id!=='work');normalizePromptOrders(state);assert.deepEqual(state.promptOrders,[]);
});

test('import rejects malformed, duplicate or excessive ordering metadata',()=>{
 for(const orders of [null,{},[{id:'bad!',folder:null,ids:[]}],[{id:'order',folder:null,ids:['welcome','welcome']}],[{id:'order',folder:null,ids:['bad!']}],[{id:'a',folder:null,ids:[]},{id:'b',folder:null,ids:[]}]]){
  const state=freshState();state.promptOrders=orders;
  // A missing/null optional field is an older backup, but malformed records are rejected.
  if(orders===null)assert.deepEqual(validateState(state).promptOrders,[]);else assert.throws(()=>validateState(state),/排序/);
 }
});
