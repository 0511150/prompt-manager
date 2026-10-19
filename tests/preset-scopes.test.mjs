import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,validateState} from '../src/model.js';
import {presetScope,presetsForPrompt,normalizePresetScopes,movePromptPresets,removeFolderPresets} from '../src/preset-scopes.js';

test('saved combinations share only inside the exact document folder, including independent child folders',()=>{
 const s=freshState();s.folders.push({id:'child',name:'工作子目录',parent:'work',open:true});s.prompts.push({id:'child-doc',folder:'child',title:'child',body:'@@stack@@',values:{stack:'own input'},updated:1});s.presets.push({id:'work-preset',name:'work',scope:'folder:work',values:{stack:'Rust'}},{id:'child-preset',name:'child',scope:'folder:child',values:{stack:'Go'}});
 assert.equal(presetScope(s,s.prompts.find(p=>p.id==='review')),presetScope(s,s.prompts.find(p=>p.id==='study')));
 assert.deepEqual(presetsForPrompt(s,s.prompts.find(p=>p.id==='review')).map(p=>p.id),['work-preset']);assert.deepEqual(presetsForPrompt(s,s.prompts.find(p=>p.id==='study')).map(p=>p.id),['work-preset']);assert.deepEqual(presetsForPrompt(s,s.prompts.find(p=>p.id==='child-doc')).map(p=>p.id),['child-preset']);assert(!presetsForPrompt(s,s.prompts.find(p=>p.id==='email')).some(p=>p.id==='work-preset'));
});
test('root documents keep separate libraries even if their variable names and values match',()=>{
 const s=freshState(),first=s.prompts.find(p=>p.id==='welcome'),second={...structuredClone(first),id:'other-root'};s.prompts.push(second);s.presets.push({id:'private',name:'private',scope:'prompt:welcome',values:{email:'saved@example.test'}});
 assert(presetsForPrompt(s,first).some(p=>p.id==='private'));assert(!presetsForPrompt(s,second).some(p=>p.id==='private'));assert.notEqual(presetScope(s,first),presetScope(s,second));
});
test('entering a folder shares private combinations without changing current input values',()=>{
 const s=freshState(),p=s.prompts.find(p=>p.id==='welcome'),inputs=structuredClone(s.prompts.map(p=>p.values));s.presets.push({id:'private',name:'private',scope:'prompt:welcome',values:{email:'saved@example.test'}});movePromptPresets(s,p,'work');p.folder='work';normalizePresetScopes(s);
 assert.equal(s.presets.find(p=>p.id==='private').scope,'folder:work');assert(presetsForPrompt(s,s.prompts.find(p=>p.id==='review')).some(p=>p.id==='private'));assert.deepEqual(s.prompts.map(p=>p.values),inputs);
});
test('moving between folders switches libraries, and leaving creates independent private copies',()=>{
 const s=freshState(),p=s.prompts.find(p=>p.id==='email');s.presets.push({id:'work-preset',name:'work',scope:'folder:work',values:{name:'Work identity'}});const input=structuredClone(p.values);movePromptPresets(s,p,'work');p.folder='work';assert.deepEqual(presetsForPrompt(s,p).map(x=>x.id),['work-preset']);assert.equal(s.presets.find(x=>x.id==='p1').scope,'folder:writing');
 movePromptPresets(s,p,null);p.folder=null;const copy=presetsForPrompt(s,p)[0];assert(copy);assert.notEqual(copy.id,'work-preset');copy.values.name='private change';assert.equal(s.presets.find(x=>x.id==='work-preset').values.name,'Work identity');assert.deepEqual(p.values,input);
});
test('deleting a folder preserves independent libraries when its documents move to root',()=>{
 const s=freshState(),folder=s.folders.find(f=>f.id==='work'),members=s.prompts.filter(p=>p.folder==='work');s.presets.push({id:'work-preset',name:'work',scope:'folder:work',values:{name:'shared identity'}});removeFolderPresets(s,folder);for(const p of members)p.folder=null;s.folders=s.folders.filter(f=>f.id!==folder.id);validateState(s);
 const a=presetsForPrompt(s,members[0])[0],b=presetsForPrompt(s,members[1])[0];assert(a&&b);assert.notEqual(a.id,b.id);a.values.name='private';assert.equal(b.values.name,'shared identity');
});
test('old unambiguous combinations migrate, ambiguous and orphaned combinations stay recoverable',()=>{
 const s=freshState();delete s.presets[0].scope;s.presets.push({id:'ambiguous',name:'old email',values:{email:'hello@example.com'}},{id:'unknown',name:'unmatched',values:{secret:'old value'}},{id:'orphan',name:'deleted folder',scope:'folder:missing',values:{name:'preserved'}});validateState(s);
 assert.equal(s.presets.find(p=>p.id==='p1').scope,'folder:writing');for(const id of ['ambiguous','unknown','orphan'])assert.equal(s.presets.find(p=>p.id===id).scope,'unassigned');assert.equal(s.presets.find(p=>p.id==='unknown').values.secret,'old value');const snapshot=structuredClone(s);normalizePresetScopes(s);assert.deepEqual(s,snapshot);
});
test('current inputs and saved combinations are independent snapshots',()=>{
 const s=freshState(),p=s.prompts.find(p=>p.id==='email'),saved=s.presets[0];p.values.email='typed@example.test';assert.equal(saved.values.email,'hello@example.com');saved.values.email='saved@example.test';assert.equal(p.values.email,'typed@example.test');const other=s.prompts.find(p=>p.id==='review');assert.deepEqual(other.values,{stack:'TypeScript',code:'// 在此填入代码'});
});
test('invalid ownership fields are rejected and full libraries never discard combinations on detach',()=>{
 const invalid=freshState();invalid.presets[0].scope='folder:"><script>';assert.throws(()=>validateState(invalid),/范围/);const s=freshState();s.presets=Array.from({length:1000},(_,i)=>({id:'preset-'+i,name:'combo',scope:'folder:work',values:{name:String(i)}}));const p=s.prompts.find(p=>p.id==='review');movePromptPresets(s,p,null);p.folder=null;assert.equal(s.presets.length,1000);removeFolderPresets(s,s.folders.find(f=>f.id==='work'));assert.equal(s.presets.length,1000);
});
