import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionStore} from '../sessions.mjs';
import {createServer} from '../server.mjs';

function get(port,path){return new Promise((resolve,reject)=>{
 const request=http.request({hostname:'127.0.0.1',port,path,headers:{Host:'127.0.0.1:4173'}},response=>{
  let raw='';response.on('data',chunk=>raw+=chunk);response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(raw)}));
 });request.on('error',reject);request.end();
});}
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'nexus-search-')),file=join(dir,'chats.json');
 const first=randomUUID(),second=randomUUID(),project=randomUUID();
 const data={version:1,projects:[{id:project,name:'隐藏项目',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}],sessions:[
  {id:first,type:'unified',agent:null,title:'晨光计划',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z',messages:[
   {id:randomUUID(),sessionId:first,role:'user',text:'我们讨论晨光布局',createdAt:'2026-01-01T00:01:00.000Z'},
   {id:randomUUID(),sessionId:first,role:'assistant',agent:'Claude',text:'晨光布局可以先做纸面草图',createdAt:'2026-01-01T00:02:00.000Z'}]},
  {id:second,type:'unified',agent:null,title:'另一段聊天',projectId:project,createdAt:'2026-01-03T00:00:00.000Z',updatedAt:'2026-01-04T00:00:00.000Z',messages:[
   {role:'assistant',agent:'Codex',text:'Search safely <img src=x onerror=alert(1)>',createdAt:'2026-01-03T00:01:00.000Z'},
   {role:'user',text:'这里提到晨光，但在别的项目里'}]}
 ]};
 await writeFile(file,JSON.stringify(data));
 try{await run({store:new SessionStore(file),file,first,second});}
 finally{await rm(dir,{recursive:true,force:true});}
}

test('global search covers titles, all user and AI messages, other projects, and older missing IDs without writing',async()=>{
 await fixture(async({store,file,first,second})=>{
  const before=await readFile(file,'utf8');
  const matches=await store.search('晨光');
  assert.equal(matches.total,4);
  assert.equal(matches.results[0].kind,'title');
  assert.equal(matches.results[0].sessionId,first);
  assert.equal(matches.results[1].sessionId,second,'equally relevant message hits prefer recent sessions');
  assert.deepEqual(matches.results.filter(item=>item.kind==='message').map(item=>item.speaker).sort(),['Claude','你','你']);
  assert.ok(matches.results.some(item=>item.sessionId===second),'project visibility must not limit search');
  const english=await store.search('sEaRcH');
  assert.equal(english.total,1);assert.equal(english.results[0].speaker,'Codex');
  assert.match(english.results[0].excerpt,/<img src=x onerror=alert\(1\)>/);
  const legacy=(await store.get(second)).messages;
  assert.match(legacy[0].id,/^[0-9a-f-]{36}$/);assert.equal(legacy[0].sessionId,second);
  assert.equal((await store.search('Search')).results[0].messageId,legacy[0].id);
  assert.equal((await store.search('Search')).results[0].messageId,legacy[0].id,'legacy target is stable across reads');
  assert.equal(await readFile(file,'utf8'),before,'search and read must not rewrite the file');
 });
});

test('read-only search API paginates results, validates input, and leaves the file intact',async()=>{
 await fixture(async({store,file,second})=>{
  const before=await readFile(file,'utf8'),server=createServer({},null,store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const port=server.address().port;
   const response=await get(port,'/api/search?q='+encodeURIComponent('晨光'));
   assert.equal(response.status,200);assert.equal(response.data.total,4);
   assert.equal(response.data.results.find(item=>item.sessionId===second).messageId,(await store.get(second)).messages[1].id);
   assert.equal((await get(port,'/api/search?q='+encodeURIComponent('CLAUDE'))).data.total,0);
   assert.equal((await get(port,'/api/search?q=%20')).status,400);
   assert.equal((await get(port,'/api/search?q='+encodeURIComponent('晨光')+'&offset=-1')).status,400);
   const page=await store.search('晨光',2,2);
   assert.equal(page.results.length,2);assert.equal(page.total,4);
   assert.equal(await readFile(file,'utf8'),before);
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
});
