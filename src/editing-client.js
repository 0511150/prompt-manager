import {EDIT_IDLE_MS,HEARTBEAT_MS,contentVersion,diffWorkspace,overlayChanges,putItem,sameItem,validateChanges} from './edit-protocol.js';
import {LocalDrafts} from './local-drafts.js';

export class EditingClient{
 constructor({request,getState,setState,onStatus=()=>{},onChange=()=>{},drafts=new LocalDrafts(),now=()=>Date.now(),online=()=>navigator.onLine,pause=()=>false,timers=globalThis}){
  Object.assign(this,{request,getState,setState,onStatus,onChange,drafts,now,online,pause,timers});this.client=crypto.randomUUID();this.base=null;this.scope=null;this.etag=null;this.leases=new Map();this.remoteLocks=new Map();this.problems=new Map();this.activity=new Map();this.lastAfter=new Map();this.acquiring=new Map();this.recovered=new Set();this.offline=!online();this.authExpired=false;this.localError=false;this.draftRecords=[];this.persistQueue=Promise.resolve();this.retryAfter=0;this.reason='edit';this.remoteGeneration=0;
 }
 get changes(){return this.base?diffWorkspace(this.base,this.getState()):[];}
 get dirty(){return this.changes.length>0;}
 get conflicted(){return this.metadataConflict||[...this.problems.values()].some(value=>value==='conflict');}
 notify(){this.onChange();}
 status(message,type=''){this.onStatus(message,type);this.notify();}
 async boot(){const remote=await this.request('/api/edit/state?client='+this.client).then(r=>r.json());this.base=structuredClone(remote.state);this.scope=remote.workspaceId;this.etag=remote.etag;this.restoreView(remote.state);this.setState(remote.state);this.setLocks(remote.locks);this.offline=false;await this.readDrafts();this.status('已同步到 R2','ok');this.heartbeat=this.timers.setInterval(()=>{void this.tick();},HEARTBEAT_MS);}
 rememberView(){try{const state=this.getState();globalThis.localStorage?.setItem('prompt-view-'+this.scope,JSON.stringify({tabs:state.tabs,active:state.active,folders:Object.fromEntries(state.folders.map(f=>[f.id,f.open]))}));}catch{/* Navigation still works if browser preferences cannot be stored. */}}
 restoreView(state){try{const view=JSON.parse(globalThis.localStorage?.getItem('prompt-view-'+this.scope)||'null');if(!view)return;if(Array.isArray(view.tabs))state.tabs=view.tabs.filter(id=>state.prompts.some(p=>p.id===id));if(state.tabs.includes(view.active))state.active=view.active;else state.active=state.tabs[0]||null;for(const folder of state.folders)if(typeof view.folders?.[folder.id]==='boolean')folder.open=view.folders[folder.id];}catch{/* Ignore invalid browser preferences. */}}
 dispose(){this.timers.clearTimeout(this.saveTimer);this.timers.clearInterval(this.heartbeat);}
 setLocks(locks){this.remoteLocks=new Map((locks||[]).map(lock=>[lock.id,lock]));}
 owned(id){return this.leases.get(id)?.until>this.now();}
 editable(id){return !this.committing?.has(id)&&!this.authExpired&&this.problems.get(id)!=='conflict'&&(this.offline||this.owned(id));}
 async readDrafts(){try{this.draftRecords=await this.drafts.list(this.scope);this.localError=false;}catch{this.localError=true;}this.notify();}
 persist(){
  if(!this.scope)return Promise.resolve();const changes=this.changes,record={id:this.client,scope:this.scope,savedAt:this.now(),changes:structuredClone(changes),reason:this.reason};
  this.persistQueue=this.persistQueue.catch(()=>{}).then(async()=>{try{if(record.changes.length)await this.drafts.put(record);else{await this.drafts.remove(this.client);for(const id of this.recovered)await this.drafts.remove(id);this.recovered.clear();}this.localError=false;await this.readDrafts();}catch{this.localError=true;this.status('本地草稿未写入 · 请下载备份','error');}});return this.persistQueue;
 }
 changed(reason='edit'){
  this.rememberView();this.reason=reason==='import'?'import':this.reason;const now=this.now(),changes=this.changes,nextAfter=new Map();
  for(const change of changes){const key=change.group+':'+change.id,value=JSON.stringify(change.after);nextAfter.set(key,value);if(this.lastAfter.get(key)!==value){if(change.group==='prompts')this.activity.set(change.id,now);else this.metadataDue=now+850;}}
  this.lastAfter=nextAfter;void this.persist();this.status(this.offline?'离线 · 已保留本地草稿':changes.length?'本地草稿 · 空闲两分钟后保存':'已同步到 R2',changes.length?'':'ok');this.schedule();
 }
 schedule(){this.timers.clearTimeout(this.saveTimer);if(!this.base)return;const changes=this.changes,prompts=changes.filter(x=>x.group==='prompts'),times=prompts.filter(x=>this.problems.get(x.id)!=='conflict').map(x=>(this.activity.get(x.id)??this.now())+EDIT_IDLE_MS);for(const [id,lease]of this.leases)if(!prompts.some(x=>x.id===id))times.push((this.activity.get(id)??lease.started)+EDIT_IDLE_MS);if(!prompts.length&&changes.length&&!this.metadataConflict)times.push(this.metadataDue||this.now()+850);if(times.length&&!this.offline&&!this.authExpired)this.saveTimer=this.timers.setTimeout(()=>{void this.flush({all:false});},Math.max(50,Math.min(...times)-this.now(),this.retryAfter-this.now()));}
 async leaseRequest(action,id,token,baseVersion){return (await this.request('/api/edit/lease',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,document:id,client:this.client,token,baseVersion})})).json();}
 failure(error,id){
  if(error.status===401){this.authExpired=true;this.leases.clear();this.status('登录已过期 · 草稿保留在本机','error');}
  else if(error.status===409){if(error.data?.document||id)this.problems.set(error.data?.document||id,'conflict');else this.metadataConflict=true;this.status('版本冲突 · 本地草稿已保留','error');}
  else if(error.status===423){const document=error.data?.document||id;this.leases.delete(document);this.remoteLocks.set(document,{id:document,owned:false,until:error.data?.until||this.now()+HEARTBEAT_MS});this.status('此文件在其他位置编辑 · 本地草稿已保留','error');}
  else if(!error.status){this.offline=true;this.status(this.localError?'离线 · 本地草稿存储不可用':'离线 · 修改保留为本地草稿');}
  else this.status(error.message||'保存失败 · 本地草稿已保留','error');
  this.retryAfter=this.now()+HEARTBEAT_MS;this.notify();
 }
 async startEdit(id,{touch=true}={}){
  if(this.committing?.has(id))await this.saving;
  if(this.problems.get(id)==='conflict'||this.authExpired)return false;
  if(!this.online()){this.offline=true;this.notify();return true;}
  if(this.owned(id)){if(touch)this.activity.set(id,this.now());this.schedule();return true;}
  if(this.acquiring.has(id))return this.acquiring.get(id);
  const task=(async()=>{try{const before=this.base.prompts.find(p=>p.id===id)||null,result=await this.leaseRequest('acquire',id,this.leases.get(id)?.token,await contentVersion(before));this.leases.set(id,{...result,started:this.now()});if(touch||!this.activity.has(id))this.activity.set(id,this.now());this.remoteLocks.delete(id);this.offline=false;this.status('正在编辑 · 空闲两分钟后保存');this.schedule();return true;}catch(error){this.failure(error,id);if(error.status===409)await this.refresh().catch(()=>{});return this.offline&&!this.authExpired&&this.problems.get(id)!=='conflict';}finally{this.acquiring.delete(id);this.notify();}})();this.acquiring.set(id,task);this.notify();return task;
 }
 rebase(remote,sent=[]){
  const local=this.getState(),pending=[];
  for(const change of this.changes){const actual=remote[change.group].find(x=>x.id===change.id)||null,acknowledged=sent.find(x=>x.group===change.group&&x.id===change.id);if(sameItem(change.group,actual,change.after)||acknowledged&&sameItem(change.group,change.after,acknowledged.after))continue;pending.push(acknowledged?{...change,before:actual}:change);}
  const next=overlayChanges(remote,pending),base=structuredClone(remote);this.metadataConflict=false;
  for(const id of [...this.problems.keys()])if(!pending.some(x=>x.group==='prompts'&&x.id===id))this.problems.delete(id);
  for(const change of pending){const actual=remote[change.group].find(x=>x.id===change.id)||null;if(!sameItem(change.group,actual,change.before)&&!sameItem(change.group,actual,change.after)){if(change.group==='prompts')this.problems.set(change.id,'conflict');else this.metadataConflict=true;}else if(change.group==='prompts')this.problems.delete(change.id);putItem(base,change.group,change.id,change.before);}
  next.tabs=local.tabs.filter(id=>next.prompts.some(p=>p.id===id));next.active=next.prompts.some(p=>p.id===local.active)?local.active:next.tabs[0]||null;for(const f of next.folders){const old=local.folders.find(x=>x.id===f.id);if(old)f.open=old.open;}
  const changed=JSON.stringify(next)!==JSON.stringify(local);this.base=base;if(changed)this.setState(next);this.notify();
 }
 async refresh(){if(!this.base)return;const generation=this.remoteGeneration;try{const remote=await (await this.request('/api/edit/state?client='+this.client)).json();if(generation!==this.remoteGeneration)return null;this.offline=false;this.authExpired=false;this.etag=remote.etag;this.setLocks(remote.locks);this.rebase(remote.state);await this.persist();return remote;}catch(error){this.failure(error);throw error;}}
 async release(id){const lease=this.leases.get(id);if(!lease)return;try{await this.leaseRequest('release',id,lease.token);}catch{/* Expiry releases a lease if the connection is gone. */}finally{this.leases.delete(id);this.notify();}}
 async flush({all=true,ids=null}={}){
  this.timers.clearTimeout(this.saveTimer);if(this.saving){await this.saving;if(all&&this.dirty)return this.flush({all,ids});return;}
  if(this.pause()){this.retryAfter=this.now()+1000;this.schedule();return;}
  if(!this.online()||this.offline){await this.persist();this.status('离线 · 修改保留为本地草稿');return;}
  const task=(async()=>{
   const now=this.now(),pending=this.changes,promptChanges=pending.filter(x=>x.group==='prompts'),eligible=promptChanges.filter(x=>(!ids||ids.includes(x.id))&&(all||now-(this.activity.get(x.id)??now)>=EDIT_IDLE_MS)&&this.problems.get(x.id)!=='conflict');
   // Keep structural changes together with their document moves/deletions.
   const changes=[...eligible,...(!this.metadataConflict&&eligible.length===promptChanges.length&&!ids?pending.filter(x=>x.group!=='prompts'):[])];
   if(changes.length&&!this.authExpired){
    for(const change of eligible)if(!await this.startEdit(change.id,{touch:false}))return;
    const leases=Object.fromEntries(eligible.map(x=>[x.id,this.leases.get(x.id)?.token]));this.committing=new Set(eligible.map(x=>x.id));this.remoteGeneration++;this.status('正在保存至 R2…');
    try{const result=await (await this.request('/api/edit/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client:this.client,changes,leases,reason:this.reason})})).json();this.remoteGeneration++;this.etag=result.etag;for(const change of eligible){this.leases.delete(change.id);this.problems.delete(change.id);}this.rebase(result.state,changes);if(!this.dirty){this.reason='edit';this.metadataConflict=false;}await this.persist();this.status(this.dirty?'还有本地草稿待保存':'已保存并解锁','ok');}
    catch(error){this.failure(error);await this.persist();if(error.status===409)await this.refresh().catch(()=>{});}
    finally{this.committing=null;}
   }
   for(const [id,lease]of [...this.leases])if(!this.changes.some(x=>x.group==='prompts'&&x.id===id)&&(all||now-(this.activity.get(id)??lease.started)>=EDIT_IDLE_MS))await this.release(id);
   if(!this.dirty&&!this.authExpired)this.status('已同步 · 文件已解锁','ok');
  })();this.saving=task;this.notify();try{await task;}finally{this.saving=null;this.notify();this.schedule();}
 }
 async tick(){
  if(!this.base||this.saving)return;if(!this.online()){this.offline=true;await this.persist();this.notify();return;}
  if(!this.pause())try{await this.refresh();}catch{return;}
  for(const [id,lease]of [...this.leases]){if(!this.changes.some(x=>x.group==='prompts'&&x.id===id)&&this.now()-(this.activity.get(id)??lease.started)>=EDIT_IDLE_MS){await this.release(id);continue;}try{const renewed=await this.leaseRequest('renew',id,lease.token);this.leases.set(id,{...lease,until:renewed.until});}catch(error){this.leases.delete(id);this.failure(error,id);}}
  if(!this.pause())await this.flush({all:false});this.schedule();this.notify();
 }
 async reconnect(){if(this.pause())return;await this.refresh().catch(()=>{});if(!this.offline)await this.flush();}
 async recover(recordId){
  if(this.dirty)throw Error('请先保存当前修改，或下载备份后读取云端');const record=this.draftRecords.find(x=>x.id===recordId);if(!record)throw Error('这份草稿已不在本机');const changes=validateChanges(record.changes);await this.refresh();const remote=structuredClone(this.base),pending=changes.filter(x=>!sameItem(x.group,remote[x.group].find(item=>item.id===x.id)||null,x.after));
  this.base=overlayChanges(remote,pending.map(x=>({...x,after:x.before})));const next=overlayChanges(remote,pending),first=pending.find(x=>x.group==='prompts'&&x.after);if(first){if(!next.tabs.includes(first.id))next.tabs.push(first.id);next.active=first.id;}this.setState(next);this.reason=record.reason==='import'?'import':'edit';this.recovered.add(recordId);this.changed(this.reason);this.rebase(remote);for(const change of pending.filter(x=>x.group==='prompts'))if(this.problems.get(change.id)!=='conflict')await this.startEdit(change.id);this.notify();
 }
 async useRemote(id){const remote=await this.refresh();if(!remote)return;await this.release(id);const document=remote.state.prompts.find(p=>p.id===id)||null;putItem(this.base,'prompts',id,document);const next=structuredClone(this.getState());putItem(next,'prompts',id,document);next.tabs=next.tabs.filter(tab=>next.prompts.some(p=>p.id===tab));if(!next.prompts.some(p=>p.id===next.active))next.active=next.tabs[0]||null;this.problems.delete(id);this.setState(next);this.changed();}
 async saveCopy(id){const document=structuredClone(this.getState().prompts.find(p=>p.id===id));if(!document)throw Error('没有可保留的本地内容');await this.useRemote(id);document.id=crypto.randomUUID();document.title+=' · 本地副本';document.updated=this.now();const next=structuredClone(this.getState());next.prompts.push(document);next.tabs.push(document.id);next.active=document.id;this.setState(next);this.changed();if(await this.startEdit(document.id))await this.flush({ids:[document.id]});}
 async discardRecord(id){if(id===this.client&&this.dirty)throw Error('当前草稿仍在编辑，请先保存');await this.drafts.remove(id);await this.readDrafts();}
 async reloadDiscardingLocal(){for(const id of [...this.leases.keys()])await this.release(id);const remote=await (await this.request('/api/edit/state?client='+this.client)).json();this.base=structuredClone(remote.state);this.etag=remote.etag;this.problems.clear();this.metadataConflict=false;this.setLocks(remote.locks);this.setState(remote.state);this.offline=false;await this.persist();this.status('已读取云端最新内容','ok');}
}
