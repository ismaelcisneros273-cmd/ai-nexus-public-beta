import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, ORIGIN } from '../server.mjs';
import { SessionStore } from '../sessions.mjs';
import { ClaudeCode } from '../claude-code.mjs';

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const headers = { Host: '127.0.0.1:4173', Origin: ORIGIN };
    if (body) { headers['Content-Type'] = 'application/json'; headers['X-AI-Nexus'] = 'local'; }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('fresh data: offline member is rejected; a mock connected member replies and history survives reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-nexus-first-run-'));
  const file = join(dir, 'chat-sessions.json');
  let calls = 0;
  const claude = {
    state: { connected: false, message: '尚未登录' }, active: null,
    async send(_prompt, emit) { calls++; emit({ type: 'message', itemId: 'reply', text: '真实适配器的模拟回复' }); emit({ type: 'done' }); },
    cancel() {},
  };
  const sessions = new SessionStore(file);
  const server = createServer({ Claude: claude },
    { read: async () => ({ background: '', decisions: '', progress: '', todos: '' }) },
    sessions, { relevant: async () => '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    assert.equal((await request(port, 'GET', '/api/status')).status, 200);
    const created = await request(port, 'POST', '/api/sessions', { type: 'unified' });
    assert.equal(created.status, 201);
    const id = JSON.parse(created.text).id;
    const body = { sessionId: id, recipient: 'Claude', message: '你好' };
    const offline = await request(port, 'POST', '/api/chat', body);
    assert.equal(offline.status, 503);
    assert.equal(calls, 0);
    assert.equal((await sessions.get(id)).messages.length, 0);

    claude.state = { connected: true, message: '已连接' };
    const sent = await request(port, 'POST', '/api/chat', body);
    assert.equal(sent.status, 200);
    assert.equal(calls, 1);
    assert.match(sent.text, /真实适配器的模拟回复/);
    const reopened = await new SessionStore(file).get(id);
    assert.deepEqual(reopened.messages.map(item => item.role), ['user', 'assistant']);
    assert.equal(reopened.messages[1].agent, 'Claude');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('fresh CLI profile: Claude stays offline until a simulated official login, then uses only the fake executable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-nexus-cli-first-run-'));
  const bin = join(dir, 'bin');
  const originalPath = process.env.PATH, originalHome = process.env.HOME;
  await mkdir(bin);
  const cli = join(bin, 'claude');
  await writeFile(cli, `#!/bin/sh
if [ "$1" = auth ]; then
  if [ -f "$HOME/allow-login" ]; then printf '%s\\n' '{"loggedIn":true}'; else printf '%s\\n' '{"loggedIn":false}'; fi
  exit 0
fi
if [ "$1" = -p ]; then
  printf '%s\\n' '{"type":"assistant","message":{"id":"demo","content":[{"type":"text","text":"虚构测试回复"}]}}'
  printf '%s\\n' '{"type":"result","subtype":"success","is_error":false}'
  exit 0
fi
exit 2
`);
  await chmod(cli, 0o700);
  process.env.PATH = bin + ':/usr/bin:/bin';
  process.env.HOME = dir;
  try {
    const agent = new ClaudeCode('Claude');
    assert.equal((await agent.start()).connected, false);
    await writeFile(join(dir, 'allow-login'), 'simulated login only');
    assert.equal((await agent.start()).connected, true);
    const events = [];
    await agent.send('你好', event => events.push(event), { stateless: true });
    assert.equal(events.some(event => event.type === 'message' && event.text === '虚构测试回复'), true);
    assert.equal(events.at(-1).type, 'done');
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    await rm(dir, { recursive: true, force: true });
  }
});
