import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {SessionStore} from '../sessions.mjs';
import {OrganizerStore} from '../organizer.mjs';
import {createServer,ORIGIN} from '../server.mjs';
import {mobilePathAllowed} from '../mobile-gateway.mjs';

async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'nexus-organizer-'));
 const sessions=new SessionStore(join(dir,'sessions.json')),file=join(dir,'organizer.json'),organizer=new OrganizerStore(file,sessions);
 try{await run({sessions,organizer,file,dir});}finally{await rm(dir,{recursive:true,force:true});}
}
function call(port,method,path,body){return new Promise((resolve,reject)=>{
 const payload=body===undefined?undefined:JSON.stringify(body),headers={Host:'127.0.0.1:4173',Origin:ORIGIN,'X-AI-Nexus':'local','Content-Type':'application/json'};
 if(payload!==undefined)headers['Content-Length']=Buffer.byteLength(payload);
 const req=http.request({hostname:'127.0.0.1',port,method,path,headers},res=>{let raw='';res.on('data',part=>raw+=part);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(raw)});}catch(error){reject(Error(method+' '+path+' returned '+res.statusCode+' with '+JSON.stringify(raw)));}});});
 req.on('error',reject);req.end(payload);
});}
test('bookmarks persist once, old IDs resolve, and session deletion removes bookmarks but keeps todos',async()=>fixture(async({sessions,organizer,file})=>{
 const session=await sessions.create(),message=(await sessions.append(session.id,'assistant','旧 Claude 建议','Claude')).message;
 const legacy=JSON.parse(await readFile(sessions.file,'utf8'));delete legacy.sessions[0].messages[0].id;await writeFile(sessions.file,JSON.stringify(legacy));
 const id=(await sessions.get(session.id)).messages[0].id;
 const first=await organizer.bookmark(session.id,id),again=await organizer.bookmark(session.id,id);
 assert.equal(first.created,true);assert.equal(again.created,false);assert.equal(again.bookmark.id,first.bookmark.id);
 const todo=await organizer.createTodo({id:randomUUID(),title:'实施建议',note:'先验证',source:{sessionId:session.id,messageId:id}});
 const reopened=new OrganizerStore(file,sessions);assert.equal((await reopened.list()).bookmarks[0].excerpt,'旧 Claude 建议');
 await sessions.delete(session.id);await reopened.sessionDeleted(session.id);
 const result=await reopened.list();assert.equal(result.bookmarks.length,0);assert.equal(result.todos[0].id,todo.todo.id);assert.equal(result.todos[0].sourceAvailable,false);
}));
test('todo edit, completion, restore, duplicates, invalid references and corrupt storage fail closed',async()=>fixture(async({sessions,organizer,file})=>{
 const session=await sessions.create(),id=randomUUID(),input={id,title:'写总结',note:'',source:null};
 assert.equal((await organizer.createTodo(input)).created,true);assert.equal((await organizer.createTodo(input)).created,false);
 await organizer.updateTodo(id,{title:'写简短总结',note:'周五',completed:true});
 assert.equal((await organizer.list()).todos[0].completed,true);
 await organizer.updateTodo(id,{title:'写简短总结',note:'周五',completed:false});
 assert.equal((await organizer.list()).todos[0].completed,false);
 await assert.rejects(()=>organizer.createTodo({...input,id:randomUUID(),source:{sessionId:session.id,messageId:randomUUID()}}),{status:404});
 await assert.rejects(()=>organizer.bookmark(session.id,randomUUID()),{status:404});
 await organizer.deleteTodo(id);assert.equal((await organizer.list()).todos.length,0);
 await writeFile(file,'{bad');await assert.rejects(()=>organizer.createTodo({...input,id:randomUUID()}),{status:500});assert.equal(await readFile(file,'utf8'),'{bad');
}));
test('organizer endpoints enforce local checks and mobile allowlist is narrow',async()=>fixture(async({sessions,organizer})=>{
 const session=await sessions.create(),message=(await sessions.append(session.id,'assistant','真实历史文本','Claude')).message;
 const agents={Claude:{state:{connected:true},active:null,send(){throw Error('must not call model');},cancel(){}}};
 const server=createServer(agents,{read:async()=>({})},sessions,undefined,undefined,undefined,undefined,undefined,organizer);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 try{
  assert.equal((await call(port,'POST','/api/bookmarks',{sessionId:session.id,messageId:message.id})).status,201);
  assert.equal((await call(port,'POST','/api/bookmarks',{sessionId:session.id,messageId:message.id})).status,200);
  assert.equal((await call(port,'GET','/api/organizer')).body.bookmarks.length,1);
  assert.equal((await call(port,'POST','/api/bookmarks',{sessionId:session.id,messageId:message.id,extra:true})).status,400);
  const todo={id:randomUUID(),title:'做事',note:'',source:{sessionId:session.id,messageId:message.id}};
  assert.equal((await call(port,'POST','/api/todos',todo)).status,201);
  assert.equal((await call(port,'PATCH','/api/todos/'+todo.id,{title:'完成',note:'',completed:true})).status,200);
  assert.equal((await call(port,'DELETE','/api/sessions/'+session.id,{})).status,200);
  const result=(await call(port,'GET','/api/organizer')).body;assert.equal(result.bookmarks.length,0);assert.equal(result.todos[0].sourceAvailable,false);
  assert.equal(mobilePathAllowed('GET','/api/organizer'),true);assert.equal(mobilePathAllowed('POST','/api/todos'),true);assert.equal(mobilePathAllowed('DELETE','/api/bookmarks/'+message.id),true);assert.equal(mobilePathAllowed('GET','/api/bookmarks'),false);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));
