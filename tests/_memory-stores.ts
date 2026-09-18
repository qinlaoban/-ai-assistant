import type { SecretStore, TextFileStore } from '../src/services/key-value-store.ts';

/**
 * 内存版存储后端。
 *
 * chat-storage 改为通过 `setStorageBackend` 接收后端后，测试注入它即可 ——
 * 于是这些用例完全不需要把 `Platform.OS` 钉成 'web'，也不会加载任何原生模块。
 */
export class MemoryFileStore implements TextFileStore {
  private files = new Map<string, string>();

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, value: string): Promise<void> {
    this.files.set(path, value);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(dir: string): Promise<string[]> {
    return [...this.files.keys()].filter((path) => path.startsWith(dir));
  }

  /** 同步落盘原始内容：用来构造坏文件、旧格式这类 saveChat 造不出来的数据 */
  seed(path: string, value: string): void {
    this.files.set(path, value);
  }

  clear(): void {
    this.files.clear();
  }
}

export class MemorySecretStore implements SecretStore {
  private values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}
