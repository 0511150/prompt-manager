// Resolve pointer coordinates separately from rendering so boundaries are testable.
export function resolveTreeDrop(levels,x,y){
 const level=levels.filter(l=>l.root||x>=l.left-6&&y>=l.top&&y<=l.bottom).sort((a,b)=>b.depth-a.depth)[0];if(!level)return null;
 const entry=level.entries.find(e=>y<=e.bottom)||level.entries.at(-1);
 if(!entry)return {parent:level.parent,target:null,after:true,inside:false,lineY:level.top,left:level.left,right:level.right};
 const height=entry.headerBottom-entry.top;
 if(entry.kind==='folder'&&x>=entry.left+14&&y>=entry.top+height*.25&&y<=entry.headerBottom-height*.25)return {parent:entry.id,target:null,after:true,inside:true,element:entry.header};
 const after=y>=entry.top+height/2;
 return {parent:level.parent,target:entry.key,after,inside:false,lineY:after?entry.bottom:entry.top,left:level.left,right:level.right};
}
