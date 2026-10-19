import {freshState,validateState} from './model.js';
import {sealWorkspace,unsealWorkspace} from './server-crypto.mjs';

export const CURRENT_KEY='workspace/current.json',HISTORY_PREFIX='workspace/history/',HISTORY_LIMIT=100;
const conflict=()=>Object.assign(Error('其他设备已修改工作区。请先导出本机备份，再读取云端最新内容。'),{status:409});
function decodeRecord(value,uploaded){
 if(value?.format===3&&value.current&&Array.isArray(value.history))return value;
 if(value?.v===2)return {format:3,current:value,history:[],savedAt:uploaded?.getTime()||Date.now()};
 throw Error('Unsupported workspace storage format');
}
function meaningful(state){return JSON.stringify({
 version:state.version,promptOrders:state.promptOrders||[],folders:state.folders.map(({open,...f})=>f),
 prompts:state.prompts.map(({updated,...p})=>p),
 bookmarkFolders:state.bookmarkFolders,bookmarks:state.bookmarks,
 presets:state.presets.map(({updated,...p})=>p)
});}
export async function readWorkspace(env){
 const object=await env.VAULTS.get(CURRENT_KEY);
 if(!object)return {state:freshState(),etag:'"new"',record:null};
 const record=decodeRecord(await object.json(),object.uploaded);
 return {state:validateState(await unsealWorkspace(record.current,env.DATA_KEY)),etag:object.httpEtag,record};
}
export async function saveWorkspace(env,input,revision,reason='edit'){
 const state=validateState(input),previous=await readWorkspace(env);
 if(previous.etag!==revision)throw conflict();
 const now=Date.now(),history=[...(previous.record?.history||[])];let candidate=null;
 const changed=previous.record&&meaningful(previous.state)!==meaningful(state);
 if(changed){
  const id=crypto.randomUUID();candidate={id,key:HISTORY_PREFIX+id+'.json',savedAt:previous.record.savedAt||now,archivedAt:now,reason,counts:{prompts:previous.state.prompts.length,folders:previous.state.folders.length,presets:previous.state.presets.length,bookmarks:previous.state.bookmarks.length}};
  await env.VAULTS.put(candidate.key,JSON.stringify(previous.record.current),{httpMetadata:{contentType:'application/json'}});
  history.unshift(candidate);
 }
 const dropped=history.splice(HISTORY_LIMIT);
 const record={format:3,current:await sealWorkspace(state,env.DATA_KEY),history,savedAt:changed||!previous.record?now:previous.record.savedAt};
 const result=await env.VAULTS.put(CURRENT_KEY,JSON.stringify(record),{httpMetadata:{contentType:'application/json'},onlyIf:revision==='"new"'?{etagDoesNotMatch:'*'}:{etagMatches:revision.replaceAll('"','')}});
 if(!result){if(candidate)await env.VAULTS.delete(candidate.key);throw conflict();}
 return {etag:result.httpEtag,state,historyCount:history.length,droppedKeys:dropped.map(x=>x.key)};
}
export async function listHistory(env){const {record,etag}=await readWorkspace(env);return {limit:HISTORY_LIMIT,currentSavedAt:record?.savedAt||null,etag,items:(record?.history||[]).map(({key,...item})=>item)};}
export async function readHistory(env,id){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(Error('修改记录不存在'),{status:404});
 const {record}=await readWorkspace(env),item=record?.history.find(x=>x.id===id);
 if(!item)throw Object.assign(Error('此记录已不在最近 100 次修改中'),{status:404});
 const snapshot=await env.VAULTS.get(item.key);
 if(!snapshot)throw Object.assign(Error('修改记录暂时无法读取'),{status:404});
 return {item:{...item,key:undefined},state:validateState(await unsealWorkspace(await snapshot.json(),env.DATA_KEY))};
}
export async function restoreHistory(env,id,revision){const {state}=await readHistory(env,id);return saveWorkspace(env,state,revision,'restore');}
export async function pruneHistory(env,droppedKeys=[]){
 if(droppedKeys.length)await env.VAULTS.delete(droppedKeys);
 // Remove abandoned candidates only after a grace period, so concurrent saves remain safe.
 const {record}=await readWorkspace(env),keep=new Set((record?.history||[]).map(x=>x.key));
 let cursor;do{const page=await env.VAULTS.list({prefix:HISTORY_PREFIX,limit:500,...(cursor?{cursor}:{})});const stale=page.objects.filter(x=>!keep.has(x.key)&&x.uploaded.getTime()<Date.now()-5*60*1000).map(x=>x.key);if(stale.length)await env.VAULTS.delete(stale);cursor=page.truncated?page.cursor:null;}while(cursor);
}
