import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
export const makeImageZip=files=>new Blob([zipSync(Object.fromEntries(files.map(f=>[f.name,new Uint8Array(f.bytes)])),{level:0})],{type:'application/zip'});
export function makeBackupZip(workspace,files,encrypted){return makeImageZip([{name:'manifest.json',bytes:strToU8(JSON.stringify({app:'prompt-workspace-images',version:1,encrypted}))},{name:'workspace.json',bytes:strToU8(JSON.stringify(workspace))},...files.map(file=>({name:'images/'+file.id+'.bin',bytes:file.bytes}))]);}
export function readBackupZip(bytes){
 if(bytes.byteLength>128*1024*1024)throw Error('备份文件不能超过 128 MB');let total=0,count=0;
 const files=unzipSync(new Uint8Array(bytes),{filter:file=>{if(++count>10000||file.originalSize>10*1024*1024||(total+=file.originalSize)>128*1024*1024)throw Error('备份内容超出限制');return file.name==='manifest.json'||file.name==='workspace.json'||/^images\/[a-f0-9]{64}\.bin$/.test(file.name);}});
 const manifest=JSON.parse(strFromU8(files['manifest.json']||new Uint8Array()));
 if(manifest.app!=='prompt-workspace-images'||manifest.version!==1||typeof manifest.encrypted!=='boolean'||!files['workspace.json'])throw Error('不是有效的图片完整备份');
 return {workspace:JSON.parse(strFromU8(files['workspace.json'])),files,encrypted:manifest.encrypted};
}
