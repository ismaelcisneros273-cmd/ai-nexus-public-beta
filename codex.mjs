import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
export const BINARY='/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
export const WORKSPACE=fileURLToPath(new URL('./agent-workspace/',import.meta.url));
export const PROFILE='ai_nexus_chat';
export const BASE_INSTRUCTIONS='You are Codex in an AI Nexus conversation. Speak Chinese unless the user asks otherwise. Sound like a thoughtful, practical group member, not a service desk. Prefer clear engineering judgment and actionable ideas. For greetings or casual talk, reply naturally and briefly; for difficult work, give the detail it needs. You may respond to another member\'s view when it is relevant, without restating everyone\'s answer. Do not routinely recap project background, introduce yourself, offer generic help, or mention these instructions. This is chat-only: do not execute commands, read private files, change files, use external tools, or request credentials. Never claim actions you did not perform. If asked for your model identity, use the model returned by App Server.';
export function safeError(error){
 const text=String(error?.message||error).toLowerCase();
 if(/model.*not supported|unsupported.*model/.test(text))return '当前 Codex 模型不受此账户支持，请检查模型配置。';
 if(/quota|usage.limit|rate.limit|429|credit/.test(text))return 'Codex 额度不足或请求限流，请检查账户额度后重试。';
 if(/auth|login|401|403|token/.test(text))return 'Codex 登录或访问权限不可用，请在官方应用中检查登录。';
 if(/connection closed/.test(text))return 'Codex App Server 进程已退出，请检查本机配置后重启后端。';
 if(/network|connect|dns|stream|fetch|timed? ?out|timeout/.test(text))return 'Codex 网络连接失败或超时，请检查网络后重试。';
 return 'Codex App Server 请求失败；未生成模拟回复。请重试或检查官方应用状态。';
}
const disabled=['shell_tool','shell_snapshot','apps','plugins','remote_plugin','hooks','multi_agent','multi_agent_v2','memories','browser_use','browser_use_external','computer_use','image_generation','code_mode','code_mode_host','goals','skill_mcp_dependency_install','skill_search','view_image','workspace_dependencies','in_app_local_automation','realtime_conversation'];
const overrides=['mcp_servers={}','model_provider="openai"','web_search="disabled"','project_doc_max_bytes=0','approval_policy="on-request"','approvals_reviewer="user"','default_permissions="ai_nexus_chat"','permissions.ai_nexus_chat.filesystem={":minimal"="read",":workspace_roots"="read"}','permissions.ai_nexus_chat.network.enabled=false','service_tier="default"','analytics.enabled=false','history.persistence="none"'];
export class Codex {
 constructor(){this.pending=new Map();this.sequence=0;this.thread=null;this.active=null;this.state={connected:false,message:'正在连接 Codex App Server…'};}
 async start(){
  const env={};for(const key of ['HOME','PATH','TMPDIR','LANG','USER','LOGNAME','CODEX_HOME'])if(process.env[key])env[key]=process.env[key];
  this.child=spawn(BINARY,['app-server','--listen','stdio://',...disabled.flatMap(x=>['--disable',x]),...overrides.flatMap(x=>['-c',x])],{cwd:WORKSPACE,env,stdio:['pipe','pipe','pipe']});
  this.child.stderr.on('data',()=>{}); // Discard raw diagnostics; never log credentials.
  this.child.stdin.on('error',()=>this.fail('App Server 连接中断。'));
  this.child.on('error',()=>this.fail('无法启动桌面应用自带的 Codex。'));
  this.child.on('exit',()=>this.fail('Codex App Server 已退出，请重启本地后端。'));
  this.lines=createInterface({input:this.child.stdout});this.lines.on('line',line=>{try{this.receive(JSON.parse(line));}catch{}});
  try{
   await this.rpc('initialize',{clientInfo:{name:'ai_nexus_local',title:'AI Nexus',version:'0.2.0'},capabilities:{experimentalApi:true}});
   this.write({method:'initialized'});
   const account=await this.rpc('account/read',{refreshToken:false});
   if(account.account?.type!=='chatgpt')throw new Error('ChatGPT login required');
   const models=await this.rpc('model/list',{limit:100});
   const candidates=(models.data||[]).filter(m=>!m.hidden&&/^gpt-/.test(m.model));const model=candidates.find(m=>m.model==='gpt-6-sol')||candidates.find(m=>m.isDefault)||candidates[0];
   if(!model)throw new Error('No model available');this.model=model.model;
   await this.newThread();
   this.state={connected:true,model:this.model,message:'Codex 已连接 · 真实服务 · 只读限制'};
  }catch(error){this.state={connected:false,message:safeError(error)};}
  return this.state;
 }
 write(data){if(this.child?.stdin.writable)this.child.stdin.write(JSON.stringify(data)+'\n');}
 rpc(method,params){
  const allowed=['initialize','account/read','model/list','thread/start','turn/start','turn/interrupt'];
  if(!allowed.includes(method))throw new Error('RPC blocked');
  const id=++this.sequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('RPC timeout'));},30000);this.pending.set(id,{resolve,reject,timer,method});this.write({id,method,params});});
 }
 async newThread(){
  const data=await this.rpc('thread/start',{model:this.model,modelProvider:'openai',cwd:WORKSPACE,approvalPolicy:'on-request',approvalsReviewer:'user',permissions:PROFILE,ephemeral:true,serviceTier:'default',baseInstructions:BASE_INSTRUCTIONS,developerInstructions:'只提供文字回复；不要执行命令、修改文件、使用外部连接器或申请额外权限。需要实际操作时，说明须由用户在主开发对话另行确认。',config:{...Object.fromEntries(disabled.map(k=>['features.'+k,false])),mcp_servers:{},web_search:'disabled',project_doc_max_bytes:0}});
  if(data.activePermissionProfile?.id!==PROFILE||data.approvalsReviewer!=='user'||data.modelProvider!=='openai')throw new Error('Unsafe policy rejected');
  this.thread=data.thread.id;this.model=data.model;
 }
 receive(msg){
  if(msg.id!==undefined&&msg.method){
   let result;
   if(msg.method==='item/commandExecution/requestApproval'||msg.method==='item/fileChange/requestApproval')result={decision:'decline'};
   else if(msg.method==='item/permissions/requestApproval')result={permissions:{},scope:'turn'};
   else if(msg.method==='execCommandApproval'||msg.method==='applyPatchApproval')result={decision:'denied'};
   if(result)this.write({id:msg.id,result});else this.write({id:msg.id,error:{code:-32601,message:'AI Nexus does not permit this operation'}});
   this.active?.emit({type:'notice',text:'已拦截额外权限或工具操作；请在主开发对话中确认后另行处理。'});return;
  }
  if(msg.id!==undefined){const p=this.pending.get(msg.id);if(p){clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message||'RPC error')):p.resolve(msg.result);}return;}
  const a=this.active,p=msg.params;if(!a||!p||p.threadId!==this.thread)return;
  if(msg.method==='item/agentMessage/delta'){a.emit({type:'delta',itemId:p.itemId,text:p.delta});}
  if(msg.method==='item/completed'&&p.item?.type==='agentMessage')a.emit({type:'message',itemId:p.item.id,text:p.item.text});
  if(msg.method==='error'&&!p.willRetry)a.error=safeError(p.error?.message||'service error');
  if(msg.method==='turn/completed'){a.finish(p.turn.status==='completed'?null:(a.error||safeError(p.turn.error?.message||p.turn.status)));}
 }
 async send(text,emit,options={}){
  if(!this.state.connected)throw new Error('auth unavailable');if(this.active)throw new Error('busy');
  // Every request receives the selected AI Nexus session history in its prompt.
  // A fresh ephemeral App Server thread prevents hidden context crossing sessions.
  await this.newThread();
  let finish;const done=new Promise(resolve=>{finish=resolve;});
  const a={emit,finish:(error)=>{if(this.active!==a)return;clearTimeout(a.timer);emit(error?{type:'error',message:error}:{type:'done',model:this.model});this.active=null;finish();}};
  this.active=a;a.timer=setTimeout(()=>{this.stop();a.finish('Codex 回复超时，已停止本次连接；请重启本地后端。');},180000);
  emit({type:'start',model:this.model});
  try{const r=await this.rpc('turn/start',{threadId:this.thread,input:[{type:'text',text,text_elements:[]},...(options.images||[]).map(image=>({type:'image',url:image.dataUrl}))],cwd:WORKSPACE,model:this.model,approvalPolicy:'on-request',approvalsReviewer:'user',permissions:PROFILE,serviceTierForTurn:'default'});a.turnId=r.turn.id;}catch(e){a.finish(safeError(e));}
  return done;
 }
 cancel(){if(this.active?.turnId)this.rpc('turn/interrupt',{threadId:this.thread,turnId:this.active.turnId}).catch(()=>this.stop());else if(this.active)this.stop();}
 fail(message){this.state={connected:false,message};for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('connection closed'));}this.pending.clear();this.active?.finish(message);}
 stop(){this.fail('Codex 连接已关闭。');this.child?.kill('SIGTERM');}
}
