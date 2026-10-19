export function normalizeIp(value){
 if(typeof value!=='string'||value.length>64)return null;
 const text=value.trim();
 if(/^\d{1,3}(\.\d{1,3}){3}$/.test(text)){
  const parts=text.split('.');return parts.every(x=>Number(x)<=255&&!/^0\d/.test(x))?parts.map(Number).join('.'):null;
 }
 if(!text.includes(':')||!/^[0-9a-f:.]+$/i.test(text))return null;
 try{const host=new URL('http://['+text+']/').hostname;return host.startsWith('[')?host.slice(1,-1).toLowerCase():null;}catch{return null;}
}
