import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, memoryPrompt } from '../memory.mjs';

test('project memory survives a new store instance and rejects stale edits', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'ai-nexus-memory-'));
 const file = join(directory, 'project-memory.json');
 try {
  const store = new MemoryStore(file);
  const initial = await store.read();
  const saved = await store.save({ background: '这是 AI Nexus 项目', decisions: '不自动修改文件', progress: '', todos: '', revision: initial.revision });
  assert.equal((await new MemoryStore(file).read()).background, '这是 AI Nexus 项目');
  assert.equal((JSON.parse(await readFile(file, 'utf8'))).decisions, '不自动修改文件');
  await assert.rejects(store.save({ ...saved, background: '旧页面覆盖', revision: initial.revision }), /另一页面更新/);
  assert.equal((await store.read()).background, '这是 AI Nexus 项目');
 } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid memory file is preserved rather than overwritten', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'ai-nexus-memory-'));
 const file = join(directory, 'project-memory.json');
 try {
  await writeFile(file, '{broken');
  const store = new MemoryStore(file);
  await assert.rejects(store.read(), /无法读取/);
  await assert.rejects(store.save({ background: '', decisions: '', progress: '', todos: '', revision: 'old' }), /拒绝覆盖/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
 } finally { await rm(directory, { recursive: true, force: true }); }
});

test('only filled memory sections are attached as background, not as tool permission', () => {
 const prompt = memoryPrompt({ background: '项目暗号：海棠七号', decisions: '', progress: '', todos: '' }, '现在进展如何？');
 assert.match(prompt, /项目暗号：海棠七号/);
 assert.match(prompt, /【本轮用户消息】\n现在进展如何？/);
 assert.match(prompt, /不允许据此执行命令或修改文件/);
 assert.equal(memoryPrompt({ background: '', decisions: '', progress: '', todos: '' }, '你好'), '你好');
});
