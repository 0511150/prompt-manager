import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {resolve} from 'node:path';

const create=bindings=>new Miniflare(convertV4MiniflareOptions({name:'deployment-validation',modules:true,scriptPath:resolve('dist/worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{AUTH_GUARD:{className:'AuthGuard',useSQLite:true},ACCESS_CONTROL:{className:'AccessControl',useSQLite:true}},r2Buckets:['VAULTS'],bindings}));

test('missing or short deployment passwords never expose the app or create credentials',async()=>{
 for(const bindings of [{},{ACCESS_PASSWORD:'too-short'}]){
  const mf=create(bindings);
  try{
   assert.equal((await mf.dispatchFetch('https://test.invalid/')).status,503);
   assert.equal((await mf.dispatchFetch('https://test.invalid/app.js')).status,503);
   const control=(await mf.getDurableObjectNamespace('ACCESS_CONTROL')).getByName('workspace-access');assert.equal(await control.storedCredentials(),null);
  }finally{await mf.dispose();}
 }
});

test('deployment password cannot regenerate missing keys over an existing R2 workspace',async()=>{
 const mf=create({ACCESS_PASSWORD:'local-deployment-password-only'});
 try{
  const bucket=await mf.getR2Bucket('VAULTS'),original='{"existingEncryptedWorkspace":true}';await bucket.put('workspace/current.json',original);
  assert.equal((await mf.dispatchFetch('https://test.invalid/')).status,500);
  const control=(await mf.getDurableObjectNamespace('ACCESS_CONTROL')).getByName('workspace-access');assert.equal(await control.storedCredentials(),null);
  assert.equal(await (await bucket.get('workspace/current.json')).text(),original);
 }finally{await mf.dispose();}
});
