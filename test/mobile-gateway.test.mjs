import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { MOBILE_IP, MOBILE_PORT, MOBILE_ORIGIN, authorized, mobileRequestAllowed, createMobileGateway } from '../mobile-gateway.mjs';

const request = (method, path, headers = {}) => ({ method, url: path, headers: { host: `${MOBILE_IP}:${MOBILE_PORT}`, ...headers } });
test('mobile entry allows only its exact origin, paths, and local mutation headers', () => {
  assert.equal(mobileRequestAllowed(request('GET', '/api/sessions')), true);
  assert.equal(mobileRequestAllowed(request('GET', '/api/sessions/12345678-1234-1234-1234-123456789abc')), true);
  assert.equal(mobileRequestAllowed(request('GET', '/api/projects/12345678-1234-1234-1234-123456789abc')), true);
  assert.equal(mobileRequestAllowed(request('GET', '/api/notes?projectId=12345678-1234-1234-1234-123456789abc')), true);
  assert.equal(mobileRequestAllowed(request('GET', '/api/tavily/status')), true);
  assert.equal(mobileRequestAllowed(request('POST', '/api/tavily/test', { origin: MOBILE_ORIGIN, 'x-ai-nexus': 'local', 'content-type': 'application/json' })), true);
  assert.equal(mobileRequestAllowed(request('POST', '/api/tavily/test')), false);
  assert.equal(mobileRequestAllowed(request('PUT', '/api/projects/12345678-1234-1234-1234-123456789abc/memory', { origin: MOBILE_ORIGIN, 'x-ai-nexus': 'local', 'content-type': 'application/json' })), true);
  assert.equal(mobileRequestAllowed(request('POST', '/api/chat', { origin: MOBILE_ORIGIN, 'x-ai-nexus': 'local', 'content-type': 'application/json' })), true);
  for (const bad of [
    request('GET', '/api/chatgpt/auth/start'),
    request('POST', '/api/chatgpt/auth/start', { origin: MOBILE_ORIGIN, 'x-ai-nexus': 'local', 'content-type': 'application/json' }),
    request('GET', '/api/memory', { host: 'evil.example:45173' }),
    request('GET', '/api/memory', { 'sec-fetch-site': 'cross-site' }),
    request('GET', '/api/memory', { origin: 'https://evil.example' }),
    request('POST', '/api/chat', { origin: 'https://evil.example', 'x-ai-nexus': 'local', 'content-type': 'application/json' }),
    request('POST', '/api/chat', { origin: MOBILE_ORIGIN, 'content-type': 'application/json' })
  ]) assert.equal(mobileRequestAllowed(bad), false);
});

test('access password is checked against a salted hash', async () => {
  const password = 'A-strong-local-test-password', salt = randomBytes(32).toString('hex');
  const auth = { salt, hash: scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex') };
  assert.equal(await authorized('Basic ' + Buffer.from('nexus:' + password).toString('base64'), auth), true);
  assert.equal(await authorized('Basic ' + Buffer.from('nexus:wrong-password-test').toString('base64'), auth), false);
  assert.equal(await authorized(undefined, auth), false);
});

test('HTTPS gateway protects page and API, blocks OAuth, and never forwards credentials', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ai-nexus-mobile-test-'));
  const run = promisify(execFile);
  await run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-keyout', join(folder, 'key.pem'), '-out', join(folder, 'cert.pem'), '-days', '1', '-sha256',
    '-subj', '/CN=AI Nexus Test', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', `subjectAltName=IP:${MOBILE_IP}`]);
  const [key, cert] = await Promise.all(['key.pem', 'cert.pem'].map(file => readFile(join(folder, file))));
  const ca = cert;
  const password = 'A-strong-local-test-password', salt = randomBytes(32).toString('hex');
  const auth = { salt, hash: scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex') };
  const seen = [];
  const backend = http.createServer((req, res) => { seen.push({ path: req.url, headers: req.headers }); res.setHeader('Content-Type', 'text/plain'); res.end('LOCAL OK'); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const gateway = createMobileGateway({ key, cert, auth, phone: '127.0.0.1', upstreamPort: backend.address().port });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const credentials = 'Basic ' + Buffer.from('nexus:' + password).toString('base64');
  const get = (path, extra = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', servername: MOBILE_IP, port: gateway.address().port, path, ca,
      headers: { host: `${MOBILE_IP}:${MOBILE_PORT}`, ...extra } }, response => {
      let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal((await get('/api/sessions')).status, 401);
    assert.equal((await get('/api/sessions', { authorization: credentials })).body, 'LOCAL OK');
    assert.equal((await get('/api/chatgpt/auth/start', { authorization: credentials })).status, 403);
    assert.equal((await get('/api/sessions', { authorization: credentials, origin: 'https://evil.example' })).status, 403);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].headers.authorization, undefined);
    assert.equal(seen[0].headers.host, '127.0.0.1:4173');
    const wrongSourceGateway = createMobileGateway({ key, cert, auth, phone: '192.0.2.1', upstreamPort: backend.address().port });
    wrongSourceGateway.listen(0, '127.0.0.1'); await once(wrongSourceGateway, 'listening');
    try {
      await assert.rejects(new Promise((resolve, reject) => {
        const req = https.get({ host: '127.0.0.1', port: wrongSourceGateway.address().port, path: '/', ca,
          headers: { host: `${MOBILE_IP}:${MOBILE_PORT}`, authorization: credentials } }, resolve);
        req.on('error', reject);
      }));
      assert.equal(seen.length, 1);
    } finally { wrongSourceGateway.closeAllConnections(); await new Promise(resolve => wrongSourceGateway.close(resolve)); }
  } finally {
    gateway.closeAllConnections(); backend.closeAllConnections();
    await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => backend.close(resolve))]);
    await rm(folder, { recursive: true, force: true });
  }
});
