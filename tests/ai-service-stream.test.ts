import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

import {
  AIError,
  DEFAULT_MODEL,
  sendMessageStream,
  type ChatMessage,
} from '../src/services/ai-service.ts';

const SAMPLE: ChatMessage[] = [{ role: 'user', content: '你好' }];

/** 造一个 SSE 响应：每段以空行分隔，模拟真实流式块。 */
function sseResponse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

/** 记录每次请求的 url 与已解析的 body，方便断言请求体构造。 */
let fetchCalls: { url: string; body: Record<string, unknown> }[] = [];

function installFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    fetchCalls.push({
      url: String(url),
      body: bodyText.length > 0 ? (JSON.parse(bodyText) as Record<string, unknown>) : {},
    });
    return handler(String(url), init as RequestInit);
  }) as typeof globalThis.fetch;
}

beforeEach(() => {
  fetchCalls = [];
});

// ------------------------------------------------------------ delta 解析

test('流式：多段 SSE delta 被增量回调并拼成完整文本', async () => {
  installFetch(() =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ])
  );
  const deltas: string[] = [];
  const text = await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, {
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(text, '你好');
  assert.equal(deltas.join(''), '你好');
});

test('流式：一个事件块内多行 data: 累加进同一增量', async () => {
  installFetch(() =>
    sseResponse(['data: {"choices":[{"delta":{"content":"A"}}]}\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\n'])
  );
  const text = await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} });
  assert.equal(text, 'AB');
});

test('流式：半条坏 JSON 行被丢弃、正常行照常产出', async () => {
  installFetch(() =>
    sseResponse([
      'data: {这不是合法 json\n',
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ])
  );
  const text = await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} });
  assert.equal(text, 'hi');
});

test('流式：孤立的 [DONE] 不产生任何内容', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  const text = await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} });
  assert.equal(text, '');
});

test('流式：[DONE] 只是空标记，不截断流（真实服务端只在末尾发它）', async () => {
  installFetch(() =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
    ])
  );
  const text = await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} });
  assert.equal(text, 'ab');
});

// ------------------------------------------------------------ usage 解析

test('流式：usage 单独成块也回传（choices 为空）', async () => {
  installFetch(() =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ])
  );
  let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, {
    onDelta: () => {},
    onUsage: (u) => {
      usage = u;
    },
  });
  assert.deepEqual(usage, { promptTokens: 3, completionTokens: 2, totalTokens: 5 });
});

test('流式：usage 字段缺失时不回调 onUsage', async () => {
  installFetch(() =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ])
  );
  let called = false;
  await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, {
    onDelta: () => {},
    onUsage: () => {
      called = true;
    },
  });
  assert.equal(called, false);
});

test('流式：usage 只有部分字段时补零并把 total 算出来', async () => {
  installFetch(() =>
    sseResponse([
      'data: {"choices":[],"usage":{"prompt_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ])
  );
  let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, {
    onDelta: () => {},
    onUsage: (u) => {
      usage = u;
    },
  });
  assert.deepEqual(usage, { promptTokens: 7, completionTokens: 0, totalTokens: 7 });
});

// ------------------------------------------------------------ 请求体构造

test('请求体：设置了才下发 temperature / max_completion_tokens / system', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(
    SAMPLE,
    {
      model: DEFAULT_MODEL,
      apiKey: 'k',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: '你是助手',
      baseUrl: 'https://api.openai.com',
    },
    { onDelta: () => {} }
  );
  const body = fetchCalls[0].body;
  assert.equal(body.model, DEFAULT_MODEL);
  assert.ok(body.stream_options, '默认就该带 stream_options 以拿 usage');
  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_completion_tokens, 1024);
  const messages = body.messages as { role: string; content: string }[];
  assert.deepEqual(messages[0], { role: 'system', content: '你是助手' });
  assert.deepEqual(messages[1], { role: 'user', content: '你好' });
});

test('请求体：默认配置不下发 temperature / max_completion_tokens / system', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} });
  const body = fetchCalls[0].body;
  assert.equal(body.temperature, undefined);
  assert.equal(body.max_completion_tokens, undefined);
  assert.ok(
    !(body.messages as { role: string }[]).some((m) => m.role === 'system')
  );
});

test('请求体：接口地址被归一化到 /v1 再拼 /chat/completions', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k', baseUrl: 'https://api.openai.com' }, {
    onDelta: () => {},
  });
  assert.equal(fetchCalls[0].url, 'https://api.openai.com/v1/chat/completions');
});

test('请求体：引用被折进正文，本地字段（id/createdAt/versions/quote）一律不下发', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(
    [
      {
        role: 'user',
        content: '接着讲',
        id: 'local-1',
        createdAt: 111,
        quote: '上文第一行\n上文第二行',
      },
      {
        role: 'assistant',
        content: '好的',
        id: 'local-2',
        createdAt: 222,
        versions: ['旧版本', '好的'],
        activeVersion: 1,
      },
    ],
    { model: DEFAULT_MODEL, apiKey: 'k' },
    { onDelta: () => {} }
  );

  // deepEqual 同时对「取值」与「没有多余字段」做断言
  assert.deepEqual(fetchCalls[0].body.messages, [
    { role: 'user', content: '> 上文第一行\n> 上文第二行\n\n接着讲' },
    { role: 'assistant', content: '好的' },
  ]);
});

test('请求体：没有引用时正文原样下发', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(
    [{ role: 'user', content: '你好', id: 'local-1', createdAt: 1, quote: '   ' }],
    { model: DEFAULT_MODEL, apiKey: 'k' },
    { onDelta: () => {} }
  );
  assert.deepEqual(fetchCalls[0].body.messages, [{ role: 'user', content: '你好' }]);
});

// ------------------------------------------------------------ 多模态附件

test('请求体：带图片附件时 content 升级成「文本 + 图片」片段数组', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(
    [
      {
        role: 'user',
        content: '这张图是什么？',
        attachments: [
          {
            id: 'a1',
            kind: 'image',
            uri: 'file:///photo.jpg',
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            dataUrl: 'data:image/jpeg;base64,AAA',
          },
        ],
      },
    ],
    { model: DEFAULT_MODEL, apiKey: 'k' },
    { onDelta: () => {} }
  );

  assert.deepEqual(fetchCalls[0].body.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: '这张图是什么？' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
      ],
    },
  ]);
});

test('请求体：图片没有 dataUrl（例如文件已被清理）时跳过，正文仍是纯字符串', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(
    [
      {
        role: 'user',
        content: '你好',
        attachments: [
          { id: 'a1', kind: 'image', uri: 'file:///gone.jpg', name: 'gone.jpg', mimeType: 'image/jpeg' },
        ],
      },
    ],
    { model: DEFAULT_MODEL, apiKey: 'k' },
    { onDelta: () => {} }
  );

  assert.deepEqual(fetchCalls[0].body.messages, [{ role: 'user', content: '你好' }]);
});

test('请求体：文本类附件的内容被内联进正文，且附件字段本身不下发', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(
    [
      {
        role: 'user',
        content: '看下这个文件',
        attachments: [
          {
            id: 'a1',
            kind: 'file',
            uri: 'file:///note.md',
            name: 'note.md',
            mimeType: 'text/markdown',
            text: '# 标题',
          },
        ],
      },
    ],
    { model: DEFAULT_MODEL, apiKey: 'k' },
    { onDelta: () => {} }
  );

  assert.deepEqual(fetchCalls[0].body.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: '看下这个文件\n\n【附件：note.md】\n# 标题' },
      ],
    },
  ]);
});

test('请求体：引用与图片同时存在时，引用折进文本片段', async () => {
  installFetch(() => sseResponse(['data: [DONE]\n\n']));
  await sendMessageStream(
    [
      {
        role: 'user',
        content: '照这个改',
        quote: '原文',
        attachments: [
          {
            id: 'a1',
            kind: 'image',
            uri: 'file:///p.png',
            name: 'p.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,BBB',
          },
        ],
      },
    ],
    { model: DEFAULT_MODEL, apiKey: 'k' },
    { onDelta: () => {} }
  );

  assert.deepEqual(fetchCalls[0].body.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: '> 原文\n\n照这个改' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } },
      ],
    },
  ]);
});

// ------------------------------------------------------------ 适配层重试

test('stream_options 被 400 时摘掉重发一次', async () => {
  let n = 0;
  installFetch(() => {
    n += 1;
    if (n === 1) {
      return new Response(JSON.stringify({ error: { message: 'stream_options not supported' } }), {
        status: 400,
      });
    }
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  });
  const text = await sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} });
  assert.equal(fetchCalls.length, 2, '应原样重发一次');
  assert.ok((fetchCalls[0].body as { stream_options?: unknown }).stream_options, '第一次带 stream_options');
  assert.equal(
    (fetchCalls[1].body as { stream_options?: unknown }).stream_options,
    undefined,
    '重试不带 stream_options'
  );
  assert.equal(text, 'ok');
});

test('400 但非 stream_options 原因时直接抛 AIError', async () => {
  installFetch(() =>
    new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 400 })
  );
  await assert.rejects(
    () => sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} }),
    (err: unknown) => err instanceof AIError && /model not found/.test((err as Error).message)
  );
});

// ------------------------------------------------------------ 传输层错误翻译

test('传输层：超时翻译成人话，且不被当成取消吞掉', async () => {
  installFetch(() => {
    throw new Error(
      'fetch failed: UnexpectedException: The request timed out. (at ExpoModulesCore/Promise.swift:56)'
    );
  });
  await assert.rejects(
    () => sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} }),
    (err: unknown) => err instanceof AIError && /超时/.test((err as Error).message)
  );
});

test('传输层：离线翻译', async () => {
  installFetch(() => {
    throw new Error('fetch failed: The Internet connection appears to be offline.');
  });
  await assert.rejects(
    () => sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} }),
    (err: unknown) => err instanceof AIError && /网络不可用/.test((err as Error).message)
  );
});

test('传输层：DNS 解析失败翻译并带上主机名', async () => {
  installFetch(() => {
    throw new Error('fetch failed: Could not resolve host: api.xiaomimimo.com');
  });
  await assert.rejects(
    () =>
      sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k', baseUrl: 'https://api.xiaomimimo.com' }, {
        onDelta: () => {},
      }),
    (err: unknown) =>
      err instanceof AIError &&
      /无法解析/.test((err as Error).message) &&
      (err as Error).message.includes('api.xiaomimimo.com')
  );
});

test('传输层：TLS/证书类错误翻译', async () => {
  installFetch(() => {
    throw new Error('fetch failed: The certificate for this server is invalid.');
  });
  await assert.rejects(
    () => sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} }),
    (err: unknown) => err instanceof AIError && /安全连接/.test((err as Error).message)
  );
});

// ------------------------------------------------------------ 取消归一化

test('已 abort 的 signal 归一成 AbortError（name 为 AbortError）', async () => {
  const controller = new AbortController();
  controller.abort();
  installFetch(() => {
    throw new Error('The operation was aborted.');
  });
  await assert.rejects(
    () => sendMessageStream(SAMPLE, { model: DEFAULT_MODEL, apiKey: 'k' }, { onDelta: () => {} }, controller.signal),
    (err: unknown) => err instanceof Error && err.name === 'AbortError'
  );
});
