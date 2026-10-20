import {sortedPrompts,promptFolder,promptOrderId} from './prompt-order.js';
export const entryKey=(kind,id)=>kind+':'+id;
export function entryParent(state,key){const [kind,id]=key.split(':');return kind==='folder'?state.folders.find(f=>f.id===id)?.parent:promptFolder(state,state.prompts.find(p=>p.id===id)||{});}
export function sortedEntries(state,parent){
 const folders=state.folders.filter(f=>f.parent===parent).map(item=>({kind:'folder',item,key:entryKey('folder',item.id)})),prompts=sortedPrompts(state,parent).map(item=>({kind:'prompt',item,key:entryKey('prompt',item.id)}));
 const entries=parent===null?[...prompts,...folders]:[...folders,...prompts],rank=new Map((state.treeOrders?.find(o=>o.parent===parent)?.keys||[]).map((key,index)=>[key,index]));
 return entries.sort((a,b)=>(rank.get(a.key)??Infinity)-(rank.get(b.key)??Infinity));
}
export const treeOrderId=async parent=>'tree-'+await promptOrderId(parent);
export function canMoveEntry(state,key,parent){
 const [kind,id]=key.split(':');if(!['folder','prompt'].includes(kind)||!(kind==='folder'?state.folders:state.prompts).some(item=>item.id===id)||parent!==null&&!state.folders.some(f=>f.id===parent))return false;
 if(kind==='folder'){const seen=new Set();let current=parent;while(current!==null){if(current===id||seen.has(current))return false;seen.add(current);current=state.folders.find(f=>f.id===current)?.parent??null;}}
 return true;
}
export function reorderEntry(state,parent,source,target,after,id){
 const keys=sortedEntries(state,parent).map(entry=>entry.key);if(!keys.includes(source)||source===target||target&&!keys.includes(target))return false;
 const next=keys.filter(key=>key!==source);next.splice(target?next.indexOf(target)+(after?1:0):next.length,0,source);if(JSON.stringify(next)===JSON.stringify(keys))return false;
 state.treeOrders??=[];const order=state.treeOrders.find(o=>o.parent===parent);if(order)order.keys=next;else state.treeOrders.push({id,parent,keys:next});return true;
}
export function normalizeTreeOrders(state){
 const parents=new Map([...state.folders.map(f=>[entryKey('folder',f.id),f.parent]),...state.prompts.map(p=>[entryKey('prompt',p.id),promptFolder(state,p)])]);
 state.treeOrders=(state.treeOrders||[]).filter(o=>o.parent===null||state.folders.some(f=>f.id===o.parent));for(const order of state.treeOrders)order.keys=order.keys.filter(key=>parents.has(key)&&parents.get(key)===order.parent);return state;
}
