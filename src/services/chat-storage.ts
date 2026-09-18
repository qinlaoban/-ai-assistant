import {
  DEFAULT_GENERATION_SETTINGS,
  normalizeGenerationSettings,
  type GenerationSettings,
} from '../constants/chat-params.ts';
import type { ChatMessage, Usage } from './ai-service.ts';
import type { StorageBackend } from './key-value-store.ts';

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredChat extends ChatSummary {
  messages: ChatMessage[];
  /** 该会话的累计用量；旧文件没有这个字段，读取时视为未知 */
  usage?: Usage;
}

/**
 * 密钥的存储键名。原生端落在 SecureStore，web 端是 localStorage。
 * **不能改**：改了等于让老用户的 Key 「消失」。
 */
const KEY_API = 'ai_assistant_api_key';
const KEY_MODEL = 'ai_assistant_model';

/**
 * 其余数据都按「路径」存取，路径本身与平台无关：
 * 原生端就是文件树，web 端由 src/platform/store.ts 映射成扁平 key。
 */
const SETTINGS_PATH = 'settings.json';
const CHATS_DIR = 'chats/';
const DRAFTS_DIR = 'drafts/';
const CHAT_EXT = '.json';

const chatPath = (id: string): string => `${CHATS_DIR}${id}${CHAT_EXT}`;
const draftPath = (draftId: string): string => `${DRAFTS_DIR}${draftId}.txt`;

const EMPTY_TITLE = '新对话';
/** 重命名可以比自动标题长一些，但得挡住整段粘贴。输入框与存储层共用同一个上限 */
export const TITLE_MAX_LENGTH = 60;

let backend: StorageBackend | null = null;

/**
 * 注入存储后端。**只有测试会调用它**：给了后端，本模块就不会去动态加载
 * `src/platform/store.ts`，于是 Node 里跑测试时完全没有 react-native / expo-* 参与。
 */
export function setStorageBackend(next: StorageBackend): void {
  backend = next;
}

/**
 * 平台实现按需加载 —— 本模块的顶层 import 因此是纯的，测试可以先注入内存后端，
 * 原生模块永远不被触达。
 */
async function getBackend(): Promise<StorageBackend> {
  if (!backend) backend = (await import('../platform/store.ts')).platformBackend;
  return backend;
}

// ---------------------------------------------------------------- 会话

export function createChatId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 用首条用户消息生成标题 */
export function deriveTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return EMPTY_TITLE;
  return oneLine.length > 24 ? `${oneLine.slice(0, 24)}…` : oneLine;
}

export async function saveChat(chat: StoredChat): Promise<void> {
  try {
    const { files } = await getBackend();
    await files.write(chatPath(chat.id), JSON.stringify(chat));
  } catch (error) {
    console.warn('[chat-storage] 保存会话失败:', error);
  }
}

/** 用量只用于展示，但也不能让旧文件里的脏数据（NaN、对象）直接渲染出去 */
function sanitizeUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Partial<Record<keyof Usage, unknown>>;
  const promptTokens = typeof source.promptTokens === 'number' ? source.promptTokens : 0;
  const completionTokens =
    typeof source.completionTokens === 'number' ? source.completionTokens : 0;
  // total 缺失/非法时回退为前两者之和，与 ai-service 的 toUsage 保持一致；
  // 否则只存了 prompt/completion 的会话会在 UI 上显示 total=0
  const totalTokens =
    typeof source.totalTokens === 'number' ? source.totalTokens : promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

export async function loadChat(id: string): Promise<StoredChat | null> {
  const { files } = await getBackend();
  const raw = await files.read(chatPath(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredChat>;
    if (!Array.isArray(parsed.messages)) return null;
    const createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now();
    return {
      id,
      title: parsed.title || EMPTY_TITLE,
      createdAt,
      // 兼容旧版本没有 updatedAt 的文件
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : createdAt,
      messages: parsed.messages,
      usage: sanitizeUsage(parsed.usage),
    };
  } catch {
    return null; // 文件坏了，当作不存在
  }
}

export async function listChats(): Promise<ChatSummary[]> {
  const { files } = await getBackend();
  // 只看 .json：目录里混进别的文件不该把整个列表带崩
  const paths = (await files.list(CHATS_DIR)).filter((path) => path.endsWith(CHAT_EXT));

  // 并行读取：会话数多时，串行逐个 await 会把列表耗时累加成 Σ 每个文件的读取时间
  const raws = await Promise.all(paths.map((path) => files.read(path)));

  const chats: ChatSummary[] = [];
  raws.forEach((raw, index) => {
    if (!raw) return;
    // 路径 → id：chats/<id>.json 里掐掉目录前缀与扩展名
    const id = paths[index].slice(CHATS_DIR.length, -CHAT_EXT.length);
    try {
      const parsed = JSON.parse(raw) as Partial<StoredChat>;
      if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return;
      const createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now();
      chats.push({
        id,
        title: parsed.title || EMPTY_TITLE,
        createdAt,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : createdAt,
      });
    } catch {
      // 跳过坏文件，不要让一条坏数据拖垮整个列表
    }
  });
  return chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteChat(id: string): Promise<void> {
  const { files } = await getBackend();
  await files.remove(chatPath(id));
}

/**
 * 重命名会话。刻意不动 updatedAt：列表按「最后说话的时间」排序，
 * 只是改个名字就跳到最上面会很突兀。
 *
 * 返回新的摘要供 store 就地更新列表；会话不存在或标题为空时返回 null。
 */
export async function renameChat(id: string, title: string): Promise<ChatSummary | null> {
  const chat = await loadChat(id);
  if (!chat) return null;

  const clean = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH);
  if (clean.length === 0) return null;

  await saveChat({ ...chat, title: clean });
  return { id: chat.id, title: clean, createdAt: chat.createdAt, updatedAt: chat.updatedAt };
}

// ---------------------------------------------------------------- 配置

export async function getApiKey(): Promise<string | null> {
  try {
    const { secrets } = await getBackend();
    return await secrets.get(KEY_API);
  } catch {
    // 存储不可用（隐私模式 / SecureStore 故障）不该卡死启动流程
    return null;
  }
}

export async function saveApiKey(key: string): Promise<void> {
  const { secrets } = await getBackend();
  await secrets.set(KEY_API, key);
}

export async function clearApiKey(): Promise<void> {
  const { secrets } = await getBackend();
  await secrets.remove(KEY_API);
}

export async function getModel(): Promise<string | null> {
  try {
    const { secrets } = await getBackend();
    return await secrets.get(KEY_MODEL);
  } catch {
    return null;
  }
}

export async function saveModel(model: string): Promise<void> {
  const { secrets } = await getBackend();
  await secrets.set(KEY_MODEL, model);
}

// ---------------------------------------------------------------- 生成参数

/**
 * 生成参数与密钥分开存：SecureStore 单值上限约 2KB，装不下可能很长的系统提示词，
 * 而这里也没有敏感信息（密钥仍旧只存在 SecureStore 里）。
 *
 * 任何异常都收敛成默认值——启动期读配置失败不该拖垮应用。
 */
export async function getGenerationSettings(): Promise<GenerationSettings> {
  try {
    const { files } = await getBackend();
    const raw = await files.read(SETTINGS_PATH);
    if (!raw) return DEFAULT_GENERATION_SETTINGS;
    return normalizeGenerationSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_GENERATION_SETTINGS;
  }
}

/** 写生成参数；写入前先归一化，避免把越界数值落盘 */
export async function saveGenerationSettings(settings: GenerationSettings): Promise<void> {
  try {
    const { files } = await getBackend();
    await files.write(SETTINGS_PATH, JSON.stringify(normalizeGenerationSettings(settings)));
  } catch (error) {
    console.warn('[chat-storage] 保存生成参数失败:', error);
  }
}

// ---------------------------------------------------------------- 输入草稿

/** 还没落盘的新对话没有 id，用这个固定 key 暂存草稿 */
export const NEW_CHAT_DRAFT_ID = '__new__';

/** 读某条会话的输入草稿；没有则返回空串 */
export async function getDraft(draftId: string): Promise<string> {
  try {
    const { files } = await getBackend();
    return (await files.read(draftPath(draftId))) ?? '';
  } catch {
    return ''; // 没有草稿是常态
  }
}

/**
 * 写草稿。空串视为「没有草稿」，直接删文件 ——
 * 否则每发一次消息都会在磁盘上留下一个空文件。
 */
export async function saveDraft(draftId: string, text: string): Promise<void> {
  const { files } = await getBackend();
  if (text.length === 0) {
    await files.remove(draftPath(draftId));
    return;
  }
  try {
    await files.write(draftPath(draftId), text);
  } catch (error) {
    console.warn('[chat-storage] 保存草稿失败:', error);
  }
}

/** 发送后清掉草稿 */
export async function clearDraft(draftId: string): Promise<void> {
  const { files } = await getBackend();
  await files.remove(draftPath(draftId));
}
