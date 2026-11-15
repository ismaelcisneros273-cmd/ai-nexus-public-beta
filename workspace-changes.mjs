import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CHANGES_FILE=fileURLToPath(new URL('./private/workspace-changes.json',import.meta.url));
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function view(change){const {originalContent,newContent,root,device,inode,...publicData}=change;return {...publicData,diff:diff(change.path,originalContent,newContent)};}
function diff(path,before,after){
 const old=before.split('\n'),newLines=after.split('\n');let start=0;
 while(start<old.length&&start<newLines.length&&old[start]===newLines[start])start++;
 let left=old.length-1,right=newLines.length-1;
 while(left>=start&&right>=start&&old[left]===newLines[right]){left--;right--;}
 const context=old.slice(Math.max(0,start-2),start).map(line=>' '+line);
 return [`--- a/${path}`,`+++ b/${path}`,...context,...old.slice(start,left+1).map(line=>'-'+line),...newLines.slice(start,right+1).map(line=>'+'+line),...old.slice(left+1,left+3).map(line=>' '+line)].join('\n');
}
async function atomic(file,data){
 await mkdir(dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(tmp,'wx',0o600);await handle.writeFile(JSON.stringify(data));await handle.sync();await handle.close();handle=null;await rename(tmp,file);}
 finally{await handle?.close().catch(()=>{});await unlink(tmp).catch(()=>{});}
}
function executeWrite(input){return new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/python3',['-I',fileURLToPath(new URL('./workspace-write.py',import.meta.url))],{stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/bin:/bin'}});
 let output='';const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{output+=part;if(output.length>4096)child.kill('SIGKILL');});
 child.stdin.on('error',()=>{});
 child.on('error',()=>{clearTimeout(timer);reject(fail('安全写入组件无法启动；文件未修改。',503));});
 child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(fail('安全写入超时或失败，请检查文件实际内容。',500));try{resolve(JSON.parse(output));}catch{reject(fail('安全写入结果无效，请检查文件实际内容。',500));}});
 child.stdin.end(JSON.stringify(input));
});}
export class WorkspaceChanges{
 constructor(file=CHANGES_FILE,workspaces){this.file=file;this.workspaces=workspaces;this.queue=Promise.resolve();}
 async raw(){let data;try{data=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code==='ENOENT')return {version:1,changes:[]};throw fail('修改记录无法读取，已停止写入。',500);}
  if(data?.version!==1||!Array.isArray(data.changes))throw fail('修改记录格式异常，已停止写入。',500);return data;}
 async read(){await this.queue;return this.raw();}
 mutate(fn){const task=this.queue.then(async()=>{const data=await this.raw(),result=await fn(data);await atomic(this.file,data);return result;});this.queue=task.catch(()=>{});return task;}
 async list(sessionId){let data=await this.read();for(const change of data.changes.filter(item=>item.sessionId===sessionId&&['applying','restoring'].includes(item.status))){
  try{const grant=await this.workspaces.record(sessionId);if(grant.path!==change.root||grant.device!==change.device||grant.inode!==change.inode)continue;
   const result=await executeWrite({mode:'inspect',root:grant.path,device:grant.device,inode:grant.inode,path:change.path});
   if(result.status!=='present')continue;
   const status=change.status==='applying'?(result.sha256===change.newSha256?'applied':result.sha256===change.originalSha256?'pending':'conflict'):(result.sha256===change.originalSha256?'restored':result.sha256===change.newSha256?'applied':'conflict');
   await this.mutate(current=>{const item=current.changes.find(value=>value.id===change.id);if(item&&['applying','restoring'].includes(item.status)){item.status=status;item.updatedAt=new Date().toISOString();}return null;});
  }catch{}
 }data=await this.read();return data.changes.filter(item=>item.sessionId===sessionId).map(view);}
 async create(sessionId,agent,task,reply,context){
  let proposal;try{const clean=reply.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');proposal=JSON.parse(clean);}catch{throw fail('AI 未返回可验证的修改方案；没有修改文件。',422);}
  if(!proposal||Object.keys(proposal).sort().join()!=='explanation,newContent,path'||typeof proposal.path!=='string'||typeof proposal.newContent!=='string'||typeof proposal.explanation!=='string'||proposal.explanation.length>1000||Buffer.byteLength(proposal.newContent)>16384)throw fail('AI 修改方案格式或长度无效；没有修改文件。',422);
  const listed=context.files.find(file=>file.path===proposal.path&&!file.truncated);
  if(!listed||Buffer.byteLength(listed.text)>16384||listed.text===proposal.newContent)throw fail('方案只能修改本轮完整读取的单个普通文件，且内容必须有变化。',422);
  const grant=await this.workspaces.record(sessionId),now=new Date().toISOString();
  const change={id:randomUUID(),sessionId,agent,task:task.slice(0,1000),path:proposal.path,explanation:proposal.explanation,root:grant.path,device:grant.device,inode:grant.inode,originalContent:listed.text,originalSha256:hash(listed.text),newContent:proposal.newContent,newSha256:hash(proposal.newContent),status:'pending',createdAt:now,updatedAt:now};
  await this.mutate(data=>{data.changes.push(change);return null;});return view(change);
 }
 async action(sessionId,changeId,action){
  if(!idPattern.test(changeId)||!['approve','reject','restore'].includes(action))throw fail('修改操作无效。');
  return this.mutate(async data=>{
   const change=data.changes.find(item=>item.id===changeId&&item.sessionId===sessionId);if(!change)throw fail('修改方案不存在。',404);
   if(action==='reject'){
    if(change.status!=='pending')throw fail('方案已处理，不能重复操作。',409);
    change.status='rejected';change.updatedAt=new Date().toISOString();return view(change);
   }
   if(action==='approve'&&change.status!=='pending'||action==='restore'&&change.status!=='applied')throw fail('方案状态不允许此操作。',409);
   const grant=await this.workspaces.record(sessionId);
   if(grant.path!==change.root||grant.device!==change.device||grant.inode!==change.inode)throw fail('工作区授权已变更，请先检查方案。',409);
   change.status=action==='approve'?'applying':'restoring';change.updatedAt=new Date().toISOString();await atomic(this.file,data);
   const result=await executeWrite({root:grant.path,device:grant.device,inode:grant.inode,path:change.path,expected:action==='approve'?change.originalSha256:change.newSha256,content:action==='approve'?change.newContent:change.originalContent});
   if(result.status!=='applied')throw fail(result.status==='changed'?'文件已被其他程序修改；没有覆盖，请重新生成方案。':'安全写入被拒绝；请检查文件与授权状态。',result.status==='changed'?409:422);
   change.status=action==='approve'?'applied':'restored';change.updatedAt=new Date().toISOString();return view(change);
  });
 }
}
