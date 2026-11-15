import https from 'node:https';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const derive = promisify(scrypt);
export const MOBILE_IP = '172.20.10.3';
export const PHONE_IP = '172.20.10.1';
export const MOBILE_PORT = 45173;
export const MOBILE_ORIGIN = `https://${MOBILE_IP}:${MOBILE_PORT}`;
const LOCAL_ORIGIN = 'http://127.0.0.1:4173';
const privateDir = new URL('./private/mobile/', import.meta.url);
const publicPaths = new Set(['/', '/index.html', '/styles.css', '/app.js', '/api/status', '/api/memory', '/api/sessions', '/api/projects', '/api/notes', '/api/chat', '/api/cancel', '/api/search', '/api/tavily/status', '/api/organizer']);
const sessionPath = /^\/api\/sessions\/[0-9a-f-]{36}$/;
const projectPath = /^\/api\/projects\/[0-9a-f-]{36}(?:\/memory)?$/;
const notePath = /^\/api\/notes\/[0-9a-f-]{36}$/;
const attachmentPath = /^\/api\/attachments\/[0-9a-f-]{36}$/;
const bookmarkPath = /^\/api\/bookmarks\/[0-9a-f-]{36}$/;
const todoPath = /^\/api\/todos\/[0-9a-f-]{36}$/;
const discussionPath = /^\/api\/sessions\/[0-9a-f-]{36}\/rounds\/[0-9a-f-]{36}\/discuss$/;
const historyDiscussionPath = /^\/api\/sessions\/[0-9a-f-]{36}\/discuss$/;
const collaborationPath = /^\/api\/collaborations\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(approve|reject|retry)$/;
const integrationPath = /^\/api\/integrations\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export function mobilePathAllowed(method, path) {
  if (method === 'GET') return publicPaths.has(path) && !['/api/chat', '/api/cancel'].includes(path) || sessionPath.test(path) || projectPath.test(path) || notePath.test(path) || attachmentPath.test(path);
  if (method === 'POST') return ['/api/chat', '/api/handoff', '/api/cancel', '/api/memory', '/api/sessions', '/api/projects', '/api/notes', '/api/tavily/test', '/api/attachments', '/api/bookmarks', '/api/todos'].includes(path) || discussionPath.test(path) || historyDiscussionPath.test(path) || collaborationPath.test(path) || integrationPath.test(path);
  if (method === 'PUT') return /\/memory$/.test(path) && projectPath.test(path);
  return (sessionPath.test(path) || projectPath.test(path) || notePath.test(path) || todoPath.test(path)) && ['PATCH', 'DELETE'].includes(method) || method === 'DELETE' && (attachmentPath.test(path) || bookmarkPath.test(path));
}

export function mobileRequestAllowed(req) {
  if (req.headers.host !== `${MOBILE_IP}:${MOBILE_PORT}` || !req.url?.startsWith('/') || req.url.startsWith('//')) return false;
  let path;
  try { path = new URL(req.url, MOBILE_ORIGIN).pathname; } catch { return false; }
  if (!mobilePathAllowed(req.method, path)) return false;
  if (req.headers.origin && req.headers.origin !== MOBILE_ORIGIN) return false;
  if (req.headers.referer && !req.headers.referer.startsWith(MOBILE_ORIGIN + '/')) return false;
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
  if (!['GET', 'HEAD'].includes(req.method) &&
      (req.headers.origin !== MOBILE_ORIGIN || req.headers['x-ai-nexus'] !== 'local' || req.headers['content-type'] !== 'application/json')) return false;
  return true;
}

export async function authorized(header, config) {
  if (typeof header !== 'string' || !header.startsWith('Basic ') || header.length > 256) return false;
  let credentials;
  try { credentials = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  if (!credentials.startsWith('nexus:')) return false;
  const password = credentials.slice(6);
  if (password.length < 16 || password.length > 128) return false;
  const result = await derive(password, Buffer.from(config.salt, 'hex'), 32);
  return timingSafeEqual(result, Buffer.from(config.hash, 'hex'));
}

export function createMobileGateway({ key, cert, auth, phone = PHONE_IP, upstreamPort = 4173 } = {}) {
  if (!key || !cert || !auth || !/^[0-9a-f]{64}$/.test(auth.salt) || !/^[0-9a-f]{64}$/.test(auth.hash)) throw Error('手机入口缺少证书或访问密码');
  let failures = 0, windowStart = 0;
  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const deny = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message); };
    if (req.socket.remoteAddress !== phone) { deny(403, '来源不允许'); return; }
    if (Date.now() - windowStart > 60000) { failures = 0; windowStart = Date.now(); }
    if (failures >= 5) { deny(429, '请一分钟后再试'); return; }
    if (!await authorized(req.headers.authorization, auth)) {
      failures++;
      res.setHeader('WWW-Authenticate', 'Basic realm="AI Nexus Mobile", charset="UTF-8"');
      deny(401, '需要手机访问密码'); return;
    }
    failures = 0;
    if (!mobileRequestAllowed(req)) { deny(403, '请求来源或路径无效'); return; }
    const headers = {
      host: '127.0.0.1:4173',
      accept: req.headers.accept || '*/*',
      'sec-fetch-site': req.headers['sec-fetch-site'] || 'same-origin'
    };
    if (req.headers.origin) headers.origin = LOCAL_ORIGIN;
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers['x-ai-nexus']) headers['x-ai-nexus'] = req.headers['x-ai-nexus'];
    if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers, timeout: 300000 }, response => {
      const safeHeaders = {};
      for (const name of ['content-type', 'cache-control', 'content-security-policy', 'x-content-type-options', 'x-accel-buffering']) {
        if (response.headers[name]) safeHeaders[name] = response.headers[name];
      }
      res.writeHead(response.statusCode || 502, safeHeaders);
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) deny(502, 'AI Nexus 本机服务未就绪'); else res.destroy(); });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
  // Reject other hotspot clients before they can complete a TLS handshake.
  server.on('connection', socket => { if (socket.remoteAddress !== phone) socket.destroy(); });
  return server;
}

async function main() {
  const wifi = networkInterfaces().en0?.find(address => address.family === 'IPv4' && !address.internal)?.address;
  if (wifi !== MOBILE_IP) throw Error(`未检测到预期的 Wi-Fi 地址 ${MOBILE_IP}；手机入口未启动`);
  const [key, cert, authText] = await Promise.all([
    readFile(new URL('server.key', privateDir)),
    readFile(new URL('server.crt', privateDir)),
    readFile(new URL('auth.json', privateDir), 'utf8')
  ]);
  const server = createMobileGateway({ key, cert, auth: JSON.parse(authText) });
  server.on('error', error => { console.error('手机 HTTPS 入口启动失败：' + error.code); process.exitCode = 1; });
  server.listen(MOBILE_PORT, MOBILE_IP, () => console.log('手机 HTTPS 入口：' + MOBILE_ORIGIN));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.code === 'ENOENT' ? '手机入口未启动：请先在 Mac 终端设置独立访问密码。' : error.message);
  process.exitCode = 1;
});
