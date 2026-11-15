import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIBRARY_FILE=fileURLToPath(new URL('./data/project-library.json',import.meta.url));
export const NOTE_LIMIT=100*1024;
export const LIBRARY_LIMIT=1024*1024;
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const bytes=text=>Buffer.byteLength(text,'utf8');
const valid=n=>n&&typeof n.id==='string'&&typeof n.title==='string'&&typeof n.content==='string'&&
 (n.projectId===null||typeof n.projectId==='string')&&typeof n.createdAt==='string'&&typeof n.updatedAt==='string'&&
 (n.sourceName===null||typeof n.sourceName==='string');
const summary=n=>({id:n.id,title:n.title,projectId:n.projectId,sourceName:n.sourceName,createdAt:n.createdAt,updatedAt:n.updatedAt,size:bytes(n.content)});
function check(input){
 if(!input||typeof input.title!=='string'||!input.title.trim()||input.title.length>100||
    typeof input.content!=='string'||bytes(input.content)>NOTE_LIMIT||
    !(input.projectId===null||typeof input.projectId==='string'&&input.projectId)||
    !(input.sourceName===null||typeof input.sourceName==='string'&&/^[^/\\\x00-\x1f]{1,120}\.(txt|md|markdown)$/i.test(input.sourceName)))
  throw fail('资料格式无效；单条最多 100 KiB，仅支持 UTF-8 文本。');
}
export class LibraryStore{
 constructor(file=LIBRARY_FILE){this.file=file;this.queue=Promise.resolve();}
 async raw(){
  try{const data=JSON.parse(await readFile(this.file,'utf8'));if(data?.version!==1||!Array.isArray(data.notes)||!data.notes.every(valid))throw Error('invalid');return data;}
  catch(error){if(error.code==='ENOENT')return {version:1,notes:[]};throw fail('资料文件无法读取；已停止操作以保护旧数据。',500);}
 }
 async read(){await this.queue;return this.raw();}
 async write(data){
  const temp=this.file+'.'+randomUUID()+'.tmp';let handle;
  try{await mkdir(dirname(this.file),{recursive:true,mode:0o700});handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(data,null,2)+'\n');await handle.sync();await handle.close();handle=null;await rename(temp,this.file);}
  catch{if(handle)await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});throw fail('资料保存失败，旧文件已保留。',500);}
 }
 mutate(fn){const task=this.queue.then(async()=>{const data=await this.raw(),result=fn(data);await this.write(data);return result;});this.queue=task.catch(()=>{});return task;}
 async list(projectId){const data=await this.read();return data.notes.filter(n=>n.projectId===null||n.projectId===projectId).map(summary).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 async get(id){const data=await this.read();const note=data.notes.find(n=>n.id===id);if(!note)throw fail('资料不存在。',404);return structuredClone(note);}
 async countForProject(id){const data=await this.read();return data.notes.filter(n=>n.projectId===id).length;}
 create(input){check(input);return this.mutate(data=>{
  if(data.notes.reduce((sum,n)=>sum+bytes(n.content),0)+bytes(input.content)>LIBRARY_LIMIT)throw fail('资料库总量最多 1 MiB，请先整理旧资料。',413);
  const now=new Date().toISOString(),note={id:randomUUID(),title:input.title.trim(),content:input.content,projectId:input.projectId,sourceName:input.sourceName,createdAt:now,updatedAt:now};data.notes.push(note);return structuredClone(note);
 });}
 update(id,input){check(input);return this.mutate(data=>{
  const note=data.notes.find(n=>n.id===id);if(!note)throw fail('资料不存在。',404);
  if(data.notes.reduce((sum,n)=>sum+bytes(n.content),0)-bytes(note.content)+bytes(input.content)>LIBRARY_LIMIT)throw fail('资料库总量最多 1 MiB，请先整理旧资料。',413);
  Object.assign(note,{title:input.title.trim(),content:input.content,projectId:input.projectId,sourceName:input.sourceName,updatedAt:new Date().toISOString()});return structuredClone(note);
 });}
 delete(id){return this.mutate(data=>{const index=data.notes.findIndex(n=>n.id===id);if(index<0)throw fail('资料不存在。',404);data.notes.splice(index,1);return {ok:true};});}
 async relevant(projectId,query){
  const data=await this.read();const matches=[];
  const words=(query.toLowerCase().match(/[\p{Script=Han}]{2,}|[a-z0-9]{3,}/gu)||[]).flatMap(word=>/[\p{Script=Han}]/u.test(word)&&word.length>2?[word,...Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2))]:[word]);
  const terms=[...new Set(words)].filter(word=>!['项目','资料','问题','我们','什么','怎么','请问','可以'].includes(word)).slice(0,30);
  if(!terms.length)return '';
  for(const note of data.notes){if(note.projectId!==null&&note.projectId!==projectId)continue;
   const title=note.title.toLowerCase(),content=note.content.toLowerCase();let score=0,position=-1;
   for(const term of terms){if(title.includes(term))score+=4;const index=content.indexOf(term);if(index>=0){score++;if(position<0||index<position)position=index;}}
   if(score)matches.push({note,score,position});
  }
  matches.sort((a,b)=>b.score-a.score||b.note.updatedAt.localeCompare(a.note.updatedAt));
  return matches.slice(0,3).map(({note,position})=>{
   const start=Math.max(0,position-180),excerpt=note.content.slice(start,start+850);
   return `[来源：${note.projectId===null?'全局资料':'当前项目资料'} · ${note.title}]\n${start?'…':''}${excerpt}${start+850<note.content.length?'…':''}`;
  }).join('\n\n');
 }
}
