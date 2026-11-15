const team=[
  {name:'ChatGPT',agent:'ChatGPT',color:'gpt'},
  {name:'Claude',agent:'Claude',color:'claude'},
  {name:'Claude Code',agent:'Claude Code',color:'claude-code'},
  {name:'DeepSeek',agent:'DeepSeek',color:'deepseek'},
  {name:'Muse',agent:null,color:'muse'},
  {name:'Codex',agent:'Codex',color:'codex'}
];
const realAgents=team.filter(member=>member.agent).map(member=>member.agent);
const $=id=>document.getElementById(id);
const displayName=agent=>team.find(member=>member.agent===agent)?.name||agent;
const groupEnabledKey='ai-nexus-group-enabled-v1';
const groupEnabledCookie='ai_nexus_group_enabled';
function parseGroupEnabled(raw){
  if(!raw)return null;
  try{
    const saved=JSON.parse(raw),values=saved?.values||saved;
    if(!values||typeof values!=='object')return null;
    const selected=Object.fromEntries(realAgents.filter(agent=>typeof values[agent]==='boolean').map(agent=>[agent,values[agent]]));
    return Object.keys(selected).length?{selected}:null;
  }catch{return null;}
}
function groupCookieValue(){
  const entry=document.cookie.split(';').map(item=>item.trim()).find(item=>item.startsWith(groupEnabledCookie+'='));
  return entry?decodeURIComponent(entry.slice(groupEnabledCookie.length+1)):null;
}
function clearGroupCookie(){
  document.cookie=groupEnabledCookie+'=; Path=/; Max-Age=0; SameSite=Strict'+(location.protocol==='https:'?'; Secure':'');
}
function localGroupEnabled(){
  try{return parseGroupEnabled(localStorage.getItem(groupEnabledKey));}catch{return null;}
}
function loadGroupEnabled(){
  const values=Object.fromEntries(realAgents.map(agent=>[agent,agent==='Claude'||agent==='Codex']));
  const applySaved=saved=>{
    const choices={...saved.selected};
    // Before the split, the Claude card stored its choice under Claude Code.
    if(!Object.hasOwn(choices,'Claude')&&Object.hasOwn(choices,'Claude Code')){
      choices.Claude=choices['Claude Code'];choices['Claude Code']=false;
      return {values:{...values,...choices},migrated:true};
    }
    return {values:{...values,...choices},migrated:false};
  };
  // The existing localStorage choice is authoritative; the old cookie is read
  // only when that key has no usable value.
  const local=localGroupEnabled();
  if(local){const restored=applySaved(local);if(restored.migrated)try{localStorage.setItem(groupEnabledKey,JSON.stringify({values:restored.values}));}catch{}return restored.values;}
  let cookie=null;
  try{cookie=parseGroupEnabled(groupCookieValue());}catch{}
  if(cookie){
    Object.assign(values,applySaved(cookie).values);
    try{
      const migrated=JSON.stringify({values});
      localStorage.setItem(groupEnabledKey,migrated);
      if(localStorage.getItem(groupEnabledKey)===migrated)clearGroupCookie();
    }catch{}
  }
  return values;
}
const enabled=loadGroupEnabled();
function updateGroupCheckboxes(){
  for(const input of document.querySelectorAll('input[data-group-agent]'))input.checked=enabled[input.dataset.groupAgent];
}
function setGroupEnabled(agent,value){
  const next={...enabled,[agent]:value};
  const saved=JSON.stringify({values:next});
  const hadLocal=!!localGroupEnabled();
  let persisted=false;
  try{localStorage.setItem(groupEnabledKey,saved);persisted=localStorage.getItem(groupEnabledKey)===saved;}catch{}
  if(persisted){
    try{clearGroupCookie();}catch{}
  }else if(!hadLocal){
    try{
      document.cookie=groupEnabledCookie+'='+encodeURIComponent(saved)+'; Path=/; Max-Age=31536000; SameSite=Strict'+(location.protocol==='https:'?'; Secure':'');
      persisted=groupCookieValue()===saved;
    }catch{}
  }
  if(!persisted){toast('无法保存群聊成员设置，请检查 Safari 网站存储');updateGroupCheckboxes();return;}
  Object.assign(enabled,next);updateGroupCheckboxes();updateRoom();updateSend();
}
function syncGroupEnabled(){
  const saved=loadGroupEnabled();
  if(realAgents.every(agent=>enabled[agent]===saved[agent]))return;
  Object.assign(enabled,saved);updateGroupCheckboxes();updateRoom();updateSend();
}
const memoryFields=['background','decisions','progress','todos'];
let busy=false,discussing=false,agentStatus={},toastTimer,memoryRevision=null,memoryReady=false,memoryDirty=false,currentSession=null,sessionList=[],projects=[],projectFilter='all',viewGeneration=0,currentProject=null,editingNote=null,editingNoteSourceName=null;
let quotedMessageId=null,mentionChoices=[],mentionIndex=0,mentionStart=-1;
let handoffDraft=null;
let integrationDraft=null;
let workspaceGrant=null;
let workspaceProposals=[];
let organizer={bookmarks:[],todos:[]},utilityPage=null,todoDraft=null,organizerBusy=false;
async function loadOrganizer(){
 const response=await fetch('/api/organizer'),data=await response.json();
 if(!response.ok)throw Error(data.error||'收藏与待办读取失败');
 organizer=data;renderBookmarks();renderTodos();syncBookmarkButtons();
}
function syncBookmarkButtons(){
 for(const button of document.querySelectorAll('[data-bookmark-message]')){
  const saved=organizer.bookmarks.some(b=>b.sessionId===currentSession?.id&&b.messageId===button.dataset.bookmarkMessage);
  button.textContent=saved?'取消收藏':'收藏';button.setAttribute('aria-pressed',String(saved));
 }
}
function sourceButton(source,available,label='查看原消息'){
 const button=document.createElement('button');button.type='button';button.textContent=available?label:'原消息不可用';button.disabled=!available;
 button.onclick=async()=>{try{if(currentSession?.id===source.sessionId)showView('chat');else await openSession(source.sessionId);jumpToMessage(source.messageId);}catch(error){toast(error.message);await loadOrganizer().catch(()=>{});}};
 return button;
}
function renderBookmarks(){
 const list=$('bookmark-list');list.replaceChildren();
 if(!organizer.bookmarks.length){list.textContent='还没有收藏的消息';return;}
 for(const item of organizer.bookmarks){
  const row=document.createElement('article');row.className='utility-item';
  const heading=document.createElement('strong');heading.textContent=item.sessionTitle+' · '+item.speaker;
  const excerpt=document.createElement('p');excerpt.textContent=item.excerpt||'（附件消息）';
  const time=document.createElement('small');time.textContent='收藏于 '+sessionTime(item.createdAt);
  const actions=document.createElement('div');actions.className='utility-item-actions';actions.append(sourceButton(item,true,'打开原消息'));
  const remove=document.createElement('button');remove.type='button';remove.textContent='取消收藏';remove.onclick=async()=>{remove.disabled=true;try{await request('DELETE','/api/bookmarks/'+item.id);await loadOrganizer();}catch(error){remove.disabled=false;toast(error.message);}};actions.append(remove);
  row.append(heading,excerpt,time,actions);list.append(row);
 }
}
async function toggleBookmark(messageId){
 if(organizerBusy||!currentSession?.id)return;organizerBusy=true;
 const existing=organizer.bookmarks.find(b=>b.sessionId===currentSession.id&&b.messageId===messageId);
 try{if(existing)await request('DELETE','/api/bookmarks/'+existing.id);else await post('/api/bookmarks',{sessionId:currentSession.id,messageId});await loadOrganizer();toast(existing?'已取消收藏':'已收藏消息');}
 catch(error){toast(error.message);}finally{organizerBusy=false;}
}
function openTodoForm(item=null,source=null){
 todoDraft={id:item?.id||crypto.randomUUID(),source:item?.source||source||null,completed:item?.completed||false,editing:!!item};
 $('todo-title').value=item?.title||'';$('todo-note').value=item?.note||'';
 $('todo-source-label').textContent=todoDraft.source?'来自聊天消息':'';
 $('todo-form').hidden=false;$('todo-title').focus();
}
function renderTodos(){
 const list=$('todo-list');list.replaceChildren();
 if(!organizer.todos.length){list.textContent='还没有待办事项';return;}
 for(const item of organizer.todos){
  const row=document.createElement('article');row.className='utility-item todo-item';
  const heading=document.createElement('div');heading.className='todo-heading';
  const check=document.createElement('input');check.type='checkbox';check.checked=item.completed;check.setAttribute('aria-label',item.completed?'恢复未完成':'标记完成');
  check.onchange=async()=>{check.disabled=true;try{await request('PATCH','/api/todos/'+item.id,{title:item.title,note:item.note,completed:check.checked});await loadOrganizer();}catch(error){check.checked=!check.checked;check.disabled=false;toast(error.message);}};
  const title=document.createElement('strong');title.textContent=item.title;heading.append(check,title);
  const note=document.createElement('p');note.textContent=item.note;note.hidden=!item.note;
  const time=document.createElement('small');time.textContent=(item.completed?'已完成 · ':'未完成 · ')+sessionTime(item.updatedAt);
  const actions=document.createElement('div');actions.className='utility-item-actions';
  if(item.source)actions.append(sourceButton(item.source,item.sourceAvailable,item.sourceSessionTitle?'查看来源 · '+item.sourceSessionTitle:'查看来源'));
  const edit=document.createElement('button');edit.type='button';edit.textContent='编辑';edit.onclick=()=>openTodoForm(item);actions.append(edit);
  const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.onclick=()=>{if(row.querySelector('.todo-confirm'))return;const confirm=document.createElement('div');confirm.className='todo-confirm';confirm.textContent='确定删除这条待办？';const yes=document.createElement('button');yes.type='button';yes.textContent='确定删除';yes.onclick=async()=>{yes.disabled=true;try{await request('DELETE','/api/todos/'+item.id);await loadOrganizer();}catch(error){yes.disabled=false;toast(error.message);}};const no=document.createElement('button');no.type='button';no.textContent='取消';no.onclick=()=>confirm.remove();confirm.append(yes,no);row.append(confirm);};actions.append(remove);
  row.append(heading,note,time,actions);list.append(row);
 }
}
function openUtility(page){
 utilityPage=page;showView('utility');
 for(const name of ['members','bookmarks','todos'])$('utility-'+name).hidden=name!==page;
 $('utility-title').textContent={members:'AI 成员',bookmarks:'我的收藏',todos:'待办事项'}[page];
 if(page==='members')$('utility-members').append($('member-cards'));
 if(page==='bookmarks')renderBookmarks();if(page==='todos')renderTodos();
 closeHistory();
}
function renderWorkspaceProposals(){
 let list=$('workspace-proposals');if(!list){list=document.createElement('div');list.id='workspace-proposals';list.className='workspace-proposals';$('messages').append(list);}list.replaceChildren();
 for(const proposal of workspaceProposals.slice().reverse()){
  const card=document.createElement('div');card.className='workspace-proposal';
  const title=document.createElement('strong');title.textContent='修改方案 · '+proposal.agent+' · '+proposal.path;
  const explanation=document.createElement('p');explanation.textContent=proposal.explanation;
  const status=document.createElement('small');status.textContent={pending:'等待你批准',applying:'写入状态待核对',applied:'已真实写入',rejected:'已拒绝，文件未修改',restoring:'恢复状态待核对',restored:'已恢复原内容',conflict:'文件已变化，请人工核对'}[proposal.status]||'状态未知';
  const diff=document.createElement('pre');diff.textContent=proposal.diff;
  const actions=document.createElement('div');actions.className='workspace-actions';
  for(const [label,action,enabled] of [['批准修改','approve',proposal.status==='pending'],['拒绝修改','reject',proposal.status==='pending'],['恢复原内容','restore',proposal.status==='applied']]){
   if(!enabled)continue;const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=busy||!workspaceGrant&&action!=='reject';
   button.onclick=async()=>{if(busy)return;button.disabled=true;try{const response=await post('/api/workspaces/'+proposal.sessionId+'/proposals/'+proposal.id+'/'+action),data=await response.json();workspaceProposals=workspaceProposals.map(item=>item.id===proposal.id?data.proposal:item);renderWorkspaceProposals();toast(action==='approve'?'已写入文件；尚未运行测试':action==='restore'?'已恢复原文件':'已拒绝，文件未修改');}catch(error){toast(error.message);try{const response=await fetch('/api/workspaces/'+proposal.sessionId+'/proposals'),data=await response.json();if(response.ok&&currentSession?.id===proposal.sessionId){workspaceProposals=data.proposals;renderWorkspaceProposals();}}catch{button.disabled=false;}}};
   actions.append(button);
  }
  card.append(title,explanation,status,diff,actions);list.append(card);
 }
 list.hidden=!workspaceProposals.length;
}
function renderWorkspace(){
 const available=location.protocol==='http:';
 $('workspace-toggle').disabled=!available;
 $('workspace-toggle').title=available?'当前会话的本地项目文件夹':'请在 Mac 本机管理工作区';
 $('workspace-state').textContent=!available?'仅 Mac 本机可以管理工作区':workspaceGrant?workspaceGrant.path+' · 只读':'尚未授权文件夹';
 $('workspace-revoke').hidden=!workspaceGrant;
 $('workspace-read').disabled=!workspaceGrant||!available||busy;
 if(!workspaceGrant)$('workspace-read').checked=false;
 const targets=selectedRecipients(),explicit=mentionedAgents($('message').value).length===1||$('recipient').value===targets[0];
 $('workspace-propose').disabled=!available||!workspaceGrant||busy||!$('message').value.trim()||targets.length!==1||!['Codex','Claude Code'].includes(targets[0])||!explicit||$('web-search-enabled').checked||attachmentDraft.length>0;
 renderWorkspaceProposals();
 updateSend();
}
async function loadWorkspace(sessionId){
 workspaceGrant=null;workspaceProposals=[];$('workspace-read').checked=false;$('workspace-panel').hidden=true;$('workspace-toggle').setAttribute('aria-expanded','false');renderWorkspace();
 if(!sessionId||location.protocol!=='http:')return;
 try{const [response,proposalsResponse]=await Promise.all([fetch('/api/workspaces/'+sessionId),fetch('/api/workspaces/'+sessionId+'/proposals')]),data=await response.json(),proposals=await proposalsResponse.json();if(!response.ok||!proposalsResponse.ok)throw Error(data.error||proposals.error||'工作区读取失败');if(currentSession?.id!==sessionId)return;workspaceGrant=data.workspace;workspaceProposals=proposals.proposals;renderWorkspace();}
 catch(error){if(currentSession?.id===sessionId)$('workspace-state').textContent=error.message;}
}
const attachmentExtensions=new Set(['txt','md','json','js','ts','py','pdf','png','jpg','jpeg','webp']);
const attachmentMaxFile=3*1024*1024,attachmentMaxTotal=8*1024*1024,attachmentMaxCount=4;
let attachmentDraft=[],attachmentUploading=false;
function attachmentSize(bytes){return bytes>=1024*1024?(bytes/1024/1024).toFixed(1)+' MiB':Math.ceil(bytes/1024)+' KiB';}
function attachmentUrl(id,sessionId){return '/api/attachments/'+encodeURIComponent(id)+'?sessionId='+encodeURIComponent(sessionId);}
function renderAttachmentDraft(){
 const box=$('attachment-draft');box.replaceChildren();box.hidden=!attachmentDraft.length;
 for(const item of attachmentDraft){
  const chip=document.createElement('div');chip.className='attachment-chip';
  if(item.kind==='image'&&item.previewUrl){const image=document.createElement('img');image.src=item.previewUrl;image.alt='';chip.append(image);}
  const label=document.createElement('span');label.textContent=item.name+' · '+attachmentSize(item.size)+' · '+item.kind.toUpperCase()+(item.truncated?' · 内容已截断':'');chip.append(label);
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除 '+item.name);remove.disabled=busy||attachmentUploading;
  remove.onclick=async()=>{attachmentDraft=attachmentDraft.filter(a=>a.id!==item.id);if(item.previewUrl)URL.revokeObjectURL(item.previewUrl);renderAttachmentDraft();updateSend();try{await request('DELETE','/api/attachments/'+item.id);}catch(error){toast('清理附件失败：'+error.message);}};
  chip.append(remove);box.append(chip);
 }
}
async function addAttachments(files){
 if(busy||attachmentUploading)return;
 const list=[...files];if(!list.length)return;
 if(attachmentDraft.length+list.length>attachmentMaxCount){toast('每条消息最多 4 个附件');return;}
 if(list.some(file=>!attachmentExtensions.has(file.name.split('.').pop().toLowerCase()))){toast('不支持此文件类型');return;}
 if(list.some(file=>!file.size||file.size>attachmentMaxFile)){toast('单个附件需小于 3 MiB，且不能为空');return;}
 if([...attachmentDraft,...list].reduce((sum,file)=>sum+file.size,0)>attachmentMaxTotal){toast('附件总量不能超过 8 MiB');return;}
 attachmentUploading=true;$('attachment-status').textContent='正在上传和解析…';updateSend();
 for(const file of list){
  try{
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   const response=await post('/api/attachments',{name:file.name,data:btoa(binary)});const item=await response.json();
   if(item.kind==='image')item.previewUrl=URL.createObjectURL(file);
   attachmentDraft.push(item);renderAttachmentDraft();
  }catch(error){toast(file.name+'：'+error.message);$('attachment-status').textContent='上传或解析失败';break;}
 }
 attachmentUploading=false;if($('attachment-status').textContent!=='上传或解析失败')$('attachment-status').textContent=attachmentDraft.length+' 个附件已就绪';renderAttachmentDraft();updateSend();
}
function mentionedAgents(text){
  const found=new Set();
  for(const match of text.matchAll(/(^|[\s，,（(])@(Claude Code|ChatGPT|DeepSeek|Claude|Codex)(?=$|[\s，,。！？!?）)])/g))found.add(match[2]);
  return [...found];
}
function mentionDraft(){
  const field=$('message'),before=field.value.slice(0,field.selectionStart);
  const match=before.match(/(^|[\s，,（(])@([^\s@，,。！？!?（）]*)$/);
  return match?{start:before.length-match[0].length+match[1].length,query:match[2].toLowerCase()}:null;
}
function closeMentions(){mentionChoices=[];mentionStart=-1;$('mention-list').hidden=true;$('mention-list').replaceChildren();}
function chooseMention(agent){
  const field=$('message');if(mentionStart<0)return;
  const cursor=field.selectionStart,insert='@'+agent+' ';
  field.setRangeText(insert,mentionStart,cursor,'end');closeMentions();field.focus();resizeComposer();updateSend();
}
function refreshMentions(){
  const draft=mentionDraft();if(!draft){closeMentions();return;}
  mentionStart=draft.start;
  mentionChoices=realAgents.filter(name=>agentStatus[name]?.connected&&name.toLowerCase().includes(draft.query));
  mentionIndex=0;const list=$('mention-list');list.replaceChildren();
  for(const [index,name] of mentionChoices.entries()){
    const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(index===mentionIndex));button.textContent=name;
    button.onmousedown=event=>event.preventDefault();button.onclick=()=>chooseMention(name);list.append(button);
  }
  list.hidden=!mentionChoices.length;
}
function showQuote(id){quotedMessageId=id;renderQuote();$('message').focus();}
function handoffComplete(request){return !!currentSession?.messages.some(m=>m.role==='assistant'&&m.status==='complete'&&m.handoff?.sourceMessageId===request.handoff.sourceMessageId&&m.handoff?.targetAgent===request.handoff.targetAgent&&m.handoff?.supplement===request.handoff.supplement&&m.createdAt>=request.createdAt);}
function openHandoff(source,retry=null){
 if(busy||!currentSession||source.role!=='assistant'||source.status==='partial')return;
 const dialog=$('handoff-dialog'),select=$('handoff-target');select.replaceChildren();
 for(const member of team){if(!member.agent||member.agent===source.agent)continue;
  const option=document.createElement('option');option.value=member.agent;
  const state=agentStatus[member.agent];option.disabled=!state?.connected;
  option.textContent=member.name+(state?.paused?' · 已暂停':state?.connected?' · 已连接':' · 未连接');select.append(option);
 }
 handoffDraft={sessionId:currentSession.id,sourceMessageId:source.id,requestId:crypto.randomUUID(),retryOf:retry?.id||null};
 select.disabled=!!retry;select.value=retry?.handoff?.targetAgent||[...select.options].find(option=>!option.disabled)?.value||'';
 $('handoff-supplement').value=retry?.handoff?.supplement||'';$('handoff-supplement').readOnly=!!retry;
 $('handoff-source').textContent=(retry?'重试这次接力 · ':'')+'来自 '+source.agent+'：'+source.text.slice(0,180)+(source.text.length>180?'…':'');
 $('handoff-limit').hidden=source.text.length<=20000;$('handoff-limit').textContent='原回复超过 20000 字，接收 AI 将看到前 20000 字及截断提示。';
 $('handoff-status').textContent=select.value?'只会发送给所选成员；不会自动转交或执行文件操作。':'当前没有可用的其他 AI。';
 $('handoff-confirm').disabled=!select.value;dialog.showModal();
}
async function submitHandoff(event){
 event.preventDefault();if(!handoffDraft||busy)return;
 const draft=handoffDraft,target=$('handoff-target').value,supplement=$('handoff-supplement').value.trim();
 if(!target||!agentStatus[target]?.connected){$('handoff-status').textContent='所选成员当前不可用，请刷新连接状态。';return;}
 busy=true;updateSend();$('handoff-confirm').disabled=true;$('handoff-cancel').disabled=true;$('handoff-status').textContent='正在发送接力请求…';phase('正在发送接力',0);
 const generation=viewGeneration;let accepted=false,requestMessageId=null,failed=false,replySeen=false;
 try{
  const body={sessionId:draft.sessionId,sourceMessageId:draft.sourceMessageId,targetAgent:target,supplement,requestId:draft.requestId};if(draft.retryOf)body.retryOf=draft.retryOf;
  const response=await post('/api/handoff',body);accepted=true;$('handoff-status').textContent='已发送，等待 '+target+' 回复…';
  await consumeChatStream(response,draft.sessionId,generation,[target],'handoff',null,event=>{if(event.type==='handoff')requestMessageId=event.requestMessageId;if(event.type==='message'||event.type==='delta')replySeen=true;if(event.type==='error')failed=true;});
  if(!replySeen)failed=true;
  $('handoff-status').textContent=failed?'接力未完成；可在聊天记录中手动重试。':'接力已完成。';
  toast(failed?'接力未完成，可手动重试':'接力已完成');
 }catch(error){$('handoff-status').textContent=error.message;toast(error.message);failed=true;}
 finally{
  busy=false;updateSend();$('handoff-confirm').disabled=false;$('handoff-cancel').disabled=false;
  try{await loadSessionList();if(currentSession?.id===draft.sessionId)await refreshVisibleSession(draft.sessionId);}catch(error){toast(error.message);}
  if(accepted){handoffDraft=null;$('handoff-dialog').close();}else if(requestMessageId){handoffDraft={...draft,retryOf:requestMessageId,requestId:crypto.randomUUID()};}
  await status();
 }
}
async function decideCollaboration(source,action){
 if(busy||!currentSession)return;
 const sessionId=currentSession.id,generation=viewGeneration,target=source.collaboration.targetAgent;
 busy=true;updateSend();
 try{
  const path='/api/collaborations/'+sessionId+'/'+source.id+'/'+action;
  if(action==='reject'){
   await post(path,{});toast('已拒绝协作；没有调用其他 AI。');
  }else{
   phase('等待 '+target+' 回复',0);
   await consumeChatStream(await post(path,{requestId:crypto.randomUUID()}),sessionId,generation,[target],'handoff');
   toast('本次协作已结束');
  }
 }catch(error){toast(error.message);phase('协作未完成',0);}
 finally{busy=false;updateSend();try{await loadSessionList();if(currentSession?.id===sessionId)await refreshVisibleSession(sessionId);}catch(error){toast(error.message);}await status();}
}
function integrationSource(reply){
 if(reply?.role!=='assistant'||reply.status!=='complete'||!reply.handoff?.requestMessageId)return null;
 const source=currentSession?.messages.find(m=>m.id===reply.handoff.sourceMessageId&&m.role==='assistant');
 return source?.collaboration?.status==='complete'&&source.collaboration.requestMessageId===reply.handoff.requestMessageId&&source.collaboration.targetAgent===reply.agent?source:null;
}
function openIntegration(source,reply){
 if(busy||!currentSession||source.collaboration?.integration?.status==='running'||source.collaboration?.integration?.status==='complete')return;
 const sourceIndex=currentSession.messages.findIndex(m=>m.id===source.id);
 const question=[...currentSession.messages.slice(0,sourceIndex)].reverse().find(m=>m.role==='user'&&!m.handoff&&!m.integration);
 if(!question||!agentStatus[source.agent]?.connected){toast(!question?'原始问题不可用':'原发起成员当前未连接');return;}
 integrationDraft={sessionId:currentSession.id,sourceId:source.id,sourceAgent:source.agent,requestId:crypto.randomUUID()};
 $('integration-title').textContent='请 '+displayName(source.agent)+' 整合';
 $('integration-context').textContent='将向 '+displayName(source.agent)+' 提供原始问题、其原回复、协作原因与任务，以及 '+displayName(reply.agent)+' 的完整回复。只调用这位成员一次，不执行文件或命令。';
 const limited=question.text.length>4000||source.text.length>16000||reply.text.length>16000;
 $('integration-limit').hidden=!limited;$('integration-limit').textContent='内容较长：原问题限 4000 字、双方回复各限 16000 字。截断会在模型上下文和聊天中标明。';
 $('integration-instruction').value='';$('integration-status').textContent=source.collaboration.integration?.status==='failed'?'上次整合未完成。本次仅在你确认后手动重试。':'确认前不会调用模型。';
 $('integration-dialog').showModal();
}
async function submitIntegration(event){
 event.preventDefault();if(!integrationDraft||busy)return;
 const draft=integrationDraft,instruction=$('integration-instruction').value.trim();
 if(!agentStatus[draft.sourceAgent]?.connected){$('integration-status').textContent='原发起成员当前未连接，请刷新状态。';return;}
 busy=true;updateSend();$('integration-confirm').disabled=true;$('integration-cancel').disabled=true;$('integration-status').textContent='正在等待整合回复…';phase('等待协作整合',0);
 const generation=viewGeneration;let accepted=false,failed=false,replySeen=false;
 try{
  const response=await post('/api/integrations/'+draft.sessionId+'/'+draft.sourceId,{requestId:draft.requestId,instruction});accepted=true;
  await consumeChatStream(response,draft.sessionId,generation,[draft.sourceAgent], 'integration',null,entry=>{if(entry.type==='message'||entry.type==='delta')replySeen=true;if(entry.type==='error')failed=true;});
  if(!replySeen)failed=true;
  toast(failed?'整合未完成，可手动重试':'整合已保存到原会话');
 }catch(error){$('integration-status').textContent=error.message;toast(error.message);failed=true;}
 finally{
  busy=false;updateSend();$('integration-confirm').disabled=false;$('integration-cancel').disabled=false;
  try{await loadSessionList();if(currentSession?.id===draft.sessionId)await refreshVisibleSession(draft.sessionId);}catch(error){toast(error.message);}
  if(accepted){integrationDraft=null;$('integration-dialog').close();}else integrationDraft={...draft,requestId:crypto.randomUUID()};
  await status();
 }
}
function renderQuote(){
  const box=$('quote-preview');box.replaceChildren();const original=currentSession?.messages.find(item=>item.id===quotedMessageId);
  if(!quotedMessageId){box.hidden=true;return;}
  const text=document.createElement('span');text.textContent=original?(original.role==='user'?'你':displayName(original.agent))+'：'+original.text.slice(0,110)+(original.attachments?.length?' · 附件：'+original.attachments.map(file=>file.name).join('、'):''):'原消息不可用';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='×';cancel.setAttribute('aria-label','取消引用');cancel.onclick=()=>{quotedMessageId=null;renderQuote();};
  box.append(text,cancel);box.hidden=false;
}
function jumpToMessage(id){
  const row=[...$('messages').querySelectorAll('.message[data-message-id]')].find(element=>element.dataset.messageId===id);
  if(!row){toast('原消息不可用');return;}
  row.scrollIntoView({block:'center',behavior:'smooth'});row.classList.add('message-highlight');setTimeout(()=>row.classList.remove('message-highlight'),2200);
}
function renderSearch(){
  const list=$('search-results'),query=$('search-input').value.trim().toLocaleLowerCase();list.replaceChildren();
  if(!query){list.textContent='输入关键词搜索当前会话';return;}
  const matches=(currentSession?.messages||[]).filter(item=>['user','assistant'].includes(item.role)&&item.text.toLocaleLowerCase().includes(query));
  if(!matches.length){list.textContent='没有找到匹配消息';return;}
  for(const item of matches){
    const button=document.createElement('button');button.type='button';button.className='search-hit';
    const speaker=document.createElement('strong');speaker.textContent=item.role==='user'?'你':displayName(item.agent);
    const time=document.createElement('small');time.textContent=sessionTime(item.createdAt);
    const excerpt=document.createElement('span');const start=Math.max(0,item.text.toLocaleLowerCase().indexOf(query)-35);excerpt.textContent=(start?'…':'')+item.text.slice(start,start+125)+(item.text.length>start+125?'…':'');
    button.append(speaker,time,excerpt);button.onclick=()=>{$('chat-search').hidden=true;$('search-toggle').setAttribute('aria-expanded','false');jumpToMessage(item.id);};list.append(button);
  }
}
let globalSearchSeq=0,globalSearchTimer,globalSearchLoaded=0;
function setGlobalSearch(open){
  const panel=$('global-search');panel.hidden=!open;$('session-list').hidden=open;
  $('global-search-toggle').setAttribute('aria-expanded',String(open));
  if(open){searchAllHistory(true);$('global-search-input').focus();}
  else{clearTimeout(globalSearchTimer);globalSearchSeq++;$('global-search-toggle').focus();}
}
async function searchAllHistory(reset=false){
  const query=$('global-search-input').value.trim(),list=$('global-search-results');
  if(reset){globalSearchLoaded=0;list.replaceChildren();}
  const seq=++globalSearchSeq;
  if(!query){list.textContent='输入关键词搜索全部历史会话';return;}
  const offset=globalSearchLoaded;
  if(reset)list.textContent='正在搜索…';
  try{
    const response=await fetch('/api/search?q='+encodeURIComponent(query)+'&offset='+offset);
    const data=await response.json();
    if(seq!==globalSearchSeq||$('global-search').hidden||query!==$('global-search-input').value.trim())return;
    if(!response.ok)throw Error(data.error||'搜索失败');
    if(reset)list.replaceChildren();else list.querySelector('.global-search-more')?.remove();
    if(!data.total){list.textContent='没有找到匹配的历史聊天';return;}
    if(reset){const count=document.createElement('p');count.className='global-search-count';count.textContent='找到 '+data.total+' 条结果';list.append(count);}
    for(const item of data.results){
      const button=document.createElement('button');button.type='button';button.className='global-search-hit';
      const title=document.createElement('strong');title.textContent=item.sessionTitle;
      const meta=document.createElement('small');meta.textContent=(item.kind==='title'?'标题匹配':item.speaker||'AI')+' · '+sessionTime(item.createdAt);
      const excerpt=document.createElement('span');excerpt.textContent=item.excerpt;
      button.append(title,meta,excerpt);
      button.onclick=async()=>{
        button.disabled=true;
        try{await openSession(item.sessionId);setGlobalSearch(false);if(item.messageId)jumpToMessage(item.messageId);}
        catch(error){button.disabled=false;toast(error.message);}
      };
      list.append(button);
    }
    globalSearchLoaded+=data.results.length;
    if(globalSearchLoaded<data.total){const more=document.createElement('button');more.type='button';more.className='global-search-more';more.textContent='加载更多结果';more.onclick=()=>{more.disabled=true;searchAllHistory();};list.append(more);}
  }catch(error){if(seq===globalSearchSeq)list.textContent=error.message;}
}
let expandedViewportHeight=window.visualViewport?.height||window.innerHeight||0;
function syncMobileViewport(){
  const root=document.documentElement,viewport=window.visualViewport;
  const mobile=window.matchMedia('(max-width:620px)').matches;
  const focused=document.activeElement===$('message');
  if(mobile&&viewport&&!focused)expandedViewportHeight=viewport.height;
  if(!mobile||!viewport||viewport.scale!==1||!focused||viewport.height>=expandedViewportHeight*.85){
    root.style.removeProperty('--nexus-visible-height');root.style.removeProperty('--nexus-visible-top');return;
  }
  root.style.setProperty('--nexus-visible-height',viewport.height+'px');
  root.style.setProperty('--nexus-visible-top',viewport.offsetTop+'px');
}
function restoreMobileViewport(){
  syncMobileViewport();
  if(window.matchMedia('(max-width:620px)').matches&&document.activeElement!==$('message'))window.scrollTo(0,0);
}
function resizeComposer(){
  const field=$('message');field.style.height='auto';
  const maxHeight=156;field.style.height=Math.min(field.scrollHeight,maxHeight)+'px';
  field.style.overflowY=field.scrollHeight>maxHeight?'auto':'hidden';
}
function setSidebarCollapsed(collapsed){
  document.body.classList.toggle('sidebar-collapsed',collapsed);
  const toggle=$('sidebar-toggle');toggle.setAttribute('aria-pressed',String(collapsed));
  toggle.setAttribute('aria-label',collapsed?'展开侧边栏':'折叠侧边栏');
  toggle.title=collapsed?'展开侧边栏':'折叠侧边栏';
  try{localStorage.setItem('ai-nexus-sidebar-collapsed',collapsed?'1':'0');}catch{}
  closeHistory();
}

// Generic geometric marks drawn for this release candidate; not provider logos.
const memberIcons={
  ChatGPT:'<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="8" cy="16" r="3"/><circle cx="24" cy="9" r="3"/><circle cx="24" cy="23" r="3"/><path d="M11 15l10-5M11 17l10 5M24 12v8"/></svg>',
  Claude:'<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 5l5 11-5 11-5-11 5-11Z"/><path d="M5 16h6m10 0h6"/></svg>',
  'Claude Code':'<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="4" y="6" width="24" height="20" rx="5"/><path d="m12 12-4 4 4 4m5 0h7"/></svg>',
  DeepSeek:'<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 23c7-12 15-12 22 0M9 23c4-7 10-7 14 0"/><circle cx="16" cy="10" r="2"/></svg>',
  Muse:'<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="10"/><path d="M9 21l4-10 3 7 3-7 4 10"/></svg>',
  Codex:'<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m10 8-6 8 6 8m12-16 6 8-6 8M19 6l-6 20"/></svg>'
};
function avatar(member){const span=document.createElement('span');span.className='avatar '+member.color;span.innerHTML=memberIcons[member.name];return span;}
async function openSingle(member){
  if(!member.agent||!agentStatus[member.agent]?.connected){toast(member.name+' 尚未连接');return;}
  if(busy){toast('请等待当前回复结束');return;}
  try{
    if(!currentSession)await createSession();
    $('recipient').value=member.agent;setMemberPanel(false);showView('chat');updateRoom();updateSend();$('message').focus();
  }catch(error){toast(error.message);}
}
function sessionTime(value){return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function closeHistory(){document.body.classList.remove('history-open');$('history-backdrop').hidden=true;}
function projectOptions(select,selected=null){
  select.replaceChildren();
  const none=document.createElement('option');none.value='';none.textContent='未归类';select.append(none);
  for(const project of projects){const option=document.createElement('option');option.value=project.id;option.textContent=project.name;select.append(option);}
  select.value=selected||'';
}
async function renameProject(id,name){
  await request('PATCH','/api/projects/'+id,{name});
  if(currentProject?.id===id){currentProject.name=name;$('project-page-title').textContent=name;showView('project');}
  await loadProjects();
}
async function removeProject(id){
  await request('DELETE','/api/projects/'+id,{});
  if(projectFilter===id)projectFilter='all';
  if(currentProject?.id===id){currentProject=null;showProjectsIndex();}
  if(currentSession?.projectId===id)currentSession.projectId=null;
  await loadProjects();await loadSessionList();
}
function renderProjects(){
  const list=$('project-list'),filters=$('history-filters');list.replaceChildren();filters.replaceChildren();
  const filter=(label,value,count)=>{const button=document.createElement('button');button.type='button';button.className='project-filter'+(projectFilter===value?' active':'');button.textContent=label+' · '+count;button.setAttribute('aria-pressed',String(projectFilter===value));button.onclick=()=>{projectFilter=value;renderProjects();renderSessionList();showView('chat');closeHistory();};filters.append(button);};
  filter('全部会话','all',sessionList.length);
  filter('未归类',null,sessionList.filter(s=>!s.projectId).length);
  if(!projects.length){const empty=document.createElement('p');empty.className='project-empty';empty.textContent='暂无项目，点击「＋ 新建」开始';list.append(empty);}
  for(const project of projects){
    const row=document.createElement('div');row.className='project-row';
    const open=document.createElement('button');open.type='button';open.className='project-filter'+(projectFilter===project.id?' active':'');open.textContent=project.name+' · '+sessionList.filter(s=>s.projectId===project.id).length;open.title=project.name;open.setAttribute('aria-pressed',String(projectFilter===project.id));open.onclick=()=>openProject(project.id).catch(error=>toast(error.message));row.append(open);
    const rename=document.createElement('button');rename.type='button';rename.className='project-action';rename.textContent='✎';rename.title='重命名项目 '+project.name;rename.setAttribute('aria-label',rename.title);
    rename.onclick=()=>{
      if(busy){toast('请等待当前回复结束');return;}
      const form=document.createElement('form');form.className='project-edit';const input=document.createElement('input');input.value=project.name;input.maxLength=60;input.required=true;input.setAttribute('aria-label','新项目名称');
      const save=document.createElement('button');save.type='submit';save.textContent='保存';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=renderProjects;
      form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await renameProject(project.id,input.value.trim());}catch(error){save.disabled=false;toast(error.message);}};
      form.append(input,save,cancel);row.replaceChildren(form);input.focus();input.select();
    };
    const remove=document.createElement('button');remove.type='button';remove.className='project-action';remove.textContent='×';remove.title='删除项目 '+project.name;remove.setAttribute('aria-label',remove.title);
    remove.onclick=()=>{
      if(busy){toast('请等待当前回复结束');return;}
      const form=document.createElement('div');form.className='project-delete';const note=document.createElement('span');note.textContent='删除项目？会话会移至未归类；项目记忆和简介会删除。有项目资料时必须先移动或删除资料。';
      const confirm=document.createElement('button');confirm.type='button';confirm.textContent='确认删除';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=renderProjects;
      confirm.onclick=async()=>{confirm.disabled=true;try{await removeProject(project.id);}catch(error){confirm.disabled=false;toast(error.message);}};
      form.append(note,confirm,cancel);row.replaceChildren(form);
    };
    row.append(rename,remove);list.append(row);
  }
  $('history-title').textContent='聊天记录';
}
function renderProjectIndex(){
  const list=$('project-index-list');list.replaceChildren();
  if(!projects.length){const empty=document.createElement('p');empty.className='project-index-empty';empty.textContent='还没有项目，创建后就能在这里打开。';list.append(empty);return;}
  for(const project of projects){
    const button=document.createElement('button');button.type='button';button.className='project-index-card';
    const title=document.createElement('strong');title.textContent=project.name;
    const count=document.createElement('small');count.textContent=sessionList.filter(s=>s.projectId===project.id).length+' 段会话';
    const arrow=document.createElement('span');arrow.className='project-index-arrow';arrow.textContent='→';
    button.append(title,count,arrow);button.onclick=()=>openProject(project.id).catch(error=>toast(error.message));list.append(button);
  }
}
function showProjectsIndex(){currentProject=null;$('project-index').hidden=false;$('project-detail').hidden=true;renderProjectIndex();showView('project');closeHistory();}
async function loadProjects(){const response=await fetch('/api/projects'),data=await response.json();if(!response.ok)throw Error(data.error||'读取项目失败');projects=data.projects;if(projectFilter!=='all'&&projectFilter!==null&&!projects.some(p=>p.id===projectFilter))projectFilter='all';renderProjects();if(!$('project-index').hidden)renderProjectIndex();}
async function openProject(id){
  let project;
  if(id){const response=await fetch('/api/projects/'+id);project=await response.json();if(!response.ok)throw Error(project.error||'读取项目失败');}
  else project={id:null,name:'全局资料库',description:'',memory:Object.fromEntries(memoryFields.map(key=>[key,''])),memoryRevision:''};
  currentProject=project;if(id)projectFilter=id;renderProjects();renderSessionList();
  $('project-index').hidden=true;$('project-detail').hidden=false;
  $('project-home-controls').hidden=!id;$('project-home-rename-form').hidden=true;
  editingNote=null;editingNoteSourceName=null;$('project-note-form').hidden=true;
  $('project-page-title').textContent=project.name;$('project-page-intro').textContent=id?'项目会话与相关内容':'所有会话可使用的文字资料';$('project-description').value=project.description;
  $('project-notes-heading').textContent=id?'项目资料':'全局资料库';
  $('project-notes-intro').textContent=id?'本项目资料仅供项目会话使用；全局资料会单独列出。单条最多 100 KiB，总量最多 1 MiB。':'供所有会话按需检索的文字资料。单条最多 100 KiB，总量最多 1 MiB。';
  for(const card of ['description','sessions','memory'])$('project-'+card+'-card').hidden=!id;
  $('project-note-scope').querySelector('option[value="project"]').disabled=!id;
  $('project-note-scope').value=id?'project':'global';
  $('project-description-status').textContent='保存后生效';
  for(const key of memoryFields)$('project-memory-'+key).value=project.memory[key]||'';
  $('project-memory-status').textContent='项目记忆仅由你保存';
  renderProjectSessions();await loadProjectNotes();showView('project');closeHistory();
}
function renderProjectSessions(){
  const list=$('project-sessions');list.replaceChildren();
  const sessions=sessionList.filter(s=>s.projectId===currentProject?.id);
  if(!sessions.length){list.textContent='暂无会话';return;}
  for(const session of sessions){const button=document.createElement('button');button.type='button';button.textContent=(session.pinned?'◆ ':'')+session.title+' · '+sessionTime(session.updatedAt);button.onclick=()=>openSession(session.id).catch(error=>toast(error.message));list.append(button);}
}
async function loadProjectNotes(){
  if(!currentProject)return;
  const id=currentProject.id,response=await fetch(id?'/api/notes?projectId='+encodeURIComponent(id):'/api/notes'),data=await response.json();
  if(!response.ok)throw Error(data.error||'读取资料失败');if(currentProject?.id!==id)return;
  const list=$('project-notes');list.replaceChildren();
  if(!data.notes.length){list.textContent='暂无资料';return;}
  const addNotes=notes=>{for(const note of notes){
    const row=document.createElement('div');row.className='project-note-row';
    const open=document.createElement('button');open.type='button';open.textContent=note.title+' · '+(note.projectId?'项目专属':'全局共享')+' · '+Math.ceil(note.size/1024)+' KiB';
    open.onclick=()=>editProjectNote(note.id).catch(error=>toast(error.message));
    const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.setAttribute('aria-label','删除资料 '+note.title);
    remove.onclick=async()=>{if(!window.confirm('永久删除资料「'+note.title+'」？'))return;try{await request('DELETE','/api/notes/'+note.id);await loadProjectNotes();toast('资料已删除');}catch(error){toast(error.message);}};
    row.append(open,remove);list.append(row);
  }};
  if(id){
    const own=data.notes.filter(note=>note.projectId===id),global=data.notes.filter(note=>note.projectId===null);
    const heading=document.createElement('h3');heading.className='project-note-heading';heading.textContent='本项目资料';list.append(heading);
    if(own.length)addNotes(own);else{const empty=document.createElement('p');empty.className='project-empty';empty.textContent='暂无项目资料';list.append(empty);}
    if(global.length){const label=document.createElement('h3');label.className='project-note-heading';label.textContent='全局参考资料 · 所有项目可用';list.append(label);addNotes(global);}
  }else addNotes(data.notes);
}
async function editProjectNote(id){
  const response=await fetch('/api/notes/'+id),note=await response.json();if(!response.ok)throw Error(note.error||'读取资料失败');
  editingNote=id;editingNoteSourceName=note.sourceName;$('project-note-title').value=note.title;$('project-note-content').value=note.content;$('project-note-scope').value=note.projectId?'project':'global';$('project-note-file').value='';
  $('project-note-status').textContent=note.sourceName?'来自 '+note.sourceName:'文字笔记';$('project-note-form').hidden=false;$('project-note-title').focus();
}
function renderSessionList(){
  $('session-list').replaceChildren();
  const visible=sessionList.filter(s=>projectFilter==='all'||(projectFilter===null?!s.projectId:s.projectId===projectFilter));
  if(!visible.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent='暂无历史会话';$('session-list').append(empty);return;}
  let lastGroup='';
  for(const session of visible){
    const group=session.pinned?'置顶':'最近聊天';
    if(group!==lastGroup){const heading=document.createElement('div');heading.className='session-group-title';heading.textContent=group;$('session-list').append(heading);lastGroup=group;}
    const row=document.createElement('div');row.className='session-row'+(currentSession?.id===session.id?' active':'')+(session.pinned?' pinned':'');
    const open=document.createElement('button');open.type='button';open.className='session-open';open.title=session.title;
    const title=document.createElement('span');title.className='session-title';title.textContent=(session.pinned?'◆ ':'')+session.title;
    const meta=document.createElement('span');meta.className='session-meta';meta.textContent=sessionTime(session.updatedAt);
    open.append(title,meta);open.onclick=()=>openSession(session.id).catch(error=>toast(error.message));row.append(open);
    const actions=document.createElement('span');actions.className='session-actions';
    const move=document.createElement('button');move.type='button';move.className='session-move';move.textContent='项目';move.title='移动会话到项目或移出项目';move.setAttribute('aria-label','移动 '+session.title+' 到项目或移出项目');
    move.onclick=()=>{
      if(busy){toast('请等待当前回复结束');return;}
      const form=document.createElement('form');form.className='session-move-form';const select=document.createElement('select');select.setAttribute('aria-label','所属项目');projectOptions(select,session.projectId);
      const save=document.createElement('button');save.type='submit';save.textContent='保存';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=renderSessionList;
      form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await request('PATCH','/api/sessions/'+session.id,{projectId:select.value||null});if(currentSession?.id===session.id)currentSession.projectId=select.value||null;await loadSessionList();}catch(error){save.disabled=false;toast(error.message);}};
      form.append(select,save,cancel);row.replaceChildren(form);select.focus();
    };
    const pin=document.createElement('button');pin.type='button';pin.className='session-pin';pin.textContent=session.pinned?'取消置顶':'置顶';pin.title=(session.pinned?'取消置顶 ':'置顶 ')+session.title;
    pin.setAttribute('aria-label',pin.title);
    pin.onclick=async()=>{
      if(busy){toast('请等待当前回复结束');return;}
      pin.disabled=true;
      try{await request('PATCH','/api/sessions/'+session.id,{pinned:!session.pinned});await loadSessionList();}
      catch(error){pin.disabled=false;toast(error.message);}
    };
    const rename=document.createElement('button');rename.type='button';rename.textContent='✎';rename.title='重命名 '+session.title;
    rename.setAttribute('aria-label','重命名 '+session.title);
    rename.onclick=()=>{
      if(busy){toast('请等待当前回复结束');return;}
      const form=document.createElement('form');form.className='session-rename';
      const input=document.createElement('input');input.type='text';input.value=session.title;input.maxLength=60;input.required=true;input.setAttribute('aria-label','新会话标题');
      const save=document.createElement('button');save.type='submit';save.textContent='保存';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>renderSessionList();
      input.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();renderSessionList();}};
      form.onsubmit=async event=>{
        event.preventDefault();const value=input.value.trim();
        if(!value){input.focus();return;}
        if(value===session.title){renderSessionList();return;}
        save.disabled=true;
        try{await request('PATCH','/api/sessions/'+session.id,{title:value});if(currentSession?.id===session.id){currentSession.title=value;updateRoom();}await loadSessionList();}
        catch(error){save.disabled=false;toast(error.message);}
      };
      form.append(input,save,cancel);row.replaceChildren(form);input.focus();input.select();
    };
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='删除 '+session.title;
    remove.setAttribute('aria-label','删除 '+session.title);
    remove.onclick=()=>{
      if(busy){toast('请等待当前回复结束');return;}
      const form=document.createElement('div');form.className='session-delete';
      const warning=document.createElement('span');warning.textContent='永久删除此会话？';
      const confirm=document.createElement('button');confirm.type='button';confirm.textContent='确认删除';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>renderSessionList();
      confirm.onclick=async()=>{
        confirm.disabled=true;
        try{await request('DELETE','/api/sessions/'+session.id);if(currentSession?.id===session.id)currentSession=null;await loadSessionList();if(!currentSession){if(sessionList.length)await openSession(sessionList[0].id);else await createSession();}}
        catch(error){confirm.disabled=false;toast(error.message);}
      };
      form.append(warning,confirm,cancel);row.replaceChildren(form);
    };
    actions.append(move,pin,rename,remove);row.append(actions);$('session-list').append(row);
  }
}
async function loadSessionList(){const response=await fetch('/api/sessions');const data=await response.json();if(!response.ok)throw Error(data.error||'读取会话失败');sessionList=data.sessions;renderProjects();renderSessionList();if(currentProject)renderProjectSessions();if(!$('project-index').hidden)renderProjectIndex();}
async function openSession(id){
  if($('handoff-dialog').open){$('handoff-dialog').close();handoffDraft=null;}
  if($('integration-dialog').open){$('integration-dialog').close();integrationDraft=null;}
  const response=await fetch('/api/sessions/'+id),session=await response.json();
  if(!response.ok)throw Error(session.error||'读取会话失败');
  viewGeneration++;
  currentSession=session;$('recipient').value=session.type==='single'?session.agent:session.type==='group'?'group':'smart';
  quotedMessageId=null;renderQuote();closeMentions();
  renderConversation(session);
  $('message').value='';resizeComposer();showView('chat');updateRoom();updateSend();renderSessionList();renderSearch();closeHistory();
  await loadWorkspace(id);
  restoreMobileViewport();
}
async function refreshVisibleSession(id){
  if(currentSession?.id!==id)return;
  const expectedGeneration=viewGeneration;
  const response=await fetch('/api/sessions/'+id),session=await response.json();
  if(!response.ok)throw Error(session.error||'读取会话失败');
  if(currentSession?.id!==id||viewGeneration!==expectedGeneration)return;
  currentSession=session;viewGeneration++;renderConversation(session);renderWorkspaceProposals();renderQuote();renderSearch();updateRoom();updateSend();renderSessionList();
}
function discussionControl(round){
  const block=document.createElement('div');block.className='discussion-control';
  if(round.initialStatus==='running'){block.textContent='第一轮回复中…';return block;}
  if(round.discussionStatus==='available'){
    const button=document.createElement('button');button.type='button';button.textContent='✧ 让 AI 继续讨论';
    button.disabled=busy;button.setAttribute('aria-label','让 AI 继续讨论本轮观点');
    button.onclick=()=>startDiscussion(currentSession.id,round.id);
    block.append(button);return block;
  }
  const status={running:'讨论进行中…',complete:'已完成讨论',incomplete:'讨论未完成，不会自动重试',unavailable:round.initialStatus==='incomplete'?'第一轮未完成，无法讨论':'本轮不足两位完整回复'};
  block.textContent=status[round.discussionStatus]||'';
  return block;
}
function renderConversation(session){
  $('messages').replaceChildren();
  const rounds=session.rounds||[],last=new Map(),byUser=new Map(),byId=new Map(),dividers=new Set();
  for(const round of rounds){if(round.source!=='history'){byUser.set(round.userMessageId,round);byId.set(round.id,round);}}
  session.messages.forEach((item,index)=>{if(item.roundId&&item.phase==='initial')last.set(item.roundId,index);});
  session.messages.forEach((item,index)=>{
    if(item.phase==='discussion'&&item.roundId&&!dividers.has(item.roundId)){
      const divider=document.createElement('div');divider.className='discussion-divider';divider.textContent='第二轮 · AI 互相讨论';
      $('messages').append(divider);dividers.add(item.roundId);
    }
    message(item.role==='user'?'你':item.role==='assistant'?item.agent:'系统',item.text,item.createdAt,item.status,item.phase,false,item.recipients,item);
    const round=byUser.get(item.id)||[...last].find(([,i])=>i===index)?.[0];
    const matched=typeof round==='string'?byId.get(round):round;
    if(matched&&(last.get(matched.id)===index||!last.has(matched.id)&&matched.userMessageId===item.id))$('messages').append(discussionControl(matched));
  });
  scrollMessages(true);
}
async function createSession(projectId=null){
  if(busy)throw Error('请等待当前回复结束');
  const response=await request('POST','/api/sessions',{type:'unified',projectId});
  const session=await response.json();await loadSessionList();await openSession(session.id);
  return session;
}
async function initSessions(){
  try{await loadProjects();await loadSessionList();if(sessionList.length)await openSession(sessionList[0].id);else await createSession();}
  catch(error){$('session-list').textContent='历史会话无法读取';toast(error.message);}
}
function renderMembers(){
  $('members').replaceChildren();$('member-cards').replaceChildren();
  for(const member of team){
    const connected=!!(member.agent&&agentStatus[member.agent]?.connected);
    const paused=!!(member.agent&&agentStatus[member.agent]?.paused);
    const status=paused?'已暂停':connected?'已连接 · 回复未验证':member.agent?'未连接':'暂未连接';
    const row=document.createElement('div');row.className='member-row';
    const button=document.createElement('button');button.type='button';button.id='member-'+member.name;button.className='member'+(connected?'':' offline');
    button.title=connected?'在当前对话发送给 '+member.name:member.name+(paused?' 已暂停':' 未连接');
    const identity=document.createElement('span');identity.className='identity';
    const name=document.createElement('span');name.className='member-name';name.textContent=member.name;
    const small=document.createElement('small');small.textContent=status;identity.append(name,small);
    button.append(avatar(member),identity);button.onclick=()=>openSingle(member);row.append(button);
    if(member.agent){
      const label=document.createElement('label');label.className='member-toggle';label.title='参与群聊广播';
      const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='enable-'+member.name;
      toggle.dataset.groupAgent=member.agent;toggle.checked=enabled[member.agent];toggle.disabled=!connected;toggle.setAttribute('aria-label','启用 '+member.name+' 群聊广播');
      toggle.onchange=()=>setGroupEnabled(member.agent,toggle.checked);
      label.append(toggle);row.append(label);
    }
    $('members').append(row);
    const card=document.createElement('article');card.className='member-card';card.append(avatar(member));
    const info=document.createElement('div');info.className='card-info';const title=document.createElement('h2');title.textContent=member.name;
    const detail=document.createElement('p');detail.textContent=status;info.append(title,detail);
    if(!connected&&member.agent&&agentStatus[member.agent]?.message){const reason=document.createElement('small');reason.className='member-reason';reason.textContent=agentStatus[member.agent].message;info.append(reason);}
    const capabilities={ChatGPT:'ChatGPT 授权 · 图片与文字 · 无项目执行',Claude:'Claude Code CLI · 文字与文件内容 · 共用额度', 'Claude Code':'Claude Code CLI · 文字、只读工作区与修改方案 · 共用额度',Codex:'Codex App Server · 图片、文字与受控工作区',DeepSeek:'官方云端 API · 文字 · 默认暂停',Muse:'尚未接入 · 无法发送'};
    const note=document.createElement('small');note.className='member-source';note.textContent=capabilities[member.name];info.append(note);
    card.append(info);
    const actions=document.createElement('div');actions.className='card-actions';
    if(member.agent){
      const label=document.createElement('label');label.className='card-toggle';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.groupAgent=member.agent;checkbox.checked=enabled[member.agent];checkbox.disabled=!connected;
      checkbox.setAttribute('aria-label','启用 '+member.name+' 群聊广播');
      checkbox.onchange=()=>setGroupEnabled(member.agent,checkbox.checked);
      label.append(checkbox,document.createTextNode('群聊启用'));actions.append(label);
    }
    const single=document.createElement('button');single.type='button';single.textContent='开始聊天';single.disabled=!connected;single.onclick=()=>openSingle(member);actions.append(single);
    card.append(actions);$('member-cards').append(card);
  }
}
function setMemberPanel(open){
  $('member-panel').hidden=!open;
  $('member-panel-toggle').setAttribute('aria-expanded',String(open));
}
function recipients(){return realAgents.filter(agent=>enabled[agent]&&agentStatus[agent]?.connected);}
function selectedRecipients(){
  if(!currentSession)return [];
  const mentions=mentionedAgents($('message').value);
  if(mentions.length)return mentions.every(name=>agentStatus[name]?.connected)?mentions:[];
  const value=$('recipient').value;return value==='group'||value==='smart'?recipients():agentStatus[value]?.connected?[value]:[];
}
function updateActualRecipients(){
  const mentions=mentionedAgents($('message').value),label=$('actual-recipients');
  if(mentions.length){
    const unavailable=mentions.filter(name=>!agentStatus[name]?.connected);
    label.textContent=unavailable.length?'@ 成员不可用：'+unavailable.join('、')+'；请移除后发送':'本轮实际发送给：'+mentions.join('、')+'（@ 优先）';
  }else label.textContent=$('recipient').value==='smart'?'本轮将智能选择 1–2 位':$('recipient').value==='group'?'本轮发送给：'+(recipients().join('、')||'暂无可用成员'):'本轮发送给：'+$('recipient').value;
}
function discussionAvailability(){
  if(!currentSession)return {targets:[],reason:'请先打开对话'};
  const targets=recipients();
  if(targets.length<2)return {targets,reason:'需启用两位 AI'};
  const speakers=new Set(currentSession.messages.slice(-20).filter(item=>item.role==='assistant'&&item.status==='complete'&&item.agent).map(item=>item.agent));
  return {targets,reason:speakers.size<2?'先让两位 AI 发言':''};
}
function updateRoom(){
  const active=recipients(),current=$('recipient').value;
  if(!$('chat-view').hidden)$('page-name').textContent='对话';
  $('room-avatars').replaceChildren(...team.filter(member=>member.agent&&active.includes(member.agent)).map(avatar));
  const names=active.map(displayName);
  document.querySelector('.room-note').textContent=names.length?names.length+' 位成员可用':'暂无可用成员';
  $('chat-title').firstChild.textContent=(currentSession?.title||'新对话')+' ';
  $('chat-subtitle').textContent='发送对象仅影响当前消息；同一会话中的成员可读取此前的讨论。';
  $('message').placeholder=current==='smart'?'输入消息，由 Nexus 智能选择…':current==='group'?'发送消息给全员…':'发送消息给 '+displayName(current)+'…';
  if(!busy)$('task-description').textContent=current==='smart'?(names.length?'将从已启用成员中选择 1–2 位':'请启用至少一位已连接成员。'):current==='group'?(names.length?'消息将送达 '+names.join('、'):'请启用至少一位已连接成员。'):'消息将送达 '+displayName(current);
}
function updateSend(){
  updateActualRecipients();
  const targets=selectedRecipients(),explicitWorkspaceTarget=mentionedAgents($('message').value).length===1||$('recipient').value===targets[0],workspaceEligible=!$('workspace-read').checked||workspaceGrant&&targets.length===1&&['Codex','Claude Code'].includes(targets[0])&&explicitWorkspaceTarget&&!$('web-search-enabled').checked;
  $('workspace-propose').disabled=location.protocol!=='http:'||!workspaceGrant||busy||!$('message').value.trim()||targets.length!==1||!['Codex','Claude Code'].includes(targets[0])||!explicitWorkspaceTarget||$('web-search-enabled').checked||attachmentDraft.length>0;
  $('send').disabled=busy||attachmentUploading||!targets.length||!workspaceEligible||(!$('message').value.trim()&&!attachmentDraft.length);
  if(!workspaceEligible)$('actual-recipients').textContent='读取工作区时，请只指定 Codex 或 Claude Code，并关闭联网搜索。';
  $('send').firstChild.textContent=busy?'回复中… ':'发送 ';
  const discussion=discussionAvailability();
  $('discuss-all').disabled=busy||!!discussion.reason;
  $('discuss-all').textContent=discussing?'讨论中…':'✧ 全员讨论';
  $('discussion-reason').textContent=busy?(discussing?'本轮讨论中':'回复进行中'):discussion.reason||'额外使用 AI 额度';
  $('discuss-all').title=$('discussion-reason').textContent;
  for(const button of $('messages').querySelectorAll('.discussion-control button'))button.disabled=busy;
  $('recipient').disabled=busy;
  $('workspace-read').disabled=!workspaceGrant||busy;
  $('attachment-pick').disabled=busy||attachmentUploading;
  $('reset').disabled=busy;$('cancel').hidden=!busy;
}
function showView(view){
  if(view!=='chat')setMemberPanel(false);
  if(view!=='utility'&&$('member-cards').parentElement===$('utility-members'))$('member-panel').append($('member-cards'));
  for(const name of ['chat','project','members','memory','settings','utility']){
    $(name+'-view').hidden=name!==view;
    if($(name+'-nav'))$(name+'-nav').classList.toggle('active',name===view);
  }
  for(const name of ['members','bookmarks','todos'])$('utility-'+name+'-nav').classList.toggle('active',view==='utility'&&utilityPage===name);
  $('projects-nav').classList.toggle('active',view==='project'&&(!currentProject||currentProject.id!==null));
  $('library-nav').classList.toggle('active',view==='project'&&currentProject?.id===null);
  $('page-name').textContent=view==='chat'?'对话':view==='project'?(currentProject?.name||'我的项目'):view==='utility'?{members:'AI 成员',bookmarks:'我的收藏',todos:'待办事项'}[utilityPage]:{members:'AI 成员',memory:'全局记忆',settings:'设置'}[view];
}
function message(agent,text,createdAt=new Date().toISOString(),state='complete',messagePhase=null,followScroll=true,recipients=null,item=null){
  const name=agent==='你'||agent==='系统'?agent:displayName(agent);
  const member=team.find(item=>item.name===name);
  const row=document.createElement('article');row.className='message'+(name==='你'?' you':name==='系统'?' system':'');
  if(item?.id)row.dataset.messageId=item.id;
  if(member)row.classList.add('speaker-'+member.color);
  if(messagePhase==='discussion')row.classList.add('discussion');
  const icon=member?avatar(member):document.createElement('span');
  if(!member){icon.className='avatar';icon.textContent=name==='你'?'Y':'i';}
  const content=document.createElement('div');content.className='message-content';
  const meta=document.createElement('div');meta.className='message-meta';
  const author=document.createElement('span');author.textContent=name;
  const time=document.createElement('small');time.textContent=new Date(createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  meta.append(author,time);
  if(name==='你'&&recipients?.length){const target=document.createElement('small');target.textContent='发送给 '+recipients.map(displayName).join('、');meta.append(target);}
  if(name==='你'&&item?.mentions?.length){const marker=document.createElement('small');marker.className='mention-marker';marker.textContent='@ '+item.mentions.join('、');meta.append(marker);}
  if(messagePhase==='discussion'&&name!=='系统'){
    const badge=document.createElement('small');badge.className='discussion-badge';badge.textContent='讨论补充';meta.append(badge);
  }
  if(item?.integration&&item.role==='assistant'){const badge=document.createElement('small');badge.className='discussion-badge';badge.textContent='协作整合';meta.append(badge);}
  const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=text;
  if(state==='partial'){const partial=document.createElement('small');partial.textContent=' · 未完成';meta.append(partial);}
  content.append(meta);
  if(item?.quoteId&&!item?.handoff){
    const original=currentSession?.messages.find(entry=>entry.id===item.quoteId);
    const quote=document.createElement('button');quote.type='button';quote.className='message-quote';
    quote.textContent=original?'引用 '+(original.role==='user'?'你':displayName(original.agent))+'：'+original.text.slice(0,100)+(original.attachments?.length?' · 附件：'+original.attachments.map(file=>file.name).join('、'):''):'原消息不可用';
    quote.disabled=!original;if(original)quote.onclick=()=>jumpToMessage(original.id);content.append(quote);
  }
  if(item?.handoff){
    const handoff=item.handoff,source=currentSession?.messages.find(entry=>entry.id===handoff.sourceMessageId&&entry.role==='assistant');
    const trace=document.createElement('button');trace.type='button';trace.className='handoff-trace';
    trace.textContent=source?handoff.sourceAgent+' → '+handoff.targetAgent+' · 查看原回复':'原回复不可用';trace.disabled=!source;
    if(source)trace.onclick=()=>jumpToMessage(source.id);content.append(trace);
    if(handoff.truncated){const limit=document.createElement('small');limit.className='handoff-truncated';limit.textContent='原回复超过 20000 字，已截断传递';content.append(limit);}
  }
  if(item?.integration){
    const link=item.integration,trace=document.createElement('div');trace.className='integration-trace';
    for(const [id,label] of [[link.originalQuestionId,'原始问题'],[link.sourceMessageId,link.sourceAgent+' 原回复'],[link.collaborationRequestId,'协作请求'],[link.collaboratorReplyId,link.targetAgent+' 协作回复']]){
      const found=currentSession?.messages.some(m=>m.id===id),button=document.createElement('button');button.type='button';button.textContent=found?label:'原消息不可用';button.disabled=!found;if(found)button.onclick=()=>jumpToMessage(id);trace.append(button);
    }
    content.append(trace);
    if(Object.values(link.truncated||{}).some(Boolean)){const limit=document.createElement('small');limit.className='handoff-truncated';limit.textContent='整合材料过长，已明确截断传递';content.append(limit);}
  }
  if(item?.collaboration){
    const request=item.collaboration,card=document.createElement('div');card.className='collaboration-request';
    const title=document.createElement('strong');title.textContent='建议邀请 '+displayName(request.targetAgent)+' 协作';
    const detail=document.createElement('p');detail.textContent=request.reason+' · '+request.task;
    const state=document.createElement('small');state.textContent=({pending:'等待你决定',rejected:'已拒绝',running:'已批准，等待回复',complete:'已完成',failed:'未完成，可手动重试'})[request.status];
    card.append(title,detail,state);
    if(request.status==='pending')for(const [action,label] of [['approve','批准协作'],['reject','拒绝']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=busy||action==='approve'&&!agentStatus[request.targetAgent]?.connected;
      if(action==='approve'&&button.disabled)button.title='目标成员当前未连接或已暂停';
      button.onclick=()=>decideCollaboration(item,action);card.append(button);
    }
    if(request.status==='failed'){
      const retry=document.createElement('button');retry.type='button';retry.textContent='重试协作';retry.disabled=busy||!agentStatus[request.targetAgent]?.connected;
      retry.onclick=()=>decideCollaboration(item,'retry');card.append(retry);
    }
    content.append(card);
  }
  content.append(bubble);
  if(item?.workspaceFiles?.length){const files=document.createElement('small');files.className='workspace-used';files.textContent='工作区只读参考：'+item.workspaceFiles.join('、');content.append(files);}
  if(item?.attachments?.length){
    const attachments=document.createElement('div');attachments.className='message-attachments';
    for(const file of item.attachments){
      const link=document.createElement('a');link.href=attachmentUrl(file.id,item.sessionId||currentSession?.id);link.textContent=file.name+' · '+attachmentSize(file.size)+(file.truncated?' · 内容已截断':'');if(file.kind!=='image')link.download=file.name;
      if(file.kind==='image'){
        const thumbnail=document.createElement('img');thumbnail.src=file.previewUrl||link.href;thumbnail.alt=file.name;thumbnail.loading='lazy';link.prepend(thumbnail);link.target='_blank';link.rel='noopener';
      }
      attachments.append(link);
    }
    content.append(attachments);
  }
  if(item?.webSearch)renderWebSources(content,item.webSearch);
  if(name!=='系统'){
    const actions=document.createElement('div');actions.className='message-actions';
    const quote=document.createElement('button');quote.type='button';quote.textContent='引用回复';quote.disabled=!item?.id;quote.onclick=()=>showQuote(item.id);
    const copy=document.createElement('button');copy.type='button';copy.textContent='复制消息';copy.onclick=async()=>{try{await navigator.clipboard.writeText(bubble.textContent);toast('已复制消息');}catch{toast('复制失败，请检查剪贴板权限');}};
    actions.append(quote,copy);
    if(item?.id){
      const bookmark=document.createElement('button');bookmark.type='button';bookmark.dataset.bookmarkMessage=item.id;bookmark.textContent=organizer.bookmarks.some(b=>b.sessionId===currentSession?.id&&b.messageId===item.id)?'取消收藏':'收藏';bookmark.onclick=()=>toggleBookmark(item.id);
      const todo=document.createElement('button');todo.type='button';todo.textContent='加入待办';todo.onclick=()=>{openUtility('todos');openTodoForm(null,{sessionId:currentSession.id,messageId:item.id});$('todo-title').value=(item.text||('附件：'+(item.attachments||[]).map(a=>a.name).join('、'))).trim().slice(0,160);};actions.append(bookmark,todo);
      if(item.role==='assistant'&&item.status!=='partial'){
        const handoff=document.createElement('button');handoff.type='button';handoff.textContent='交给其他 AI';handoff.onclick=()=>openHandoff(item);actions.append(handoff);
        const source=integrationSource(item);
        if(source){
          const state=source.collaboration.integration;
          if(!state||state.status==='failed'){
            const integrate=document.createElement('button');integrate.type='button';integrate.textContent=(state?.status==='failed'?'重试 · ':'请 ')+displayName(source.agent)+' 整合';integrate.disabled=busy||!agentStatus[source.agent]?.connected;
            if(integrate.disabled)integrate.title='原发起成员当前未连接或忙碌';
            integrate.onclick=()=>openIntegration(source,item);actions.append(integrate);
          }else if(state.status==='running'||state.status==='complete'){
            const note=document.createElement('small');note.className='integration-state';note.textContent=state.status==='running'?'整合中…':'整合已完成';actions.append(note);
          }
          if(state?.status==='failed'){const note=document.createElement('small');note.className='integration-state';note.textContent=state.error||'整合未完成';actions.append(note);}
        }
      }
      if(item.role==='user'&&item.handoff&&!handoffComplete(item)){
        const retry=document.createElement('button');retry.type='button';retry.textContent='接力未完成 · 重试';retry.disabled=busy;
        retry.onclick=()=>{const source=currentSession?.messages.find(m=>m.id===item.handoff.sourceMessageId);if(source)openHandoff(source,item);else toast('原回复不可用，无法重试');};actions.append(retry);
      }
    }
    content.append(actions);
  }
  row.append(icon,content);
  const shouldFollow=followScroll&&nearMessageBottom();
  $('messages').append(row);if(shouldFollow)scrollMessages(true);return bubble;
}
function renderWebSources(content,search){
  content.querySelector('.web-search-sources')?.remove();
  const box=document.createElement('div');box.className='web-search-sources';
  const heading=document.createElement('strong');heading.textContent=search.status==='no-results'?'联网搜索 · 未找到可靠来源':'联网搜索 · '+search.sources.length+' 个来源';box.append(heading);
  for(const source of search.sources||[]){
    let url;try{url=new URL(source.url);const host=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.startsWith('['))continue;}catch{continue;}
    const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';
    link.textContent=source.title+' · '+url.hostname;
    const original=document.createElement('small');original.textContent=url.href+(source.publishedAt&&!Number.isNaN(Date.parse(source.publishedAt))?' · '+new Date(source.publishedAt).toLocaleDateString('zh-CN'):'');
    box.append(link,original);
  }
  content.append(box);
}
function nearMessageBottom(){const list=$('messages');return list.scrollHeight-list.scrollTop-list.clientHeight<120;}
function scrollMessages(force=false){if(force||nearMessageBottom())$('messages').scrollTop=$('messages').scrollHeight;}
function phase(text,stage){$('percent').textContent=text;$('task-status').textContent=text;$('progress').style.width=stage===3?'100%':'0%';}
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.add('show');toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
async function status(){
  const connectedBefore=realAgents.map(agent=>[!!agentStatus[agent]?.connected,!!agentStatus[agent]?.paused,agentStatus[agent]?.message||''].join(':')).join(',');
  try{
    const response=await fetch('/api/status');if(!response.ok)throw Error('本地后端未连接');
    const data=await response.json();agentStatus=data.agents||{};
    const connected=realAgents.filter(agent=>agentStatus[agent]?.connected);
    $('first-run-hint').hidden=connected.length>0;
    document.querySelector('.connection-pill').textContent=connected.length+' / '+realAgents.length+' 位已连接';
    $('member-count').textContent=connected.length+' 位已连接';
    $('settings-connection').textContent=connected.length?connected.map(displayName).join('、')+' 已连接；其他成员暂未连接。':'没有成员连接成功，请检查本地服务。';
    for(const member of team.filter(item=>item.agent)){
      const option=$({ChatGPT:'opt-chatgpt',Claude:'opt-claude','Claude Code':'opt-claude-code',DeepSeek:'opt-deepseek',Codex:'opt-codex'}[member.name]);
      option.disabled=!agentStatus[member.agent]?.connected;
      option.textContent=member.name+(option.disabled?(agentStatus[member.agent]?.paused?'（已暂停）':'（未连接）'):'');
    }
  }catch{
    agentStatus={};document.querySelector('.connection-pill').textContent='本地后端未连接';
    $('first-run-hint').hidden=true;
    $('member-count').textContent='连接失败';$('settings-connection').textContent='无法连接本地后端，请确认服务已启动。';
    for(const id of ['opt-chatgpt','opt-claude','opt-claude-code','opt-deepseek','opt-codex'])$(id).disabled=true;
  }
  syncGroupEnabled();
  if(connectedBefore!==realAgents.map(agent=>[!!agentStatus[agent]?.connected,!!agentStatus[agent]?.paused,agentStatus[agent]?.message||''].join(':')).join(','))renderMembers();
  updateRoom();updateSend();
}
async function request(method,path,body={}){
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-AI-Nexus':'local'},body:JSON.stringify(body)});
  if(!response.ok){let data={};try{data=await response.json();}catch{}throw Error(data.error||'本地请求失败');}
  return response;
}
const post=(path,body={})=>request('POST',path,body);
async function updateWebSearchStatus(){
  try{
    const response=await fetch('/api/tavily/status'),data=await response.json();
    if(!response.ok)throw Error(data.error||'状态读取失败');
    $('web-search-status').textContent=data.configured?'本地今日 '+data.used+' / '+data.dailyLimit+' 次':'尚未在 Mac 配置密钥';
  }catch(error){$('web-search-status').textContent=error.message;}
}
async function testWebSearch(){
  if(busy)return;
  if(!window.confirm('将执行一次真实 Tavily 搜索并计入本地次数；不会调用 AI。继续吗？'))return;
  const button=$('web-search-test');button.disabled=true;$('web-search-status').textContent='正在测试搜索…';
  try{const response=await post('/api/tavily/test'),result=await response.json();$('web-search-status').textContent='搜索成功 · '+result.resultCount+' 个来源 · 本地今日 '+result.used+' / '+result.dailyLimit+' 次';}
  catch(error){$('web-search-status').textContent='测试失败：'+error.message;toast(error.message);}
  finally{button.disabled=false;}
}
function memoryValues(){return Object.fromEntries(memoryFields.map(key=>[key,$('memory-'+key).value]));}
function memoryFeedback(text){$('memory-feedback').textContent=text;}
async function loadMemory(){
  if(memoryDirty&&!window.confirm('未保存的修改会丢失，确定重新加载吗？'))return;
  $('memory-save').disabled=true;memoryFeedback('正在读取…');
  try{
    const response=await fetch('/api/memory');const data=await response.json();
    if(!response.ok)throw Error(data.error||'读取失败');
    for(const key of memoryFields)$('memory-'+key).value=data[key]||'';
    memoryRevision=data.revision;memoryReady=true;memoryDirty=false;
    $('memory-summary').textContent=memoryFields.some(key=>data[key]?.trim())?'已保存':'暂无内容';
    $('memory-indicator').classList.remove('visible');memoryFeedback('保存后才会提供给 AI');$('memory-save').disabled=false;
  }catch(error){memoryReady=false;$('memory-summary').textContent='读取失败';memoryFeedback(error.message);}
}
async function saveMemory(event){
  event.preventDefault();if(!memoryReady)return;
  const values=memoryValues();
  if(memoryFields.reduce((n,key)=>n+values[key].length,0)>6000){memoryFeedback('四栏合计最多 6000 字');return;}
  $('memory-save').disabled=true;memoryFeedback('正在安全保存…');
  try{
    const response=await post('/api/memory',{...values,revision:memoryRevision});const data=await response.json();
    for(const key of memoryFields)$('memory-'+key).value=data[key];
    memoryRevision=data.revision;memoryDirty=false;$('memory-summary').textContent='已保存';
    $('memory-indicator').classList.remove('visible');memoryFeedback('已保存到本地文件');
  }catch(error){memoryFeedback(error.message);$('memory-summary').textContent='尚未保存';}
  finally{$('memory-save').disabled=false;}
}
async function send(event){
  event?.preventDefault();const text=$('message').value.trim(),recipient=$('recipient').value,names=selectedRecipients(),sessionId=currentSession?.id;
  if((!text&&!attachmentDraft.length)||busy||attachmentUploading||!names.length||!sessionId)return;
  const files=[...attachmentDraft];
  const mentions=mentionedAgents(text),quoteId=quotedMessageId,requestId=crypto.randomUUID(),webSearch=$('web-search-enabled').checked,workspaceRead=$('workspace-read').checked,collaborationMode=$('collaboration-mode').checked;let accepted=false,webSearchError='';
  busy=true;closeMentions();updateSend();const optimistic=message('你',text||'请阅读本轮附件并回答。',new Date().toISOString(),'complete',null,true,names,{quoteId,mentions,attachments:files,sessionId});$('message').value='';quotedMessageId=null;renderQuote();resizeComposer();$('task-title').textContent=(text||files[0].name).slice(0,30);phase(webSearch?'正在搜索':'正在发送附件',0);
  const generation=viewGeneration;
  try{
    const body=recipient==='group'||recipient==='smart'?{sessionId,recipient,recipients:names,message:text,mentions,requestId,webSearch,collaborationMode}:{sessionId,recipient,message:text,mentions,requestId,webSearch,collaborationMode};
    if(files.length)body.attachments=files.map(file=>file.id);
    if(workspaceRead)body.workspaceRead=true;
    if(quoteId)body.quoteId=quoteId;
    const response=await post('/api/chat',body);accepted=true;$('workspace-read').checked=false;$('collaboration-mode').checked=false;attachmentDraft=[];for(const file of files)if(file.previewUrl)URL.revokeObjectURL(file.previewUrl);renderAttachmentDraft();$('attachment-status').textContent=files.length?'附件已发送':'';
    await consumeChatStream(response,sessionId,generation,names,'initial',optimistic);
  }catch(error){phase('请求失败',0);toast(error.message);if(webSearch)webSearchError=error.message;if(!accepted&&currentSession?.id===sessionId){$('message').value=text;quotedMessageId=quoteId;renderQuote();resizeComposer();}}
  finally{
    busy=false;updateSend();
    try{await loadSessionList();if(currentSession?.id===sessionId)await refreshVisibleSession(sessionId);}catch(error){toast(error.message);}
    await status();if(webSearch){await updateWebSearchStatus();if(webSearchError)$('web-search-status').textContent='搜索失败：'+webSearchError;}
  }
}
async function startDiscussion(sessionId,roundId){
  if(busy||currentSession?.id!==sessionId)return;
  busy=true;discussing=true;updateSend();
  const generation=viewGeneration,round=currentSession.rounds?.find(item=>item.id===roundId);
  if(!round||round.discussionStatus!=='available'){busy=false;discussing=false;updateSend();return;}
  for(const button of $('messages').querySelectorAll('.discussion-control button'))button.disabled=true;
  phase('正在开始讨论',0);$('task-description').textContent='第二轮需要额外使用 AI 额度';
  try{
    const path='/api/sessions/'+sessionId+'/rounds/'+roundId+'/discuss';
    const participants=round.participants.filter(agent=>round.outcomes[agent]==='complete');
    await consumeChatStream(await post(path),sessionId,generation,participants,'discussion');
  }catch(error){phase('讨论未完成',0);toast(error.message);}
  finally{
    busy=false;discussing=false;updateSend();
    try{await loadSessionList();if(currentSession?.id===sessionId)await refreshVisibleSession(sessionId);}catch(error){toast(error.message);}
    await status();
  }
}
async function startAllDiscussion(){
  const {targets,reason}=discussionAvailability(),sessionId=currentSession?.id;
  if(busy||reason||!sessionId)return;
  busy=true;discussing=true;updateSend();
  const generation=viewGeneration;
  phase('正在开始讨论',0);$('task-description').textContent='本轮讨论会额外使用 AI 额度';
  try{
    await consumeChatStream(await post('/api/sessions/'+sessionId+'/discuss',{participants:targets}),sessionId,generation,targets,'discussion');
  }catch(error){phase('讨论未完成',0);toast(error.message);}
  finally{
    busy=false;discussing=false;updateSend();
    try{await loadSessionList();if(currentSession?.id===sessionId)await refreshVisibleSession(sessionId);}catch(error){toast(error.message);}
    await status();
  }
}
async function consumeChatStream(response,sessionId,generation,names,streamPhase,optimistic=null,onEvent=null){
  const reader=response.body.getReader(),decoder=new TextDecoder(),bubbles=new Map(),replied=new Set(),failed=new Set();
  let buffer='',batchDone=false,dividerShown=false,selectedNames=names;
  const visible=()=>currentSession?.id===sessionId&&viewGeneration===generation;
  const consume=line=>{
    if(!line.trim())return;
    const item=JSON.parse(line),agent=item.agent;
    onEvent?.(item);
    if(item.type==='selection')selectedNames=item.agents;
    if(item.type==='error'&&agent)failed.add(agent);
    if(item.type==='done'&&!replied.has(agent)&&agent)failed.add(agent);
    if(item.type==='batchDone')batchDone=true;
    if(!visible())return;
    if(item.type==='webSearch'){
      if(optimistic)renderWebSources(optimistic.parentElement,item.webSearch);
      phase(item.webSearch.status==='no-results'?'搜索无结果':'搜索完成',1);
    }
    if(item.type==='selection')message('系统','智能选择：'+item.agents.map(displayName).join('、')+' · '+item.reason);
    if(item.type==='workspaceRead')message('系统','已只读参考工作区文件：'+(item.files.join('、')||'仅目录结构'));
    if(item.type==='discussionStart'&&!dividerShown){
      const divider=document.createElement('div');divider.className='discussion-divider';divider.textContent='第二轮 · AI 互相讨论';$('messages').append(divider);dividerShown=true;
      phase('正在讨论',1);
    }
    if(item.type==='start'){phase(streamPhase==='discussion'?'正在讨论':'正在生成',1);$('task-description').textContent=selectedNames.map(displayName).join('、')+' 正在回复';}
    if(item.type==='delta'||item.type==='message'){
      const shouldFollow=nearMessageBottom();
      const key=agent+':'+(item.itemId||'main');let bubble=bubbles.get(key);
      if(!bubble){bubble=message(agent,'',new Date().toISOString(),'complete',streamPhase);bubbles.set(key,bubble);}
      replied.add(agent);if(item.type==='delta')bubble.textContent+=item.text||'';else bubble.textContent=item.text||'';
      phase('接收回复',2);if(shouldFollow)scrollMessages(true);
    }
    if(item.type==='notice')message('系统',displayName(agent)+'：'+item.text);
    if(item.type==='error')message('系统',(agent?displayName(agent)+' 回复失败：':'讨论失败：')+item.message);
    if(item.type==='done'&&!replied.has(agent))message('系统',displayName(agent)+' 已结束，但没有返回文字。');
    if(item.type==='batchDone'){
      phase(failed.size?'部分失败':'已完成',failed.size?0:3);
      $('task-description').textContent='完成 '+(selectedNames.length-failed.size)+' / '+selectedNames.length+' 位成员的回复';
    }
  };
  while(true){
    const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
    let index;while((index=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,index));buffer=buffer.slice(index+1);}
    if(done)break;
  }
  if(buffer.trim())consume(buffer);
  if(!batchDone)throw Error('连接提前中断，无法确认所有成员的结果。');
}
for(const nav of document.querySelectorAll('[data-view]'))nav.onclick=async()=>{
  showView(nav.dataset.view);closeHistory();
};
$('projects-nav').onclick=showProjectsIndex;
$('library-nav').onclick=()=>openProject(null).catch(error=>toast(error.message));
$('compose').addEventListener('submit',send);$('message').addEventListener('input',()=>{resizeComposer();refreshMentions();updateSend();});
$('handoff-form').addEventListener('submit',submitHandoff);
$('handoff-cancel').onclick=()=>{$('handoff-dialog').close();handoffDraft=null;};
$('handoff-dialog').addEventListener('close',()=>{if(!busy)handoffDraft=null;});
$('integration-form').addEventListener('submit',submitIntegration);
$('integration-cancel').onclick=()=>{$('integration-dialog').close();integrationDraft=null;};
$('integration-dialog').addEventListener('close',()=>{if(!busy)integrationDraft=null;});
$('attachment-pick').onclick=()=>$('attachment-input').click();
$('workspace-toggle').onclick=()=>{const panel=$('workspace-panel');panel.hidden=!panel.hidden;$('workspace-toggle').setAttribute('aria-expanded',String(!panel.hidden));};
$('workspace-select').onclick=async()=>{const id=currentSession?.id;if(!id||busy)return;const button=$('workspace-select');button.disabled=true;$('workspace-state').textContent='请在 Mac 选择项目文件夹…';try{const response=await post('/api/workspaces/'+id+'/select');const data=await response.json();if(currentSession?.id===id){workspaceGrant=data.workspace;renderWorkspace();toast('已授权此会话只读访问工作区');}}catch(error){toast(error.message);if(currentSession?.id===id)renderWorkspace();}finally{button.disabled=false;}};
$('workspace-revoke').onclick=async()=>{const id=currentSession?.id;if(!id||busy)return;try{await request('DELETE','/api/workspaces/'+id);if(currentSession?.id===id){workspaceGrant=null;renderWorkspace();toast('已撤销工作区授权');}}catch(error){toast(error.message);}};
$('workspace-propose').onclick=async()=>{const id=currentSession?.id,targets=selectedRecipients(),task=$('message').value.trim();if(!id||busy||!workspaceGrant||targets.length!==1||!['Codex','Claude Code'].includes(targets[0])||!task)return;
 busy=true;updateSend();phase('生成修改方案',0);
 try{const response=await post('/api/workspaces/'+id+'/proposals',{agent:targets[0],task}),data=await response.json();if(currentSession?.id===id){workspaceProposals.push(data.proposal);renderWorkspaceProposals();$('workspace-panel').hidden=true;$('workspace-toggle').setAttribute('aria-expanded','false');$('messages').scrollTop=$('messages').scrollHeight;toast('方案已生成；请在聊天中查看差异后选择批准或拒绝');}}
 catch(error){toast(error.message);}finally{busy=false;updateSend();phase('待发送',0);renderWorkspaceProposals();}
};
$('workspace-read').onchange=updateSend;
$('attachment-input').onchange=event=>{addAttachments(event.target.files);event.target.value='';};
for(const target of [$('compose'),$('messages')]){
 target.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();target.classList.add('attachment-drop');}});
 target.addEventListener('dragleave',()=>target.classList.remove('attachment-drop'));
 target.addEventListener('drop',event=>{target.classList.remove('attachment-drop');if(event.dataTransfer?.files.length){event.preventDefault();addAttachments(event.dataTransfer.files);}});
}
$('message').addEventListener('paste',event=>{
 const supported=['image/png','image/jpeg','image/webp'];
 const direct=[...event.clipboardData?.files||[]].filter(file=>supported.includes(file.type));
 const images=direct.length?direct:[...event.clipboardData?.items||[]].filter(item=>supported.includes(item.type)).map(item=>item.getAsFile()).filter(Boolean);
 if(images.length){event.preventDefault();addAttachments(images.map((file,index)=>new File([file],file.name&&/\.(png|jpe?g|webp)$/i.test(file.name)?file.name:'粘贴图片-'+(index+1)+'.'+({"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[file.type]),{type:file.type})));}
});
$('message').addEventListener('click',refreshMentions);
$('message').addEventListener('keydown',event=>{
  if(!$('mention-list').hidden&&['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key)){
    event.preventDefault();
    if(event.key==='Escape'){closeMentions();return;}
    if(event.key==='ArrowDown')mentionIndex=(mentionIndex+1)%mentionChoices.length;
    if(event.key==='ArrowUp')mentionIndex=(mentionIndex+mentionChoices.length-1)%mentionChoices.length;
    if(event.key==='Enter'){chooseMention(mentionChoices[mentionIndex]);return;}
    for(const [index,option] of [...$('mention-list').children].entries())option.setAttribute('aria-selected',String(index===mentionIndex));
    return;
  }
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();send();}
});
$('search-toggle').onclick=()=>{$('chat-search').hidden=!$('chat-search').hidden;$('search-toggle').setAttribute('aria-expanded',String(!$('chat-search').hidden));if(!$('chat-search').hidden){renderSearch();$('search-input').focus();}};
$('search-close').onclick=()=>{$('chat-search').hidden=true;$('search-toggle').setAttribute('aria-expanded','false');$('message').focus();};
$('search-input').addEventListener('input',renderSearch);
$('search-input').addEventListener('keydown',event=>{if(event.key==='Escape')$('search-close').click();});
$('global-search-toggle').onclick=()=>setGlobalSearch($('global-search').hidden);
$('global-search-close').onclick=()=>setGlobalSearch(false);
$('global-search-input').addEventListener('input',()=>{clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(()=>searchAllHistory(true),160);});
$('global-search-input').addEventListener('keydown',event=>{if(event.key==='Escape')setGlobalSearch(false);if(event.key==='Enter'){event.preventDefault();clearTimeout(globalSearchTimer);searchAllHistory(true);}});
$('message').addEventListener('focus',syncMobileViewport);
$('message').addEventListener('blur',()=>{
  document.documentElement.style.removeProperty('--nexus-visible-height');
  document.documentElement.style.removeProperty('--nexus-visible-top');
  requestAnimationFrame(restoreMobileViewport);
  setTimeout(restoreMobileViewport,300);
});
window.visualViewport?.addEventListener('resize',syncMobileViewport);
window.visualViewport?.addEventListener('scroll',syncMobileViewport);
window.addEventListener('resize',syncMobileViewport);
window.addEventListener('pageshow',restoreMobileViewport);
$('recipient').addEventListener('change',()=>{updateRoom();updateSend();});
$('member-panel-toggle').onclick=()=>setMemberPanel($('member-panel').hidden);
document.addEventListener('click',event=>{if(!$('member-panel').hidden&&!$('member-panel').contains(event.target)&&event.target!==$('member-panel-toggle'))setMemberPanel(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('member-panel').hidden){setMemberPanel(false);$('member-panel-toggle').focus();}});
$('discuss-all').onclick=startAllDiscussion;
$('web-search-enabled').onchange=()=>{$('web-search-status').title=$('web-search-enabled').checked?'当前消息会执行一次 Tavily 搜索':'普通聊天不会搜索';updateSend();};
$('web-search-test').onclick=testWebSearch;
$('memory-form').addEventListener('submit',saveMemory);$('memory-reload').onclick=loadMemory;
for(const key of memoryFields)$('memory-'+key).addEventListener('input',()=>{
  if(!memoryReady)return;memoryDirty=true;$('memory-summary').textContent='未保存更改';$('memory-indicator').classList.add('visible');memoryFeedback('保存后才会提供给 AI');
});
let creatingSession=false;
async function showNewSessionForm(){
  if(busy||creatingSession){if(busy)toast('请等待当前回复结束');return;}
  creatingSession=true;$('new-session').disabled=true;
  try{await createSession();setMemberPanel(false);phase('待发送',0);$('message').focus();}
  catch(error){toast(error.message);}finally{creatingSession=false;$('new-session').disabled=false;}
}
$('reset').onclick=showNewSessionForm;
$('new-session').onclick=showNewSessionForm;
$('new-session-cancel').onclick=()=>$('new-session-form').hidden=true;
$('new-session-form').onsubmit=async event=>{
  event.preventDefault();const button=$('new-session-form').querySelector('button[type="submit"]');button.disabled=true;
  try{await createSession($('new-session-project').value||null);$('new-session-form').hidden=true;phase('待发送',0);toast('已创建独立新会话');}
  catch(error){toast(error.message);}finally{button.disabled=false;}
};
$('new-project').onclick=()=>{if(busy){toast('请等待当前回复结束');return;}$('project-create').hidden=false;$('project-name').focus();};
$('project-create-cancel').onclick=()=>$('project-create').hidden=true;
$('project-create').onsubmit=async event=>{
  event.preventDefault();const button=$('project-create').querySelector('button[type="submit"]');button.disabled=true;
  try{const response=await request('POST','/api/projects',{name:$('project-name').value.trim()});const project=await response.json();$('project-name').value='';$('project-create').hidden=true;await loadProjects();await openProject(project.id);}
  catch(error){toast(error.message);}finally{button.disabled=false;}
};
$('project-index-new').onclick=()=>{$('sidebar-projects').open=true;$('project-create').hidden=false;document.body.classList.add('history-open');$('history-backdrop').hidden=false;$('project-name').focus();};
$('project-home-rename').onclick=()=>{if(!currentProject?.id)return;$('project-home-name').value=currentProject.name;$('project-home-rename-form').hidden=false;$('project-home-name').focus();$('project-home-name').select();};
$('project-home-rename-cancel').onclick=()=>$('project-home-rename-form').hidden=true;
$('project-home-rename-form').onsubmit=async event=>{
  event.preventDefault();if(!currentProject?.id)return;
  const name=$('project-home-name').value.trim();if(!name)return;
  try{await renameProject(currentProject.id,name);$('project-home-rename-form').hidden=true;toast('项目已重命名');}catch(error){toast(error.message);}
};
$('project-home-delete').onclick=async()=>{
  if(!currentProject?.id)return;
  const name=currentProject.name,id=currentProject.id;
  if(!window.confirm('删除项目「'+name+'」？会话移至未归类；项目介绍和记忆会删除。若有项目资料，请先移动或删除资料。'))return;
  try{await removeProject(id);toast('项目已删除，会话已保留');}catch(error){toast(error.message);}
};
$('project-description-form').onsubmit=async event=>{
  event.preventDefault();if(!currentProject)return;const id=currentProject.id;
  try{const response=await request('PATCH','/api/projects/'+id,{description:$('project-description').value});const project=await response.json();if(currentProject?.id===id){currentProject.description=project.description;$('project-description-status').textContent='已保存';}await loadProjects();}
  catch(error){$('project-description-status').textContent=error.message;}
};
$('project-memory-form').onsubmit=async event=>{
  event.preventDefault();if(!currentProject)return;const id=currentProject.id;
  const values=Object.fromEntries(memoryFields.map(key=>[key,$('project-memory-'+key).value]));
  try{const response=await request('PUT','/api/projects/'+id+'/memory',{...values,revision:currentProject.memoryRevision});const saved=await response.json();if(currentProject?.id===id){currentProject.memory=saved;currentProject.memoryRevision=saved.revision;$('project-memory-status').textContent='已安全保存';}}
  catch(error){$('project-memory-status').textContent=error.message;}
};
$('project-new-session').onclick=()=>{if(!currentProject)return;projectOptions($('new-session-project'),currentProject.id);$('new-session-form').hidden=false;document.body.classList.add('history-open');$('history-backdrop').hidden=false;};
$('project-new-note').onclick=()=>{if(!currentProject)return;editingNote=null;editingNoteSourceName=null;$('project-note-form').reset();if(currentProject.id===null)$('project-note-scope').value='global';$('project-note-status').textContent='保存后提供给相关会话';$('project-note-form').hidden=false;$('project-note-title').focus();};
$('project-note-cancel').onclick=()=>{$('project-note-form').hidden=true;editingNote=null;editingNoteSourceName=null;};
$('project-note-form').onsubmit=async event=>{
  event.preventDefault();if(!currentProject)return;
  const file=$('project-note-file').files[0],status=$('project-note-status');let content=$('project-note-content').value,sourceName=editingNoteSourceName;
  if(file){
    if(!/\.(txt|md|markdown)$/i.test(file.name)||file.size>100*1024){status.textContent='仅支持 100 KiB 内的 TXT / Markdown';return;}
    try{content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());sourceName=file.name;$('project-note-content').value=content;}
    catch{status.textContent='文件不是有效的 UTF-8 文本';return;}
  }
  const data={title:$('project-note-title').value,content,projectId:$('project-note-scope').value==='global'?null:currentProject.id,sourceName};
  try{await request(editingNote?'PATCH':'POST',editingNote?'/api/notes/'+editingNote:'/api/notes',data);$('project-note-form').hidden=true;editingNote=null;editingNoteSourceName=null;await loadProjectNotes();toast('资料已保存');}
  catch(error){status.textContent=error.message;}
};
$('history-nav').onclick=()=>{document.body.classList.add('history-open');$('history-backdrop').hidden=false;};
$('utility-members-nav').onclick=()=>openUtility('members');
$('utility-bookmarks-nav').onclick=()=>openUtility('bookmarks');
$('utility-todos-nav').onclick=()=>openUtility('todos');
$('utility-close').onclick=()=>showView('chat');
$('todo-new').onclick=()=>openTodoForm();
$('todo-cancel').onclick=()=>{$('todo-form').hidden=true;todoDraft=null;};
$('todo-form').onsubmit=async event=>{
 event.preventDefault();if(!todoDraft||organizerBusy)return;
 const title=$('todo-title').value.trim(),note=$('todo-note').value.trim();if(!title){toast('请填写待办标题');return;}
 organizerBusy=true;const save=$('todo-form').querySelector('button[type="submit"]');save.disabled=true;
 try{
  if(todoDraft.editing)await request('PATCH','/api/todos/'+todoDraft.id,{title,note,completed:todoDraft.completed});
  else await post('/api/todos',{id:todoDraft.id,title,note,source:todoDraft.source});
  await loadOrganizer();$('todo-form').hidden=true;todoDraft=null;toast('待办已保存');
 }catch(error){toast(error.message);}finally{organizerBusy=false;save.disabled=false;}
};
$('history-close').onclick=closeHistory;$('history-backdrop').onclick=closeHistory;
$('sidebar-toggle').onclick=()=>setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
$('cancel').onclick=async()=>{try{await post('/api/cancel');toast('已请求停止回复');}catch(error){toast(error.message);}};
$('refresh-status').onclick=status;
try{if(localStorage.getItem('ai-nexus-sidebar-collapsed')==='1')setSidebarCollapsed(true);}catch{}
resizeComposer();renderMembers();renderWorkspace();status();loadMemory();updateWebSearchStatus();loadOrganizer().catch(error=>toast(error.message));
window.addEventListener('storage',event=>{if(event.key===groupEnabledKey)syncGroupEnabled();});
window.addEventListener('pageshow',syncGroupEnabled);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncGroupEnabled();});
const chatgptReturn=new URLSearchParams(location.search).get('chatgpt');
initSessions().then(()=>{
  if(['authorized','failed','no-plan-permission'].includes(chatgptReturn)){
    showView('settings');history.replaceState(null,'',location.pathname);
  }
});
setInterval(()=>{if(!busy)status();},15000);
