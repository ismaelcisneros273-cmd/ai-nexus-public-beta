import { accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function supportedNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (major === 22 && minor >= 21) || (major >= 24 && major % 2 === 0);
}

export function environmentReport({ platform, nodeVersion, proxyFlag, python, codex, claude, portBusy, portCheckError = false }) {
  const errors = [];
  if (platform !== 'darwin') errors.push('当前只支持 macOS。');
  if (!supportedNode(nodeVersion) || !proxyFlag)
    errors.push('Node.js 需要 22.21.0 及以上的 22.x，或 24.x／更新的偶数 LTS 版本，并支持 --use-env-proxy。请从 https://nodejs.org/ 安装。');
  if (portBusy) errors.push('127.0.0.1:4173 已被占用。若 Nexus 已打开，请直接使用现有网页；此脚本不会停止其他程序。');
  if (portCheckError) errors.push('无法确认 4173 端口是否空闲，已停止以避免启动冲突。');
  const notes = [
    python ? 'PDF 与工作区辅助程序：系统 Python 已找到。' : 'PDF 与工作区辅助程序：未找到可执行的 /usr/bin/python3；普通聊天仍可使用。',
    codex ? 'Codex：找到 ChatGPT 桌面应用内的程序；登录及实际可用性请以网页连接状态为准。' : 'Codex：未找到 ChatGPT 桌面应用内的程序；需自行安装并登录官方应用。',
    claude ? 'Claude / Claude Code：找到 CLI；登录及实际可用性请以网页连接状态为准。' : 'Claude / Claude Code：未找到 CLI；需自行安装并登录官方工具。',
    'ChatGPT：此候选版没有可见的首次授权入口，不能保证新用户可连接。',
    'DeepSeek：默认暂停；只有用户自行配置付费 API Key 并明确启用后才会调用。',
    'Muse：尚未接入。未连接成员不会生成模拟回复。',
  ];
  return { errors, notes };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const executable = path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };
  const proxyFlag = spawnSync(process.execPath, ['--use-env-proxy', '-e', ''], { stdio: 'ignore' }).status === 0;
  const portCheck = spawnSync('/usr/sbin/lsof', ['-nP', '-iTCP:4173', '-sTCP:LISTEN'], { stdio: 'ignore' });
  const report = environmentReport({
    platform: process.platform,
    nodeVersion: process.version,
    proxyFlag,
    python: executable('/usr/bin/python3'),
    codex: executable('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'),
    claude: spawnSync('/usr/bin/which', ['claude'], { stdio: 'ignore' }).status === 0,
    portBusy: portCheck.status === 0,
    portCheckError: !!portCheck.error || ![0, 1].includes(portCheck.status),
  });
  for (const note of report.notes) console.log('· ' + note);
  for (const error of report.errors) console.error('检查未通过：' + error);
  if (report.errors.length) process.exitCode = 1;
  else console.log('检查通过。打开网页后，在“成员与状态”查看真实连接情况，选择已连接成员再发送消息。');
}
