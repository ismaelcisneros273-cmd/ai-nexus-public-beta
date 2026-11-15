import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentReport, supportedNode } from '../scripts/doctor.mjs';

test('startup rejects Node versions without the required proxy flag', () => {
  assert.equal(supportedNode('v22.20.0'), false);
  assert.equal(supportedNode('v22.21.0'), true);
  assert.equal(supportedNode('v24.0.0'), true);
  assert.equal(supportedNode('v23.9.0'), false);
  assert.equal(supportedNode('broken'), false);
});

test('missing optional AI tools remain unavailable without blocking local UI', () => {
  const report = environmentReport({ platform: 'darwin', nodeVersion: 'v22.21.0', proxyFlag: true,
    python: false, codex: false, claude: false, portBusy: false });
  assert.deepEqual(report.errors, []);
  assert.match(report.notes.join(' '), /未找到 ChatGPT 桌面应用/);
  assert.match(report.notes.join(' '), /未找到 CLI/);
  assert.match(report.notes.join(' '), /没有可见的首次授权入口/);
  assert.match(report.notes.join(' '), /默认暂停/);
});

test('startup reports incompatible systems and occupied port', () => {
  const report = environmentReport({ platform: 'linux', nodeVersion: 'v20.0.0', proxyFlag: false,
    python: true, codex: true, claude: true, portBusy: true });
  assert.equal(report.errors.length, 3);
  assert.match(report.errors.join(' '), /4173 已被占用/);
});

test('startup refuses to proceed when port inspection cannot be trusted', () => {
  const report = environmentReport({ platform: 'darwin', nodeVersion: 'v24.0.0', proxyFlag: true,
    python: true, codex: false, claude: false, portBusy: false, portCheckError: true });
  assert.match(report.errors.join(' '), /无法确认 4173 端口/);
});
