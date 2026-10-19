import {DurableObject} from 'cloudflare:workers';
import {readWorkspace,saveWorkspace,restoreHistory,readHistory,pruneHistory} from './workspace-store.mjs';
import {validateState} from './model.js';
import {DEFAULT_IDLE_SECONDS,MAX_IDLE_SECONDS,validIdleSeconds,LEASE_TTL_MS,validEditId,contentVersion,sameItem,diffWorkspace,putItem,validateChanges} from './edit-protocol.js';

const fail=(status,message,details={})=>Object.assign(Error(message),{status,details});
// One coordinator per workspace. Leases are independent rows per document;
// only the short R2 snapshot commits are serialized, never the editing sessions.
export class WorkspaceEditor extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.queue=Promise.resolve();ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS edit_lease (document TEXT PRIMARY KEY, client TEXT NOT NULL, session TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL)');ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS editor_settings (id INTEGER PRIMARY KEY, idle_seconds INTEGER NOT NULL)');}
 settings(){const row=this.ctx.storage.sql.exec('SELECT idle_seconds FROM editor_settings WHERE id=1').toArray()[0];return {idleSeconds:row?.idle_seconds??DEFAULT_IDLE_SECONDS};}
 updateSettings(input){return this.run(()=>{if(!validIdleSeconds(input?.idleSeconds))throw fail(400,`锁定时间请输入 1–${MAX_IDLE_SECONDS} 之间的整数，单位为秒`);this.ctx.storage.sql.exec('INSERT OR REPLACE INTO editor_settings(id,idle_seconds) VALUES(1,?)',input.idleSeconds);return this.settings();});}
 run(task){const result=this.queue.then(async()=>{try{return await task();}catch(error){return {status:error.status||500,error:error.status?error.message:'保存暂时不可用，请稍后重试',...error.details};}});this.queue=result.then(()=>{});return result;}
 async workspaceEnv(){const credentials=await this.env.ACCESS_CONTROL.getByName('workspace-access').getCredentials();if(!credentials)throw fail(503,'访问密码尚未配置');return {...this.env,...credentials};}
 lease(id){return this.ctx.storage.sql.exec('SELECT * FROM edit_lease WHERE document=?',id).toArray()[0];}
 owns(row,owner,token){return row&&row.client===owner.client&&row.session===owner.session&&row.token===token&&row.expires>Date.now();}
 releaseOwned(id,owner,token){const row=this.lease(id);if(row&&row.client===owner.client&&row.session===owner.session&&row.token===token)this.ctx.storage.sql.exec('DELETE FROM edit_lease WHERE document=?',id);}
 async scope(env){return contentVersion({id:'workspace',key:env.DATA_KEY});}
 snapshot(owner){return this.run(async()=>{const env=await this.workspaceEnv(),snapshot=await readWorkspace(env);this.ctx.storage.sql.exec('DELETE FROM edit_lease WHERE expires<=?',Date.now());const locks=this.ctx.storage.sql.exec('SELECT document,client,session,expires FROM edit_lease').toArray().map(row=>({id:row.document,until:row.expires,owned:row.client===owner.client&&row.session===owner.session}));return {state:snapshot.state,etag:snapshot.etag,workspaceId:await this.scope(env),locks,settings:this.settings()};});}
 edit(action,id,owner,token,baseVersion){return this.run(async()=>{
  if(!validEditId(id))throw fail(400,'文件标识无效');
  const row=this.lease(id),now=Date.now();
  if(action==='release'){this.releaseOwned(id,owner,token);return {ok:true};}
  if(action==='renew'){if(!this.owns(row,owner,token))throw fail(423,'编辑权已到期，请重新取得编辑权',{document:id});const until=now+LEASE_TTL_MS;this.ctx.storage.sql.exec('UPDATE edit_lease SET expires=? WHERE document=?',until,id);return {ok:true,until};}
  if(action!=='acquire')throw fail(400,'不支持的编辑操作');
  if(row&&row.expires>now&&(row.client!==owner.client||row.session!==owner.session))throw fail(423,'另一处正在编辑此文件，请稍后重试',{document:id,until:row.expires});
  const env=await this.workspaceEnv(),{state}=await readWorkspace(env),document=state.prompts.find(p=>p.id===id)||null,version=await contentVersion(document);
  if(baseVersion!==version)throw fail(409,'此文件已有新版本。本地修改已保留，请先处理版本冲突',{document:id});
  const nextToken=this.owns(row,owner,token)?token:crypto.randomUUID(),until=Date.now()+LEASE_TTL_MS;
  this.ctx.storage.sql.exec('INSERT OR REPLACE INTO edit_lease(document,client,session,token,expires) VALUES(?,?,?,?,?)',id,owner.client,owner.session,nextToken,until);
  return {ok:true,token:nextToken,until,version};
 });}
 save(input,owner){return this.run(async()=>{
  const changes=validateChanges(input?.changes),proofs=input?.leases||{};if(input?.reason&&!['edit','import'].includes(input.reason))throw fail(400,'保存类型无效');
  const env=await this.workspaceEnv();
  for(let attempt=0;attempt<3;attempt++){
   const previous=await readWorkspace(env),next=structuredClone(previous.state);
   for(const change of changes){const current=next[change.group].find(item=>item.id===change.id)||null;if(sameItem(change.group,current,change.after))continue;
    if(!sameItem(change.group,current,change.before))throw fail(409,change.group==='prompts'?'此文件已有新版本，本地草稿不会覆盖云端':'其他位置已修改同一项设置，请先保留本地备份再读取云端',{document:change.group==='prompts'?change.id:null,group:change.group});
    if(change.group==='prompts'&&!this.owns(this.lease(change.id),owner,proofs[change.id]))throw fail(423,'保存前需要重新取得此文件的编辑权',{document:change.id});
    putItem(next,change.group,change.id,change.after);
   }
   next.tabs=next.tabs.filter(id=>next.prompts.some(p=>p.id===id));if(!next.tabs.includes(next.active))next.active=next.tabs[0]||null;
   try{validateState(next);}catch{throw fail(400,'修改后的工作区格式无效');}
   let result;
   try{result=diffWorkspace(previous.state,next).length?await saveWorkspace(env,next,previous.etag,input.reason||'edit'):{...previous,historyCount:previous.record?.history.length||0,droppedKeys:[]};}
   catch(error){if(error.status===409&&attempt<2)continue;throw error;}
   for(const change of changes)if(change.group==='prompts')this.releaseOwned(change.id,owner,proofs[change.id]);
   this.ctx.waitUntil(pruneHistory(env,result.droppedKeys).catch(()=>console.error(JSON.stringify({event:'history_cleanup_deferred'}))));
   return {ok:true,state:next,etag:result.etag,historyCount:result.historyCount};
  }
 });}
 // Older open tabs and whole-workspace restores must also respect active leases.
 replace(input,revision,reason='edit',historyId=null){return this.run(async()=>{
  const env=await this.workspaceEnv(),previous=await readWorkspace(env);if(previous.etag!==revision)throw fail(409,'其他位置已更新工作区，请先读取最新内容');
  let next;try{next=historyId?(await readHistory(env,historyId)).state:validateState(input);}catch(error){throw fail(error.status||400,error.status?error.message:'工作区内容无效');}
  for(const change of diffWorkspace(previous.state,next).filter(x=>x.group==='prompts')){const row=this.lease(change.id);if(row?.expires>Date.now())throw fail(423,'有文件正在其他位置编辑，请等待保存并解锁后再导入或恢复',{document:change.id});}
  const result=historyId?await restoreHistory(env,historyId,revision):await saveWorkspace(env,next,revision,reason);
  this.ctx.waitUntil(pruneHistory(env,result.droppedKeys).catch(()=>console.error(JSON.stringify({event:'history_cleanup_deferred'}))));return {ok:true,state:result.state,etag:result.etag,historyCount:result.historyCount};
 });}
}
