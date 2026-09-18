import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

import { DEFAULT_TRANSCRIPTION_MODEL } from '../src/constants/chat-params.ts';
import { MemoryFileStore, MemorySecretStore } from './_memory-stores.ts';

/**
 * chat-storage 已不依赖任何原生模块：它只认 TextFileStore / SecretStore 两个契约，
 * 平台实现（src/platform/store.ts）是在真正读写时才动态加载的。
 *
 * 所以这里注入内存后端就能覆盖完整的会话读写逻辑 —— 不再需要把 Platform.OS
 * 钉成 'web'，测到的也不再是「web 分支」，而是与平台无关的存储逻辑本身。
 */

const files = new MemoryFileStore();
const secrets = new MemorySecretStore();

const storage = await import('../src/services/chat-storage.ts');
storage.setStorageBackend({ files, secrets });

/** 某个会话在存储里的路径（原生端即 `chats/<id>.json`） */
const chatPath = (id: string): string => `chats/${id}.json`;

/**
 * 直接塞原始内容，用于构造坏文件 / 旧格式这类 saveChat 造不出来的数据。
 * 保留 `ai_assistant:chat:<id>` 这套调用方式只是为了不改动下面各处用例，
 * 底层落到上面注入的内存后端 —— web 端的 key 本来就是这个形状。
 */
const WEB_CHAT_PREFIX = 'ai_assistant:chat:';
const mem = {
  setItem(key: string, value: string): void {
    files.seed(chatPath(key.slice(WEB_CHAT_PREFIX.length)), value);
  },
};

beforeEach(() => {
  files.clear();
  secrets.clear();
});

// ------------------------------------------------------------ id / 标题

test('createChatId：格式含短横线且两次不同', () => {
  const a = storage.createChatId();
  const b = storage.createChatId();
  assert.match(a, /^[0-9a-z]+-[0-9a-z]+$/);
  assert.notEqual(a, b);
});

test('deriveTitle：空/纯空白回退「新对话」', () => {
  assert.equal(storage.deriveTitle(''), '新对话');
  assert.equal(storage.deriveTitle('   \n  '), '新对话');
});

test('deriveTitle：超过 24 字截断并加省略号', () => {
  const long = '一'.repeat(30);
  const title = storage.deriveTitle(long);
  assert.ok(title.endsWith('…'), '应以省略号结尾');
  assert.ok(title.length <= 25, `含省略号总长应 <= 25，实际 ${title.length}`);
});

test('deriveTitle：普通文本会收掉内部空白', () => {
  assert.equal(storage.deriveTitle('  hello   world  '), 'hello world');
});

// ------------------------------------------------------------ 保存 / 读取

test('saveChat + loadChat：消息与标题往返一致', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: '测试会话',
    createdAt: 1000,
    updatedAt: 2000,
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ],
  });
  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.equal(loaded.title, '测试会话');
  assert.equal(loaded.createdAt, 1000);
  assert.equal(loaded.updatedAt, 2000);
  assert.deepEqual(loaded.messages, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
});

test('loadChat：文件不存在返回 null', async () => {
  assert.equal(await storage.loadChat('no-such-id'), null);
});

test('saveChat + loadChat：消息的 createdAt / versions / activeVersion / quote 往返保留', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: 't',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { role: 'user', content: '问题', id: 'm1', createdAt: 111, quote: '被引用的上文' },
      {
        role: 'assistant',
        content: '新回答',
        id: 'm2',
        createdAt: 222,
        versions: ['旧回答', '新回答'],
        activeVersion: 1,
      },
    ],
  });

  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.deepEqual(loaded.messages, [
    { role: 'user', content: '问题', id: 'm1', createdAt: 111, quote: '被引用的上文' },
    {
      role: 'assistant',
      content: '新回答',
      id: 'm2',
      createdAt: 222,
      versions: ['旧回答', '新回答'],
      activeVersion: 1,
    },
  ]);
});

test('saveChat + loadChat：附件字段往返保留', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        role: 'user',
        content: '',
        id: 'm1',
        attachments: [
          {
            id: 'a1',
            kind: 'file',
            uri: 'file:///note.md',
            name: 'note.md',
            mimeType: 'text/markdown',
            size: 12,
            text: '# 标题',
          },
          {
            id: 'a2',
            kind: 'image',
            uri: 'file:///attachments/a2.jpg',
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
          },
        ],
      },
    ],
  });

  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.deepEqual(loaded.messages[0].attachments, [
    {
      id: 'a1',
      kind: 'file',
      uri: 'file:///note.md',
      name: 'note.md',
      mimeType: 'text/markdown',
      size: 12,
      text: '# 标题',
    },
    {
      id: 'a2',
      kind: 'image',
      uri: 'file:///attachments/a2.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
    },
  ]);
});

test('loadChat：旧消息没有新字段时原样加载，不被补默认值', async () => {
  const id = storage.createChatId();
  mem.setItem(
    WEB_CHAT_PREFIX + id,
    JSON.stringify({
      title: '旧',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'a' }],
    })
  );
  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.deepEqual(loaded.messages, [{ role: 'user', content: 'a' }]);
  assert.equal(loaded.messages[0].createdAt, undefined);
  assert.equal(loaded.messages[0].versions, undefined);
  assert.equal(loaded.messages[0].quote, undefined);
});

test('loadChat：坏 JSON 返回 null（不抛）', async () => {
  mem.setItem(WEB_CHAT_PREFIX + 'broken', '{这不是合法 json');
  assert.equal(await storage.loadChat('broken'), null);
});

test('loadChat：messages 不是数组返回 null', async () => {
  mem.setItem(WEB_CHAT_PREFIX + 'nomsg', JSON.stringify({ title: 'x', messages: 'nope' }));
  assert.equal(await storage.loadChat('nomsg'), null);
});

test('saveChat：消息被删空后写盘，读回空数组且不再进列表（删除不会被撤销）', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ role: 'user', content: 'a' }],
  });
  // 删掉最后一条消息后必须再写一次，否则磁盘仍是旧内容，刷新会把消息读回来
  await storage.saveChat({ id, title: 't', createdAt: 1, updatedAt: 2, messages: [] });

  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.deepEqual(loaded.messages, []);

  const list = await storage.listChats();
  assert.ok(
    !list.some((chat) => chat.id === id),
    '空消息会话只在文件里，不该出现在列表'
  );
});

test('loadChat：旧格式没有 updatedAt 时回落为 createdAt', async () => {
  const id = storage.createChatId();
  mem.setItem(
    WEB_CHAT_PREFIX + id,
    JSON.stringify({ title: '旧', createdAt: 123, messages: [{ role: 'user', content: 'a' }] })
  );
  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.equal(loaded.updatedAt, 123);
});

// ------------------------------------------------------------ 用量收敛

test('sanitizeUsage：三个字段全 0 时落盘后读取为 undefined', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ role: 'user', content: 'a' }],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  });
  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.equal(loaded.usage, undefined);
});

test('sanitizeUsage：正常用量原样保留', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ role: 'user', content: 'a' }],
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
  });
  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.deepEqual(loaded.usage, { promptTokens: 5, completionTokens: 3, totalTokens: 8 });
});

test('sanitizeUsage：NaN / 对象字段被收敛为 0，且 total 由前两者算出', async () => {
  const id = storage.createChatId();
  mem.setItem(
    WEB_CHAT_PREFIX + id,
    JSON.stringify({
      title: 't',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'a' }],
      // promptTokens 合法；另两个是脏数据，应被收敛为 0，total 回退为 prompt+completion
      usage: { promptTokens: 5, completionTokens: { bad: 1 }, totalTokens: 'x' },
    })
  );
  const loaded = await storage.loadChat(id);
  assert.ok(loaded);
  assert.deepEqual(loaded.usage, { promptTokens: 5, completionTokens: 0, totalTokens: 5 });
});

// ------------------------------------------------------------ 列表

test('listChats：按 updatedAt 降序、空消息会话被过滤', async () => {
  const old = storage.createChatId();
  const recent = storage.createChatId();
  await storage.saveChat({
    id: old,
    title: '旧',
    createdAt: 1,
    updatedAt: 100,
    messages: [{ role: 'user', content: 'a' }],
  });
  await storage.saveChat({
    id: recent,
    title: '新',
    createdAt: 2,
    updatedAt: 200,
    messages: [{ role: 'user', content: 'b' }],
  });
  // 一条没有消息的会话：列出来时应被跳过
  mem.setItem(WEB_CHAT_PREFIX + 'empty', JSON.stringify({ title: '空', createdAt: 3, updatedAt: 300, messages: [] }));
  // 一条坏文件：不应拖垮整个列表
  mem.setItem(WEB_CHAT_PREFIX + 'bad', '{坏');

  const list = await storage.listChats();
  assert.deepEqual(
    list.map((c) => c.id),
    [recent, old],
    '应只列出两条有消息的，且按更新时间降序'
  );
});

// ------------------------------------------------------------ 重命名

test('renameChat：空标题 / 纯空白返回 null', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: '原',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ role: 'user', content: 'a' }],
  });
  assert.equal(await storage.renameChat(id, ''), null);
  assert.equal(await storage.renameChat(id, '   '), null);
});

test('renameChat：超长标题截断到上限', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: '原',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ role: 'user', content: 'a' }],
  });
  const renamed = await storage.renameChat(id, 'x'.repeat(200));
  assert.ok(renamed);
  assert.ok(renamed.title.length <= storage.TITLE_MAX_LENGTH);
});

test('renameChat：内部空白收成单空格', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: '原',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ role: 'user', content: 'a' }],
  });
  const renamed = await storage.renameChat(id, 'a   b\tc');
  assert.ok(renamed);
  assert.equal(renamed.title, 'a b c');
});

test('renameChat：不改动 updatedAt（列表顺序不跳变）', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: '原',
    createdAt: 1,
    updatedAt: 42,
    messages: [{ role: 'user', content: 'a' }],
  });
  const renamed = await storage.renameChat(id, '新名字');
  assert.ok(renamed);
  assert.equal(renamed.updatedAt, 42, '重命名不应改变 updatedAt');
  const list = await storage.listChats();
  assert.equal(list[0].updatedAt, 42);
});

test('renameChat：不存在的会话返回 null', async () => {
  assert.equal(await storage.renameChat('ghost', 'x'), null);
});

test('deleteChat：删除后列表里不再出现', async () => {
  const id = storage.createChatId();
  await storage.saveChat({
    id,
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ role: 'user', content: 'a' }],
  });
  await storage.deleteChat(id);
  const list = await storage.listChats();
  assert.ok(!list.some((c) => c.id === id));
});

// ------------------------------------------------------------ 配置

test('API Key：保存 / 读取 / 清除往返', async () => {
  await storage.saveApiKey('sk-test');
  assert.equal(await storage.getApiKey(), 'sk-test');
  await storage.clearApiKey();
  assert.equal(await storage.getApiKey(), null);
});

test('生成参数：保存后读取经过归一化', async () => {
  await storage.saveGenerationSettings({
    apiBaseUrl: 'https://api.xiaomimimo.com/',
    systemPrompt: 'x'.repeat(9999),
    temperature: 9,
    maxTokens: -3,
    transcriptionModel: '   ',
  });
  const settings = await storage.getGenerationSettings();
  // 地址补 /v1、温度钳到上限、长度负数回 0、提示词截断到 4000
  assert.equal(settings.apiBaseUrl, 'https://api.xiaomimimo.com/v1');
  assert.equal(settings.temperature, 1.5);
  assert.equal(settings.maxTokens, 0);
  assert.equal(settings.systemPrompt.length, 4000);
  // 纯空白的转写模型回退默认，而不是留一个空串去请求
  assert.equal(settings.transcriptionModel, DEFAULT_TRANSCRIPTION_MODEL);
});
