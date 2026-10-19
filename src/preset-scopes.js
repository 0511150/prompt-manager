const folderFor=(state,prompt)=>state.folders.find(folder=>folder.id===prompt?.folder);
export const presetScope=(state,prompt)=>folderFor(state,prompt)?'folder:'+prompt.folder:'prompt:'+prompt.id;
export function presetScopeLabel(state,prompt){const folder=folderFor(state,prompt);return folder?'文件夹「'+folder.name+'」的组合':'仅当前 Prompt 的组合';}
export const presetsForPrompt=(state,prompt)=>state.presets.filter(preset=>preset.scope===presetScope(state,prompt));

// Older versions had no owner field. Only migrate an unambiguous value match;
// keep other old combinations in an archive until the user chooses their scope.
export function normalizePresetScopes(state){
 for(const preset of state.presets){
  if(preset.scope===undefined){const entries=Object.entries(preset.values),scopes=new Set(entries.length?state.prompts.filter(prompt=>entries.every(([name,value])=>Object.hasOwn(prompt.values,name)&&prompt.values[name]===value)).map(prompt=>presetScope(state,prompt)):[]);preset.scope=scopes.size===1?[...scopes][0]:'unassigned';}
  if(preset.scope.startsWith('folder:')&&!state.folders.some(f=>preset.scope==='folder:'+f.id))preset.scope='unassigned';
  if(preset.scope.startsWith('prompt:')){const owner=state.prompts.find(p=>preset.scope==='prompt:'+p.id);if(!owner)preset.scope='unassigned';else if(folderFor(state,owner))preset.scope='folder:'+owner.folder;}
 }
 return state;
}

export function movePromptPresets(state,prompt,targetFolder){
 const source=folderFor(state,prompt),destination=state.folders.find(folder=>folder.id===targetFolder);
 if(source?.id===destination?.id)return;
 if(!source&&destination){for(const preset of state.presets)if(preset.scope==='prompt:'+prompt.id)preset.scope='folder:'+destination.id;}
 if(source&&!destination){const shared=presetsForPrompt(state,prompt);if(state.presets.length+shared.length<=1000)for(const preset of shared)state.presets.push({...structuredClone(preset),id:crypto.randomUUID(),scope:'prompt:'+prompt.id});}
}

export function removeFolderPresets(state,folder){
 const members=state.prompts.filter(p=>p.folder===folder.id),shared=state.presets.filter(preset=>preset.scope==='folder:'+folder.id),parent=state.folders.find(f=>f.id===folder.parent);
 const canCopy=state.presets.length+shared.length*Math.max(0,members.length-1)<=1000;
 for(const preset of shared){
  if(parent)preset.scope='folder:'+parent.id;
  else if(members.length&&canCopy){preset.scope='prompt:'+members[0].id;for(const prompt of members.slice(1))state.presets.push({...structuredClone(preset),id:crypto.randomUUID(),scope:'prompt:'+prompt.id});}
  else preset.scope='unassigned';
 }
}
