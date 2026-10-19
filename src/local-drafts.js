// Drafts stay on this browser. They are never uploaded as separate R2 objects.
export class LocalDrafts{
 constructor(){this.connection=null;}
 async open(){
  if(!this.connection)this.connection=new Promise((resolve,reject)=>{const request=indexedDB.open('prompt-local-drafts',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'});request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('本地草稿存储被另一个页面占用'));});
  return this.connection;
 }
 async transaction(mode,operation){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode),request=operation(tx.objectStore('drafts'));let value;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('本地草稿未保存'));});}
 put(record){return this.transaction('readwrite',store=>store.put(record));}
 remove(id){return this.transaction('readwrite',store=>store.delete(id));}
 async list(scope){return (await this.transaction('readonly',store=>store.getAll())).filter(record=>record.scope===scope).sort((a,b)=>b.savedAt-a.savedAt);}
}
