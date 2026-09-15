/**
 * 附件（图片 / 文本类文件）。
 *
 * 设计取舍：
 * - **图片**：选完拷进 App 文档目录（cache 会被系统清理，重建后旧会话的图就没了），
 *   请求时再按需读成 data URL —— base64 只在内存里存在，绝不落盘，否则会话文件会迅速膨胀。
 * - **文本类文件**：直接把内容内联进正文。chat/completions 只认图片这种多模态输入，
 *   把 txt/md/json 当文本塞进 prompt 才是它们唯一有意义的用法。
 * - 其余类型（PDF、音视频等）明确拒绝并给出原因，而不是悄悄发出去让模型答非所问。
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { ChatMessage, MessageAttachment } from './ai-service.ts';

/** 单条消息最多带几个附件（多模态请求会显著变贵，卡住上限） */
export const MAX_ATTACHMENTS = 4;
/** 单个文本文件最多内联多少字符，超出截断 */
export const TEXT_FILE_MAX_CHARS = 20_000;
/** data URL 内存缓存条数上限 */
const DATA_URL_CACHE_LIMIT = 20;

/** 常见代码/文本类扩展名（各家 MIME 报得五花八门，只能双轨判断） */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'csv', 'tsv', 'log', 'yml', 'yaml',
  'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'py', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs',
  'rb', 'php', 'sh', 'bash', 'zsh', 'sql', 'ini', 'toml', 'env', 'conf', 'properties',
]);

export function createAttachmentId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index + 1).toLowerCase();
}

/** 能否按文本内联：MIME 或扩展名命中其一即可 */
export function isTextLike(name: string, mimeType?: string | null): boolean {
  if (mimeType) {
    const lower = mimeType.toLowerCase();
    if (lower.startsWith('text/')) return true;
    if (lower === 'application/json' || lower === 'application/xml') return true;
  }
  return TEXT_EXTENSIONS.has(extensionOf(name));
}

/** 图片的 MIME：选择器没给（如相机直出）时按扩展名兜底 */
export function guessImageMime(uri: string, mimeType?: string | null): string {
  if (mimeType && mimeType.toLowerCase().startsWith('image/')) return mimeType;
  switch (extensionOf(uri)) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
    case 'heif':
      return 'image/heic';
    default:
      return 'image/jpeg';
  }
}

// ---------------------------------------------------------------- data URL

const dataUrlCache = new Map<string, string>();

async function readAsDataUrl(uri: string, mimeType: string): Promise<string> {
  const cached = dataUrlCache.get(uri);
  if (cached) return cached;

  let dataUrl: string;
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(blob);
    });
  } else {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    dataUrl = `data:${mimeType};base64,${base64}`;
  }

  if (dataUrlCache.size >= DATA_URL_CACHE_LIMIT) dataUrlCache.clear();
  dataUrlCache.set(uri, dataUrl);
  return dataUrl;
}

/**
 * 为请求准备消息：把图片附件补上 data URL。
 *
 * 返回的是**克隆体**，调用方只把它交给请求层，不要写回 state ——
 * base64 一旦落进会话文件，读写都会变得很重。读不到图（文件被清理）时跳过该图而不是整单失败。
 */
export async function attachDataUrls(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const needsWork = messages.some((message) =>
    message.attachments?.some((item) => item.kind === 'image' && !item.dataUrl)
  );
  if (!needsWork) return messages;

  return Promise.all(
    messages.map(async (message) => {
      if (!message.attachments || message.attachments.length === 0) return message;
      const attachments = await Promise.all(
        message.attachments.map(async (item) => {
          if (item.kind !== 'image' || item.dataUrl) return item;
          return readAsDataUrl(item.uri, item.mimeType || guessImageMime(item.uri))
            .then((dataUrl) => ({ ...item, dataUrl }))
            .catch(() => item);
        })
      );
      return { ...message, attachments };
    })
  );
}

// ---------------------------------------------------------------- 选择

/** 把选中的图片复制进文档目录，保证重启后仍然可读 */
async function persistImage(uri: string, mimeType: string | null | undefined): Promise<string> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return uri;
  const directory = `${FileSystem.documentDirectory}attachments/`;
  const extension = extensionOf(uri) || extensionOf(mimeType ?? '') || 'jpg';
  const target = `${directory}${createAttachmentId()}.${extension}`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}

async function toImageAttachment(asset: ImagePicker.ImagePickerAsset): Promise<MessageAttachment> {
  const mimeType = guessImageMime(asset.uri, asset.mimeType);
  const uri = await persistImage(asset.uri, asset.fileName ?? mimeType).catch(() => asset.uri);
  return {
    id: createAttachmentId(),
    kind: 'image',
    uri,
    name: asset.fileName ?? `图片.${extensionOf(uri) || 'jpg'}`,
    mimeType,
    size: asset.fileSize,
  };
}

function toImageAttachments(assets: ImagePicker.ImagePickerAsset[]): Promise<MessageAttachment[]> {
  return Promise.all(assets.slice(0, MAX_ATTACHMENTS).map(toImageAttachment));
}

/** 从相册选择图片 */
export async function pickImageAttachments(): Promise<MessageAttachment[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('没有相册权限，请在系统设置里允许后重试');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_ATTACHMENTS,
    quality: 0.8,
  });
  if (result.canceled) return [];
  return toImageAttachments(result.assets);
}

/** 拍照 */
export async function captureImageAttachment(): Promise<MessageAttachment[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('没有相机权限，请在系统设置里允许后重试');
  const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
  if (result.canceled) return [];
  return toImageAttachments(result.assets);
}

/**
 * 选择文本类文件。非文本类型直接拒绝并说明原因 —— 与其发出去让模型答非所问，
 * 不如当场告诉用户「这种文件不支持」。
 */
export async function pickTextAttachments(): Promise<MessageAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    // 保持默认的 true：选完要立刻用 file-system 读取内容
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];

  const assets = result.assets.slice(0, MAX_ATTACHMENTS);
  const unsupported: string[] = [];
  const attachments: MessageAttachment[] = [];

  for (const asset of assets) {
    if (!isTextLike(asset.name, asset.mimeType)) {
      unsupported.push(asset.name);
      continue;
    }
    const raw = await FileSystem.readAsStringAsync(asset.uri).catch(() => '');
    if (raw.length === 0) {
      unsupported.push(asset.name);
      continue;
    }
    const text =
      raw.length > TEXT_FILE_MAX_CHARS
        ? `${raw.slice(0, TEXT_FILE_MAX_CHARS)}\n\n…（文件过长，已截断）`
        : raw;
    attachments.push({
      id: createAttachmentId(),
      kind: 'file',
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? 'text/plain',
      size: asset.size,
      text,
    });
  }

  if (unsupported.length > 0 && attachments.length === 0) {
    throw new Error(`暂不支持这些文件类型：${unsupported.join('、')}。目前支持图片与文本类文件。`);
  }
  return attachments;
}
