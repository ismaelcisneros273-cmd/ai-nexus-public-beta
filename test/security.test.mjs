import test from 'node:test';
import assert from 'node:assert/strict';
import { Codex, PROFILE, safeError } from '../codex.mjs';
import { allowedRequest } from '../server.mjs';
test('reject foreign origins, DNS rebinding hosts, cross-site requests',()=>{
 assert.equal(allowedRequest({headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173'}}),true);
 for(const headers of [{host:'evil.example:4173'},{host:'127.0.0.1:4173',origin:'https://evil.example'},{host:'127.0.0.1:4173','sec-fetch-site':'cross-site'}])assert.equal(allowedRequest({headers}),false);
});
test('allow only the exact top-level OAuth return page from a cross-site navigation',()=>{
 const headers={host:'127.0.0.1:4173','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate'};
 for(const result of ['authorized','failed','no-plan-permission'])
  assert.equal(allowedRequest({method:'GET',url:'/?chatgpt='+result,headers}),true);
 for(const [method,url,extra] of [['POST','/?chatgpt=authorized',{}],['GET','/api/status',{}],
  ['GET','/?chatgpt=authorized&extra=1',{}],['GET','/?chatgpt=authorized',{origin:'https://auth.openai.com'}],
  ['GET','/?chatgpt=authorized',{'sec-fetch-mode':'cors'}]])
  assert.equal(allowedRequest({method,url,headers:{...headers,...extra}}),false);
});
test('approval requests fail closed and cannot grant extra permissions',()=>{
 const c=new Codex(),out=[];c.write=x=>out.push(x);
 for(const method of ['item/commandExecution/requestApproval','item/fileChange/requestApproval'])c.receive({id:1,method,params:{}});
 c.receive({id:2,method:'item/permissions/requestApproval',params:{permissions:{filesystem:{write:['/']}}}});
 c.receive({id:3,method:'unrecognized/tool',params:{}});
 assert.deepEqual(out.slice(0,2).map(x=>x.result.decision),['decline','decline']);assert.deepEqual(out[2].result.permissions,{});assert.ok(out[3].error);
 assert.throws(()=>c.rpc('command/exec',{command:['rm','-rf','/']}),/blocked/);
});
test('read-only named profile is required before accepting a thread',async()=>{
 const c=new Codex();c.model='test';c.rpc=async()=>({activePermissionProfile:{id:':workspace'},approvalsReviewer:'user',modelProvider:'openai',thread:{id:'bad'}});
 await assert.rejects(c.newThread(),/Unsafe/);assert.equal(c.thread,null);
 c.rpc=async()=>({activePermissionProfile:{id:PROFILE},approvalsReviewer:'user',modelProvider:'openai',model:'test',thread:{id:'safe'}});await c.newThread();assert.equal(c.thread,'safe');
});
test('stream ignores unrelated threads and never reports failed turn as success',()=>{
 const c=new Codex(),out=[];c.thread='mine';c.active={emit:x=>out.push(x),finish:e=>out.push({finished:e})};
 c.receive({method:'item/agentMessage/delta',params:{threadId:'other',delta:'private'}});assert.equal(out.length,0);
 c.receive({method:'item/agentMessage/delta',params:{threadId:'mine',itemId:'1',delta:'你好'}});assert.equal(out[0].text,'你好');
 c.receive({method:'turn/completed',params:{threadId:'mine',turn:{status:'failed',error:{message:'401'}}}});assert.ok(out[1].finished);
});
test('errors never echo sensitive diagnostic text',()=>{assert.ok(!safeError(new Error('token=secret-example-value')).includes('secret-example-value'));});
