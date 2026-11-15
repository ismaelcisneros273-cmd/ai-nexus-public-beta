import { randomBytes, scrypt } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MOBILE_IP } from './mobile-gateway.mjs';

const run = promisify(execFile);
const derive = promisify(scrypt);
const folder = fileURLToPath(new URL('./private/mobile/', import.meta.url));
const exists = async file => readFile(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });

async function certificate() {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  const caKey = join(folder, 'ca.key'), caCert = join(folder, 'ai-nexus-ca.crt'), phoneCert = join(folder, 'ai-nexus-ca.cer');
  const key = join(folder, 'server.key'), cert = join(folder, 'server.crt');
  if (await exists(caKey) || await exists(caCert) || await exists(phoneCert) || await exists(key) || await exists(cert)) {
    throw Error('证书文件已存在；为保护手机信任关系，未覆盖原文件');
  }
  const csr = join(folder, 'server.csr'), ext = join(folder, 'server.ext');
  try {
    await run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
      '-keyout', caKey, '-out', caCert, '-days', '3650', '-sha256', '-subj', '/CN=AI Nexus Private Hotspot CA',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    await run('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
      '-keyout', key, '-out', csr, '-subj', '/CN=' + MOBILE_IP]);
    await writeFile(ext, `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${MOBILE_IP}\n`, { mode: 0o600 });
    await run('openssl', ['x509', '-req', '-in', csr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial',
      '-out', cert, '-days', '365', '-sha256', '-extfile', ext]);
    await run('openssl', ['x509', '-in', caCert, '-outform', 'DER', '-out', phoneCert]);
    await Promise.all([chmod(key, 0o600), chmod(caCert, 0o600), chmod(phoneCert, 0o600), chmod(cert, 0o600)]);
    // The signing key is not needed after issuance. Removing it prevents minting
    // unrelated certificates from a CA that the iPhone will trust.
    await rm(caKey);
  } catch (error) {
    for (const file of [caKey, caCert, phoneCert, key, cert]) await rm(file, { force: true }).catch(() => {});
    throw error;
  } finally {
    for (const file of [csr, ext, join(folder, 'ai-nexus-ca.srl')]) await rm(file, { force: true }).catch(() => {});
  }
  console.log('证书已生成。请只把 ai-nexus-ca.cer 传给 iPhone 安装并开启完整信任；不要传送任何 .key 文件。');
  console.log(phoneCert);
}

async function hiddenPrompt(prompt) {
  if (!process.stdin.isTTY) throw Error('请在 Mac 终端中运行，密码不能通过命令参数传入');
  process.stdout.write(prompt);
  const input = process.stdin;
  const wasRaw = input.isRaw;
  input.setRawMode(true); input.resume();
  try {
    return await new Promise((resolve, reject) => {
      let answer = '';
      const onData = chunk => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\r' || char === '\n') { input.off('data', onData); process.stdout.write('\n'); resolve(answer); return; }
          if (char === '\u0003') { input.off('data', onData); reject(Error('已取消')); return; }
          if (char === '\u007f') answer = answer.slice(0, -1);
          else if (char >= ' ' && answer.length < 128) answer += char;
        }
      };
      input.on('data', onData);
    });
  } finally { input.setRawMode(wasRaw); input.pause(); }
}

async function password() {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  const target = join(folder, 'auth.json');
  if (await exists(target)) throw Error('手机访问密码已设置；未覆盖原配置');
  const first = await hiddenPrompt('设置手机访问密码（至少 16 位，输入不显示）：');
  const second = await hiddenPrompt('再次输入确认：');
  if (first !== second || first.length < 16 || first.length > 128) throw Error('两次密码不一致，或长度不在 16–128 位之间；未保存');
  const salt = randomBytes(32).toString('hex');
  const hash = (await derive(first, Buffer.from(salt, 'hex'), 32)).toString('hex');
  const temp = target + '.tmp';
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ salt, hash }) + '\n');
    await handle.sync(); await handle.close(); handle = null;
    await rename(temp, target);
  } finally { if (handle) await handle.close(); await rm(temp, { force: true }).catch(() => {}); }
  console.log('手机访问密码已设置；只保存校验值。');
}

const command = process.argv[2];
if (command === 'certificate') await certificate();
else if (command === 'password') await password();
else { console.error('用法：node mobile-setup.mjs certificate 或 node mobile-setup.mjs password'); process.exitCode = 1; }
