import {imageInfo,imageHash,validImageId,IMAGE_LIMIT,IMAGE_GRACE_MS,workspaceImages,imageName} from './images.js';
import {base64ToBytes,unsealWorkspace} from './server-crypto.mjs';
import {readWorkspace} from './workspace-store.mjs';
export const IMAGE_PREFIX='workspace/images/';
export const imageKey=id=>IMAGE_PREFIX+id+'.bin';
const fail=(status,message)=>Object.assign(Error(message),{status});
const aad=id=>new TextEncoder().encode('prompt-manager/image/v1/'+id);
const key=secret=>crypto.subtle.importKey('raw',base64ToBytes(secret),'AES-GCM',false,['encrypt','decrypt']);
export async function encryptImage(bytes,id,secret){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(id)},await key(secret),bytes)),out=new Uint8Array(16+cipher.length);out.set([73,77,71,1]);out.set(iv,4);out.set(cipher,16);return out;}
export async function decryptImage(input,id,secret){const b=new Uint8Array(input);if(b.length<33||b.length>IMAGE_LIMIT+32||b.slice(0,4).join(',')!=='73,77,71,1')throw fail(400,'加密图片格式无效');try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(4,16),additionalData:aad(id)},await key(secret),b.slice(16)));}catch{throw fail(400,'图片无法解密，请确认来自当前工作区');}}
export async function storeImage(env,sql,id,input,name,encrypted=false){
 if(!validImageId(id))throw fail(400,'图片标识无效');
 const bytes=encrypted?await decryptImage(input,id,env.DATA_KEY):new Uint8Array(input);let info;
 try{info=imageInfo(bytes);}catch(e){throw fail(400,e.message);}
 if(await imageHash(bytes)!==id)throw fail(400,'图片哈希不匹配');
 const metadata={id,...info,name:imageName(name,info.type)};
 if(!await env.VAULTS.head(imageKey(id)))await env.VAULTS.put(imageKey(id),await encryptImage(bytes,id,env.DATA_KEY),{httpMetadata:{contentType:'application/octet-stream'},onlyIf:{etagDoesNotMatch:'*'}});
 sql.exec('INSERT OR IGNORE INTO image_blob(id,metadata,unref_since,created) VALUES(?,?,?,?)',id,JSON.stringify(metadata),Date.now(),Date.now());
 return metadata;
}
export async function readImage(env,id,encrypted=false){
 if(!validImageId(id))throw fail(404,'图片不存在');const object=await env.VAULTS.get(imageKey(id));if(!object)throw fail(404,'图片不存在，可能已超过找回期限');
 if(object.size>IMAGE_LIMIT+32)throw fail(413,'图片对象过大');const cipher=new Uint8Array(await object.arrayBuffer());if(encrypted)return {bytes:cipher,type:'application/octet-stream'};
 const bytes=await decryptImage(cipher,id,env.DATA_KEY);return {bytes,type:imageInfo(bytes).type};
}
export async function assertImages(env,state,sql){const checked=new Map();for(const p of state.prompts)for(const image of workspaceImages({prompts:[p]})){if(!checked.has(image.id)){const row=sql.exec('SELECT metadata FROM image_blob WHERE id=?',image.id).toArray()[0];checked.set(image.id,row?JSON.parse(row.metadata):null);}const stored=checked.get(image.id);if(!stored)throw Object.assign(fail(400,'图片尚未上传或已被清理，请重新添加：'+image.name),{details:{document:p.id}});if(['type','size','width','height'].some(k=>image[k]!==stored[k]))throw fail(400,'图片附件信息不匹配：'+image.name);}}
export async function reconcileImages(env,sql,removeExpired=false){
 const rows=sql.exec('SELECT id,metadata,unref_since FROM image_blob').toArray();if(!rows.length)return {items:[],removed:0,graceDays:7};
 const {state,record}=await readWorkspace(env),current=new Set(workspaceImages(state).map(i=>i.id)),retained=new Set(current);
 for(const item of record?.history||[]){let ids=item.imageIds;if(!ids){const object=await env.VAULTS.get(item.key);if(!object)throw Error('Missing history while checking images');ids=workspaceImages(await unsealWorkspace(await object.json(),env.DATA_KEY)).map(i=>i.id);}for(const id of ids)retained.add(id);}
 const now=Date.now(),items=[];let removed=0;
 for(const row of rows){
  let since=row.unref_since;if(retained.has(row.id)){if(since!==null)sql.exec('UPDATE image_blob SET unref_since=NULL WHERE id=?',row.id);since=null;}
  else if(since===null){since=now;sql.exec('UPDATE image_blob SET unref_since=? WHERE id=?',since,row.id);}
  if(removeExpired&&since!==null&&now-since>=IMAGE_GRACE_MS){await env.VAULTS.delete(imageKey(row.id));sql.exec('DELETE FROM image_blob WHERE id=?',row.id);removed++;continue;}
  if(!current.has(row.id))items.push({...JSON.parse(row.metadata),protectedByHistory:retained.has(row.id),deleteAt:since===null?null:since+IMAGE_GRACE_MS});
 }
 return {items:items.sort((a,b)=>(a.deleteAt??Infinity)-(b.deleteAt??Infinity)),removed,graceDays:7};
}
