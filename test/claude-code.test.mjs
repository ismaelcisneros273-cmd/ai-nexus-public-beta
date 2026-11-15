import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCode, safeError, MAX_HISTORY, CLAUDE_PROMPT, SYSTEM_PROMPT } from '../claude-code.mjs';

test('Claude and Claude Code are separate roles on the same tool-free CLI adapter',()=>{
 const talk=new ClaudeCode('Claude'),code=new ClaudeCode();
 talk.pushHistory('assistant','文字观点');code.pushHistory('assistant','代码观点');
 assert.match(talk.buildPrompt('继续'),/Claude: 文字观点/);
 assert.match(code.buildPrompt('继续'),/Claude Code: 代码观点/);
 assert.notEqual(talk.history,code.history);
 for(const prompt of [CLAUDE_PROMPT,SYSTEM_PROMPT])assert.match(prompt,/no tools and cannot execute commands, read or write files/);
});

test('errors never echo sensitive diagnostic text', () => {
 assert.ok(!safeError(new Error('token=secret-example-value')).includes('secret-example-value'));
 assert.match(safeError(new Error('401 unauthorized')), /登录不可用/);
 assert.match(safeError(new Error('rate limit exceeded')), /额度不足或请求限流/);
});

test('stream deltas and the final assistant message are forwarded, and history is recorded only on success', () => {
 const c = new ClaudeCode();
 const out = [];
 const a = { emit: x => out.push(x), itemId: null, replyText: '', turnDone: false };
 c.handle({ type: 'system', subtype: 'init', model: 'claude-sonnet-5' }, a);
 c.handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } }, a);
 c.handle({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你' } } }, a);
 c.handle({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '好' } } }, a);
 c.handle({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '你好' }] } }, a);
 assert.equal(c.model, 'claude-sonnet-5');
 assert.deepEqual(out.map(e => e.type), ['start', 'delta', 'delta', 'message']);
 assert.equal(a.replyText, '你好');
});

test('a successful result finalizes the turn; a failed one never reports success', () => {
 const c = new ClaudeCode();
 let finished;
 const a = { emit: () => {}, itemId: null, replyText: 'ok', turnDone: false, finish: e => { finished = e; } };
 c.handle({ type: 'result', subtype: 'success', is_error: false }, a);
 assert.equal(finished, null);
 assert.equal(a.turnDone, true);

 const c2 = new ClaudeCode();
 let finished2;
 const a2 = { emit: () => {}, itemId: null, replyText: '', turnDone: false, finish: e => { finished2 = e; } };
 c2.handle({ type: 'result', subtype: 'error_during_execution', is_error: true, error: { message: 'boom' } }, a2);
 assert.ok(finished2);
});

test('history is capped and formatted as alternating turns, reset clears it', async () => {
 const c = new ClaudeCode();
 for (let i = 0; i < MAX_HISTORY + 5; i++) c.pushHistory(i % 2 ? 'assistant' : 'user', 'msg' + i);
 assert.equal(c.history.length, MAX_HISTORY);
 c.pushHistory('user', '最新问题');
 const prompt = c.buildPrompt('最新问题');
 assert.ok(prompt.endsWith('用户: 最新问题'));
 assert.ok(prompt.includes('Claude Code: '));
 await c.newThread();
 assert.equal(c.history.length, 0);
 assert.equal(c.buildPrompt('hi'), 'hi');
});

test('cancel and stop only touch the active child process, never crash with no active turn', () => {
 const c = new ClaudeCode();
 assert.doesNotThrow(() => c.cancel());
 assert.doesNotThrow(() => c.stop());
 let killedWith;
 c.active = { child: { kill: sig => { killedWith = sig; } } };
 c.cancel();
 assert.equal(killedWith, 'SIGINT');
 c.stop();
 assert.equal(killedWith, 'SIGTERM');
});
