import {marked} from 'marked';
export const IMAGE_LIMIT=8*1024*1024,IMAGE_PIXELS=32_000_000,IMAGE_GRACE_MS=7*24*60*60*1000;
export const validImageId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
export const imageUrl=id=>'/api/images/'+id;
export const imageHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function imageInfo(input){
 const b=new Uint8Array(input),v=new DataView(b.buffer,b.byteOffset,b.byteLength);let type,width,height;
 if(!b.length||b.length>IMAGE_LIMIT)throw Error('图片须小于或等于 8 MB');
 if(b.length>=24&&b.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'&&v.getUint32(12)===0x49484452){type='image/png';width=v.getUint32(16);height=v.getUint32(20);}
 else if(b.length>=4&&b[0]===255&&b[1]===216){type='image/jpeg';let p=2;while(p+4<=b.length){if(b[p++]!==255)break;while(b[p]===255)p++;const marker=b[p++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;if(p+2>b.length)break;const length=v.getUint16(p);if(length<2||p+length>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=length;}}
 else if(b.length>=26&&v.getUint32(0)===0x52494646&&v.getUint32(8)===0x57454250){type='image/webp';const chunk=v.getUint32(12);if(chunk===0x56503858&&b.length>=30){width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}else if(chunk===0x56503820&&b.length>=30&&b[23]===157&&b[24]===1&&b[25]===42){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}else if(chunk===0x5650384c&&b[20]===47){const bits=v.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}}
 if(!type||!width||!height||width>20000||height>20000||width*height>IMAGE_PIXELS)throw Error('请选择有效的 PNG、JPEG 或 WebP 图片，最多 3200 万像素');
 return {type,width,height,size:b.length};
}
export function imageName(name,type='image/png'){
 const ext=type==='image/jpeg'?'.jpg':type==='image/webp'?'.webp':'.png';
 let value=String(name||'图片').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*\[\]()`]/g,'_').trim().replace(/[. ]+$/,'');
 value=value.replace(/\.(?:png|jpe?g|webp)$/i,'').slice(0,110)||'图片';
 return value+ext;
}
export function uniqueImageName(name,images,type){const base=imageName(name,type),dot=base.lastIndexOf('.'),used=new Set(images.map(i=>i.name.toLowerCase()));let next=base,n=2;while(used.has(next.toLowerCase()))next=base.slice(0,dot)+'_'+(n++)+base.slice(dot);return next;}
export function validateImages(prompt){
 if(prompt.images===undefined)return;
 if(!Array.isArray(prompt.images)||prompt.images.length>200)throw Error('图片附件格式不正确');
 const ids=new Set(),names=new Set();for(const i of prompt.images){if(!i||!validImageId(i.id)||!['image/png','image/jpeg','image/webp'].includes(i.type)||!Number.isInteger(i.size)||i.size<1||i.size>IMAGE_LIMIT||!Number.isInteger(i.width)||!Number.isInteger(i.height)||i.width<1||i.height<1||i.width*i.height>IMAGE_PIXELS||typeof i.name!=='string'||i.name!==imageName(i.name,i.type)||ids.has(i.id)||names.has(i.name.toLowerCase()))throw Error('图片附件格式不正确');ids.add(i.id);names.add(i.name.toLowerCase());}
}
export function imageTokens(text){const list=[];marked.walkTokens(marked.lexer(text),token=>{if(token.type==='image'&&/^\/api\/images\/[a-f0-9]{64}$/.test(token.href))list.push({...token,id:token.href.slice(-64)});});return list;}
export function promptImages(prompt,text=prompt?.body||''){const byId=new Map((prompt?.images||[]).map(i=>[i.id,i])),seen=new Set();return imageTokens(text).flatMap(t=>{const image=byId.get(t.id);if(!image||seen.has(t.id))return [];seen.add(t.id);return [image];});}
export function workspaceImages(state){return [...new Map(state.prompts.flatMap(p=>promptImages(p)).map(i=>[i.id,i])).values()];}
export function copyPromptWithImages(prompt,text){const images=promptImages(prompt,text);let result=text;for(const token of imageTokens(text)){const image=images.find(i=>i.id===token.id);if(image)result=result.replaceAll(token.raw,'[图片：'+image.name+']');}return images.length?result+'\n\n附图（请按文件名对应）：\n'+images.map((i,n)=>(n+1)+'. '+i.name).join('\n'):result;}
