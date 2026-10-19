// Shared comparison rules: navigation and timestamps are not document edits.
export const EDIT_GROUPS=['prompts','folders','bookmarks','bookmarkFolders','presets','promptOrders'];
export const DEFAULT_IDLE_SECONDS=10,MAX_IDLE_SECONDS=86_400;
export const validIdleSeconds=value=>Number.isInteger(value)&&value>=1&&value<=MAX_IDLE_SECONDS;
export const EDIT_IDLE_MS=DEFAULT_IDLE_SECONDS*1000,LEASE_TTL_MS=150_000,HEARTBEAT_MS=30_000;
export const validEditId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
export function comparable(group,item){if(!item)return null;const copy={...item};if(group==='prompts'||group==='presets')delete copy.updated;if(group==='folders')delete copy.open;return stable(copy);}
export const sameItem=(group,a,b)=>JSON.stringify(comparable(group,a))===JSON.stringify(comparable(group,b));
export async function contentVersion(item){if(!item)return null;const bytes=new TextEncoder().encode(JSON.stringify(comparable('prompts',item)));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function diffWorkspace(before,after){const changes=[];for(const group of EDIT_GROUPS){const old=new Map((before[group]||[]).map(item=>[item.id,item])),next=new Map((after[group]||[]).map(item=>[item.id,item]));for(const id of new Set([...old.keys(),...next.keys()]))if(!sameItem(group,old.get(id),next.get(id)))changes.push({group,id,before:structuredClone(old.get(id)||null),after:structuredClone(next.get(id)||null)});}return changes;}
export function putItem(state,group,id,item){state[group]??=[];const at=state[group].findIndex(x=>x.id===id);if(item===null){if(at!==-1)state[group].splice(at,1);}else if(at===-1)state[group].push(structuredClone(item));else state[group][at]=structuredClone(item);}
export function overlayChanges(state,changes){const result=structuredClone(state);for(const change of changes)putItem(result,change.group,change.id,change.after);return result;}
export function validateChanges(changes){if(!Array.isArray(changes)||changes.length>8000)throw Object.assign(Error('修改请求无效'),{status:400});const seen=new Set();for(const change of changes){const key=change?.group+':'+change?.id;if(!EDIT_GROUPS.includes(change?.group)||!validEditId(change.id)||seen.has(key)||![change.before,change.after].every(item=>item===null||item&&typeof item==='object'&&!Array.isArray(item)&&item.id===change.id))throw Object.assign(Error('修改请求无效'),{status:400});seen.add(key);}return changes;}
