import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditingClient} from '../src/editing-client.js';
import {EDIT_IDLE_MS,contentVersion,overlayChanges} from '../src/edit-protocol.js';
import {freshState} from '../src/model.js';

class DraftMemory{rows=new Map();async put(row){this.rows.set(row.id,structuredClone(row));}async remove(id){this.rows.delete(id);}async list(scope){return [...this.rows.values()].filter(row=>row.scope===scope).map(row=>structuredClone(row));}}
function fixture({idleSeconds=10}={}){let scheduledDelay=null,clock=1000,connected=true,cloud=freshState(),state=null,commits=0,dropResponse=false,paused=false,holdRead=false,releaseRead=null;const drafts=new DraftMemory(),tokens=new Map(),timers={setTimeout:(_callback,delay)=>{scheduledDelay=delay;return 1;},clearTimeout(){},setInterval:()=>1,clearInterval(){}};
 const error=(status,document)=>Object.assign(Error('test error'),{status,data:{document}});
 const request=async(path,options={})=>{if(!connected)throw TypeError('offline');const body=options.body?JSON.parse(options.body):null;if(path==='/api/edit/settings'){if(body)idleSeconds=body.idleSeconds;return Response.json({idleSeconds});}if(path.startsWith('/api/edit/state')){const response=Response.json({settings:{idleSeconds},state:cloud,etag:'"'+commits+'"',workspaceId:'test-scope',locks:[]});if(holdRead){holdRead=false;await new Promise(resolve=>{releaseRead=resolve;});}return response;}if(path==='/api/edit/lease'){if(body.action==='acquire'){if(body.baseVersion!==await contentVersion(cloud.prompts.find(p=>p.id===body.document)||null))throw error(409,body.document);tokens.set(body.document,crypto.randomUUID());return Response.json({token:tokens.get(body.document),until:clock+150000});}if(body.action==='release')tokens.delete(body.document);return Response.json({until:clock+150000});}if(path==='/api/edit/save'){for(const change of body.changes.filter(x=>x.group==='prompts'))assert.equal(body.leases[change.id],tokens.get(change.id));cloud=overlayChanges(cloud,body.changes);commits++;for(const change of body.changes)tokens.delete(change.id);if(dropResponse){dropResponse=false;throw TypeError('response lost');}return Response.json({state:cloud,etag:'"'+commits+'"'});}throw Error(path);};
 const client=new EditingClient({request,getState:()=>state,setState:next=>{state=next;},drafts,now:()=>clock,online:()=>connected,pause:()=>paused,timers});return {client,drafts,get scheduledDelay(){return scheduledDelay;},setRemoteIdle:seconds=>{idleSeconds=seconds;},get state(){return state;},get cloud(){return cloud;},get commits(){return commits;},advance:ms=>{clock+=ms;},offline:()=>{connected=false;client.offline=true;},online:()=>{connected=true;},drop:()=>{dropResponse=true;},pause:()=>{paused=true;},resume:()=>{paused=false;},hold:()=>{holdRead=true;},releaseRead:()=>releaseRead(),otherEdit:(id,text)=>{cloud.prompts.find(p=>p.id===id).body=text;}};
}
test('idle save is measured per file and releases ownership after the cloud acknowledgment',async()=>{
 const f=fixture(),c=f.client;await c.boot();await c.startEdit('email');f.state.prompts.find(p=>p.id==='email').body='first file draft';c.changed();await c.persist();
 f.advance(EDIT_IDLE_MS-1000);await c.startEdit('review');f.state.prompts.find(p=>p.id==='review').body='second file draft';c.changed();await c.flush({all:false});assert.equal(f.commits,0,'typing and navigation do not trigger an early file save');
 f.advance(1000);await c.flush({all:false});assert.equal(f.commits,1);assert.equal(f.cloud.prompts.find(p=>p.id==='email').body,'first file draft');assert.notEqual(f.cloud.prompts.find(p=>p.id==='review').body,'second file draft');assert(!c.owned('email'));assert(c.owned('review'));assert(c.dirty);
 await c.flush();assert.equal(f.commits,2);assert(!c.dirty);assert.equal((await f.drafts.list('test-scope')).length,0);c.dispose();
});
test('offline drafts survive a page and stale reconnection preserves both cloud and local text',async()=>{
 const f=fixture(),c=f.client;await c.boot();await c.startEdit('email');f.offline();f.state.prompts.find(p=>p.id==='email').body='offline local text';c.changed();await c.persist();await c.flush();assert.equal(f.commits,0);const record=(await f.drafts.list('test-scope'))[0];assert.equal(record.changes[0].after.body,'offline local text');
 f.otherEdit('email','new text from another device');f.online();await c.reconnect();assert.equal(f.commits,0);assert(c.conflicted);assert.equal(f.state.prompts.find(p=>p.id==='email').body,'offline local text');assert.equal(f.cloud.prompts.find(p=>p.id==='email').body,'new text from another device');assert(!c.editable('email'));
 await c.saveCopy('email');assert.equal(f.cloud.prompts.find(p=>p.id==='email').body,'new text from another device');assert(f.cloud.prompts.some(p=>p.id!=='email'&&p.body==='offline local text'));c.dispose();
});
test('a lost save response is recovered without overwriting or creating a second history write',async()=>{
 const f=fixture(),c=f.client;await c.boot();await c.startEdit('review');f.state.prompts.find(p=>p.id==='review').body='saved before response loss';c.changed();f.drop();await c.flush();assert(c.dirty);assert.equal(f.commits,1);await c.reconnect();assert(!c.dirty);assert.equal(f.commits,1);assert.equal((await f.drafts.list('test-scope')).length,0);c.dispose();
});
test('recovering a stored page draft uses its original base instead of silently rebasing over new text',async()=>{
 const f=fixture(),c=f.client;await c.boot();const before=structuredClone(f.state.prompts.find(p=>p.id==='email')),after={...before,body:'draft from a closed page'};await f.drafts.put({id:'old-page',scope:'test-scope',savedAt:1,changes:[{group:'prompts',id:'email',before,after}]});f.otherEdit('email','cloud changed while page closed');await c.readDrafts();await c.recover('old-page');assert(c.conflicted);assert.equal(f.state.prompts.find(p=>p.id==='email').body,'draft from a closed page');assert.equal(f.commits,0);assert((await f.drafts.list('test-scope')).some(x=>x.id==='old-page'));c.dispose();
});

test('an older read response cannot roll back a newly acknowledged save',async()=>{
 const f=fixture(),c=f.client;await c.boot();f.hold();const reading=c.refresh();await c.startEdit('email');f.state.prompts.find(p=>p.id==='email').body='newly saved text';c.changed();await c.flush();f.releaseRead();await reading;assert.equal(f.state.prompts.find(p=>p.id==='email').body,'newly saved text');assert(!c.dirty);c.dispose();
});
test('a form in progress defers background rebasing and resumes idle save after closing',async()=>{
 const f=fixture(),c=f.client;await c.boot();await c.startEdit('email');f.state.prompts.find(p=>p.id==='email').body='draft with a form open';c.changed();f.pause();f.advance(EDIT_IDLE_MS);await c.flush({all:false});assert.equal(f.commits,0);assert(c.dirty);f.resume();await c.flush({all:false});assert.equal(f.commits,1);assert(!c.dirty);c.dispose();
});

test('configurable seconds reschedule each file from its own last edit without resetting its clock',async()=>{
 const f=fixture(),c=f.client;await c.boot();assert.equal(c.idleSeconds,10);assert.equal(c.idleMs,10_000);
 await c.startEdit('email');f.state.prompts.find(p=>p.id==='email').body='email draft';c.changed();f.advance(9000);
 await c.updateSettings(25);assert.equal(c.idleSeconds,25);assert.equal(f.scheduledDelay,16000);await c.flush({all:false});assert.equal(f.commits,0);
 f.advance(11000);await c.flush({all:false});assert.equal(f.commits,0);await c.startEdit('review');f.state.prompts.find(p=>p.id==='review').body='review draft';c.changed();
 await c.updateSettings(10);assert.equal(f.scheduledDelay,50);await c.flush({all:false});assert.equal(f.commits,1);assert(!c.owned('email'));assert(c.owned('review'));assert(c.dirty);
 f.advance(9999);await c.flush({all:false});assert.equal(f.commits,1);f.advance(1);await c.flush({all:false});assert.equal(f.commits,2);assert(!c.dirty);assert(!c.owned('review'));c.dispose();
});

test('workspace timing loads on boot and refresh and releases an unchanged file without a content save',async()=>{
 const f=fixture({idleSeconds:4}),c=f.client;await c.boot();assert.equal(c.idleSeconds,4);await c.startEdit('email');assert.equal(f.scheduledDelay,4000);f.advance(3000);
 f.setRemoteIdle(2);await c.refresh();assert.equal(c.idleSeconds,2);assert.equal(f.scheduledDelay,50);await c.flush({all:false});assert(!c.owned('email'));assert.equal(f.commits,0);assert(!c.dirty);
 f.setRemoteIdle(30);await c.readSettings();assert.equal(c.idleSeconds,30);assert(!c.dirty);c.dispose();
});

test('a delayed snapshot cannot roll back a newly saved lock timeout',async()=>{
 const f=fixture(),c=f.client;await c.boot();f.hold();const reading=c.refresh();await c.updateSettings(120);f.releaseRead();await reading;assert.equal(c.idleSeconds,120);assert(!c.dirty);c.dispose();
});

test('an attachment upload failure keeps the document draft and lease until a successful retry',async()=>{
 const f=fixture(),c=f.client;await c.boot();await c.startEdit('email');f.state.prompts.find(p=>p.id==='email').body='image draft';c.changed();let ready=false,attempts=0;
 c.beforeSave=async changes=>{attempts++;assert(changes.some(change=>change.group==='prompts'&&change.id==='email'));if(!ready)throw Object.assign(Error('image upload pending'),{status:400});};
 await c.flush();assert.equal(f.commits,0);assert(c.dirty);assert(c.owned('email'));assert.equal(f.drafts.rows.get(c.client).changes[0].after.body,'image draft');
 ready=true;await c.flush();assert.equal(attempts,2);assert.equal(f.commits,1);assert.equal(f.cloud.prompts.find(p=>p.id==='email').body,'image draft');assert(!c.dirty);assert(!c.owned('email'));c.dispose();
});

test('revoked files remain read-only with durable drafts until manual reacquisition; other files still save',async()=>{
 const f=fixture(),c=f.client;await c.boot();await c.startEdit('email');f.state.prompts.find(p=>p.id==='email').body='displaced local draft';c.changed();await c.persist();
 const request=c.request;let revoked=true,automaticAttempts=0;
 c.request=async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;if(path.startsWith('/api/edit/state')){const data=await (await request(path,options)).json();return Response.json({...data,revoked:revoked?['email']:[]});}if(path==='/api/edit/lease'&&body.document==='email'){if(body.action==='acquire'){automaticAttempts++;throw Error('must not automatically reacquire');}if(body.action==='takeover'){revoked=false;return request(path,{...options,body:JSON.stringify({...body,action:'acquire'})});}}return request(path,options);};
 await c.tick();assert.equal(c.problems.get('email'),'revoked');assert(!c.editable('email'));assert(!await c.startEdit('email'));await c.flush();assert.equal(f.commits,0);assert.equal(automaticAttempts,0);assert.equal(f.drafts.rows.get(c.client).changes[0].after.body,'displaced local draft');
 await c.startEdit('review');f.state.prompts.find(p=>p.id==='review').body='independent draft';c.changed();await c.flush({ids:['review']});assert.equal(f.cloud.prompts.find(p=>p.id==='review').body,'independent draft');assert.equal(c.problems.get('email'),'revoked');assert(c.dirty);
 assert(await c.takeover('email'));assert(c.editable('email'));await c.flush();assert.equal(f.cloud.prompts.find(p=>p.id==='email').body,'displaced local draft');assert(!c.dirty);
 revoked=true;await c.refresh();f.offline();await assert.rejects(c.takeover('email'),/联网/);f.online();f.otherEdit('email','cloud changed after takeover');f.state.prompts.find(p=>p.id==='email').body='another local draft';c.changed();assert.equal(await c.takeover('email'),false,'manual takeover never bypasses a content conflict');assert.equal(f.cloud.prompts.find(p=>p.id==='email').body,'cloud changed after takeover');assert.equal(f.state.prompts.find(p=>p.id==='email').body,'another local draft');c.dispose();
});

test('a delayed revoked snapshot cannot remove a freshly acquired takeover lease',async()=>{
 const f=fixture(),c=f.client;await c.boot();c.setRevocations(['email']);const request=c.request;
 c.request=async(path,options={})=>{if(path.startsWith('/api/edit/state')){const revoked=c.problems.get('email')==='revoked';const data=await (await request(path,options)).json();return Response.json({...data,revoked:revoked?['email']:[]});}if(path==='/api/edit/lease'){const body=JSON.parse(options.body);if(body.action==='takeover')return request(path,{...options,body:JSON.stringify({...body,action:'acquire'})});}return request(path,options);};
 f.hold();const reading=c.refresh();assert(await c.startEdit('email',{takeover:true}));f.releaseRead();assert.equal(await reading,null);assert(c.editable('email'));assert.equal(c.problems.get('email'),undefined);c.dispose();
});
