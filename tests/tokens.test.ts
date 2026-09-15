import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatMessage } from '../src/services/ai-service.ts';
import {
  estimateConversationTokens,
  estimateTokens,
  formatTokenCount,
  PER_MESSAGE_OVERHEAD,
} from '../src/services/tokens.ts';

test('estimateTokens：空文本为 0', () => {
  assert.equal(estimateTokens(''), 0);
});

test('estimateTokens：CJK 按 1 字符 1 token', () => {
  assert.equal(estimateTokens('你好世界'), 4);
});

test('estimateTokens：拉丁文本约 4 字符 1 token，向上取整', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('estimateTokens：中英混排分别计权', () => {
  // 2 个 CJK + 2 个拉丁(0.5) = 2.5 → 3
  assert.equal(estimateTokens('你好ab'), 3);
});

test('estimateConversationTokens：计入每条消息的结构开销与引用', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: '你好世界' },
    { role: 'assistant', content: 'abcd' },
  ];
  // 4*2(开销) + 4 + 1
  assert.equal(estimateConversationTokens(messages), PER_MESSAGE_OVERHEAD * 2 + 5);
});

test('estimateConversationTokens：引用也计入上下文', () => {
  const withQuote: ChatMessage[] = [
    { role: 'user', content: 'abcd', quote: '你好世界' },
  ];
  assert.equal(
    estimateConversationTokens(withQuote),
    PER_MESSAGE_OVERHEAD + 1 + 4
  );
});

test('formatTokenCount：千位以下原样，千位以上保留一位小数', () => {
  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(999), '999');
  assert.equal(formatTokenCount(1000), '1.0k');
  assert.equal(formatTokenCount(1234), '1.2k');
});
