import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createServer,ORIGIN} from '../server.mjs';
import {SessionStore} from '../sessions.mjs';
import {parseCollaboration} from '../collaboration.mjs';
import {mobilePathAllowed} from '../mobile-gateway.mjs';

const marker='<nexus-collaboration>{"targetAgent":"Codex","reason":"需要工程复核","task":"检查 Claude 的方案"}</nexus-collaboration>';
function call(port,path,body){return new Promise((resolve,reject)=>{
 const payload=JSON.stringify(body),req=http.request({hostname:'127.0.0.1',port,method:'POST',path,headers:{Host:'127.0.0.1:4173',Origin:ORIGIN,'X-AI-Nexus':'local','Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,raw,json:()=>JSON.parse(raw)}));});req.on('error',reject);req.end(payload);
});}
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'nexus-collab-')),sessions=new SessionStore(join(dir,'sessions.json')),calls=[];
 let failCodex=false;
 const agents=Object.fromEntries(['Claude','Codex','ChatGPT','Claude Code','DeepSeek'].map(name=>[name,{state:{connected:name!=='DeepSeek'},active:null,async send(prompt,emit){calls.push({name,prompt});if(name==='Codex'&&failCodex){emit({type:'error',message:'timeout'});return;}emit({type:'message',itemId:'main',text:name==='Claude'?'Claude 的完整方案。'+marker:'Codex 已检查 Claude 的方案。'});emit({type:'done'});},cancel(){}}]));
 const server=createServer(agents,{read:async()=>({background:'',decisions:'',progress:'',todos:''})},sessions,{relevant:async()=>'',list:async()=>[]},{search(){throw Error('Tavily must not be used');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run({sessions,calls,agents,port:server.address().port,setFail:v=>failCodex=v});}finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
}
const chat=(port,id,mode)=>call(port,'/api/chat',{sessionId:id,recipient:'Claude',message:'请评估这个方案',requestId:randomUUID(),collaborationMode:mode});
const action=(port,id,source,verb)=>call(port,`/api/collaborations/${id}/${source}/${verb}`,verb==='reject'?{}:{requestId:randomUUID()});

test('opt-in suggestion waits for approval, then only the named member replies once with source context',async()=>fixture(async({sessions,calls,port})=>{
 const session=await sessions.create();assert.equal((await chat(port,session.id,true)).status,200);
 const before=await sessions.get(session.id),source=before.messages.find(m=>m.role==='assistant');
 assert.equal(source.collaboration.status,'pending');assert.equal(source.collaboration.targetAgent,'Codex');assert.equal(calls.length,1);
 assert.equal((await action(port,session.id,source.id,'approve')).status,200);
 assert.deepEqual(calls.map(c=>c.name),['Claude','Codex']);assert.match(calls[1].prompt,/Claude 的完整方案/);assert.match(calls[1].prompt,/需要工程复核/);
 assert.equal((await action(port,session.id,source.id,'approve')).status,409);assert.equal(calls.length,2);
 const reloaded=await new SessionStore(sessions.file).get(session.id);
 assert.equal(reloaded.messages.find(m=>m.id===source.id).collaboration.status,'complete');
 const reply=reloaded.messages.find(m=>m.role==='assistant'&&m.agent==='Codex');assert.equal(reply.handoff.sourceMessageId,source.id);
 assert.equal(reply.handoff.sourceSessionId,session.id);assert.equal(reply.handoff.targetAgent,'Codex');
 assert.equal(mobilePathAllowed('POST',`/api/collaborations/${session.id}/${source.id}/approve`),true);
}));

test('reject makes no target call; failed approval needs explicit retry and survives restart',async()=>fixture(async({sessions,calls,port,setFail})=>{
 const a=await sessions.create(),b=await sessions.create();await chat(port,a.id,true);let source=(await sessions.get(a.id)).messages.find(m=>m.collaboration);
 assert.equal((await action(port,a.id,source.id,'reject')).status,200);assert.equal(calls.length,1);
 assert.equal((await action(port,a.id,source.id,'approve')).status,409);
 await chat(port,b.id,true);source=(await sessions.get(b.id)).messages.find(m=>m.collaboration);
 setFail(true);assert.equal((await action(port,b.id,source.id,'approve')).status,200);
 assert.equal((await sessions.get(b.id)).messages.find(m=>m.id===source.id).collaboration.status,'failed');
 assert.equal((await action(port,b.id,source.id,'approve')).status,409);
 setFail(false);assert.equal((await action(port,b.id,source.id,'retry')).status,200);
 assert.equal((await action(port,b.id,source.id,'retry')).status,409);
 const restored=await new SessionStore(sessions.file).get(b.id);assert.equal(restored.messages.find(m=>m.id===source.id).collaboration.status,'complete');
 assert.equal((await sessions.get(a.id)).messages.filter(m=>m.agent==='Codex').length,0);
}));

test('normal chat and hostile or unavailable suggestions never dispatch; interrupted state becomes failed',async()=>fixture(async({sessions,calls,port,agents})=>{
 const a=await sessions.create();await chat(port,a.id,false);assert.equal((await sessions.get(a.id)).messages.some(m=>m.collaboration),false);assert.equal(calls.length,1);
 assert.equal(parseCollaboration('reply '+marker,'Claude',['ChatGPT']).proposal,null);
 assert.equal(parseCollaboration('reply <nexus-collaboration>{"targetAgent":"Codex","reason":"x","task":"x","extra":"run shell"}</nexus-collaboration>','Claude',['Codex']).proposal,null);
 assert.equal(parseCollaboration('reply '+marker,'Claude',['Codex']).proposal.status,'pending');
 const b=await sessions.create();await chat(port,b.id,true);const source=(await sessions.get(b.id)).messages.find(m=>m.collaboration);
 agents.Codex.state.connected=false;assert.equal((await action(port,b.id,source.id,'approve')).status,503);assert.equal(calls.filter(c=>c.name==='Codex').length,0);
 agents.Codex.state.connected=true;await sessions.decideCollaboration(b.id,source.id,'approve');assert.equal(await new SessionStore(sessions.file).recoverInterrupted(),true);
 assert.equal((await sessions.get(b.id)).messages.find(m=>m.id===source.id).collaboration.status,'failed');
}));
