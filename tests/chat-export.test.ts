import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatMessage } from '../src/services/ai-service.ts';
import {
  buildConversationMarkdown,
  safeFileName,
} from '../src/services/chat-export.ts';

function at(year: number, month: number, day: number, hour = 9, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

test('buildConversationMarkdown：标题、导出时间、角色小标题、时间、引用与正文齐备', () => {
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: '你好',
      createdAt: at(2026, 1, 15, 9, 5),
      quote: '上文\n第二行',
    },
    { role: 'assistant', content: '## 标题\n\n正文' },
  ];

  const markdown = buildConversationMarkdown(messages, {
    title: ' 我的会话 ',
    updatedAt: at(2026, 1, 15, 10, 0),
  });

  assert.equal(
    markdown,
    '# 我的会话\n' +
      '\n' +
      '*导出于 2026-01-15 10:00*\n' +
      '\n' +
      '## 我\n' +
      '\n' +
      '*2026-01-15 09:05*\n' +
      '\n' +
      '> 上文\n' +
      '> 第二行\n' +
      '\n' +
      '你好\n' +
      '\n' +
      '## AI\n' +
      '\n' +
      '## 标题\n\n正文\n'
  );
});

test('buildConversationMarkdown：空标题回退「对话」，无 messages 时只有标题', () => {
  const markdown = buildConversationMarkdown([], { title: '   ' });
  assert.equal(markdown, '# 对话\n');
});

test('buildConversationMarkdown：无 createdAt / updatedAt 时不写时间行（不伪造）', () => {
  const markdown = buildConversationMarkdown(
    [{ role: 'user', content: 'a' }],
    { title: 'T' }
  );
  assert.equal(markdown, '# T\n\n## 我\n\na\n');
  assert.ok(!markdown.includes('导出'));
});

test('buildConversationMarkdown：空引用 / 纯空白引用不产生引用块', () => {
  const markdown = buildConversationMarkdown(
    [
      { role: 'user', content: 'a', quote: '   ' },
      { role: 'user', content: 'b', quote: '' },
    ],
    { title: 'T' }
  );
  assert.ok(!markdown.includes('>'));
});

test('safeFileName：去掉路径分隔符与保留字符并补 .md', () => {
  assert.equal(safeFileName('a/b:c*d?e'), 'a-b-c-d-e.md');
  assert.equal(safeFileName('  我的 会话  '), '我的-会话.md');
  assert.equal(safeFileName(''), 'chat.md');
  assert.equal(safeFileName('///'), 'chat.md');
});
