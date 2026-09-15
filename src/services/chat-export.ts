/**
 * 会话导出。
 *
 * 拆成「纯构建」与「落地分享」两层：`buildConversationMarkdown` 不依赖任何原生模块，
 * 可以被 Node 直接加载并单测；`exportConversation` 负责写文件 / 分享 / 剪贴板兜底。
 */
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { ChatMessage } from './ai-service.ts';

export interface ConversationMeta {
  title: string;
  updatedAt?: number;
}

/** 导出结果的去向，调用方据此给出对应提示 */
export type ExportOutcome = 'shared' | 'copied' | 'failed';

function roleLabel(role: ChatMessage['role']): string {
  return role === 'user' ? '我' : 'AI';
}

function pad(value: number): string {
  return `${value}`.padStart(2, '0');
}

/** 本地时间戳 → `YYYY-MM-DD HH:mm` */
function formatStamp(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * 把整段会话拼成 Markdown（纯函数）。
 *
 * - 每条消息一个 `## 我` / `## AI` 小标题，正文原样保留（它本身就是 Markdown）；
 * - 有 `createdAt` 才写时间（旧消息不伪造）；
 * - 引用以 `>` 引用块呈现，与模型看到的形式一致；
 * - 末尾统一补一个换行，避免文件缺尾行。
 */
export function buildConversationMarkdown(
  messages: ChatMessage[],
  meta: ConversationMeta
): string {
  const lines: string[] = [`# ${meta.title.trim() || '对话'}`];

  if (typeof meta.updatedAt === 'number') {
    lines.push('', `*导出于 ${formatStamp(meta.updatedAt)}*`);
  }

  for (const message of messages) {
    lines.push('', `## ${roleLabel(message.role)}`);
    if (typeof message.createdAt === 'number') {
      lines.push('', `*${formatStamp(message.createdAt)}*`);
    }
    if (message.quote && message.quote.trim().length > 0) {
      lines.push(
        '',
        ...message.quote
          .trim()
          .split('\n')
          .map((line) => `> ${line}`)
      );
    }
    lines.push('', message.content);
  }

  return `${lines.join('\n')}\n`;
}

/** 把标题收敛成安全的文件名（去掉路径分隔符与保留字符） */
export function safeFileName(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'chat'}.md`;
}

/**
 * 导出当前会话：
 * 1. 原生端优先写成 `.md` 文件并呼起系统分享面板；
 * 2. 分享不可用（web / 模拟器 / 无分享能力）或写文件失败时，回退为复制整段 Markdown；
 * 3. 两条路都失败才返回 'failed'。
 */
export async function exportConversation(
  messages: ChatMessage[],
  meta: ConversationMeta
): Promise<ExportOutcome> {
  const markdown = buildConversationMarkdown(messages, meta);

  if (Platform.OS !== 'web') {
    const directory = FileSystem.cacheDirectory;
    if (directory) {
      try {
        if (await Sharing.isAvailableAsync()) {
          const uri = `${directory}${safeFileName(meta.title)}`;
          await FileSystem.writeAsStringAsync(uri, markdown);
          await Sharing.shareAsync(uri, {
            mimeType: 'text/markdown',
            dialogTitle: '导出对话',
            UTI: 'net.daringfireball.markdown',
          });
          return 'shared';
        }
      } catch {
        // 写文件或分享失败都不致命：下面还有剪贴板兜底
      }
    }
  }

  try {
    await Clipboard.setStringAsync(markdown);
    return 'copied';
  } catch {
    return 'failed';
  }
}
