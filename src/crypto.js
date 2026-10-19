const enc=new TextEncoder();
export const toBase64=buf=>{let s='';for(const b of new Uint8Array(buf))s+=String.fromCharCode(b);return btoa(s);};
export const fromBase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function digest(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function deriveSession(name,password){
 const normalized=name.trim().normalize('NFKC').toLowerCase();
 const id=await digest('prompt.05s.us/vault/v1/'+normalized);
 const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode('prompt-workspace/v1/'+id),iterations:310000},material,512));
 const key=await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-GCM',false,['encrypt','decrypt']);
 return {id,name:normalized,key,token:toBase64(bits.slice(32))};
}
export async function seal(state,session){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(session.id)},session.key,enc.encode(JSON.stringify(state)));return {v:1,iv:toBase64(iv),ciphertext:toBase64(data)};}
export async function unseal(payload,session){if(payload?.v!==1)throw Error('加密格式不支持');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(payload.iv),additionalData:enc.encode(session.id)},session.key,fromBase64(payload.ciphertext))));}
