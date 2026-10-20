import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {resolve} from 'node:path';
import {png} from './helpers/png.mjs';
import {imageHash,imageUrl,IMAGE_GRACE_MS} from '../src/images.js';
import {diffWorkspace,contentVersion} from '../src/edit-protocol.js';

test('private encrypted deduplicated attachments, configurable history, recovery and seven-day collection',async()=>{
 const wrapper=`import worker from './worker.mjs';export {AuthGuard,AccessControl,WorkspaceEditor} from './worker.mjs';let offset=0;const clock=Date.now;Date.now=()=>clock()+offset;export default {fetch(request,env,ctx){if(new URL(request.url).pathname==='/__test_clock'){offset+=Number(new URL(request.url).searchParams.get('advance'));return Response.json({ok:true});}return worker.fetch(request,env,ctx);}};`;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'images-test',modules:[{type:'ESModule',path:resolve('dist/test-images-entry.mjs'),contents:wrapper},{type:'ESModule',path:resolve('dist/worker.mjs')}],compatibilityDate:'2026-10-19',durableObjects:{AUTH_GUARD:{className:'AuthGuard',useSQLite:true},ACCESS_CONTROL:{className:'AccessControl',useSQLite:true},WORKSPACE_EDITOR:{className:'WorkspaceEditor',useSQLite:true}},r2Buckets:['VAULTS'],bindings:{ACCESS_PASSWORD:'local-image-test-password'}}));
 const origin='https://images.invalid',client=crypto.randomUUID();let cookie;
 const req=(path,{method='GET',body,raw,extra={},auth=true}={})=>mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,...(cookie&&auth?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:raw?{body:raw}:{})});
 const read=async()=>{const r=await req('/api/edit/state?client='+client);assert.equal(r.status,200);return r.json();};
 const save=async(before,next)=>{const changes=diffWorkspace(before,next),leases={};for(const change of changes.filter(c=>c.group==='prompts')){const response=await req('/api/edit/lease',{method:'POST',body:{action:'acquire',client,document:change.id,baseVersion:await contentVersion(change.before)}});assert.equal(response.status,200,await response.clone().text());leases[change.id]=(await response.json()).token;}const response=await req('/api/edit/save',{method:'POST',body:{client,changes,leases}});assert.equal(response.status,200,await response.clone().text());return (await response.json()).state;};
 try{
  const bytes=png(),id=await imageHash(bytes),url=imageUrl(id),key='workspace/images/'+id+'.bin';assert.equal((await req(url,{auth:false})).status,401);
  const login=await req('/auth/login',{method:'POST',body:{password:'local-image-test-password'}});assert.equal(login.status,200);cookie=login.headers.get('Set-Cookie').split(';')[0];
  const draftBytes=png(48,32),draftId=await imageHash(draftBytes),sealedDraft=await req(imageUrl(draftId)+'/encrypted',{method:'POST',raw:draftBytes});assert.equal(sealedDraft.status,200);assert.equal(await (await mf.getR2Bucket('VAULTS')).head('workspace/images/'+draftId+'.bin'),null,'manual backup encryption never writes draft images or backup objects to R2');
  assert.equal((await req(url,{method:'PUT',raw:bytes,extra:{Origin:'https://foreign.invalid'}})).status,403);
  assert.equal((await req(imageUrl('0'.repeat(64)),{method:'PUT',raw:bytes})).status,400);
  const upload=await req(url,{method:'PUT',raw:bytes,extra:{'X-Image-Name':encodeURIComponent('参考图.png')}});assert.equal(upload.status,200,await upload.clone().text());const image=await upload.json();assert.equal(image.id,id);
  const bucket=await mf.getR2Bucket('VAULTS'),encrypted=await (await bucket.get(key)).arrayBuffer(),etag=(await bucket.head(key)).etag;assert(!Buffer.from(encrypted).equals(bytes));
  assert.equal((await req(url,{method:'PUT',raw:bytes})).status,200);assert.equal((await bucket.head(key)).etag,etag,'duplicate hashes do not rewrite originals');assert.equal((await bucket.list({prefix:'workspace/images/'})).objects.length,1);
  const get=await req(url);assert.equal(get.status,200);assert.equal(get.headers.get('Content-Type'),'image/png');assert.equal(get.headers.get('Cache-Control'),'no-store');assert.deepEqual(Buffer.from(await get.arrayBuffer()),bytes);
  const exported=await (await req(url+'/encrypted')).arrayBuffer();assert.deepEqual(Buffer.from(exported),Buffer.from(encrypted));const tampered=new Uint8Array(exported.slice(0));tampered[tampered.length-1]^=1;assert.equal((await req(url+'/encrypted',{method:'PUT',raw:tampered})).status,400);
  assert.equal((await req(url+'/encrypted',{method:'PUT',raw:exported})).status,200);
  let first=await read();assert.equal(first.settings.historyLimit,20);assert.equal((await req('/api/edit/settings',{method:'POST',body:{historyLimit:0}})).status,400);
  const invalid=structuredClone(first.state);invalid.prompts[0].images=[{...image,id:'0'.repeat(64)}];invalid.prompts[0].body='![缺少的图片]('+imageUrl('0'.repeat(64))+')';
  const lease=await req('/api/edit/lease',{method:'POST',body:{action:'acquire',client,document:'welcome',baseVersion:await contentVersion(first.state.prompts[0])}});const token=(await lease.json()).token;assert.equal((await req('/api/edit/save',{method:'POST',body:{client,changes:diffWorkspace(first.state,invalid),leases:{welcome:token}}})).status,400);
  let next=structuredClone(first.state);next.prompts[0].images=[image];next.prompts[0].body='![参考图]('+url+')';next=await save(first.state,next);
  let after=structuredClone(next);after.prompts[1].images=[image];after.prompts[1].body='另一处 ![相同图片]('+url+')';after=await save(next,after);
  let removed=structuredClone(after);removed.prompts[0].body='移除第一处';removed=await save(after,removed);assert.equal((await (await req('/api/images/trash')).json()).items.length,0,'another current document still references the blob');
  let noRefs=structuredClone(removed);noRefs.prompts[1].body='移除所有当前引用';noRefs=await save(removed,noRefs);let trash=await (await req('/api/images/trash')).json();assert.equal(trash.items[0].protectedByHistory,true);assert.equal(trash.items[0].deleteAt,null);
  const history=await (await req('/api/history')).json();assert.equal(history.limit,20);const restored=await req('/api/history/'+history.items[0].id+'/restore',{method:'POST',extra:{'X-Workspace-Revision':(await read()).etag}});assert.equal(restored.status,200);assert.equal((await req(url)).status,200,'history restoration retains the original image');
  assert.equal((await req('/api/edit/settings',{method:'POST',body:{historyLimit:1}})).status,200);assert.equal((await (await req('/api/history')).json()).limit,1);
  const snapshot=await read();let clear=structuredClone(snapshot.state);for(const p of clear.prompts)if(p.images)p.body='无图片';clear=await save(snapshot.state,clear);let aged=structuredClone(clear);aged.prompts[0].body+=' 再修改一次';aged=await save(clear,aged);
  trash=await (await req('/api/images/trash')).json();assert.equal(trash.items[0].protectedByHistory,false);assert(trash.items[0].deleteAt>Date.now());
  const stub=(await mf.getDurableObjectNamespace('WORKSPACE_EDITOR')).getByName('private-workspace');await req('/__test_clock?advance='+(IMAGE_GRACE_MS-1000));assert.equal((await stub.cleanupImages()).removed,0);const relogin=await req('/auth/login',{method:'POST',body:{password:'local-image-test-password'}});cookie=relogin.headers.get('Set-Cookie').split(';')[0];assert.equal((await req(url)).status,200);
  await req('/__test_clock?advance=2000');assert.equal((await stub.cleanupImages()).removed,1);assert.equal((await req(url)).status,404);assert.equal((await bucket.list({prefix:'workspace/images/'})).objects.length,0);
 }finally{await mf.dispose();}
});
