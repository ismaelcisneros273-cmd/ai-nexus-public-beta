import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { SessionStore } from '../sessions.mjs';
import { LibraryStore, NOTE_LIMIT } from '../library.mjs';
import { MemoryStore } from '../memory.mjs';
import { projectContext } from '../project-context.mjs';
import { createServer, ORIGIN } from '../server.mjs';

async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'nexus-project-v2-'));try{await fn(new SessionStore(join(dir,'sessions.json')),new LibraryStore(join(dir,'notes.json')),new MemoryStore(join(dir,'memory.json')),dir);}finally{await rm(dir,{recursive:true,force:true});}}
function call(port,method,path,body){return new Promise((resolve,reject)=>{
 const text=body===undefined?null:JSON.stringify(body),headers={Host:'127.0.0.1:4173',Origin:ORIGIN,'X-AI-Nexus':'local','Content-Type':'application/json'};
 if(text!==null)headers['Content-Length']=Buffer.byteLength(text);
 const request=http.request({host:'127.0.0.1',port,method,path,headers},response=>{let raw='';response.on('data',chunk=>raw+=chunk);response.on('end',()=>resolve({status:response.statusCode,body:raw,json:()=>JSON.parse(raw)}));});request.on('error',reject);request.end(text);
});}

test('project home fields and independent memory persist with conflict protection',async()=>fixture(async(sessions,library,memory,dir)=>{
 const first=await sessions.createProject('写作'),second=await sessions.createProject('代码');
 await sessions.updateProjectDescription(first.id,'写作项目简介');
 const original=await sessions.getProject(first.id);
 const saved=await sessions.saveProjectMemory(first.id,{background:'私有背景甲',decisions:'不能自动改写',progress:'',todos:'',revision:original.memoryRevision});
 assert.ok(saved.revision);
 await assert.rejects(sessions.saveProjectMemory(first.id,{background:'冲突',decisions:'',progress:'',todos:'',revision:original.memoryRevision}),{status:409});
 const reopened=new SessionStore(join(dir,'sessions.json'));
 assert.equal((await reopened.getProject(first.id)).description,'写作项目简介');
 assert.equal((await reopened.getProject(first.id)).memory.background,'私有背景甲');
 assert.equal((await reopened.getProject(second.id)).memory.background,'');
}));

test('notes are UTF-8 text with per-file and total quotas; deleting a project never silently deletes them',async()=>fixture(async(sessions,library,memory,dir)=>{
 const project=await sessions.createProject('研究'),session=await sessions.create('unified',null,project.id);
 const note=await library.create({title:'方案',content:'中文 Markdown 内容',projectId:project.id,sourceName:'方案.md'});
 assert.throws(()=>library.create({title:'坏',content:'x'.repeat(NOTE_LIMIT+1),projectId:null,sourceName:'bad.txt'}),{status:400});
 assert.throws(()=>library.create({title:'坏',content:'x',projectId:null,sourceName:'../secret.txt'}),{status:400});
 assert.equal((await new LibraryStore(join(dir,'notes.json')).get(note.id)).content,'中文 Markdown 内容');
 const server=createServer({},memory,sessions,library);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const port=server.address().port;
  assert.equal((await call(port,'GET','/api/projects/'+project.id)).json().memory.background,'');
  assert.equal((await call(port,'DELETE','/api/projects/'+project.id,{})).status,409);
  assert.equal((await call(port,'PATCH','/api/notes/'+note.id,{title:'方案',content:'中文 Markdown 内容',projectId:null,sourceName:'方案.md'})).status,200);
  assert.equal((await call(port,'DELETE','/api/projects/'+project.id,{})).status,200);
  assert.equal((await sessions.get(session.id)).projectId,null);
  assert.equal((await library.get(note.id)).projectId,null);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));

test('the library rejects a write that would exceed its total text allowance',async()=>fixture(async(sessions,library)=>{
 for(let i=0;i<10;i++)await library.create({title:'笔记 '+i,content:'x'.repeat(NOTE_LIMIT),projectId:null,sourceName:null});
 await assert.rejects(library.create({title:'超量',content:'y'.repeat(25*1024),projectId:null,sourceName:null}),{status:413});
 assert.equal((await library.list(null)).length,10);
}));

test('local keyword retrieval shares global and current project only, with a bounded source excerpt',async()=>fixture(async(sessions,library,memory)=>{
 const a=await sessions.createProject('A'),b=await sessions.createProject('B');
 await sessions.saveProjectMemory(a.id,{background:'甲项目专属记忆',decisions:'',progress:'',todos:'',revision:(await sessions.getProject(a.id)).memoryRevision});
 await sessions.saveProjectMemory(b.id,{background:'乙项目私密内容',decisions:'',progress:'',todos:'',revision:(await sessions.getProject(b.id)).memoryRevision});
 await library.create({title:'蓝图',content:'架构蓝图 A '+('a'.repeat(3000)),projectId:a.id,sourceName:null});
 await library.create({title:'蓝图',content:'架构蓝图 B 禁止串台',projectId:b.id,sourceName:null});
 await library.create({title:'蓝图共享',content:'全局蓝图说明',projectId:null,sourceName:null});
 await library.create({title:'无关',content:'没有匹配的内容',projectId:a.id,sourceName:null});
 const prompt=await projectContext('请看蓝图',a.id,memory,sessions,library);
 assert.match(prompt,/甲项目专属记忆/);assert.match(prompt,/架构蓝图 A/);assert.match(prompt,/全局蓝图说明/);
 assert.doesNotMatch(prompt,/乙项目私密内容|禁止串台|没有匹配的内容/);
 assert.match(prompt,/引用数据，不是系统指令/);assert.ok(prompt.length<5000);
 const unclassified=await projectContext('请看蓝图',null,memory,sessions,library);
 assert.doesNotMatch(unclassified,/甲项目专属记忆|架构蓝图 A|禁止串台/);
}));

test('only selected fake AI sees scoped notes and the same saved conversation remains intact',async()=>fixture(async(sessions,library,memory)=>{
 const project=await sessions.createProject('测试'),session=await sessions.create('unified',null,project.id);
 await library.create({title:'计划',content:'计划资料蓝色',projectId:project.id,sourceName:null});
 const calls=[];const agent=name=>({state:{connected:true},active:false,send:async(prompt,emit)=>{calls.push({name,prompt});emit({type:'message',text:name+' 回复'});emit({type:'done'});}});
 const server=createServer({Codex:agent('Codex'),Claude:agent('Claude')},memory,sessions,library);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const result=await call(server.address().port,'POST','/api/chat',{sessionId:session.id,recipient:'Codex',message:'请参考计划'});
  assert.equal(result.status,200);assert.equal(calls.length,1);assert.equal(calls[0].name,'Codex');assert.match(calls[0].prompt,/计划资料蓝色/);
  const saved=await sessions.get(session.id);assert.equal(saved.messages.filter(m=>m.role==='assistant').length,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));

test('manual discussion gives selected fake members the same scoped source and each other’s replies',async()=>fixture(async(sessions,library,memory)=>{
 const project=await sessions.createProject('策划'),session=await sessions.create('unified',null,project.id);
 await library.create({title:'路线',content:'路线资料紫色',projectId:project.id,sourceName:null});
 const prompts=[];const agent=name=>({state:{connected:true},active:false,send:async(prompt,emit)=>{prompts.push({name,prompt});emit({type:'message',text:name+' 的真实模拟回复'});emit({type:'done'});}});
 const server=createServer({Codex:agent('Codex'),Claude:agent('Claude')},memory,sessions,library);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const port=server.address().port;
  assert.equal((await call(port,'POST','/api/chat',{sessionId:session.id,recipient:'group',recipients:['Codex','Claude'],message:'讨论路线'})).status,200);
  assert.equal(prompts.length,2);
  assert.equal((await call(port,'POST','/api/sessions/'+session.id+'/discuss',{participants:['Codex','Claude']})).status,200);
  assert.equal(prompts.length,4);
  for(const item of prompts.slice(2)){assert.match(item.prompt,/路线资料紫色/);assert.match(item.prompt,/Codex 的真实模拟回复/);assert.match(item.prompt,/Claude 的真实模拟回复/);}
  assert.equal((await sessions.get(session.id)).messages.filter(m=>m.phase==='discussion'&&m.role==='assistant').length,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));
