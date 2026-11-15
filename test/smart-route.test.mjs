import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeSmart } from '../smart-route.mjs';
import { SessionStore } from '../sessions.mjs';
import { createServer, ORIGIN } from '../server.mjs';

const all=['Codex','Claude','Claude Code','ChatGPT'];
function request(port,path,body){
 return new Promise((resolve,reject)=>{
  const payload=JSON.stringify(body);
  const req=http.request({host:'127.0.0.1',port,path,method:'POST',headers:{Host:'127.0.0.1:4173',Origin:ORIGIN,'X-AI-Nexus':'local','Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{
   let raw='';res.setEncoding('utf8');res.on('data',chunk=>raw+=chunk);
   res.on('end',()=>resolve({status:res.statusCode,raw,events:()=>raw.trim().split('\n').map(JSON.parse),json:()=>JSON.parse(raw)}));
  });req.on('error',reject);req.end(payload);
 });
}
async function fixture(run,connected=all){
 const dir=await mkdtemp(join(tmpdir(),'ai-nexus-smart-'));
 const store=new SessionStore(join(dir,'sessions.json')),calls=[];
 const agents=Object.fromEntries(all.map(name=>[name,{state:{connected:connected.includes(name)},active:null,async send(prompt,emit){
  calls.push({name,prompt});emit({type:'start'});emit({type:'message',itemId:name,text:name+' 模拟观点'});emit({type:'done'});
 },cancel(){}}]));
 const server=createServer(agents,{read:async()=>({background:'共享项目背景',decisions:'',progress:'',todos:''})},store);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run({port:server.address().port,store,calls});}
 finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
}

test('local rules choose one specialist, two for cross-domain work, and one for unclear work',()=>{
 assert.deepEqual(routeSmart('请调试这段代码的报错',all).agents,['Codex']);
 assert.deepEqual(routeSmart('请 Claude Code 处理项目执行',all).agents,['Claude Code']);
 assert.deepEqual(routeSmart('请润色文章文案并给出视觉配色',all).agents,['Claude']);
 assert.deepEqual(routeSmart('请规划方案并分析利弊',all).agents,['ChatGPT']);
 assert.deepEqual(routeSmart('请调试代码并润色页面文案',all).agents,['Codex','Claude']);
 assert.deepEqual(routeSmart('你好',all).agents,['ChatGPT']);
 assert.deepEqual(routeSmart('你好',['Claude Code','Codex']).agents,['Codex']);
 assert.deepEqual(routeSmart('请修复代码',['Claude Code','ChatGPT']).agents,['Claude Code']);
 assert.deepEqual(routeSmart('请调试代码并润色文案',['Claude Code','ChatGPT']).agents,['Claude Code','ChatGPT']);
 assert.deepEqual(routeSmart('请分析方案',[]).agents,[]);
 assert.deepEqual(routeSmart('请写文案并分析方案',['Claude','Claude Code']).agents,['Claude']);
});

test('smart, specified, all-member, and manual discussion stay in one saved conversation',async()=>{
 await fixture(async({port,store,calls})=>{
  const id=(await request(port,'/api/sessions',{type:'unified'})).json().id;
  const send=(recipient,message,recipients)=>request(port,'/api/chat',{sessionId:id,recipient,message,...(recipients?{recipients}:{})});
  const code=await send('smart','请调试这段代码的报错',all);
  assert.equal(code.status,200);assert.deepEqual(code.events().find(e=>e.type==='selection').agents,['Codex']);
  assert.deepEqual(calls.map(c=>c.name),['Codex']);
  const creative=await send('smart','请润色文章文案',['Claude','Claude Code','ChatGPT']);
  assert.equal(creative.status,200);assert.deepEqual(creative.events().find(e=>e.type==='selection').agents,['Claude']);
  assert.match(calls[1].prompt,/Codex 模拟观点/);
  const mixed=await send('smart','请调试代码并润色页面文案',all);
  assert.equal(mixed.status,200);assert.deepEqual(mixed.events().find(e=>e.type==='selection').agents,['Codex','Claude']);
  assert.equal(calls.length,4,'双人路由不得暗中调用第三位');
  assert.equal((await store.get(id)).rounds.length,1,'双人路由沿用现有回合机制');
  assert.equal((await send('ChatGPT','请综合刚才观点')).status,200);
  assert.match(calls[4].prompt,/Claude 模拟观点/);
  assert.equal((await send('group','请全员回答',all)).status,200);
  assert.deepEqual(calls.slice(5).map(c=>c.name).sort(),[...all].sort());
  assert.equal(calls.length,9,'普通群发不会自动触发第二轮');
  const discussed=await request(port,`/api/sessions/${id}/discuss`,{participants:all});
  assert.equal(discussed.status,200);
  assert.equal(calls.length,13,'手动讨论每位成员只调用一次');
  for(const item of calls.slice(9)){
   assert.match(item.prompt,/Codex 模拟观点/);
   assert.match(item.prompt,/Claude Code 模拟观点/);
   assert.match(item.prompt,/Claude 模拟观点/);
   assert.match(item.prompt,/ChatGPT 模拟观点/);
  }
  const saved=await store.get(id);
  assert.equal((await store.list()).length,1);
  assert.deepEqual(saved.messages.filter(m=>m.role==='user').map(m=>m.recipients),[['Codex'],['Claude'],['Codex','Claude'],['ChatGPT'],all]);
  assert.equal(saved.messages.filter(m=>m.role==='system'&&m.text.startsWith('智能选择：')).length,3);
  assert.equal(saved.messages.filter(m=>m.phase==='discussion'&&m.role==='assistant').length,4);
 });
});

test('smart route excludes disconnected members and reports no available member',async()=>{
 await fixture(async({port,store,calls})=>{
  const id=(await request(port,'/api/sessions',{type:'unified'})).json().id;
  const fallback=await request(port,'/api/chat',{sessionId:id,recipient:'smart',recipients:all,message:'请修复代码'});
  assert.equal(fallback.status,200);
  assert.deepEqual(fallback.events().find(e=>e.type==='selection').agents,['Claude Code']);
  assert.deepEqual(calls.map(c=>c.name),['Claude Code']);
  const unavailable=await request(port,'/api/chat',{sessionId:id,recipient:'smart',recipients:['Codex'],message:'请修复代码'});
  assert.equal(unavailable.status,503);
  assert.match(unavailable.json().error,/没有已启用且已连接/);
  assert.equal(calls.length,1);
  assert.equal((await store.get(id)).messages.filter(m=>m.role==='user').length,1);
 },['Claude Code','ChatGPT']);
});
