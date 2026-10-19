import {DurableObject} from 'cloudflare:workers';
import {passwordMatches} from './server-crypto.mjs';
import {normalizeAttempts,failedAttempt,MAX_ATTEMPTS} from './ban-policy.mjs';
export class AuthGuard extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, count INTEGER, start INTEGER, until INTEGER, strikes INTEGER, last INTEGER)');this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS session_revocation (id INTEGER PRIMARY KEY, revoked INTEGER)');}
 read(){return this.ctx.storage.sql.exec('SELECT count,start,until,strikes,last FROM attempts WHERE id=1').toArray()[0];}
 write(row){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO attempts(id,count,start,until,strikes,last) VALUES(1,?,?,?,?,?)',row.count,row.start,row.until,row.strikes,row.last);}
 async attempt(password){
  let now=Date.now(),row=normalizeAttempts(this.read(),now);
  if(row.until>now)return {ok:false,banned:true,retryAfter:Math.ceil((row.until-now)/1000)};
  const valid=await passwordMatches(password,this.env.ACCESS_PASSWORD_HASH);
  // Re-read after hashing so concurrent requests cannot lose failed attempts.
  now=Date.now();row=normalizeAttempts(this.read(),now);
  if(row.until>now)return {ok:false,banned:true,retryAfter:Math.ceil((row.until-now)/1000)};
  if(valid){this.write({count:0,start:now,until:0,strikes:0,last:now});return {ok:true};}
  row=failedAttempt(row,now);this.write(row);
  return {ok:false,banned:row.until>now,retryAfter:Math.max(0,Math.ceil((row.until-now)/1000)),remaining:Math.max(0,MAX_ATTEMPTS-row.count)};
 }
 isRevoked(){return this.ctx.storage.sql.exec('SELECT revoked FROM session_revocation WHERE id=1').toArray()[0]?.revoked===1;}
 revoke(){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO session_revocation VALUES(1,1)');}
}
