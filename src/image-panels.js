import {promptImages,imageTokens,imageUrl,uniqueImageName} from './images.js';
export class ImagePanels{
 constructor(hooks){Object.assign(this,hooks);this.trashItems=[];}
 async addFiles(files,{promptId=this.current()?.id,atEnd=false}={}){
  let p=this.state().prompts.find(p=>p.id===promptId);if(!p)throw Error('请先打开一个 Prompt');if(!files.length)return;
  if(!await this.ensure([p.id]))return;const editor=document.querySelector('#editor'),original=p.body,start=atEnd?p.body.length:editor?.selectionStart??p.body.length,end=atEnd?start:editor?.selectionEnd??start;
  const ready=[];for(const file of files){if(file.size>8*1024*1024)throw Error('单张图片不能超过 8 MB');ready.push({meta:await this.images.prepare(file),name:file.name});}
  if(!await this.ensure([promptId]))return;p=this.state().prompts.find(p=>p.id===promptId);if(!p)return;
  const metadata=structuredClone(p.images||[]),insert=[];
  for(const {meta,name}of ready){let image=metadata.find(i=>i.id===meta.id);if(!image){image={...meta,name:uniqueImageName(name,metadata,meta.type)};metadata.push(image);}insert.push('!['+image.name+']('+imageUrl(image.id)+')');}
  if(metadata.length>200)throw Error('每份 Prompt 最多保留 200 个图片附件');
  const text='\n'+insert.join('\n\n')+'\n';p.images=metadata;p.body=p.body===original?p.body.slice(0,start)+text+p.body.slice(end):p.body+text;p.updated=Date.now();this.changed();this.render();this.toast('已添加 '+ready.length+' 张图片');
 }
 gallery(promptId=this.current()?.id){
  const p=this.state().prompts.find(p=>p.id===promptId);if(!p)return;const images=promptImages(p),{button,esc}=this;
  this.modal(this.header('复制图片',images.length?button('download-images','下载 ZIP','arrow',`data-id="${esc(p.id)}" class="image-zip-button"`):'')+`<div class="image-gallery-list" tabindex="0" aria-label="图片列表">${images.map(i=>`<figure class="image-gallery-card"><img data-image-id="${i.id}" alt="${esc(i.name)}"><figcaption><strong title="${esc(i.name)}">${esc(i.name)}</strong>${button('rename-image','','edit',`class="icon-button" aria-label="重命名 ${esc(i.name)}" title="重命名" data-id="${i.id}" data-prompt="${esc(p.id)}"`)}</figcaption></figure>`).join('')||'<p class="empty-dialog">暂无图片</p>'}</div>`);
  this.decorate();void this.images.hydrate(document.querySelector('#modal'));
 }
 header(title,action=''){return `<div class="modal-head"><h2>${this.esc(title)}</h2><div class="image-header-actions">${action}${this.button('dismiss','','close','class="icon-button" aria-label="关闭"')}</div></div>`;}
 decorate(){document.querySelector('#modal').classList.add('image-gallery-panel');this.position();}
 async copy(id){await this.images.copy(id);this.toast('已复制图片，可粘贴到聊天框');}
 async zip(id,el){const p=this.state().prompts.find(p=>p.id===id);if(!p)return;el.disabled=true;try{const blob=await this.images.zip(promptImages(p));this.download(blob,(p.title||'Prompt').replace(/[<>:"/\\|?*]/g,'_')+'-图片.zip');this.toast('已下载 ZIP · 原图仅打包');}finally{if(el.isConnected)el.disabled=false;}}
 async downloadOne(id,el){const image=this.state().prompts.find(p=>p.id===el.dataset.prompt)?.images?.find(i=>i.id===id);if(image)this.download(await this.images.blob(id),image.name);}
 async remove(id,el){const pid=el.dataset.prompt;if(!await this.ensure([pid]))return;const p=this.state().prompts.find(p=>p.id===pid);if(!p)return;for(const token of imageTokens(p.body).filter(t=>t.id===id))p.body=p.body.replaceAll(token.raw,'');p.images=(p.images||[]).filter(i=>i.id!==id);p.updated=Date.now();this.changed();this.render();this.gallery(pid);}
 async rename(id,el){const pid=el.dataset.prompt;if(!await this.ensure([pid]))return;const p=this.state().prompts.find(p=>p.id===pid),image=p?.images?.find(i=>i.id===id);if(!image)return;this.nameDialog('图片名称',image.name,name=>{image.name=uniqueImageName(name,p.images.filter(i=>i.id!==id),image.type);for(const token of imageTokens(p.body).filter(t=>t.id===id))p.body=p.body.replaceAll(token.raw,'!['+image.name+']('+imageUrl(id)+')');p.updated=Date.now();this.changed();this.render();});}
 async trash(){
  this.modal(this.header('图片回收站')+'<p id="image-trash-loading" class="inline-note">正在加载…</p>');const marker=document.querySelector('#image-trash-loading');
  const data=await (await this.request('/api/images/trash')).json();if(!marker.isConnected||!document.querySelector('#modal').open)return;this.trashItems=data.items;const {button,esc}=this;
  this.modal(this.header('图片回收站')+`<div class="image-gallery-list" tabindex="0" aria-label="图片列表">${data.items.map(i=>`<figure class="image-gallery-card"><img data-image-id="${i.id}" alt="${esc(i.name)}"><figcaption><strong title="${esc(i.name)} · ${i.protectedByHistory?'保留的历史仍在引用':new Date(i.deleteAt).toLocaleString()+' 后自动删除'}">${esc(i.name)}</strong>${button('recover-image','','refresh',`data-id="${i.id}" class="icon-button" aria-label="找回 ${esc(i.name)}" title="找回到当前 Prompt" ${this.current()?'':'disabled'}`)}</figcaption></figure>`).join('')||'<p class="empty-dialog">暂无图片</p>'}</div>`);this.decorate();void this.images.hydrate(document.querySelector('#modal'));
 }
 async recover(id){const image=this.trashItems.find(i=>i.id===id),p=this.current();if(!image||!p)throw Error('请先打开一个 Prompt');const blob=await this.images.blob(id);await this.addFiles([new File([blob],image.name,{type:blob.type})],{promptId:p.id,atEnd:true});this.gallery(p.id);}
}
