import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatMessage } from '../src/services/ai-service.ts';
import {
  buildDateSeparatedList,
  finalizeAssistantMessage,
  formatDayLabel,
  makeQuote,
  messageVersionView,
  quoteSummary,
  rollbackAssistantSeed,
  seedVersionsFor,
  squeeze,
  startOfDay,
  switchMessageVersion,
  type MessageListItem,
} from '../src/services/chat-messages.ts';

/** 取某天的本地时间戳（用本地构造，避免依赖运行环境的时区） */
function at(year: number, month: number, day: number, hour = 9, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

// ------------------------------------------------------------ 引用

test('makeQuote：折叠空白并截断到上限', () => {
  assert.equal(makeQuote('  a   b\nc '), 'a b c');
  const long = makeQuote('x'.repeat(500));
  assert.equal(long.length, 200, '超长应被截到 200');
  assert.equal(makeQuote('   '), '');
});

test('quoteSummary / squeeze：超长加省略号', () => {
  assert.equal(squeeze('a   b', 10), 'a b');
  assert.equal(squeeze('x'.repeat(11), 10), `${'x'.repeat(10)}…`);
  assert.equal(quoteSummary('  hi  '), 'hi');
});

// ------------------------------------------------------------ 版本

test('messageVersionView：无版本或单版本返回 null', () => {
  assert.equal(messageVersionView({ role: 'assistant', content: 'a' }), null);
  assert.equal(
    messageVersionView({ role: 'assistant', content: 'a', versions: ['a'], activeVersion: 0 }),
    null
  );
});

test('messageVersionView：多版本给出下标与总数，越界下标被钳制', () => {
  assert.deepEqual(
    messageVersionView({ role: 'assistant', content: 'b', versions: ['a', 'b'], activeVersion: 1 }),
    { active: 1, total: 2 }
  );
  assert.deepEqual(
    messageVersionView({ role: 'assistant', content: 'b', versions: ['a', 'b'], activeVersion: 9 }),
    { active: 1, total: 2 }
  );
  // 缺 activeVersion 时默认指向最后一个（最新版本）
  assert.deepEqual(
    messageVersionView({ role: 'assistant', content: 'b', versions: ['a', 'b'] }),
    { active: 1, total: 2 }
  );
});

test('switchMessageVersion：切换会同步 content', () => {
  const message: ChatMessage = {
    role: 'assistant',
    content: 'v2',
    versions: ['v1', 'v2', 'v3'],
    activeVersion: 2,
  };
  const back = switchMessageVersion(message, -1);
  assert.equal(back.content, 'v2');
  assert.equal(back.activeVersion, 1);
  const forward = switchMessageVersion(back, 1);
  assert.equal(forward.content, 'v3');
  assert.equal(forward.activeVersion, 2);
});

test('switchMessageVersion：已在端点或单版本时原样返回（同一引用）', () => {
  const first: ChatMessage = {
    role: 'assistant',
    content: 'v1',
    versions: ['v1', 'v2'],
    activeVersion: 0,
  };
  assert.equal(switchMessageVersion(first, -1), first);
  const single: ChatMessage = { role: 'assistant', content: 'x' };
  assert.equal(switchMessageVersion(single, 1), single);
});

test('seedVersionsFor：没有版本列表时把当前内容当作唯一版本', () => {
  assert.deepEqual(seedVersionsFor({ role: 'assistant', content: 'a' }), ['a']);
  assert.deepEqual(
    seedVersionsFor({ role: 'assistant', content: 'b', versions: ['a', 'b'], activeVersion: 1 }),
    ['a', 'b']
  );
});

test('finalizeAssistantMessage：重新生成把新内容追加为新版本并指向它', () => {
  const message: ChatMessage = { role: 'assistant', content: '新回答', id: 'm1', createdAt: 5 };
  const finalized = finalizeAssistantMessage(message, { id: 'm1', versions: ['旧回答'] });
  assert.deepEqual(finalized.versions, ['旧回答', '新回答']);
  assert.equal(finalized.activeVersion, 1);
  assert.equal(finalized.content, '新回答');
  assert.equal(finalized.id, 'm1');
});

test('finalizeAssistantMessage：续写写回当前版本，版本数不变', () => {
  const message: ChatMessage = {
    role: 'assistant',
    content: '上半段下半段',
    versions: ['上半段', '另一版'],
    activeVersion: 0,
  };
  const finalized = finalizeAssistantMessage(message, {
    mode: 'extend',
    versions: ['上半段', '另一版'],
    appendBase: '上半段',
  });
  assert.deepEqual(finalized.versions, ['上半段下半段', '另一版']);
  assert.equal(finalized.activeVersion, 0);
});

test('finalizeAssistantMessage：全新回复不引入版本字段（同一引用）', () => {
  const message: ChatMessage = { role: 'assistant', content: 'x' };
  assert.equal(finalizeAssistantMessage(message), message);
});

test('rollbackAssistantSeed：重新生成没产出时还原旧内容', () => {
  const history: ChatMessage[] = [{ role: 'user', content: '问', id: 'u1' }];
  const restored = rollbackAssistantSeed(history, { id: 'a1', createdAt: 9, versions: ['旧回答'] });
  assert.equal(restored.length, 2);
  assert.equal(restored[1].content, '旧回答');
  assert.equal(restored[1].id, 'a1');
  assert.equal(restored[1].activeVersion, 0);
});

test('rollbackAssistantSeed：普通发送或续写只回退到 history', () => {
  const history: ChatMessage[] = [{ role: 'user', content: '问', id: 'u1' }];
  assert.equal(rollbackAssistantSeed(history), history);
  assert.equal(rollbackAssistantSeed(history, { mode: 'extend' }), history);
});

// ------------------------------------------------------------ 日期分隔

test('formatDayLabel：今天 / 昨天 / 具体日期', () => {
  const todayStart = startOfDay(at(2026, 1, 15, 10, 30));
  assert.equal(formatDayLabel(at(2026, 1, 15, 23, 59), todayStart), '今天');
  assert.equal(formatDayLabel(at(2026, 1, 14, 0, 1), todayStart), '昨天');
  assert.equal(formatDayLabel(at(2026, 1, 10, 12, 0), todayStart), '2026-01-10');
});

test('buildDateSeparatedList：按天插入分隔，并保留原始消息下标', () => {
  const todayStart = startOfDay(at(2026, 1, 15, 10, 0));
  const messages: ChatMessage[] = [
    { role: 'user', content: 'a', id: 'm1', createdAt: at(2026, 1, 15, 9, 0) },
    { role: 'assistant', content: 'b', id: 'm2', createdAt: at(2026, 1, 15, 9, 1) },
    { role: 'user', content: 'c', id: 'm3', createdAt: at(2026, 1, 14, 9, 0) },
  ];
  const items = buildDateSeparatedList(messages, todayStart);
  assert.deepEqual(
    items.map((item) => item.kind),
    ['date', 'message', 'message', 'date', 'message']
  );
  const dates = items.filter((item): item is Extract<MessageListItem, { kind: 'date' }> => item.kind === 'date');
  assert.deepEqual(
    dates.map((item) => item.label),
    ['今天', '昨天']
  );
  const msgs = items.filter((item): item is Extract<MessageListItem, { kind: 'message' }> => item.kind === 'message');
  assert.deepEqual(
    msgs.map((item) => item.index),
    [0, 1, 2],
    '下标必须指向原始 messages，跳转才能对上'
  );
  assert.deepEqual(
    msgs.map((item) => item.key),
    ['m1', 'm2', 'm3']
  );
});

test('buildDateSeparatedList：无 createdAt 的消息不分组，也不被归入相邻某天', () => {
  const todayStart = startOfDay(at(2026, 1, 15, 10, 0));
  const messages: ChatMessage[] = [
    { role: 'user', content: 'old', id: 'm1' },
    { role: 'user', content: 'a', id: 'm2', createdAt: at(2026, 1, 15, 9, 0) },
    { role: 'user', content: 'b', id: 'm3', createdAt: at(2026, 1, 15, 9, 5) },
  ];
  const items = buildDateSeparatedList(messages, todayStart);
  // 第一条无时间 → 不产生分隔；后两条同一天 → 只产生一个分隔
  assert.deepEqual(
    items.map((item) => item.kind),
    ['message', 'date', 'message', 'message']
  );
});

test('buildDateSeparatedList：无 id 的消息用下标兜底做 key', () => {
  const items = buildDateSeparatedList(
    [{ role: 'user', content: 'a' }],
    startOfDay(at(2026, 1, 15))
  );
  const message = items.find(
    (item): item is Extract<MessageListItem, { kind: 'message' }> => item.kind === 'message'
  );
  assert.ok(message);
  assert.equal(message.key, 'idx-0');
});
