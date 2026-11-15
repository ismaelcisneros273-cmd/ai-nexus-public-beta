import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer,extractMentions,ORIGIN} from '../server.mjs';
import {SessionStore,conversationPrompt} from '../sessions.mjs';

function call(port,method,path,body){return new Promise((resolve,reject)=>{
 const payload=body===undefined?undefined:JSON.stringify(body);
 const request=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:'127.0.0.1:4173',Origin:ORIGIN,'X-AI-Nexus':'local','Content-Type':'application/json'}},response=>{
  let raw='';response.setEncoding('utf8');response.on('data',part=>raw+=part);response.on('end',()=>resolve({status:response.statusCode,raw,json:()=>JSON.parse(raw)}));
 });request.on('error',reject);request.end(payload);
});}
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'nexus-interactions-')),store=new SessionStore(join(dir,'sessions.json')),calls=[];
 const agents=Object.fromEntries(['Codex','Claude','ChatGPT','DeepSeek'].map(name=>[name,{state:{connected:name!=='DeepSeek'},active:null,async send(prompt,emit){calls.push({name,prompt});emit({type:'message',itemId:'main',text:name+' 模拟回复'});emit({type:'done'});},cancel(){}}]));
 const server=createServer(agents,{read:async()=>({background:'',decisions:'',progress:'',todos:''})},store);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run({port:server.address().port,store,calls});}
 finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
}

test('@ takes precedence over smart and named recipients, deduplicates, and shares prior AI context',async()=>{
 assert.deepEqual(extractMentions('@Claude Code @Claude @Claude Code'),['Claude Code','Claude']);
 await fixture(async({port,store,calls})=>{
  const session=await store.create();await store.append(session.id,'assistant','Claude 的旧建议：用本地缓存','Claude');
  const response=await call(port,'POST','/api/chat',{sessionId:session.id,recipient:'smart',recipients:['Claude','ChatGPT','Codex'],message:'@Codex 请评价 Claude 的建议，@Codex 谢谢',mentions:['Codex'],requestId:randomUUID()});
  assert.equal(response.status,200);assert.deepEqual(calls.map(call=>call.name),['Codex']);
  assert.match(calls[0].prompt,/Claude 的旧建议/);
  const saved=(await store.get(session.id)).messages.find(item=>item.role==='user');
  assert.deepEqual(saved.recipients,['Codex']);assert.deepEqual(saved.mentions,['Codex']);
  const mismatch=await call(port,'POST','/api/chat',{sessionId:session.id,recipient:'Codex',message:'@Claude 你好',mentions:['Codex']});
  assert.equal(mismatch.status,400);assert.equal(calls.length,1);
 });
});

test('quote and @ reach only ChatGPT, persist with stable IDs, and reject duplicate submission',async()=>{
 await fixture(async({port,store,calls})=>{
  const session=await store.create();const original=(await store.append(session.id,'assistant','Claude 的建议：先做小范围验证','Claude')).message;
  const requestId=randomUUID(),body={sessionId:session.id,recipient:'smart',recipients:['Claude','ChatGPT','Codex'],message:'@ChatGPT 请评估这段建议',mentions:['ChatGPT'],quoteId:original.id,requestId};
  assert.equal((await call(port,'POST','/api/chat',body)).status,200);
  assert.deepEqual(calls.map(item=>item.name),['ChatGPT']);
  assert.match(calls[0].prompt,/Claude 的建议：先做小范围验证/);
  assert.match(calls[0].prompt,/用户本轮明确引用的消息/);
  assert.match(calls[0].prompt,/"speaker":"Claude"/);
  const stored=await new SessionStore(store.file).get(session.id),user=stored.messages.find(item=>item.role==='user');
  assert.equal(user.quoteId,original.id);assert.equal(user.requestId,requestId);assert.deepEqual(user.mentions,['ChatGPT']);
  assert.match(conversationPrompt('下一条消息',stored.messages),/"quote":/);
  assert.equal((await call(port,'POST','/api/chat',body)).status,409);assert.equal(calls.length,1);
  assert.equal((await call(port,'POST','/api/chat',{...body,requestId:randomUUID(),quoteId:randomUUID()})).status,404);
 });
});

test('without @, smart, manual and group routes still work; unavailable @ never falls back',async()=>{
 await fixture(async({port,store,calls})=>{
  const session=await store.create();const send=(body)=>call(port,'POST','/api/chat',{sessionId:session.id,requestId:randomUUID(),...body});
  assert.equal((await send({recipient:'Codex',message:'请写代码'})).status,200);
  assert.equal((await send({recipient:'group',recipients:['Codex','Claude'],message:'群发'})).status,200);
  assert.equal((await send({recipient:'smart',recipients:['Codex','Claude','ChatGPT'],message:'请调试代码'})).status,200);
  const count=calls.length;
  const paused=await send({recipient:'smart',recipients:['Codex','Claude'],message:'@DeepSeek 请回答',mentions:['DeepSeek']});
  assert.equal(paused.status,503);assert.match(paused.json().error,/不可用/);assert.equal(calls.length,count);
  assert.equal((await new SessionStore(store.file).get(session.id)).messages.filter(item=>item.role==='user').length,3);
 });
});

test('two explicit mentions call each member once even when the composer points elsewhere',async()=>{
 await fixture(async({port,store,calls})=>{
  const session=await store.create();
  const response=await call(port,'POST','/api/chat',{sessionId:session.id,recipient:'ChatGPT',message:'@Claude @Codex @Claude 请一起看',mentions:['Claude','Codex'],requestId:randomUUID()});
  assert.equal(response.status,200);assert.deepEqual(calls.map(item=>item.name).sort(),['Claude','Codex']);
  const saved=(await store.get(session.id)).messages.find(item=>item.role==='user');
  assert.deepEqual(saved.recipients,['Claude','Codex']);assert.deepEqual(saved.mentions,['Claude','Codex']);
 });
});
