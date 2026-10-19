import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir,copyFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const output=resolve('dist');
if(dirname(output)!==process.cwd())throw Error('Build output must be inside the project');
await rm(output,{recursive:true,force:true});
await mkdir('dist/fonts',{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,format:'esm',minify:true,outfile:'dist/app.js',loader:{'.woff2':'file','.woff':'file','.ttf':'file'},assetNames:'fonts/[name]-[hash]'});
await copyFile('public/index.html','dist/index.html');
await copyFile('public/style.css','dist/style.css');
for(const name of ['login.html','login.css','login.js'])await copyFile('public/'+name,'dist/'+name);
const files={};
async function scan(dir,prefix='') {for(const name of await readdir(dir,{withFileTypes:true})){const rel=prefix+name.name;if(name.isDirectory()) await scan(dir+'/'+name.name,rel+'/');else {const mime=rel.endsWith('.html')?'text/html; charset=utf-8':rel.endsWith('.js')?'text/javascript; charset=utf-8':rel.endsWith('.css')?'text/css; charset=utf-8':rel.endsWith('.woff2')?'font/woff2':rel.endsWith('.woff')?'font/woff':'font/ttf';files['/'+rel]={type:mime,body:(await readFile(dir+'/'+name.name)).toString('base64')};}}}
await scan('dist');
await writeFile('src/assets.generated.mjs','export default '+JSON.stringify(files)+';');
console.log('Built '+Object.keys(files).length+' assets.');
