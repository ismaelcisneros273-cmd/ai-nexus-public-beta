import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createServer,ORIGIN} from '../server.mjs';
import {SessionStore} from '../sessions.mjs';
import {OrganizerStore} from '../organizer.mjs';
import {mobilePathAllowed} from '../mobile-gateway.mjs';

const proposal='<nexus-collaboration>{"targetAgent":"Codex","reason":"需要检查实现风险","task":"评估 Claude 的建议"}</nexus-collaboration>';
function post(port,path,body){return new Promise((resolve,reject)=>{
 const payload=JSON.stringify(body),req=http.request({hostname:'127.0.0.1',port,method:'POST',path,headers:{Host:'127.0.0.1:4173',Origin:ORIGIN,'X-AI-Nexus':'local','Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,raw,json:()=>JSON.parse(raw)}));});req.on('error',reject);req.end(payload);
});}
function get(port,path){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,method:'GET',path,headers:{Host:'127.0.0.1:4173'}},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:()=>JSON.parse(raw)}));});req.on('error',reject);req.end();});}
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'nexus-integration-')),sessions=new SessionStore(join(dir,'sessions.json')),organizer=new OrganizerStore(join(dir,'organizer.json'),sessions),calls=[];
 let fail=null,hold=null;
 const agents=Object.fromEntries(['Claude','Codex','ChatGPT','Claude Code','DeepSeek'].map(name=>[name,{state:{connected:name==='Claude'||name==='Codex'},active:null,async send(prompt,emit){
  calls.push({name,prompt});if(hold&&name==='Claude'&&calls.filter(call=>call.name==='Claude').length>1)await hold;
  if(fail===name){emit({type:'error',message:'模拟超时'});return;}
  emit({type:'message',itemId:'main',text:name==='Claude'&&!prompt.includes('用户现在明确要求你整合')?'Claude 的原始完整方案。'+proposal:name==='Codex'?'Codex 的真实模拟复核：方案需调整。':'双方一致应保留数据；分歧在实现顺序。'});emit({type:'done'});
 },cancel(){}}]));
 const server=createServer(agents,{read:async()=>({background:'',decisions:'',progress:'',todos:''})},sessions,{relevant:async()=>'',list:async()=>[]},{search(){throw Error('Tavily must not be used');}},undefined,undefined,undefined,organizer);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run({sessions,organizer,calls,agents,port:server.address().port,failWith:name=>{fail=name;},holdWith:promise=>{hold=promise;}});}finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
}
async function prepared({sessions,port}){
 const session=await sessions.create();
 assert.equal((await post(port,'/api/chat',{sessionId:session.id,recipient:'Claude',message:'请评估这个项目方案',requestId:randomUUID(),collaborationMode:true})).status,200);
 const before=await sessions.get(session.id),source=before.messages.find(m=>m.collaboration);
 assert.equal(source.collaboration.status,'pending');
 assert.equal((await post(port,`/api/collaborations/${session.id}/${source.id}/approve`,{requestId:randomUUID()})).status,200);
 const after=await sessions.get(session.id),reply=after.messages.find(m=>m.agent==='Codex'&&m.role==='assistant'&&m.status==='complete');
 assert.equal(after.messages.find(m=>m.id===source.id).collaboration.status,'complete');
 return {session,source:after.messages.find(m=>m.id===source.id),reply};
}
const integrate=(port,session,source,instruction='重点比较分歧',requestId=randomUUID())=>post(port,`/api/integrations/${session.id}/${source.id}`,{requestId,instruction});

test('approved collaboration integrates once with exact authored sources and persists relationships',async()=>fixture(async context=>{
 const {session,source,reply}=await prepared(context),{port,calls,sessions}=context;
 assert.equal(mobilePathAllowed('POST',`/api/integrations/${session.id}/${source.id}`),true);
 assert.equal(calls.length,2);
 assert.equal((await integrate(port,session,source)).status,200);
 assert.deepEqual(calls.map(call=>call.name),['Claude','Codex','Claude']);
 const prompt=calls[2].prompt;
 for(const value of ['请评估这个项目方案','Claude 的原始完整方案','需要检查实现风险','评估 Claude 的建议','Codex 的真实模拟复核','重点比较分歧','不得使用工具'])assert.ok(prompt.includes(value),value);
 const loaded=await new SessionStore(sessions.file).get(session.id),origin=loaded.messages.find(m=>m.id===source.id),request=loaded.messages.find(m=>m.role==='user'&&m.integration),answer=loaded.messages.find(m=>m.role==='assistant'&&m.integration);
 assert.equal(origin.collaboration.integration.status,'complete');assert.equal(request.quoteId,reply.id);assert.equal(answer.agent,'Claude');assert.equal(answer.integration.originalQuestionId,loaded.messages[0].id);assert.equal(answer.integration.sourceMessageId,source.id);assert.equal(answer.integration.collaboratorReplyId,reply.id);assert.equal(answer.integration.requestMessageId,request.id);
 assert.equal((await integrate(port,session,source)).status,409);assert.equal(calls.length,3);
}));

test('failed or missing collaborator and disconnected origin cannot integrate',async()=>fixture(async context=>{
 const {session,source}=await prepared(context),{port,calls,agents,sessions}=context;
 agents.Claude.state.connected=false;
 assert.equal((await integrate(port,session,source)).status,503);assert.equal(calls.length,2);
 agents.Claude.state.connected=true;
 const other=await sessions.create();assert.equal((await integrate(port,other,source)).status,409);
 await sessions.mutate(data=>{data.sessions.find(s=>s.id===session.id).messages=data.sessions.find(s=>s.id===session.id).messages.filter(m=>m.agent!=='Codex');});
 assert.equal((await integrate(port,session,source)).status,409);assert.equal(calls.length,2);
}));

test('duplicate submission while running and manual retry after failure are bounded',async()=>fixture(async context=>{
 const {session,source}=await prepared(context),{port,calls,failWith,holdWith,sessions}=context;
 let release;holdWith(new Promise(resolve=>{release=resolve;}));
 const key=randomUUID(),first=integrate(port,session,source,'',key);
 for(let i=0;i<50;i++){if(calls.length===3)break;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(calls.length,3);assert.equal((await integrate(port,session,source,'',key)).status,409);release();assert.equal((await first).status,200);
 assert.equal((await integrate(port,session,source)).status,409);assert.equal(calls.length,3);
 const next=await prepared(context);failWith('Claude');assert.equal((await integrate(port,next.session,next.source)).status,200);
 let loaded=await sessions.get(next.session.id);assert.equal(loaded.messages.find(m=>m.id===next.source.id).collaboration.integration.status,'failed');
 failWith(null);assert.equal((await integrate(port,next.session,next.source)).status,200);
 loaded=await new SessionStore(sessions.file).get(next.session.id);assert.equal(loaded.messages.find(m=>m.id===next.source.id).collaboration.integration.status,'complete');
 assert.equal(loaded.messages.filter(m=>m.role==='assistant'&&m.status==='complete'&&m.integration?.sourceMessageId===next.source.id).length,1);
}));

test('restart marks interrupted integration failed without retrying model',async()=>fixture(async context=>{
 const {session,source,reply}=await prepared(context),{sessions,calls}=context;
 const loaded=await sessions.get(session.id),original=loaded.messages.find(m=>m.role==='user');
 await sessions.beginIntegration(session.id,source.id,randomUUID(),'',{sourceSessionId:session.id,originalQuestionId:original.id,sourceMessageId:source.id,collaborationRequestId:source.collaboration.requestMessageId,collaboratorReplyId:reply.id,sourceAgent:'Claude',targetAgent:'Codex',instruction:'',truncated:{question:false,source:false,collaborator:false}});
 assert.equal(await new SessionStore(sessions.file).recoverInterrupted(),true);
 const restored=await sessions.get(session.id);assert.equal(restored.messages.find(m=>m.id===source.id).collaboration.integration.status,'failed');assert.equal(calls.length,2);
}));

test('integration reply remains searchable, quotable, bookmarkable and usable as todo source without changing another session',async()=>fixture(async context=>{
 const {session,source}=await prepared(context),other=await context.sessions.create();
 assert.equal((await integrate(context.port,session,source)).status,200);
 const saved=await context.sessions.get(session.id),answer=saved.messages.find(m=>m.role==='assistant'&&m.integration);
 assert.equal((await context.sessions.get(other.id)).messages.length,0);
 const results=(await get(context.port,'/api/search?q='+encodeURIComponent('双方一致应保留数据'))).json();
 assert.ok(results.results.some(item=>item.sessionId===session.id&&item.messageId===answer.id));
 assert.equal((await post(context.port,'/api/bookmarks',{sessionId:session.id,messageId:answer.id})).status,201);
 assert.equal((await post(context.port,'/api/todos',{id:randomUUID(),title:'检查整合建议',note:'',source:{sessionId:session.id,messageId:answer.id}})).status,201);
 assert.equal((await context.sessions.append(session.id,'user','请解释这里',null,'complete',{quoteId:answer.id})).message.quoteId,answer.id);
 const listed=await context.organizer.list();assert.equal(listed.bookmarks[0].messageId,answer.id);assert.equal(listed.todos[0].sourceAvailable,true);
}));

test('hostile integration output cannot propose another collaboration or execute tools',async()=>fixture(async context=>{
 const {session,source}=await prepared(context),{agents,calls,sessions,port}=context;
 agents.Claude.send=async(prompt,emit)=>{calls.push({name:'Claude',prompt});emit({type:'message',itemId:'main',text:'整合意见。'+proposal});emit({type:'done'});};
 assert.equal((await integrate(port,session,source)).status,200);
 const saved=await sessions.get(session.id),answer=saved.messages.find(m=>m.role==='assistant'&&m.integration);
 assert.equal(answer.collaboration,undefined);assert.equal(saved.messages.filter(m=>m.collaboration).length,1);
 assert.deepEqual(calls.map(call=>call.name),['Claude','Codex','Claude']);
}));
