import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, ORIGIN } from '../server.mjs';
import { SessionStore } from '../sessions.mjs';

function agent(name, calls, connected = true) {
 return {
  state: { connected }, active: null,
  async send(text, emit) {
   calls.push({ name, text });
   emit({ type: 'start' });
   emit({ type: 'message', itemId: name, text: `${name} 收到` });
   emit({ type: 'done' });
  },
  cancel() {},
 };
}

async function withServer(agents, run, memory = { background: '', decisions: '', progress: '', todos: '' }) {
 const dir=await mkdtemp(join(tmpdir(),'ai-nexus-broadcast-'));
 const server = createServer(agents, { read: async () => memory },new SessionStore(join(dir,'sessions.json')));
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try { await run(server.address().port); }
 finally { await new Promise(resolve => server.close(resolve));await rm(dir,{recursive:true,force:true}); }
}

async function api(port,path,body) {
 return new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: {
   Host: '127.0.0.1:4173', Origin: ORIGIN, 'X-AI-Nexus': 'local', 'Content-Type': 'application/json',
  } }, res => {
   let raw = '';
   res.setEncoding('utf8');
   res.on('data', chunk => raw += chunk);
   res.on('end', () => resolve({ status: res.statusCode, raw }));
  });
  req.on('error', reject);
  req.end(JSON.stringify(body));
 });
}
async function post(port, body) {
 const created=await api(port,'/api/sessions',{type:body.recipient==='group'?'group':'single',agent:body.recipient==='group'?null:body.recipient});
 assert.equal(created.status,201);
 return api(port,'/api/chat',{...body,sessionId:JSON.parse(created.raw).id});
}

test('group broadcasts one user message to both connected agents without AI chaining', async () => {
 const calls = [];
 await withServer({ Codex: agent('Codex', calls), 'Claude Code': agent('Claude Code', calls) }, async port => {
  const result = await post(port, { recipient: 'group', recipients: ['Codex', 'Claude Code'], message: '  同一条消息  ' });
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [{ name: 'Codex', text: '同一条消息' }, { name: 'Claude Code', text: '同一条消息' }]);
  const events = result.raw.trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter(event => event.type === 'message').map(event => [event.agent, event.text]), [
   ['Codex', 'Codex 收到'], ['Claude Code', 'Claude Code 收到'],
  ]);
  assert.deepEqual(events.at(-1), { type: 'batchDone', agents: ['Codex', 'Claude Code'] });
 });
});

test('group and single chat receive the same saved background snapshot', async () => {
 const calls = [];
 const memory = { background: '测试背景：海棠七号', decisions: '', progress: '', todos: '' };
 await withServer({ Codex: agent('Codex', calls), 'Claude Code': agent('Claude Code', calls) }, async port => {
  assert.equal((await post(port, { recipient: 'group', recipients: ['Codex', 'Claude Code'], message: '请回答' })).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].text, calls[1].text);
  assert.match(calls[0].text, /海棠七号/);
  assert.equal((await post(port, { recipient: 'Codex', message: '请回答' })).status, 200);
  assert.equal(calls[2].text, calls[0].text);
 }, memory);
});

test('single chat remains independent and disconnected group recipients are rejected', async () => {
 const calls = [];
 await withServer({ Codex: agent('Codex', calls), 'Claude Code': agent('Claude Code', calls, false) }, async port => {
  const single = await post(port, { recipient: 'Codex', message: '单聊' });
  assert.equal(single.status, 200);
  assert.deepEqual(calls, [{ name: 'Codex', text: '单聊' }]);
  const group = await post(port, { recipient: 'group', recipients: ['Codex', 'Claude Code'], message: '群聊' });
  assert.equal(group.status, 503);
  assert.equal(calls.length, 1);
 });
});
