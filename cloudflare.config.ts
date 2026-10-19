import {defineConfig, bindings, exports, triggers} from 'cf/config';
const workerName=process.env.CLOUDFLARE_WORKER_NAME||'prompt-manager';
export default defineConfig({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  worker: {
    name: workerName,
    entrypoint: './src/private-worker.mjs',
    compatibilityDate: '2026-10-19',
    env: {
      VAULTS: bindings.r2({name:process.env.CLOUDFLARE_R2_BUCKET||'prompt-manager-vaults'}),
      AUTH_GUARD: bindings.durableObject({worker:workerName,exportName:'AuthGuard'}),
      ACCESS_CONTROL: bindings.durableObject({worker:workerName,exportName:'AccessControl'}),
      WORKSPACE_EDITOR: bindings.durableObject({worker:workerName,exportName:'WorkspaceEditor'}),
      ACCESS_PASSWORD_HASH: bindings.secret(),
      SESSION_SECRET: bindings.secret(),
      DATA_KEY: bindings.secret()
    },
    exports: {AuthGuard: exports.durableObject({storage:'sqlite'}),AccessControl: exports.durableObject({storage:'sqlite'}),WorkspaceEditor: exports.durableObject({storage:'sqlite'})},
    domains: process.env.CLOUDFLARE_CUSTOM_DOMAIN?[process.env.CLOUDFLARE_CUSTOM_DOMAIN]:[],
    workersDev: true,
    triggers: [triggers.scheduled({schedule:'0 * * * *'})],
    observability: {enabled:true, logs:{enabled:true, invocationLogs:false},traces:{enabled:true,headSamplingRate:0.01}}
  }
});
