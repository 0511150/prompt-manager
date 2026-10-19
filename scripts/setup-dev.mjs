import {writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';

// These credentials are exclusively for the local integration tests.
const password='local-integration-password-only';
const content=[
  `ACCESS_PASSWORD_HASH=${createHash('sha256').update(password).digest('hex')}`,
  `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
  `DATA_KEY=${randomBytes(32).toString('base64')}`,
  ''
].join('\n');
try{
  await writeFile('.dev.vars',content,{flag:'wx',mode:0o600});
  console.log('Created local-only .dev.vars. Test password: '+password);
}catch(error){
  if(error.code!=='EEXIST')throw error;
  console.log('Kept existing .dev.vars; no credentials were replaced.');
}
