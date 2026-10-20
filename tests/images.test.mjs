import {test} from 'node:test';
import assert from 'node:assert/strict';
import {png} from './helpers/png.mjs';
import {imageInfo,imageHash,imageUrl,imageName,uniqueImageName,validateImages,promptImages,copyPromptWithImages} from '../src/images.js';
import {makeImageZip,makeBackupZip,readBackupZip} from '../src/image-archive.js';
import {unzipSync} from 'fflate';
import {ImageClient} from '../src/image-client.js';

test('images use content hashes, safe unique filenames and bounded raster formats',async()=>{
 const a=png(),b=png(40,20,[20,50,100]);assert.deepEqual(imageInfo(a),{type:'image/png',width:32,height:24,size:a.length});assert.equal(await imageHash(a),await imageHash(new Uint8Array(a)));assert.notEqual(await imageHash(a),await imageHash(b));
 assert.throws(()=>imageInfo(Buffer.from('<svg onload="alert(1)"></svg>')));assert.throws(()=>imageInfo(new Uint8Array(8*1024*1024+1)));
 assert.equal(imageName('../../截图.png'),'.._.._截图.png');assert(!imageName('x[1](2).png').includes('['));
 const first={id:await imageHash(a),name:'截图.png',...imageInfo(a)},next=uniqueImageName('截图.png',[first],first.type);assert.equal(next,'截图_2.png');assert.doesNotThrow(()=>validateImages({images:[first,{...first,id:awaitedDummyId(),name:next}]}));
 assert.throws(()=>validateImages({images:[first,first]}));
});
function awaitedDummyId(){return '1'.repeat(64);}
test('copy text references canonical image names in document order, skips code and private URLs',async()=>{
 const a={id:await imageHash(png()),name:'结果图.png',...imageInfo(png())},b={id:await imageHash(png(40,20)),name:'输入图.png',...imageInfo(png(40,20))};
 const p={images:[a,b],body:`分析 ![随便改的说明](${imageUrl(b.id)}) 与 ![结果](${imageUrl(a.id)})。\n\n\`![代码](${imageUrl(a.id)})\`\n\n![再用一次](${imageUrl(b.id)})`};
 assert.deepEqual(promptImages(p).map(i=>i.name),['输入图.png','结果图.png']);const text=copyPromptWithImages(p,p.body);assert(text.includes('[图片：输入图.png]'));assert(text.includes('1. 输入图.png\n2. 结果图.png'));assert(text.includes('`![代码]('));assert(!text.includes('![随便改的说明]'));
});
test('front-end ZIP uses STORE, preserves Unicode names, and complete backups preserve original bytes',async()=>{
 const bytes=png(),blob=makeImageZip([{name:'参考图.png',bytes}]),zip=new Uint8Array(await blob.arrayBuffer());assert.equal(new DataView(zip.buffer).getUint16(8,true),0,'ZIP local header compression method is STORE');assert.deepEqual(unzipSync(zip)['参考图.png'],new Uint8Array(bytes));
 const id=await imageHash(bytes),backup=makeBackupZip({version:1},[{id,bytes}],false),decoded=readBackupZip(await backup.arrayBuffer());assert.deepEqual(decoded.workspace,{version:1});assert.deepEqual(decoded.files['images/'+id+'.bin'],new Uint8Array(bytes));assert.equal(decoded.encrypted,false);
 assert.throws(()=>readBackupZip(zip));
});

test('offline image backup uses local originals and never calls the network',async()=>{
 const bytes=png(),id=await imageHash(bytes),image={id,name:'离线图片.png',...imageInfo(bytes)},state={version:1,prompts:[{images:[image],body:'![离线图片]('+imageUrl(id)+')'}]};
 const client=new ImageClient({scope:()=> 'test',request:()=>{throw Error('offline request must not happen');}});client.cache={get:async()=>new Blob([bytes],{type:'image/png'})};
 const backup=readBackupZip(await (await client.backup(state,false)).arrayBuffer());assert.equal(backup.encrypted,false);assert.deepEqual(backup.workspace,state);assert.deepEqual(backup.files['images/'+id+'.bin'],new Uint8Array(bytes));
});
