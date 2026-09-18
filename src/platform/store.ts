/**
 * 平台存储实现 —— services 层唯一接触原生模块的地方。
 *
 * 这段逻辑原本散在 chat-storage.ts 里，19 处 `Platform.OS === 'web'` 把「会话怎么存」
 * 和「在哪个平台存」搅在一起，也让 services 层无法脱离原生桩运行。现在平台分支
 * 只剩文件末尾那一次选择。
 *
 * 硬约束：**两端的存储布局必须与改造前逐字一致**，否则老用户的会话会被读成空。
 * - 原生：`<documentDirectory>/settings.json`、`chats/<id>.json`、`drafts/<id>.txt`；
 *   密钥走 SecureStore 的 `ai_assistant_api_key` / `ai_assistant_model`。
 * - web：localStorage 的 `ai_assistant_settings`、`ai_assistant:chat:<id>`、
 *   `ai_assistant:draft:<id>`。
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { SecretStore, StorageBackend, TextFileStore } from '../services/key-value-store.ts';

const SETTINGS_PATH = 'settings.json';
const CHATS_DIR = 'chats/';
const DRAFTS_DIR = 'drafts/';
const JSON_EXT = '.json';
const TXT_EXT = '.txt';

// ---------------------------------------------------------------- web

const WEB_SETTINGS_KEY = 'ai_assistant_settings';
const WEB_CHAT_PREFIX = 'ai_assistant:chat:';
const WEB_DRAFT_PREFIX = 'ai_assistant:draft:';

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

/** 路径 → localStorage key。必须与改造前一致，否则等于把老数据丢掉 */
function webKeyFor(path: string): string {
  if (path === SETTINGS_PATH) return WEB_SETTINGS_KEY;
  if (path.startsWith(CHATS_DIR) && path.endsWith(JSON_EXT)) {
    return `${WEB_CHAT_PREFIX}${path.slice(CHATS_DIR.length, -JSON_EXT.length)}`;
  }
  if (path.startsWith(DRAFTS_DIR) && path.endsWith(TXT_EXT)) {
    return `${WEB_DRAFT_PREFIX}${path.slice(DRAFTS_DIR.length, -TXT_EXT.length)}`;
  }
  // 兜底：出现未知路径说明调用方写错了，但也不能静默丢数据
  return `ai_assistant:file:${path}`;
}

function webList(dir: string): string[] {
  const store = webStore();
  if (!store) return [];
  const known = [
    { dir: CHATS_DIR, prefix: WEB_CHAT_PREFIX, ext: JSON_EXT },
    { dir: DRAFTS_DIR, prefix: WEB_DRAFT_PREFIX, ext: TXT_EXT },
  ].find((entry) => entry.dir === dir);
  if (!known) return [];

  const paths: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(known.prefix)) {
      paths.push(`${dir}${key.slice(known.prefix.length)}${known.ext}`);
    }
  }
  return paths;
}

const webFiles: TextFileStore = {
  async read(path) {
    return webStore()?.getItem(webKeyFor(path)) ?? null;
  },
  async write(path, value) {
    webStore()?.setItem(webKeyFor(path), value);
  },
  async remove(path) {
    webStore()?.removeItem(webKeyFor(path));
  },
  async list(dir) {
    return webList(dir);
  },
};

const webSecrets: SecretStore = {
  async get(key) {
    return webStore()?.getItem(key) ?? null;
  },
  async set(key, value) {
    webStore()?.setItem(key, value);
  },
  async remove(key) {
    webStore()?.removeItem(key);
  },
};

// ---------------------------------------------------------------- 原生

/** 文档目录；取不到时退化成「读不到、写不进」，而不是抛错拖垮调用方 */
function nativeBase(): string | null {
  return FileSystem.documentDirectory ?? null;
}

const nativeFiles: TextFileStore = {
  async read(path) {
    const base = nativeBase();
    if (!base) return null;
    try {
      return await FileSystem.readAsStringAsync(`${base}${path}`);
    } catch {
      return null; // 文件不存在是常态
    }
  },
  async write(path, value) {
    const base = nativeBase();
    if (!base) return;
    // 只在有目录层级时建目录：settings.json 落在文档目录根部
    const slash = path.lastIndexOf('/');
    if (slash >= 0) {
      await FileSystem.makeDirectoryAsync(`${base}${path.slice(0, slash + 1)}`, {
        intermediates: true,
      });
    }
    await FileSystem.writeAsStringAsync(`${base}${path}`, value);
  },
  async remove(path) {
    const base = nativeBase();
    if (!base) return;
    try {
      await FileSystem.deleteAsync(`${base}${path}`, { idempotent: true });
    } catch {
      // 已经没了就算了
    }
  },
  async list(dir) {
    const base = nativeBase();
    if (!base) return [];
    try {
      const names = await FileSystem.readDirectoryAsync(`${base}${dir}`);
      return names.map((name) => `${dir}${name}`);
    } catch {
      return []; // 目录还不存在
    }
  },
};

const nativeSecrets: SecretStore = {
  async get(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      // 某些设备/模拟器上 SecureStore 不可用，不应因此卡死启动流程
      return null;
    }
  },
  async set(key, value) {
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key) {
    await SecureStore.deleteItemAsync(key);
  },
};

// ---------------------------------------------------------------- 选择

/** 全应用唯一一处平台分支：选完就不再判断 */
export const platformBackend: StorageBackend =
  Platform.OS === 'web'
    ? { files: webFiles, secrets: webSecrets }
    : { files: nativeFiles, secrets: nativeSecrets };
