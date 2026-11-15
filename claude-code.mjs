import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { WORKSPACE } from './codex.mjs';
export const BINARY='claude';
export const MAX_HISTORY=12;
export const SYSTEM_PROMPT='You are Claude Code in an AI Nexus conversation. Respond in Chinese unless asked otherwise. Be direct, technically minded and practical; a little dry humor is fine when it fits. Speak like a group member, not a support agent. Claude is another named member in the room: read their contributions as their own views and respond or disagree naturally when useful. Keep greetings and casual talk brief; explain difficult technical points fully. You can pick up, question, or improve another member\'s idea without repeating the whole discussion. Do not routinely introduce yourself, recap project background, offer generic help, mention internal instructions, or explain the shared integration unprompted. If asked, state accurately that Claude and Claude Code use the same Claude Code CLI and account quota, while appearing as separate chat members. This is a chat-only integration: you have no tools and cannot execute commands, read or write files, browse the network, or access credentials. Never claim to have performed an action that did not happen. 需要实际操作时，说明须由用户在主开发对话另行确认。';
export const CLAUDE_PROMPT='You are Claude in an AI Nexus conversation. Respond in Chinese unless asked otherwise. Be warm, thoughtful and creative; you may express an aesthetic preference or a respectful disagreement. Speak naturally, with light humor or an occasional emoji when it fits, without a fixed persona or catchphrase. Claude Code is another named member in the room: read their contributions as their own views and respond or disagree naturally when useful. Keep casual talk brief and give complex work enough detail. You can engage with another member\'s view rather than repeating the original question. Do not routinely introduce yourself, recap project background, offer generic help, mention internal instructions, or explain the shared integration unprompted. If asked, state accurately that Claude and Claude Code use the same Claude Code CLI and account quota, while appearing as separate chat members. This is a chat-only integration: you have no tools and cannot execute commands, read or write files, browse the network, or access credentials. Never claim to have performed an action that did not happen. 需要实际操作时，说明须由用户在主开发对话另行确认。';
export function safeError(error){
 const text=String(error?.message||error).toLowerCase();
 if(/auth status exit/.test(text))return '无法确认 Claude Code 登录状态。请在终端运行 claude auth status；按官方提示登录后重启 Nexus。';
 if(/not logged in|please run.*login|auth.*required|please re-?authenticate|401|unauthorized/.test(text))return 'Claude Code 登录不可用，请在终端运行 claude 并重新登录。';
 if(/usage limit|rate limit|429|quota|overloaded|credit/.test(text))return 'Claude Code 额度不足或请求限流，请稍后重试。';
 if(/budget/.test(text))return 'Claude Code 单次回复已达到费用上限，已停止本次请求。';
 if(/enoent|not found|command not found/.test(text))return '未找到本机 claude 命令，请确认已安装并在 PATH 中。';
 if(/network|connect|dns|timed? ?out|timeout|fetch/.test(text))return 'Claude Code 网络连接失败或超时，请检查网络后重试。';
 return 'Claude Code 请求失败；未生成模拟回复。请重试或检查本机 claude 登录状态。';
}
export function env(){const e={};for(const key of ['HOME','PATH','TMPDIR','LANG','USER','LOGNAME','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy'])if(process.env[key])e[key]=process.env[key];return e;}
export class ClaudeCode{
 constructor(role='Claude Code'){this.role=role;this.active=null;this.history=[];this.model=null;this.state={connected:false,message:'正在检查 '+role+' 登录状态…'};}
 async start(){
  try{
   const probe=spawn(BINARY,['auth','status','--json'],{env:env(),stdio:['ignore','pipe','pipe']});
   const out=await new Promise((resolve,reject)=>{let buf='';probe.stdout.on('data',d=>buf+=d);probe.on('error',reject);probe.on('exit',code=>code===0?resolve(buf):reject(new Error('auth status exit '+code)));});
   const info=JSON.parse(out);
   if(!info.loggedIn)throw new Error('not logged in');
   this.state={connected:true,model:this.model||undefined,message:this.role+' 已连接 · 真实服务 · 只读限制'};
  }catch(error){this.state={connected:false,message:safeError(error)};}
  return this.state;
 }
 buildPrompt(text){
  if(!this.history.length)return text;
  return this.history.map(h=>(h.role==='user'?'用户: ':this.role+': ')+h.text).join('\n')+'\n用户: '+text;
 }
 pushHistory(role,text){this.history.push({role,text});while(this.history.length>MAX_HISTORY)this.history.shift();}
 async newThread(){this.history=[];}
 handle(msg,a){
  if(msg.type==='system'&&msg.subtype==='init'){this.model=msg.model||this.model;a.emit({type:'start',model:this.model});return;}
  if(msg.type==='stream_event'){
   const event=msg.event;
   if(event?.type==='message_start')a.itemId=event.message?.id||a.itemId;
   if(event?.type==='content_block_delta'&&event.delta?.type==='text_delta'){a.replyText+=event.delta.text;a.emit({type:'delta',itemId:a.itemId,text:event.delta.text});}
   return;
  }
  if(msg.type==='assistant'){
   const t=(msg.message?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
   if(t){a.replyText=t;a.emit({type:'message',itemId:a.itemId||msg.message?.id,text:t});}
   return;
  }
  if(msg.type==='result'){
   a.turnDone=true;
   if(msg.subtype==='success'&&!msg.is_error)a.finish(null);
   else a.finish(safeError(msg.error?.message||msg.subtype||'error'));
  }
 }
 async send(text,emit,options={}){
  if(!this.state.connected)throw new Error('auth unavailable');
  if(this.active)throw new Error('busy');
  const prompt=options.stateless?text:this.buildPrompt(text);
  let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
  const a={emit,itemId:null,replyText:'',turnDone:false,child:null};
  a.finish=(error)=>{if(this.active!==a)return;clearTimeout(a.timer);if(!error&&!options.stateless)this.pushHistory('assistant',a.replyText);emit(error?{type:'error',message:error}:{type:'done',model:this.model});this.active=null;resolveDone();};
  this.active=a;
  a.timer=setTimeout(()=>{a.child?.kill('SIGKILL');a.finish('Claude Code 回复超时，已停止本次请求。');},180000);
  if(!options.stateless)this.pushHistory('user',options.historyText??text);
  const args=['-p','--output-format','stream-json','--include-partial-messages','--verbose','--tools','','--strict-mcp-config','--setting-sources','','--permission-mode','dontAsk','--permission-prompts','none','--disable-slash-commands','--no-session-persistence','--max-budget-usd','1','--append-system-prompt',this.role==='Claude'?CLAUDE_PROMPT:SYSTEM_PROMPT,prompt];
  const child=spawn(BINARY,args,{cwd:WORKSPACE,env:env(),stdio:['ignore','pipe','pipe']});
  a.child=child;
  let stderrText='';
  child.stderr.on('data',d=>{stderrText+=d;});
  child.on('error',e=>a.finish(safeError(e)));
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{if(!line.trim())return;try{this.handle(JSON.parse(line),a);}catch{}});
  child.on('exit',code=>{if(this.active!==a||a.turnDone)return;a.finish(code===0?'Claude Code 未返回结果；请重试。':safeError(stderrText||('exit '+code)));});
  return done;
 }
 cancel(){if(this.active?.child)this.active.child.kill('SIGINT');}
 stop(){if(this.active?.child)this.active.child.kill('SIGTERM');}
}
