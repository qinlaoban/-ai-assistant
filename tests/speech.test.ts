import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toSpeechText } from '../src/services/speech.ts';

test('toSpeechText：去掉强调记号', () => {
  assert.equal(toSpeechText('**粗体**'), '粗体');
  assert.equal(toSpeechText('__粗体__'), '粗体');
  assert.equal(toSpeechText('*斜体*'), '斜体');
  assert.equal(toSpeechText('~~删除~~'), '删除');
});

test('toSpeechText：去掉标题 / 引用 / 列表 / 分隔线记号', () => {
  assert.equal(toSpeechText('# 标题'), '标题');
  assert.equal(toSpeechText('## 二级'), '二级');
  assert.equal(toSpeechText('> 引用'), '引用');
  assert.equal(toSpeechText('- 项目'), '项目');
  assert.equal(toSpeechText('1. 第一'), '第一');
  assert.equal(toSpeechText('---'), '');
});

test('toSpeechText：链接留文字、图片换占位词', () => {
  assert.equal(toSpeechText('[链接](https://example.com)'), '链接');
  assert.equal(toSpeechText('![图](https://example.com/a.png)'), '（图片）');
});

test('toSpeechText：行内代码去反引号，围栏代码块整体替换', () => {
  assert.equal(toSpeechText('`const a = 1`'), 'const a = 1');
  assert.equal(toSpeechText('```js\nconst a = 1;\n```'), '（代码块）');
});

test('toSpeechText：表格竖线换成空格，避免念出「竖线」', () => {
  assert.equal(toSpeechText('a | b'), 'a   b');
});

test('toSpeechText：空串与纯空白返回空串', () => {
  assert.equal(toSpeechText(''), '');
  assert.equal(toSpeechText('   \n\n  '), '');
});
