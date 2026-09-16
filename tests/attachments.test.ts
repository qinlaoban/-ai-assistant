import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatMessage } from '../src/services/ai-service.ts';
import {
  attachDataUrls,
  clearAttachmentCache,
  createAttachmentId,
  guessImageMime,
  isTextLike,
  isWithinTextLimit,
  MAX_TEXT_FILE_BYTES,
} from '../src/services/attachments.ts';

test('createAttachmentId：格式含短横线且两次不同', () => {
  const a = createAttachmentId();
  const b = createAttachmentId();
  assert.match(a, /^[0-9a-z]+-[0-9a-z]+$/);
  assert.notEqual(a, b);
});

test('isTextLike：按扩展名判定（大小写不敏感）', () => {
  assert.equal(isTextLike('note.md'), true);
  assert.equal(isTextLike('data.JSON'), true);
  assert.equal(isTextLike('main.ts'), true);
  assert.equal(isTextLike('photo.png'), false);
  assert.equal(isTextLike('archive.zip'), false);
  assert.equal(isTextLike('no-extension'), false);
});

test('isTextLike：MIME 与扩展名任一命中即视为文本', () => {
  assert.equal(isTextLike('weird', 'text/plain'), true);
  assert.equal(isTextLike('weird', 'application/json'), true);
  assert.equal(isTextLike('weird', 'application/xml'), true);
  // 服务商给的 MIME 经常不可靠（.md 被报成 image/png 之类），扩展名能兜住用户真实意图
  assert.equal(isTextLike('note.md', 'image/png'), true);
  assert.equal(isTextLike('archive.zip', 'image/png'), false);
});

test('guessImageMime：选择器给了 image/* 就用它', () => {
  assert.equal(guessImageMime('file:///a.jpg', 'image/webp'), 'image/webp');
});

test('guessImageMime：没给 MIME 时按扩展名兜底，默认 jpeg', () => {
  assert.equal(guessImageMime('file:///a.png'), 'image/png');
  assert.equal(guessImageMime('file:///a.webp'), 'image/webp');
  assert.equal(guessImageMime('file:///a.heic'), 'image/heic');
  assert.equal(guessImageMime('file:///a.jpg'), 'image/jpeg');
  assert.equal(guessImageMime('file:///a.unknown'), 'image/jpeg');
});

test('guessImageMime：非图片 MIME 不被采信，仍按扩展名判断', () => {
  assert.equal(guessImageMime('file:///a.png', 'application/octet-stream'), 'image/png');
});

test('isWithinTextLimit：必须在「读文件之前」拦住超大文本，否则会先整份读进内存', () => {
  assert.equal(isWithinTextLimit(0), true);
  assert.equal(isWithinTextLimit(1024), true);
  assert.equal(isWithinTextLimit(MAX_TEXT_FILE_BYTES), true);
  assert.equal(isWithinTextLimit(MAX_TEXT_FILE_BYTES + 1), false);
});

test('isWithinTextLimit：拿不到体积时放行（交给读完之后的长度截断兜底）', () => {
  assert.equal(isWithinTextLimit(undefined), true);
});

// ------------------------------------------------------------ 请求期 data URL

test('attachDataUrls：没有待解析的图片时走快速路径，返回同一引用', async () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'hi' },
    {
      role: 'user',
      content: 'x',
      attachments: [
        { id: 'a1', kind: 'file', uri: 'file:///n.md', name: 'n.md', mimeType: 'text/markdown', text: 't' },
      ],
    },
  ];
  // 同一引用意味着列表不会因为这个调用白白重渲染一次
  assert.equal(await attachDataUrls(messages), messages);
});

test('attachDataUrls：读不到图片时跳过该图，不让整条消息失败', async () => {
  // Node 下 FileSystem 是桩，读取必然失败 —— 正好用来验证「静默跳过」而不是整单抛出
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: '看图',
      attachments: [
        { id: 'a1', kind: 'image', uri: 'file:///gone.jpg', name: 'gone.jpg', mimeType: 'image/jpeg' },
      ],
    },
  ];
  const result = await attachDataUrls(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, '看图');
  assert.equal(result[0].attachments?.[0].dataUrl, undefined);
  assert.equal(
    messages[0].attachments?.[0].dataUrl,
    undefined,
    '不能就地改动传入的消息（state 里永远不该出现 base64）'
  );
});

test('clearAttachmentCache：切换会话时释放 base64 缓存，可安全重复调用', () => {
  clearAttachmentCache();
  clearAttachmentCache();
});
