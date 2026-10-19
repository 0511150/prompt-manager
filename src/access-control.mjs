import {DurableObject} from 'cloudflare:workers';
import {passwordMatches,hex,bytesToBase64,passwordVerifier} from './server-crypto.mjs';
import {normalizeAttempts,failedAttempt,MAX_ATTEMPTS,banResult} from './ban-policy.mjs';
import {normalizeIp} from './ip.js';
import {CURRENT_KEY} from './workspace-store.mjs';

// One coordinator for the single workspace's access policy, not workspace contents.
export class AccessControl extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS access_config (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS ip_policy (ip TEXT PRIMARY KEY, value TEXT NOT NULL, last INTEGER NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS allowlist (ip TEXT PRIMARY KEY, added INTEGER NOT NULL)');
 }
 storedCredentials(){const row=this.ctx.storage.sql.exec('SELECT value FROM access_config WHERE id=1').toArray()[0];return row?JSON.parse(row.value):null;}
 legacyCredentials(){return this.env.ACCESS_PASSWORD_HASH&&this.env.SESSION_SECRET&&this.env.DATA_KEY?{ACCESS_PASSWORD_HASH:this.env.ACCESS_PASSWORD_HASH,SESSION_SECRET:this.env.SESSION_SECRET,DATA_KEY:this.env.DATA_KEY}:null;}
 getCredentials(){
  // Bindings do not change during an object's lifetime; derive once per instance.
  if(!this.credentialsPromise)this.credentialsPromise=this.resolveCredentials().catch(error=>{this.credentialsPromise=null;throw error;});
  return this.credentialsPromise;
 }
 async resolveCredentials(){
  const stored=this.storedCredentials(),legacy=this.legacyCredentials(),previous=stored||legacy,password=this.env.ACCESS_PASSWORD;
  if(password===undefined)return previous;
  if(typeof password!=='string'||password.length<12||password.length>512)return null;
  if(previous?.PASSWORD_SALT&&await passwordMatches(password,previous.ACCESS_PASSWORD_HASH,previous.PASSWORD_SALT))return previous;
  if(!previous){
   if(this.env.ACCESS_PASSWORD_HASH||this.env.SESSION_SECRET||this.env.DATA_KEY)throw Error('Incomplete legacy credentials');
   if(await this.env.VAULTS.head(CURRENT_KEY))throw Error('Existing workspace without encryption credentials');
  }
  const PASSWORD_SALT=bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const credentials={ACCESS_PASSWORD_HASH:hex(await passwordVerifier(password,PASSWORD_SALT)),PASSWORD_SALT,SESSION_SECRET:previous?.SESSION_SECRET||bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),DATA_KEY:previous?.DATA_KEY||bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))};
  this.ctx.storage.sql.exec('INSERT OR REPLACE INTO access_config(id,value) VALUES(1,?)',JSON.stringify(credentials));
  return credentials;
 }
 readIp(ip,now=Date.now()){const row=this.ctx.storage.sql.exec('SELECT value FROM ip_policy WHERE ip=?',ip).toArray()[0];return normalizeAttempts(row?JSON.parse(row.value):null,now);}
 writeIp(ip,state){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO ip_policy(ip,value,last) VALUES(?,?,?)',ip,JSON.stringify(state),state.last);}
 allowed(ip){return this.ctx.storage.sql.exec('SELECT ip FROM allowlist WHERE ip=?',ip).toArray().length>0;}
 blocked(ip,now=Date.now()){const state=this.readIp(ip,now);return !this.allowed(ip)&&(state.permanent||state.until>now)?banResult(state,now):null;}
 failure(ip){
  if(this.allowed(ip))return {ok:false,remaining:MAX_ATTEMPTS,whitelisted:true};
  const now=Date.now(),row=failedAttempt(this.readIp(ip,now),now);this.writeIp(ip,row);
  return row.permanent||row.until>now?banResult(row,now):{ok:false,remaining:Math.max(0,MAX_ATTEMPTS-row.count)};
 }
 clearIp(ip){this.ctx.storage.sql.exec('DELETE FROM ip_policy WHERE ip=?',ip);return {ok:true};}
 async login(password,ip){
  const blocked=this.blocked(ip);if(blocked)return blocked;
  const credentials=await this.getCredentials();if(!credentials)return {ok:false,unconfigured:true};
  const valid=await passwordMatches(password,credentials.ACCESS_PASSWORD_HASH,credentials.PASSWORD_SALT);
  const later=this.blocked(ip);if(later)return later;
  if(!valid)return this.failure(ip);
  this.clearIp(ip);return {ok:true};
 }
 list(currentIp){
  const now=Date.now();
  const items=this.ctx.storage.sql.exec("SELECT ip,value FROM ip_policy ORDER BY json_extract(value,'$.permanent') DESC,last DESC LIMIT 1000").toArray().map(row=>({ip:row.ip,...normalizeAttempts(JSON.parse(row.value),now)})).filter(row=>row.permanent||row.until>now||row.count||row.banTimes.length);
  return {currentIp,items,whitelist:this.ctx.storage.sql.exec('SELECT ip,added FROM allowlist ORDER BY added DESC').toArray(),rules:{attempts:5,windowMinutes:15,banMinutes:15,permanentAfter:5,banWindowHours:24}};
 }
 update(action,value){
  const ip=normalizeIp(value);if(!ip)throw Object.assign(Error('请输入有效的 IPv4 或 IPv6 地址'),{status:400});
  if(action==='unban')return this.clearIp(ip);
  if(action==='allow'){
   if(this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM allowlist').toArray()[0].n>=200&&!this.allowed(ip))return {ok:false,status:400,error:'白名单最多 200 个 IP'};
   this.ctx.storage.sql.exec('INSERT OR REPLACE INTO allowlist(ip,added) VALUES(?,?)',ip,Date.now());this.clearIp(ip);return {ok:true};
  }
  if(action==='deny'){this.ctx.storage.sql.exec('DELETE FROM allowlist WHERE ip=?',ip);return {ok:true};}
  throw Object.assign(Error('不支持的操作'),{status:400});
 }
 cleanup(){this.ctx.storage.sql.exec("DELETE FROM ip_policy WHERE last<? AND json_extract(value,'$.permanent')=0",Date.now()-24*60*60*1000);}
}
