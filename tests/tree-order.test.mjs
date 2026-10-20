import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,validateState} from '../src/model.js';
import {contentVersion,diffWorkspace} from '../src/edit-protocol.js';
import {sortedEntries,reorderEntry,treeOrderId,canMoveEntry,normalizeTreeOrders} from '../src/tree-order.js';
import {resolveTreeDrop} from '../src/tree-drop.js';

test('mixed sibling ordering puts files between folders and reorders folders without changing documents',async()=>{
 const state=validateState(freshState()),before=structuredClone(state),version=await contentVersion(state.prompts[0]);
 assert(reorderEntry(state,null,'folder:work','folder:writing',false,await treeOrderId(null)));
 assert.deepEqual(sortedEntries(state,null).map(e=>e.key),['prompt:welcome','folder:work','folder:writing']);
 assert(reorderEntry(state,null,'prompt:welcome','folder:work',true,await treeOrderId(null)));
 assert.deepEqual(sortedEntries(state,null).map(e=>e.key),['folder:work','prompt:welcome','folder:writing']);
 assert.equal(await contentVersion(state.prompts[0]),version);assert(diffWorkspace(before,state).every(c=>c.group==='treeOrders'));
 assert.deepEqual(sortedEntries(validateState(JSON.parse(JSON.stringify(state))),null).map(e=>e.key),['folder:work','prompt:welcome','folder:writing']);
 state.prompts.find(p=>p.id==='email').folder=null;reorderEntry(state,null,'prompt:email','folder:work',false,await treeOrderId(null));normalizeTreeOrders(state);
 assert.equal(sortedEntries(state,null)[0].key,'prompt:email');assert.equal(reorderEntry(state,null,'folder:work','folder:work',true,await treeOrderId(null)),false);
});

test('folder moves reject cycles and legacy backups preserve their original layout',()=>{
 const state=freshState();state.folders.push({id:'child',parent:'writing',name:'Child',open:true});assert(canMoveEntry(state,'folder:child',null));assert(!canMoveEntry(state,'folder:writing','child'));assert(!canMoveEntry(state,'folder:writing','writing'));assert(!canMoveEntry(state,'folder:work','missing'));
 const legacy=validateState(state);assert.deepEqual(legacy.treeOrders,[]);assert.deepEqual(sortedEntries(legacy,null).map(e=>e.key),['prompt:welcome','folder:writing','folder:work']);
 for(const treeOrders of [[{id:'a',parent:null,keys:['wrong:welcome']}],[{id:'a',parent:null,keys:['folder:writing','folder:writing']}],[{id:'a',parent:null,keys:[]},{id:'b',parent:null,keys:[]}]])assert.throws(()=>validateState({...freshState(),treeOrders}),/目录排序/);
});

test('drop hit testing handles root outdent, folder gaps, first-file insertion and file gaps as lines',()=>{
 const folder=(id,top,bottom)=>({key:'folder:'+id,kind:'folder',id,top,headerBottom:top+30,bottom,left:10,header:id});
 const root={parent:null,depth:0,root:true,top:10,bottom:260,left:10,right:220,entries:[folder('a',10,100),folder('b',120,240)]};
 const child={parent:'a',depth:1,top:40,bottom:100,left:34,right:220,entries:[{key:'prompt:p1',kind:'prompt',id:'p1',top:45,headerBottom:65,bottom:65,left:34},{key:'prompt:p2',kind:'prompt',id:'p2',top:75,headerBottom:95,bottom:95,left:34}]};
 const levels=[root,child];
 const out=resolveTreeDrop(levels,15,90);assert.equal(out.parent,null);assert.equal(out.target,'folder:a');assert(out.after);assert(!out.inside);
 const gap=resolveTreeDrop(levels,50,110);assert.equal(gap.parent,null);assert.equal(gap.target,'folder:b');assert(!gap.after);assert.equal(gap.lineY,120);
 const first=resolveTreeDrop(levels,50,42);assert.equal(first.parent,'a');assert.equal(first.target,'prompt:p1');assert(!first.after);assert.equal(first.lineY,45);
 const between=resolveTreeDrop(levels,50,70);assert.equal(between.parent,'a');assert.equal(between.target,'prompt:p2');assert(!between.after);assert.equal(between.lineY,75);
 assert.equal(resolveTreeDrop(levels,50,22).parent,'a');assert(resolveTreeDrop(levels,50,22).inside);
 assert(!resolveTreeDrop(levels,15,5).inside);assert.equal(resolveTreeDrop(levels,15,5).lineY,10);
});
