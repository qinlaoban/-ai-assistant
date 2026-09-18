/**
 * 存储后端的契约。
 *
 * 刻意只描述「文件」与「密钥」两件事，不出现任何平台概念：
 * - 原生端是 expo-file-system 的真实文件 + expo-secure-store 的密钥；
 * - web 端是 localStorage 上的两套 key 前缀。
 *
 * 谁来实现由 `src/platform/store.ts` 决定。本文件与 chat-storage 都不 import 原生模块，
 * 因此可以在 Node 里直接加载并单测（见 AGENTS.md「可测试层的写法」）。
 */

/**
 * 按「路径」存取文本。
 *
 * 用路径而不是扁平 key，是因为原生端本来就是文件树（`chats/x.json`、`drafts/x.txt`、
 * `settings.json`），web 端只是把这套路径映射成 key 前缀。这样 chat-storage 描述的是
 * 存储结构本身，不必知道自己在哪个平台上跑。
 */
export interface TextFileStore {
  read(path: string): Promise<string | null>;
  write(path: string, value: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** 列出 dir 下的路径（返回值同样带 dir 前缀）；目录不存在时返回空数组 */
  list(dir: string): Promise<string[]>;
}

/**
 * 密钥存储。
 *
 * 单独一个接口而不是复用 TextFileStore：原生端它落在 SecureStore —— 没有目录、不能枚举、
 * 单值还有大小上限，语义与文件存储并不相同。
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 存储层运行所需的两个后端 */
export interface StorageBackend {
  files: TextFileStore;
  secrets: SecretStore;
}
