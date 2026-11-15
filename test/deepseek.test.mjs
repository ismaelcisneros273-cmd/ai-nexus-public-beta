import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeepSeek, publicAnswer, safeError } from '../deepseek.mjs';
import { routeSmart } from '../smart-route.mjs';
import { SessionStore } from '../sessions.mjs';
import { createServer, ORIGIN } from '../server.mjs';

async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'ai-nexus-cloud-'));
 const configFile=join(dir,'deepseek.json'),usageFile=join(dir,'usage.json');
 try{await run({dir,configFile,usageFile,config:async(enabled,key='private-test-key')=>
  writeFile(configFile,JSON.stringify({enabled,apiKey:key}),{mode:0o600})});}
 finally{await rm(dir,{recursive:true,force:true});}
}
function request(port,path,body){
 return new Promise((resolve,reject)=>{
  const payload=body===undefined?null:JSON.stringify(body);
  const req=http.request({hostname:'127.0.0.1',port,path,method:payload?'POST':'GET',headers:{
   Host:'127.0.0.1:4173',...(payload?{Origin:ORIGIN,'X-AI-Nexus':'local','Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})
  }},res=>{
   let raw='';res.setEncoding('utf8');res.on('data',part=>raw+=part);
   res.on('end',()=>resolve({status:res.statusCode,raw,events:()=>raw.trim().split('\n').map(JSON.parse),json:()=>JSON.parse(raw)}));
  });req.on('error',reject);req.end(payload||undefined);
 });
}
async function withServer(agents,dir,run){
 const store=new SessionStore(join(dir,'sessions.json'));
 const server=createServer(agents,{read:async()=>({background:'共同项目背景',decisions:'',progress:'',todos:''})},store);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run(server.address().port,store);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const completion=(text='云端结论')=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{reasoning_content:'内部推理不可显示',content:text}}]})});

test('DeepSeek stays paused with no configuration or with an unapproved key',async()=>{
 await fixture(async({configFile,usageFile,config})=>{
  let hits=0;const fetchImpl=async()=>{hits++;return completion();};
  let agent=new DeepSeek({configFile,usageFile,fetchImpl});
  assert.equal((await agent.start()).paused,true);
  await assert.rejects(agent.send('不能调用',()=>{}),error=>error.code==='DEEPSEEK_PAUSED');
  await config(false);
  agent=new DeepSeek({configFile,usageFile,fetchImpl});
  assert.equal((await agent.start()).paused,true);
  await agent.refresh();
  assert.equal(hits,0);
  assert.match(safeError({code:'DEEPSEEK_PAUSED'}),/暂停/);
 });
});

test('enabled cloud adapter uses only official Flash endpoint, limits output, and hides thinking',async()=>{
 await fixture(async({configFile,usageFile,config})=>{
  await config(true);const calls=[];
  const agent=new DeepSeek({configFile,usageFile,fetchImpl:async(url,options)=>{calls.push({url,options});return completion('<think>不应显示</think>云端结论');}});
  assert.equal((await agent.start()).connected,true);
  assert.equal(agent.state.model,'deepseek-flash');
  assert.ok(!JSON.stringify(agent.state).includes('private-test-key'));
  const events=[];await agent.send('用户问题',event=>events.push(event));
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].options.headers.Authorization,'Bearer private-test-key');
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.model,'deepseek-flash');assert.equal(body.stream,false);
  assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.max_tokens,1024);
  assert.equal(body.messages.at(-1).content,'用户问题');assert.equal(body.tools,undefined);
  assert.deepEqual(events.map(event=>event.type),['start','message','done']);
  assert.equal(events[1].text,'云端结论');
  assert.ok(!JSON.stringify(events).includes('内部推理'));
  assert.deepEqual(JSON.parse(await readFile(usageFile,'utf8')).count,1);
 });
 assert.equal(publicAnswer('残留思考</think>可见答复'),'可见答复');
});

test('manual enablement never leaks key in status, and DeepSeek shares unified history and discussion',async()=>{
 await fixture(async({dir,configFile,usageFile,config})=>{
  await config(true);const prompts=[];
  const deepseek=new DeepSeek({configFile,usageFile,fetchImpl:async(_url,options)=>{
   prompts.push(JSON.parse(options.body).messages.at(-1).content);return completion('DeepSeek 云端观点');
  }});await deepseek.start();
  const others=[];
  const chatgpt={state:{connected:true},active:null,async send(prompt,emit){others.push(prompt);emit({type:'message',text:'ChatGPT 观点'});emit({type:'done'});},cancel(){}};
  await withServer({DeepSeek:deepseek,ChatGPT:chatgpt},dir,async(port,store)=>{
   const status=await request(port,'/api/status');
   assert.equal(status.status,200);assert.ok(!status.raw.includes('private-test-key'));
   const id=(await request(port,'/api/sessions',{type:'unified'})).json().id;
   assert.equal((await request(port,'/api/chat',{sessionId:id,recipient:'DeepSeek',message:'给出观点'})).status,200);
   assert.equal((await request(port,'/api/chat',{sessionId:id,recipient:'ChatGPT',message:'读取上文'})).status,200);
   assert.match(others.at(-1),/DeepSeek 云端观点/);
   const group=await request(port,'/api/chat',{sessionId:id,recipient:'group',recipients:['DeepSeek','ChatGPT'],message:'共同分析'});
   assert.equal(group.status,200);assert.equal(prompts.length,2);
   const discuss=await request(port,`/api/sessions/${id}/discuss`,{participants:['DeepSeek','ChatGPT']});
   assert.equal(discuss.status,200);assert.match(prompts.at(-1),/ChatGPT 观点/);
   assert.match(others.at(-1),/DeepSeek 云端观点/);
   const saved=await store.get(id);
   assert.equal(saved.messages.filter(item=>item.role==='assistant'&&item.agent==='DeepSeek').length,3);
   assert.equal((await store.list()).length,1);
  });
 });
});

test('paused DeepSeek cannot be chosen directly, by group, or by manual discussion',async()=>{
 await fixture(async({dir,configFile,usageFile,config})=>{
  await config(false);let calls=0;
  const deepseek=new DeepSeek({configFile,usageFile,fetchImpl:async()=>{calls++;return completion();}});await deepseek.start();
  const other={state:{connected:true},active:null,async send(_prompt,emit){emit({type:'message',text:'可用成员回复'});emit({type:'done'});},cancel(){}};
  await withServer({DeepSeek:deepseek,ChatGPT:other},dir,async(port)=>{
   const id=(await request(port,'/api/sessions',{type:'unified'})).json().id;
   assert.equal((await request(port,'/api/chat',{sessionId:id,recipient:'DeepSeek',message:'指定'})).status,503);
   assert.equal((await request(port,'/api/chat',{sessionId:id,recipient:'group',recipients:['DeepSeek','ChatGPT'],message:'全员'})).status,503);
   assert.equal((await request(port,`/api/sessions/${id}/discuss`,{participants:['DeepSeek','ChatGPT']})).status,503);
   const smart=await request(port,'/api/chat',{sessionId:id,recipient:'smart',recipients:['DeepSeek','ChatGPT'],message:'分析'});
   assert.deepEqual(smart.events().find(item=>item.type==='selection').agents,['ChatGPT']);
  });
  assert.equal(calls,0);
 });
});

test('daily cap, input cap, incomplete output, and API failures do not auto retry',async()=>{
 await fixture(async({configFile,usageFile,config})=>{
  await config(true);let hits=0;
  const agent=new DeepSeek({configFile,usageFile,fetchImpl:async()=>{hits++;return completion();}});await agent.start();
  await assert.rejects(agent.send('a'.repeat(12001),()=>{}),error=>error.code==='DEEPSEEK_INPUT');
  for(let i=0;i<20;i++)await agent.send('短消息',()=>{});
  await assert.rejects(agent.send('上限后',()=>{}),error=>error.code==='DEEPSEEK_LIMIT');
  assert.equal(hits,20);
  const another=new DeepSeek({configFile,usageFile,fetchImpl:async()=>{hits++;return completion();}});await another.start();
  await assert.rejects(another.send('重启后',()=>{}),error=>error.code==='DEEPSEEK_LIMIT');
  assert.equal(hits,20);
 });
 await fixture(async({configFile,usageFile,config})=>{
  await config(true);let hits=0;
  const agent=new DeepSeek({configFile,usageFile,fetchImpl:async()=>{hits++;return {ok:false,status:402};}});await agent.start();
  await assert.rejects(agent.send('余额不足',()=>{}),error=>error.status===402);
  assert.equal(hits,1);assert.equal(agent.state.connected,false);
  assert.match(safeError({status:402}),/余额不足/);
  assert.ok(!safeError(Error('key=private-test-key')).includes('private-test-key'));
 });
 await fixture(async({configFile,usageFile,config})=>{
  await config(true);
  const agent=new DeepSeek({configFile,usageFile,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'半句'}}]})})});await agent.start();
  const events=[];await assert.rejects(agent.send('不可保存半句',event=>events.push(event)),error=>error.code==='DEEPSEEK_EMPTY');
  assert.ok(!events.some(event=>event.type==='message'));
 });
 await fixture(async({configFile,usageFile,config})=>{
  await config(true);let hits=0;
  const fetchImpl=(_url,{signal})=>new Promise((_resolve,reject)=>{
   hits++;
   const abort=()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}));
   if(signal.aborted)abort();
   else signal.addEventListener('abort',abort,{once:true});
  });
  const agent=new DeepSeek({configFile,usageFile,fetchImpl,timeoutMs:10});await agent.start();
  await assert.rejects(agent.send('超时',()=>{}),error=>error.code==='DEEPSEEK_TIMEOUT');
  assert.equal(hits,1);
  assert.match(safeError({code:'DEEPSEEK_TIMEOUT'}),/不会自动重试/);
 });
});

test('private configuration rejects broad file permissions and never calls the network',async()=>{
 await fixture(async({configFile,usageFile,config})=>{
  await config(true);await chmod(configFile,0o644);
  let hits=0;const agent=new DeepSeek({configFile,usageFile,fetchImpl:async()=>{hits++;return completion();}});
  assert.equal((await agent.start()).connected,false);
  await assert.rejects(agent.send('不可调用',()=>{}));
  assert.equal(hits,0);
 });
});

test('smart routing includes DeepSeek only when explicitly available',()=>{
 assert.deepEqual(routeSmart('请用本地模型解数学方程',['Codex','ChatGPT']).agents,['ChatGPT']);
 assert.deepEqual(routeSmart('请用本地模型解数学方程',['Codex','ChatGPT','DeepSeek']).agents,['ChatGPT']);
 assert.deepEqual(routeSmart('请用 DeepSeek 解数学方程',['Codex','ChatGPT','DeepSeek']).agents,['DeepSeek']);
 assert.deepEqual(routeSmart('请调试代码',['Codex','DeepSeek']).agents,['Codex']);
});
