// Ordering belongs to a folder, separately from document contents and leases.
export const promptFolder=(state,prompt)=>state.folders.some(f=>f.id===prompt.folder)?prompt.folder:null;
export function sortedPrompts(state,folder){
 const prompts=state.prompts.filter(p=>promptFolder(state,p)===folder),order=state.promptOrders?.find(o=>o.folder===folder),rank=new Map((order?.ids||[]).map((id,index)=>[id,index]));
 const treeRank=new Map((state.treeOrders?.find(o=>o.parent===folder)?.keys||[]).map((key,index)=>[key,index]));
 return prompts.sort((a,b)=>(treeRank.get('prompt:'+a.id)??Infinity)-(treeRank.get('prompt:'+b.id)??Infinity)||(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));
}
export async function promptOrderId(folder){
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(folder)));
 return 'order-'+[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function reorderPrompt(state,folder,source,target,after,id){
 const prompts=sortedPrompts(state,folder),ids=prompts.map(p=>p.id);
 if(!ids.includes(source)||source===target||target&&!ids.includes(target))return false;
 const next=ids.filter(value=>value!==source),at=target?next.indexOf(target)+(after?1:0):next.length;
 next.splice(at,0,source);
 if(JSON.stringify(ids)===JSON.stringify(next))return false;
 state.promptOrders??=[];
 const order=state.promptOrders.find(o=>o.folder===folder);
 if(order)order.ids=next;else state.promptOrders.push({id,folder,ids:next});
 return true;
}
export function normalizePromptOrders(state){
 state.promptOrders=(state.promptOrders||[]).filter(o=>o.folder===null||state.folders.some(f=>f.id===o.folder));
 const parents=new Map(state.prompts.map(p=>[p.id,promptFolder(state,p)]));
 for(const order of state.promptOrders)order.ids=order.ids.filter(id=>parents.has(id)&&parents.get(id)===order.folder);
 return state;
}
