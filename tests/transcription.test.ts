import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

import { AIError } from '../src/services/ai-service.ts';
import { transcribeAudio } from '../src/services/transcription.ts';

type Call = { url: string; method?: string; headers?: HeadersInit | undefined };

let calls: Call[] = [];

function installFetch(handler: (url: string) => Response): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method, headers: init?.headers });
    return handler(String(url));
  }) as typeof globalThis.fetch;
}

/** 最后一次 fetch 才是转写请求：web 分支会先 fetch 一次 uri 取 Blob */
function lastCall(): Call {
  const last = calls[calls.length - 1];
  assert.ok(last, '应当至少发过一次请求');
  return last;
}

beforeEach(() => {
  calls = [];
});

test('transcribeAudio：地址归一化到 /audio/transcriptions 并带上鉴权头', async () => {
  installFetch(() => new Response(JSON.stringify({ text: '你好' }), { status: 200 }));

  const text = await transcribeAudio('file:///speech.m4a', {
    apiKey: 'sk-x',
    model: 'whisper-1',
    baseUrl: 'https://api.openai.com',
  });

  assert.equal(text, '你好');
  assert.equal(lastCall().url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(lastCall().method, 'POST');
  assert.equal((lastCall().headers as Record<string, string>).Authorization, 'Bearer sk-x');
});

test('transcribeAudio：404 且服务端没给文案时，提示「该地址不支持语音转写」', async () => {
  // 服务端自己给了 error.message 时优先用它的（与 ai-service 的策略一致），
  // 所以这里用没有 JSON 体的 404 来验证兜底文案
  installFetch(() => new Response('Not Found', { status: 404 }));

  await assert.rejects(
    () => transcribeAudio('file:///speech.m4a', { apiKey: 'sk-x', model: 'whisper-1' }),
    (err: unknown) => err instanceof AIError && /不支持语音转写/.test((err as Error).message)
  );
});

test('transcribeAudio：返回体没有 text 时报错，而不是当成功返回空串', async () => {
  installFetch(() => new Response(JSON.stringify({}), { status: 200 }));

  await assert.rejects(
    () => transcribeAudio('file:///speech.m4a', { apiKey: 'sk-x', model: 'whisper-1' }),
    (err: unknown) => err instanceof AIError && /没有返回文本/.test((err as Error).message)
  );
});

test('transcribeAudio：服务端错误文案原样透出', async () => {
  installFetch(
    () => new Response(JSON.stringify({ error: { message: '模型不存在' } }), { status: 400 })
  );

  await assert.rejects(
    () => transcribeAudio('file:///speech.m4a', { apiKey: 'sk-x', model: 'whisper-1' }),
    (err: unknown) => err instanceof AIError && /模型不存在/.test((err as Error).message)
  );
});

test('transcribeAudio：没有 API Key 时直接拦下，不发请求', async () => {
  installFetch(() => new Response(JSON.stringify({ text: 'x' }), { status: 200 }));

  await assert.rejects(
    () => transcribeAudio('file:///speech.m4a', { apiKey: '', model: 'whisper-1' }),
    (err: unknown) => err instanceof AIError && /API Key/.test((err as Error).message)
  );
  assert.equal(calls.length, 0, '不该发出任何请求');
});
