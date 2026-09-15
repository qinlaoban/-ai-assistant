import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addUsage, isAbortError, ZERO_USAGE } from '../src/services/ai-service.ts';

/** 造一个指定 name/message 的错误，用来还原各平台抛出的真实形状 */
function errorLike(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

// ------------------------------------------------------------ 取消判定

test('isAbortError：Expo 原生 fetch 取消（线上实际遇到的形状）', () => {
  // Expo 的 FetchError 没有覆写 name，所以 name 是 'Error'，只认名字的判断会漏掉它
  const expoCancel = errorLike(
    'Error',
    'fetch failed: FetchRequestCanceledException: Fetch request has been canceled (at Expo/ NativeResponse.swift:63)'
  );
  assert.equal(isAbortError(expoCancel), true);
  assert.equal(isAbortError(errorLike('Error', 'fetch failed: The operation was aborted.')), true);
});

test('isAbortError：web 侧与标准 AbortError', () => {
  assert.equal(isAbortError(errorLike('AbortError', 'The user aborted a request.')), true);
  assert.equal(isAbortError(errorLike('CanceledError', 'canceled')), true);
});

test('isAbortError：signal 已 abort 时不再依赖错误形状', () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isAbortError(errorLike('Weird', 'something odd'), controller.signal), true);

  const idle = new AbortController();
  assert.equal(isAbortError(errorLike('Weird', 'something odd'), idle.signal), false);
});

test('isAbortError：真实错误绝不能被当成取消吞掉', () => {
  assert.equal(isAbortError(errorLike('AIError', 'API Key 无效或已过期（HTTP 401）')), false);
  assert.equal(isAbortError(errorLike('AIError', '请求过于频繁或额度不足（HTTP 429）')), false);
  assert.equal(
    isAbortError(errorLike('Error', 'fetch failed: The Internet connection appears to be offline.')),
    false
  );
  // 超时是真实失败，必须报给用户——这条对应线上遇到过的那个报错
  assert.equal(
    isAbortError(
      errorLike(
        'Error',
        'fetch failed: UnexpectedException: The request timed out. (at ExpoModulesCore/Promise.swift:56)'
      )
    ),
    false
  );
});

test('isAbortError：非 Error 值一律不算取消', () => {
  assert.equal(isAbortError('boom'), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError(undefined), false);
});

// ------------------------------------------------------------ 用量累加

test('addUsage：逐次累加', () => {
  const first = { promptTokens: 252, completionTokens: 301, totalTokens: 553 };
  const second = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };

  assert.deepEqual(addUsage(first, second), {
    promptTokens: 262,
    completionTokens: 321,
    totalTokens: 583,
  });
  assert.deepEqual(addUsage(ZERO_USAGE, first), first);
});
