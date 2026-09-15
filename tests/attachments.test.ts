import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createAttachmentId,
  guessImageMime,
  isTextLike,
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
