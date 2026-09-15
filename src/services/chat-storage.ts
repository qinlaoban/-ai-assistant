import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  DEFAULT_GENERATION_SETTINGS,
  normalizeGenerationSettings,
  type GenerationSettings,
} from '../constants/chat-params';
import type { ChatMessage, Usage } from './ai-service';

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

const KEY_API = 'ai_assistant_api_key';
const KEY_MODEL = 'ai_assistant_model';
/** 生成参数的存储键：原生端是 settings.json，web 端是 localStorage 的这个 key */
const KEY_SETTINGS = 'ai_assistant_settings';
const WEB_CHAT_PREFIX = 'ai_assistant:chat:';
const EMPTY_TITLE = '新对话';
/** 重命名可以比自动标题长一些，但得挡住整段粘贴。输入框与存储层共用同一个上限 */
export const TITLE_MAX_LENGTH = 60;

/**
 * web 静态导出（`output: "static"`）会在 Node 里预渲染，那时没有 window；
 * 隐私模式下访问 localStorage 也会抛错。所以必须惰性取、取不到就降级。
 */
function webStore(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 原生端文档目录；web 上 documentDirectory 为 null */
const nativeChatDir =
  Platform.OS === 'web' || !FileSystem.documentDirectory
    ? null
    : `${FileSystem.documentDirectory}chats/`;

/**
 * 生成参数单独落一个文件，不进 SecureStore：
 * SecureStore 单值上限约 2KB，装不下可能很长的系统提示词，而这里也没有敏感信息
 * （API Key 仍旧只存在 SecureStore 里）。
 */
const nativeSettingsUri =
  Platform.OS === 'web' || !FileSystem.documentDirectory
    ? null
    : `${FileSystem.documentDirectory}settings.json`;

// ---------------------------------------------------------------- 底层读写

async function readRaw(id: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webStore()?.getItem(WEB_CHAT_PREFIX + id) ?? null;
  }
  if (!nativeChatDir) return null;
  try {
    return await FileSystem.readAsStringAsync(`${nativeChatDir}${id}.json`);
  } catch {
    return null; // 文件不存在
  }
}

async function writeRaw(id: string, json: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.setItem(WEB_CHAT_PREFIX + id, json);
    return;
  }
  if (!nativeChatDir) return;
  await FileSystem.makeDirectoryAsync(nativeChatDir, { intermediates: true });
  await FileSystem.writeAsStringAsync(`${nativeChatDir}${id}.json`, json);
}

async function removeRaw(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.removeItem(WEB_CHAT_PREFIX + id);
    return;
  }
  if (!nativeChatDir) return;
  try {
    await FileSystem.deleteAsync(`${nativeChatDir}${id}.json`, { idempotent: true });
  } catch {
    // 已经没了就算了
  }
}

async function listRawIds(): Promise<string[]> {
  if (Platform.OS === 'web') {
    const ls = webStore();
    if (!ls) return [];
    const ids: string[] = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (key && key.startsWith(WEB_CHAT_PREFIX)) {
        ids.push(key.slice(WEB_CHAT_PREFIX.length));
      }
    }
    return ids;
  }
  if (!nativeChatDir) return [];
  try {
    const files = await FileSystem.readDirectoryAsync(nativeChatDir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
  } catch {
    return []; // 目录还不存在
  }
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
    await writeRaw(chat.id, JSON.stringify(chat));
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
  const raw = await readRaw(id);
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
  const ids = await listRawIds();
  // 并行读取：会话数多时，串行逐个 await 会把列表耗时累加成 Σ 每个文件的读取时间
  const raws = await Promise.all(ids.map((id) => readRaw(id)));
  const chats: ChatSummary[] = [];
  raws.forEach((raw, index) => {
    if (!raw) return;
    const id = ids[index];
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
  await removeRaw(id);
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
  if (Platform.OS === 'web') return webStore()?.getItem(KEY_API) ?? null;
  try {
    return await SecureStore.getItemAsync(KEY_API);
  } catch {
    // 某些设备/模拟器上 SecureStore 不可用，不应因此卡死启动流程
    return null;
  }
}

export async function saveApiKey(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.setItem(KEY_API, key);
    return;
  }
  await SecureStore.setItemAsync(KEY_API, key);
}

export async function clearApiKey(): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.removeItem(KEY_API);
    return;
  }
  await SecureStore.deleteItemAsync(KEY_API);
}

export async function getModel(): Promise<string | null> {
  if (Platform.OS === 'web') return webStore()?.getItem(KEY_MODEL) ?? null;
  try {
    return await SecureStore.getItemAsync(KEY_MODEL);
  } catch {
    return null;
  }
}

export async function saveModel(model: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.setItem(KEY_MODEL, model);
    return;
  }
  await SecureStore.setItemAsync(KEY_MODEL, model);
}

// ---------------------------------------------------------------- 生成参数

async function readSettingsRaw(): Promise<string | null> {
  if (Platform.OS === 'web') return webStore()?.getItem(KEY_SETTINGS) ?? null;
  if (!nativeSettingsUri) return null;
  try {
    return await FileSystem.readAsStringAsync(nativeSettingsUri);
  } catch {
    return null; // 文件还不存在，属正常情况
  }
}

async function writeSettingsRaw(json: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.setItem(KEY_SETTINGS, json);
    return;
  }
  if (!nativeSettingsUri) return;
  await FileSystem.writeAsStringAsync(nativeSettingsUri, json);
}

/** 读生成参数。任何异常都收敛成默认值——启动期读配置失败不该拖垮应用 */
export async function getGenerationSettings(): Promise<GenerationSettings> {
  const raw = await readSettingsRaw();
  if (!raw) return DEFAULT_GENERATION_SETTINGS;
  try {
    return normalizeGenerationSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_GENERATION_SETTINGS;
  }
}

/** 写生成参数；写入前先归一化，避免把越界数值落盘 */
export async function saveGenerationSettings(settings: GenerationSettings): Promise<void> {
  try {
    await writeSettingsRaw(JSON.stringify(normalizeGenerationSettings(settings)));
  } catch (error) {
    console.warn('[chat-storage] 保存生成参数失败:', error);
  }
}

// ---------------------------------------------------------------- 输入草稿

/** 还没落盘的新对话没有 id，用这个固定 key 暂存草稿 */
export const NEW_CHAT_DRAFT_ID = '__new__';

const KEY_DRAFT_PREFIX = 'ai_assistant:draft:';

/** 草稿目录：与 chats/ 平级，一个会话一个纯文本文件 */
const nativeDraftDir =
  Platform.OS === 'web' || !FileSystem.documentDirectory
    ? null
    : `${FileSystem.documentDirectory}drafts/`;

async function readDraftRaw(draftId: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webStore()?.getItem(KEY_DRAFT_PREFIX + draftId) ?? null;
  }
  if (!nativeDraftDir) return null;
  try {
    return await FileSystem.readAsStringAsync(`${nativeDraftDir}${draftId}.txt`);
  } catch {
    return null; // 没有草稿是常态
  }
}

async function writeDraftRaw(draftId: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.setItem(KEY_DRAFT_PREFIX + draftId, text);
    return;
  }
  if (!nativeDraftDir) return;
  await FileSystem.makeDirectoryAsync(nativeDraftDir, { intermediates: true });
  await FileSystem.writeAsStringAsync(`${nativeDraftDir}${draftId}.txt`, text);
}

async function removeDraftRaw(draftId: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.removeItem(KEY_DRAFT_PREFIX + draftId);
    return;
  }
  if (!nativeDraftDir) return;
  try {
    await FileSystem.deleteAsync(`${nativeDraftDir}${draftId}.txt`, { idempotent: true });
  } catch {
    // 已经没了就算了
  }
}

/** 读某条会话的输入草稿；没有则返回空串 */
export async function getDraft(draftId: string): Promise<string> {
  return (await readDraftRaw(draftId)) ?? '';
}

/**
 * 写草稿。空串视为「没有草稿」，直接删文件 ——
 * 否则每发一次消息都会在磁盘上留下一个空文件。
 */
export async function saveDraft(draftId: string, text: string): Promise<void> {
  if (text.length === 0) {
    await removeDraftRaw(draftId);
    return;
  }
  try {
    await writeDraftRaw(draftId, text);
  } catch (error) {
    console.warn('[chat-storage] 保存草稿失败:', error);
  }
}

/** 发送后清掉草稿 */
export async function clearDraft(draftId: string): Promise<void> {
  await removeDraftRaw(draftId);
}
