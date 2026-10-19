import {DurableObject} from 'cloudflare:workers';
// Kept under the original class/binding so existing signed-out sessions stay revoked.
export class AuthGuard extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS session_revocation (id INTEGER PRIMARY KEY, revoked INTEGER)');}
 isRevoked(){return this.ctx.storage.sql.exec('SELECT revoked FROM session_revocation WHERE id=1').toArray()[0]?.revoked===1;}
 revoke(){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO session_revocation VALUES(1,1)');}
}
