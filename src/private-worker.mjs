import assets from './assets.generated.mjs';
import {freshState,validateState} from './model.js';
import {hash,hex,createSession,verifySession,sealWorkspace,unsealWorkspace} from './server-crypto.mjs';
import {readWorkspace,saveWorkspace,listHistory,readHistory,restoreHistory,pruneHistory} from './workspace-store.mjs';
export {AuthGuard} from './auth-guard.mjs';
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{...security,'Cache-Control':'no-store',...headers}});
const cookieName='__Host-prompt_session';
const setCookie=token=>`${cookieName}=${token}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`;
const clearCookie=`${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
function assetResponse(path,request,status=200){const asset=assets[path];if(!asset)return json({error:'页面不存在'},404);return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{status,headers:{...security,'Content-Type':asset.type,'Cache-Control':'no-store','Vary':'Cookie'}});}
async function readBody(request,limit){
 const reader=request.body?.getReader();if(!reader)return new Uint8Array(0);
 const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw {status:413,message:'请求内容过大'};}chunks.push(value);}
 const bytes=new Uint8Array(size);let n=0;for(const chunk of chunks){bytes.set(chunk,n);n+=chunk.length;}return bytes;
}
async function readJson(request,limit=5*1024*1024){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw {status:415,message:'需要 JSON 请求'};
 const bytes=await readBody(request,limit);try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw {status:400,message:'JSON 格式不正确'};}
}
function sameOrigin(request){return request.headers.get('Origin')===new URL(request.url).origin;}
async function sessionFor(request,env){const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);const session=await verifySession(token,env);if(!session)return null;if(await env.AUTH_GUARD.getByName('session:'+session.id).isRevoked())return null;return session;}
async function login(request,env){
 if(request.method!=='POST')return json({error:'方法不支持'},405);
 const body=await readJson(request,2048);
 if(!sameOrigin(request))return json({error:'请求来源不允许'},403);
 if(typeof body.password!=='string'||body.password.length>512)return json({error:'密码格式不正确'},400);
 // CF-Connecting-IP is provided by Cloudflare; never use spoofable forwarding headers.
 const ip=request.headers.get('CF-Connecting-IP')||'unknown';
 const ipKey=hex(await hash(env.SESSION_SECRET+':ip:'+ip));
 const result=await env.AUTH_GUARD.getByName('ip:'+ipKey).attempt(body.password);
 if(!result.ok){if(result.banned)return json({error:`登录失败次数过多，请在 ${Math.ceil(result.retryAfter/60)} 分钟后重试。`,retryAfter:result.retryAfter},429,{'Retry-After':String(result.retryAfter)});return json({error:`密码不正确，还可尝试 ${result.remaining} 次。`},401);}
 const session=await createSession(env);return json({ok:true},200,{'Set-Cookie':setCookie(session.token)});
}
async function workspace(request,env,ctx){
 if(request.method==='GET'){const {state,etag}=await readWorkspace(env);return json(state,200,{'ETag':etag});}
 if(request.method!=='PUT')return json({error:'方法不支持'},405);
 const revision=request.headers.get('X-Workspace-Revision');if(!revision)return json({error:'请先读取最新版本'},428);
 const result=await saveWorkspace(env,await readJson(request),revision,request.headers.get('X-Workspace-Change')==='import'?'import':'edit');
 ctx.waitUntil(pruneHistory(env,result.droppedKeys).catch(()=>console.error(JSON.stringify({event:'history_cleanup_deferred'}))));
 return json({ok:true,historyCount:result.historyCount},200,{'ETag':result.etag});
}
export default {async fetch(request,env,ctx){
 try{
  const url=new URL(request.url),path=url.pathname;
  if(!env.ACCESS_PASSWORD_HASH||!env.SESSION_SECRET||!env.DATA_KEY)return json({error:'访问保护尚未配置，请联系管理员'},503);
  if(path==='/auth/login')return await login(request,env);
  if(['GET','HEAD'].includes(request.method)&&(path==='/login.js'||path==='/login.css'))return assetResponse(path,request);
  const session=await sessionFor(request,env);
  if(!session){if(['GET','HEAD'].includes(request.method)&&['/','/index.html'].includes(path))return assetResponse('/login.html',request);return json({error:'请先输入访问密码'},401);}
  if(!['GET','HEAD'].includes(request.method)&&!sameOrigin(request))return json({error:'请求来源不允许'},403);
  if(path==='/auth/logout'&&request.method==='POST'){await readBody(request,2048);await env.AUTH_GUARD.getByName('session:'+session.id).revoke();return json({ok:true},200,{'Set-Cookie':clearCookie});}
  if(path==='/api/workspace')return await workspace(request,env,ctx);
  if(path==='/api/history'&&request.method==='GET')return json(await listHistory(env));
  const historyRoute=path.match(/^\/api\/history\/([a-f0-9-]{36})(\/restore)?$/);
  if(historyRoute&&request.method==='GET'&&!historyRoute[2])return json(await readHistory(env,historyRoute[1]));
  if(historyRoute&&historyRoute[2]&&request.method==='POST'){
   const revision=request.headers.get('X-Workspace-Revision');if(!revision)return json({error:'请先读取最新版本'},428);
   const result=await restoreHistory(env,historyRoute[1],revision);
   ctx.waitUntil(pruneHistory(env,result.droppedKeys).catch(()=>console.error(JSON.stringify({event:'history_cleanup_deferred'}))));
   return json({state:result.state,historyCount:result.historyCount},200,{'ETag':result.etag});
  }
  if(path==='/api/backup'&&request.method==='POST'){const state=validateState(await readJson(request));return json({app:'prompt-workspace',format:2,encrypted:true,payload:await sealWorkspace(state,env.DATA_KEY)});}
  if(path==='/api/backup/decrypt'&&request.method==='POST'){const backup=await readJson(request,8*1024*1024);try{return json(validateState(await unsealWorkspace(backup.payload,env.DATA_KEY)));}catch{return json({error:'无法解密此备份，请确认是此工作区导出的文件'},400);}}
  if(path.startsWith('/api/')||path.startsWith('/auth/'))return json({error:'接口不存在'},404);
  if(!['GET','HEAD'].includes(request.method))return json({error:'方法不支持'},405);
  if(path==='/login.html')return Response.redirect(url.origin+'/',303);
  return assetResponse(path==='/'?'/index.html':path,request);
 }catch(error){if(error.status)return json({error:error.message},error.status);console.error(JSON.stringify({event:'request_error',message:error?.name||'Error'}));return json({error:'操作未完成，请稍后重试'},500);}
},async scheduled(_event,env,ctx){ctx.waitUntil(pruneHistory(env));}};
