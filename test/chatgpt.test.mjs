import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatGPT, safeError } from '../chatgpt.mjs';
import { SessionStore, discussionPrompt } from '../sessions.mjs';

const callback = url => new Promise((resolve, reject) => {
  httpGet(url, response => { response.resume(); response.on('end', () => resolve({status:response.statusCode,location:response.headers.location})); }).on('error',reject);
});

test('ChatGPT remains offline before authorization and cannot send a reply', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-nexus-chatgpt-'));
  const agent = new ChatGPT(join(dir, 'auth.json'));
  assert.equal((await agent.start()).connected, false);
  assert.equal(agent.record, null);
  await assert.rejects(agent.send('你好', () => {}), /unavailable/);
  assert.equal(safeError(Error('token=secret')), 'ChatGPT 官方服务请求失败；未生成模拟回复。');
});

test('authorization start creates only a local host ID and an official consent URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-nexus-chatgpt-'));
  const file = join(dir, 'private', 'auth.json'), agent = new ChatGPT(file);
  try {
    const url = new URL(await agent.beginAuthorization());
    assert.equal(url.origin, 'https://auth.openai.com');
    assert.equal(url.pathname, '/api/accounts/authorize');
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(url.searchParams.get('scope').includes('chatgpt.tokens.use.direct'), true);
    assert.equal(url.searchParams.get('redirect_uri').startsWith('http://127.0.0.1:'), true);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.match(saved.hostId, /^urn:uuid:/);
    assert.equal(saved.profile, null);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally { agent.stop(); }
});

test('valid official callback exchanges and verifies synthetic credentials, then redirects safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-nexus-chatgpt-'));
  const file = join(dir, 'private', 'auth.json'), agent = new ChatGPT(file);
  const originalFetch = globalThis.fetch;
  const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
  const key = {...publicKey.export({format:'jwk'}),kid:'test-key',use:'sig'};
  let exchanges=0;
  try {
    const authorize = new URL(await agent.beginAuthorization());
    const payload = {iss:'https://auth.openai.com',aud:'oaiapp_test',sub:'synthetic-user',
      nonce:authorize.searchParams.get('nonce'),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
    const unsigned = [Buffer.from(JSON.stringify({alg:'RS256',kid:key.kid})).toString('base64url'),
      Buffer.from(JSON.stringify(payload)).toString('base64url')].join('.');
    const idToken = unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
    globalThis.fetch = async url => {
      if(url.endsWith('/oauth/token')){exchanges++;return new Response(JSON.stringify({id_token:idToken,access_token:'synthetic-access',
        refresh_token:'synthetic-refresh',scope:'openid offline_access resource.invoke chatgpt.tokens.use.direct',expires_in:3600}),{status:200});}
      if(url.endsWith('/jwks.json'))return new Response(JSON.stringify({keys:[key]}),{status:200});
      throw Error('Unexpected endpoint');
    };
    const target = new URL(authorize.searchParams.get('redirect_uri'));
    target.searchParams.set('state',authorize.searchParams.get('state'));
    target.searchParams.set('client_id','oaiapp_test');target.searchParams.set('code','synthetic-code');
    const result = await callback(target);
    assert.equal(result.status,303);
    assert.equal(result.location,'http://127.0.0.1:4173/?chatgpt=authorized');
    assert.equal(exchanges,1);
    assert.equal(agent.state.connected,true);
    assert.equal(JSON.parse(await readFile(file,'utf8')).profile.client_id,'oaiapp_test');
  } finally {globalThis.fetch=originalFetch;agent.stop();}
});

test('invalid state never exchanges a code; token failure remains offline with redacted stage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-nexus-chatgpt-'));
  const file = join(dir, 'auth.json'), agent = new ChatGPT(file);
  const originalFetch = globalThis.fetch, originalWarn = console.warn;
  let exchanges=0;
  try {
    const authorize = new URL(await agent.beginAuthorization());
    globalThis.fetch = async () => {exchanges++;return new Response('{}',{status:403});};
    console.warn = () => {};
    const target = new URL(authorize.searchParams.get('redirect_uri'));
    target.searchParams.set('state','wrong');target.searchParams.set('client_id','oaiapp_test');target.searchParams.set('code','synthetic-code');
    assert.equal((await callback(target)).status,400);
    assert.equal(exchanges,0);
    target.searchParams.set('state',authorize.searchParams.get('state'));
    const result = await callback(target);
    assert.equal(result.location,'http://127.0.0.1:4173/?chatgpt=failed');
    assert.match(agent.state.message,/令牌交换 · HTTP 403/);
    assert.equal(agent.state.connected,false);
    assert.equal(JSON.parse(await readFile(file,'utf8')).profile,null);
    assert.equal(exchanges,1);
  } finally {globalThis.fetch=originalFetch;console.warn=originalWarn;agent.stop();}
});

test('ChatGPT adapter uses a separate text-only Responses stream and marks completion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-nexus-chatgpt-'));
  const agent = new ChatGPT(join(dir, 'auth.json'));
  agent.record = { hostId: 'urn:uuid:test', profile: { client_id: 'test', access_token: 'synthetic', refresh_token: 'synthetic',
    scopes: ['chatgpt.tokens.use.direct'], saved_at: Date.now(), expires_in: 3600 } };
  agent.state = { connected: true, message: 'test' };
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ models: [
      { slug: 'gpt-6-luna', display_name: 'GPT', visibility: 'list' },
      { slug: 'chat-latest', display_name: 'ChatGPT', visibility: 'list' }
    ] }), { status: 200 });
    return new Response('data: {"type":"response.output_text.delta","delta":"真实"}\n\ndata: {"type":"response.output_text.delta","delta":"回复"}\n\ndata: {"type":"response.completed"}\n\n', { status: 200 });
  };
  try {
    const events = [];
    await agent.send('测试消息', event => events.push(event));
    assert.deepEqual(events.map(event => event.type), ['start', 'delta', 'delta', 'done']);
    assert.equal(calls[1].url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(calls[1].options.body);
    assert.equal(body.model, 'chat-latest');
    assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.equal(body.input[0].content, '测试消息');
    assert.equal(body.tools, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('ChatGPT can be a separate single-chat member and a discussion participant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-nexus-chatgpt-'));
  const store = new SessionStore(join(dir, 'sessions.json'));
  const single = await store.create('single', 'ChatGPT');
  assert.equal((await store.get(single.id)).agent, 'ChatGPT');
  const group = await store.create('group');
  const user = await store.append(group.id, 'user', '比较两种方案');
  const round = await store.startRound(group.id, user.message.id, ['ChatGPT', 'Claude Code']);
  assert.deepEqual(round.participants, ['ChatGPT', 'Claude Code']);
  const prompt = discussionPrompt(text => text, [], '比较两种方案', [
    { agent: 'ChatGPT', text: '方案甲' }, { agent: 'Claude Code', text: '方案乙' }
  ], 'ChatGPT');
  assert.match(prompt, /你是 ChatGPT/);
  assert.match(prompt, /方案乙/);
});
