import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AttachmentStore,MAX_FILE_BYTES} from '../attachments.mjs';
import {SessionStore} from '../sessions.mjs';
import {createServer,ORIGIN} from '../server.mjs';
import {mobilePathAllowed} from '../mobile-gateway.mjs';
import {ChatGPT} from '../chatgpt.mjs';
import {Codex} from '../codex.mjs';

const png=await readFile(new URL('./fixtures/tiny.png',import.meta.url));
function call(port,method,path,body){return new Promise((resolve,reject)=>{
 const payload=body===undefined?'':JSON.stringify(body);
 const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:'127.0.0.1:4173',Origin:ORIGIN,'X-AI-Nexus':'local','Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{
  const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const raw=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,raw,json:()=>JSON.parse(raw.toString())});});
 });req.on('error',reject);req.end(payload);
});}
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'nexus-attachments-')),sessions=new SessionStore(join(dir,'sessions.json')),attachments=new AttachmentStore(join(dir,'attachments'));
 const calls=[],searchCalls=[],agents=Object.fromEntries(['ChatGPT','Claude','Claude Code','Codex'].map(name=>[name,{state:{connected:true},active:null,async send(prompt,emit,options){calls.push({name,prompt,images:options.images});emit({type:'message',text:name+' mock'});emit({type:'done'});},cancel(){}}]));
 const tavily={search:async query=>{searchCalls.push(query);return {sources:[],query,searchedAt:new Date().toISOString()};}};
 const server=createServer(agents,{read:async()=>({background:'',decisions:'',progress:'',todos:''})},sessions,{relevant:async()=>null},tavily,attachments);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run({port:server.address().port,dir,sessions,attachments,calls,searchCalls});}
 finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
}
const upload=(port,name,bytes)=>call(port,'POST','/api/attachments',{name,data:bytes.toString('base64')});
const send=(port,sessionId,recipient,attachments,message='请阅读附件',extra={})=>call(port,'POST','/api/chat',{sessionId,recipient,message,attachments,requestId:randomUUID(),...extra});

test('TXT, MD, code and PDF content enter only selected AI context, with page markers and persistence',async()=>fixture(async({port,sessions,attachments,calls})=>{
 const session=await sessions.create();
 const files=[];for(const [name,value] of [['brief.txt','实际 TXT 内容'],['notes.md','# 实际 MD 内容'],['script.js','const actualCode = true;']]){
  const result=await upload(port,name,Buffer.from(value));assert.equal(result.status,201);files.push(result.json());
 }
 const pdf=await upload(port,'pages.pdf',await readFile(new URL('./fixtures/text.pdf',import.meta.url)));assert.equal(pdf.status,201);files.push(pdf.json());
 const response=await send(port,session.id,'Codex',files.map(x=>x.id));assert.equal(response.status,200);
 assert.deepEqual(calls.map(x=>x.name),['Codex']);for(const value of ['实际 TXT 内容','实际 MD 内容','actualCode','[第 1 页]','[第 2 页]'])assert.ok(calls[0].prompt.includes(value));
 const stored=await new SessionStore(sessions.file).get(session.id),user=stored.messages.find(x=>x.role==='user');assert.equal(user.attachments.length,4);assert.equal(user.attachments[3].pageCount,2);
 const downloaded=await call(port,'GET',`/api/attachments/${files[0].id}?sessionId=${session.id}`);assert.equal(downloaded.status,200);assert.equal(downloaded.raw.toString(),'实际 TXT 内容');
 const forbidden=await call(port,'GET',`/api/attachments/${files[0].id}?sessionId=${randomUUID()}`);assert.notEqual(forbidden.status,200);
 assert.equal((await stat(attachments.file(files[0].id))).mode&0o777,0o600);
 {const result=await call(port,'DELETE',`/api/attachments/${files[0].id}`,{});assert.equal(result.status,409,result.raw.toString());}
 assert.equal((await call(port,'DELETE',`/api/sessions/${session.id}`,{})).status,200);
 await assert.rejects(stat(attachments.file(files[0].id)),{code:'ENOENT'});
}));

test('image data reaches visual adapters only; unsupported members and invalid files fail before model calls',async()=>fixture(async({port,sessions,calls,attachments})=>{
 const session=await sessions.create(),image=await upload(port,'tiny.png',png);assert.equal(image.status,201);const id=image.json().id;
 assert.equal((await send(port,session.id,'Claude',[id])).status,422);assert.equal(calls.length,0);
 assert.equal((await send(port,session.id,'ChatGPT',[id],'看图')).status,200);
 assert.equal(calls[0].images.length,1);assert.match(calls[0].images[0].dataUrl,/^data:image\/png;base64,/);
 const preview=await call(port,'GET',`/api/attachments/${id}?sessionId=${session.id}`);assert.equal(preview.status,200);assert.equal(preview.headers['content-type'],'image/png');assert.match(preview.headers['content-disposition'],/^inline/);assert.deepEqual(preview.raw,png);
 assert.equal((await send(port,session.id,'Codex',[id],'看图')).status,200);assert.equal(calls[1].images.length,1);
 assert.equal((await send(port,session.id,'smart',[id],'这张图有什么特点？',{recipients:['Claude','ChatGPT','Codex']})).status,200);
 assert.ok(['ChatGPT','Codex'].includes(calls[2].name));assert.equal(calls[2].images.length,1);
 assert.equal((await upload(port,'fake.png',Buffer.from('not image'))).status,415);
 assert.equal((await upload(port,'real.jpg',await readFile(new URL('./fixtures/tiny.jpg',import.meta.url)))).status,201);
 assert.equal((await upload(port,'real.webp',await readFile(new URL('./fixtures/tiny.webp',import.meta.url)))).status,201);
 assert.equal((await upload(port,'malformed.webp',Buffer.from('not a WebP image'))).status,415);
 assert.equal((await upload(port,'bad.txt',Buffer.from([0xff,0xfe]))).status,422);
 assert.equal((await upload(port,'empty.txt',Buffer.alloc(0))).status,422);
 {const result=await upload(port,'oversized.txt',Buffer.alloc(MAX_FILE_BYTES+1,65));assert.equal(result.status,413,result.raw.toString());}
 assert.equal((await upload(port,'bad.exe',Buffer.from('hello'))).status,415);
 const staged=await upload(port,'remove.md',Buffer.from('remove me'));assert.equal(staged.status,201);
 assert.equal((await call(port,'DELETE',`/api/attachments/${staged.json().id}`,{})).status,200);
 await assert.rejects(attachments.get(staged.json().id),/不存在/);
}));

test('combined extracted-text budget marks later attachments as truncated for both AI and saved history',async()=>fixture(async({port,sessions,calls})=>{
 const session=await sessions.create();
 const first=(await upload(port,'first.txt',Buffer.from('A'.repeat(11500)))).json();
 const second=(await upload(port,'second.txt',Buffer.from('B'.repeat(11500)))).json();
 assert.equal((await send(port,session.id,'Codex',[first.id,second.id],'比较两份文件')).status,200);
 const message=(await sessions.get(session.id)).messages.find(x=>x.role==='user');
 assert.equal(message.attachments[0].truncated,false);assert.equal(message.attachments[1].truncated,true);
 assert.match(calls[0].prompt,/已截断/);assert.ok(!calls[0].prompt.includes('B'.repeat(9000)));
}));

test('scanned PDFs fail honestly, quote links retain names, and Tavily never receives private content',async()=>fixture(async({port,sessions,calls,searchCalls})=>{
 assert.equal((await upload(port,'scan.pdf',await readFile(new URL('./fixtures/scanned.pdf',import.meta.url)))).status,422);
 const session=await sessions.create(),file=(await upload(port,'private.txt',Buffer.from('PRIVATE CONTENT NEVER FOR TAVILY'))).json();
 assert.equal((await send(port,session.id,'ChatGPT',[file.id],'先读附件')).status,200);
 const user=(await sessions.get(session.id)).messages.find(x=>x.role==='user');
 assert.equal((await send(port,session.id,'ChatGPT',[file.id],'公开问题关键词',{webSearch:true})).status,200);
 assert.deepEqual(searchCalls,['公开问题关键词']);
 assert.equal((await call(port,'POST','/api/chat',{sessionId:session.id,recipient:'Codex',message:'请评估引用',quoteId:user.id,requestId:randomUUID()})).status,200);
 assert.match(calls[2].prompt,/private.txt/);assert.equal(calls[2].images.length,0);
 assert.equal((await sessions.get(session.id)).messages.findLast(x=>x.role==='user').quoteId,user.id);
 assert.equal(mobilePathAllowed('POST','/api/attachments'),true);assert.equal(mobilePathAllowed('GET',`/api/attachments/${file.id}`),true);
}));

test('ChatGPT and Codex adapters use actual image input fields without invoking services',async()=>{
 const image={mime:'image/png',dataUrl:'data:image/png;base64,'+png.toString('base64')};
 const chat=new ChatGPT('/tmp/unused-nexus-auth.json');chat.state.connected=true;chat.accessToken=async()=> 'synthetic-token';chat.modelFor=async()=> 'synthetic-model';
 const originalFetch=globalThis.fetch;let requestBody;
 try{
  globalThis.fetch=async(_url,options)=>{requestBody=JSON.parse(options.body);return new Response('data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed"}\n\n',{headers:{'content-type':'text/event-stream'}});};
  await chat.send('看图',()=>{},{images:[image]});
  assert.equal(requestBody.input[0].content[0].type,'input_text');assert.equal(requestBody.input[0].content[1].type,'input_image');assert.equal(requestBody.input[0].content[1].image_url,image.dataUrl);
 }finally{globalThis.fetch=originalFetch;}
 const codex=new Codex();codex.state.connected=true;codex.model='synthetic-model';codex.newThread=async()=>{codex.thread='synthetic-thread';};
 let params;codex.rpc=async(_method,body)=>{params=body;return {turn:{id:'synthetic-turn'}};};
 const pending=codex.send('看图',()=>{},{images:[image]});
 await new Promise(resolve=>setImmediate(resolve));codex.active.finish(null);await pending;
 assert.equal(params.input[1].type,'image');assert.equal(params.input[1].url,image.dataUrl);
});
