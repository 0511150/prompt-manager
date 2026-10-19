import {normalizePresetScopes} from './preset-scopes.js';
export const uid=()=>crypto.randomUUID();
export const variableNames=text=>[...new Set([...text.matchAll(/@@([^@\n]+)@@/g)].map(x=>x[1].trim()).filter(Boolean))];
export function fillVariables(text,values){return text.replace(/@@([^@\n]+)@@/g,(full,name)=>Object.hasOwn(values,name.trim())&&values[name.trim()]!==''?values[name.trim()]:full);}
export const missingVariables=(text,values)=>variableNames(text).filter(k=>!Object.hasOwn(values,k)||values[k]==='');
export function freshState(){return {version:1,folders:[{id:'writing',name:'写作与表达',parent:null,open:true},{id:'work',name:'工作与效率',parent:null,open:true}],prompts:[
{id:'welcome',folder:null,title:'从这里开始',body:'# 欢迎来到你的 Prompt 工作台\n\n把常用的想法，整理成随时可用的 Prompt。\n\n## 像浏览器一样，轻松整理\n\n- **左侧文件夹**：管理全部 Prompt，可拖动归类\n- **顶部收藏栏**：固定常用 Prompt，拥有独立的收藏文件夹\n- **New Tab**：新建文档，不打断当前的思路\n\n## 一份模板，多种用法\n\n写下 `@@变量名@@`，在上方填写变量，点 **复制成品** 就能得到替换后的完整内容。\n\n> 例如：我的邮箱是 @@email@@，请用 @@language@@ 回复。\n\n保存一组常用变量，下次从 **组合库** 一键填入。\n\n## Markdown 与公式\n\n支持标题、列表、引用、表格、代码，以及 LaTeX：\n\n$$E = mc^2$$\n\n在右上方切换「编辑 / 预览 / 对照」。所有修改会自动保存。',values:{email:'hello@example.com',language:'中文'},updated:Date.now()},
{id:'email',folder:'writing',title:'写一封得体的邮件',body:'# 邮件写作助手\n\n你是一名专业的沟通顾问。请帮我写一封清晰、自然、有礼貌的邮件。\n\n## 基本信息\n\n- 收件人：@@recipient@@\n- 发件人：@@name@@\n- 联系邮箱：@@email@@\n- 语气：@@tone@@\n\n## 需要表达的内容\n\n@@message@@\n\n## 输出要求\n\n1. 提供一个简洁、明确的主题。\n2. 正文分段，优先使用简短的句子。\n3. 给出明确的下一步行动。\n4. 用中文输出，可以直接复制发送。',values:{recipient:'项目合作伙伴',name:'Alex',email:'hello@example.com',tone:'友好、专业',message:'确认下周的项目会议，并请对方提前发来议程。'},updated:Date.now()},
{id:'review',folder:'work',title:'代码审查',body:'# 代码审查\n\n请以资深 @@stack@@ 工程师的身份，审查下面的代码。\n\n重点关注：正确性、安全性和可维护性。每个问题都给出原因、影响和修改建议。\n\n```\n@@code@@\n```\n\n请按照严重程度排序，避免仅涉及个人风格的建议。',values:{stack:'TypeScript',code:'// 在此填入代码'},updated:Date.now()},
{id:'study',folder:'work',title:'把复杂概念讲清楚',body:'# 学习一个新概念\n\n请向一位 @@level@@ 学习者解释 **@@topic@@**。\n\n先给直观解释，再用一个日常比喻，最后举一个实际例子。\n\n如果包含数学公式，使用 LaTeX。每次只引入一个新概念，并提供一道小练习。',values:{level:'刚入门',topic:'贝叶斯定理'},updated:Date.now()}
],bookmarkFolders:[{id:'daily',name:'日常常用'}],bookmarks:[{id:'b1',prompt:'email',folder:null},{id:'b2',prompt:'review',folder:null},{id:'b3',prompt:'study',folder:'daily'}],presets:[{id:'p1',name:'示例 · 工作邮件',scope:'folder:writing',values:{name:'Alex',email:'hello@example.com',tone:'友好、专业'},updated:Date.now()}],tabs:['welcome','email'],active:'email'};}
export function validateState(s){
 if(!s||s.version!==1||!Array.isArray(s.prompts)||!Array.isArray(s.folders)||!Array.isArray(s.bookmarks)||!Array.isArray(s.bookmarkFolders)||!Array.isArray(s.presets))throw Error('文件不是有效的 Prompt 工作台备份');
 const str=x=>typeof x==='string';const values=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.entries(x).every(([k,v])=>str(k)&&str(v));
 if(s.prompts.length>2000||s.folders.length>500||s.bookmarks.length>3000||s.presets.length>1000)throw Error('备份内容超出限制');
 const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
 for(const group of [s.prompts,s.folders,s.bookmarks,s.bookmarkFolders,s.presets])for(const item of group)if(!validId(item.id))throw Error('备份标识格式不正确');
 for(const p of s.prompts)if(!str(p.id)||!str(p.title)||!str(p.body)||!values(p.values)||!(p.folder===null||str(p.folder)))throw Error('Prompt 内容格式不正确');
 for(const f of s.folders)if(!str(f.id)||!str(f.name)||!(f.parent===null||str(f.parent)))throw Error('文件夹格式不正确');
 for(const f of s.bookmarkFolders)if(!str(f.id)||!str(f.name))throw Error('收藏文件夹格式不正确');
 for(const b of s.bookmarks)if(!str(b.id)||!str(b.prompt)||!(b.folder===null||str(b.folder)))throw Error('收藏格式不正确');
 for(const p of s.presets)if(!str(p.id)||!str(p.name)||!values(p.values))throw Error('变量组合格式不正确');
 for(const preset of s.presets)if(preset.scope!==undefined&&(typeof preset.scope!=='string'||!(/^(?:folder|prompt):[a-zA-Z0-9_-]{1,100}$/.test(preset.scope)||preset.scope==='unassigned')))throw Error('变量组合范围不正确');
 const ids=s.prompts.map(p=>p.id);if(new Set(ids).size!==ids.length||new Set(s.folders.map(f=>f.id)).size!==s.folders.length)throw Error('备份中有重复标识');
 for(const f of s.folders){const seen=new Set([f.id]);let p=f.parent;while(p){if(seen.has(p))throw Error('文件夹不能循环嵌套');seen.add(p);p=s.folders.find(x=>x.id===p)?.parent;}}
 s.tabs=(Array.isArray(s.tabs)?s.tabs:[]).filter(id=>ids.includes(id));if(!s.tabs.includes(s.active))s.active=s.tabs[0]||null;return normalizePresetScopes(s);
}
