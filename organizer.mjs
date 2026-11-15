import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SessionStore} from './sessions.mjs';

export const ORGANIZER_FILE=fileURLToPath(new URL('./private/organizer.json',import.meta.url));
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const fresh=()=>({version:1,bookmarks:[],todos:[]});
const validSource=source=>source===null||source&&idPattern.test(source.sessionId)&&idPattern.test(source.messageId)&&Object.keys(source).sort().join()==='messageId,sessionId';
const validTodo=t=>t&&idPattern.test(t.id)&&typeof t.title==='string'&&t.title.trim()&&t.title.length<=160&&typeof t.note==='string'&&t.note.length<=2000&&typeof t.completed==='boolean'&&validSource(t.source)&&typeof t.createdAt==='string'&&typeof t.updatedAt==='string';
function messageFor(sessions,source){const session=sessions.find(s=>s.id===source.sessionId),message=session?.messages.find(m=>m.id===source.messageId&&['user','assistant'].includes(m.role));return {session,message};}
async function atomic(file,data){
 await mkdir(dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(tmp,'wx',0o600);await handle.writeFile(JSON.stringify(data,null,2)+'\n');await handle.sync();await handle.close();handle=null;await rename(tmp,file);}
 finally{await handle?.close().catch(()=>{});await unlink(tmp).catch(()=>{});}
}
export class OrganizerStore{
 constructor(file=ORGANIZER_FILE,sessions=new SessionStore()){this.file=file;this.sessions=sessions;this.queue=Promise.resolve();}
 async raw(){let data;try{data=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code==='ENOENT')return fresh();throw fail('收藏与待办文件无法读取；已停止写入以保护原数据。',500);}
  if(data?.version!==1||!Array.isArray(data.bookmarks)||!Array.isArray(data.todos)||data.bookmarks.some(b=>!b||!idPattern.test(b.id)||!validSource({sessionId:b.sessionId,messageId:b.messageId})||typeof b.createdAt!=='string')||data.todos.some(t=>!validTodo(t)))throw fail('收藏与待办文件格式异常；已停止写入以保护原数据。',500);
  return data;
 }
 async read(){await this.queue;return this.raw();}
 mutate(fn){const job=this.queue.then(async()=>{const data=await this.raw(),result=await fn(data);await atomic(this.file,data);return result;});this.queue=job.catch(()=>{});return job;}
 async list(){const [data,history]=await Promise.all([this.read(),this.sessions.read()]);const sessions=history.sessions;
  const bookmarks=data.bookmarks.map(item=>{const {session,message}=messageFor(sessions,item);return message?{...item,sessionTitle:session.title,speaker:message.role==='user'?'你':message.agent||'AI',excerpt:message.text.slice(0,180),messageCreatedAt:message.createdAt}:null;}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const todos=data.todos.map(item=>{const found=item.source?messageFor(sessions,item.source):null;return {...item,sourceAvailable:item.source?!!found.message:null,sourceSessionTitle:found?.message?found.session.title:null};}).sort((a,b)=>Number(a.completed)-Number(b.completed)||b.updatedAt.localeCompare(a.updatedAt));
  return {bookmarks,todos};
 }
 async bookmark(sessionId,messageId){if(!idPattern.test(sessionId)||!idPattern.test(messageId))throw fail('消息定位无效。');const session=await this.sessions.get(sessionId);
  if(!session.messages.some(m=>m.id===messageId&&['user','assistant'].includes(m.role)))throw fail('原消息不存在。',404);
  return this.mutate(data=>{const old=data.bookmarks.find(b=>b.sessionId===sessionId&&b.messageId===messageId);if(old)return {bookmark:old,created:false};const bookmark={id:randomUUID(),sessionId,messageId,createdAt:new Date().toISOString()};data.bookmarks.push(bookmark);return {bookmark,created:true};});
 }
 async unbookmark(id){if(!idPattern.test(id))throw fail('收藏标识无效。');return this.mutate(data=>{const index=data.bookmarks.findIndex(b=>b.id===id);if(index<0)throw fail('收藏不存在。',404);data.bookmarks.splice(index,1);return {ok:true};});}
 async createTodo(input){if(!input||Object.keys(input).sort().join()!=='id,note,source,title'||!idPattern.test(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>160||typeof input.note!=='string'||input.note.length>2000||!validSource(input.source))throw fail('待办格式无效。');
  if(input.source){const session=await this.sessions.get(input.source.sessionId);if(!session.messages.some(m=>m.id===input.source.messageId&&['user','assistant'].includes(m.role)))throw fail('来源消息不存在。',404);}
  return this.mutate(data=>{const old=data.todos.find(t=>t.id===input.id);if(old)return {todo:old,created:false};const now=new Date().toISOString(),todo={id:input.id,title:input.title.trim(),note:input.note.trim(),completed:false,source:input.source,createdAt:now,updatedAt:now};data.todos.push(todo);return {todo,created:true};});
 }
 updateTodo(id,input){if(!idPattern.test(id)||!input||Object.keys(input).sort().join()!=='completed,note,title'||typeof input.title!=='string'||!input.title.trim()||input.title.length>160||typeof input.note!=='string'||input.note.length>2000||typeof input.completed!=='boolean')throw fail('待办内容无效。');
  return this.mutate(data=>{const todo=data.todos.find(t=>t.id===id);if(!todo)throw fail('待办不存在。',404);todo.title=input.title.trim();todo.note=input.note.trim();todo.completed=input.completed;todo.updatedAt=new Date().toISOString();return {todo};});
 }
 deleteTodo(id){if(!idPattern.test(id))throw fail('待办标识无效。');return this.mutate(data=>{const index=data.todos.findIndex(t=>t.id===id);if(index<0)throw fail('待办不存在。',404);data.todos.splice(index,1);return {ok:true};});}
 async sessionDeleted(sessionId){const data=await this.read();if(!data.bookmarks.some(b=>b.sessionId===sessionId))return;await this.mutate(current=>{current.bookmarks=current.bookmarks.filter(b=>b.sessionId!==sessionId);return {ok:true};});}
}
