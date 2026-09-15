/**
 * 粗略 token 估算。
 *
 * 只用来给用户一个「量级参考」（输入大概多长、上下文是不是快满了），
 * 不做精确计费：真正的用量以服务端返回的 usage 为准。
 *
 * 经验规则：
 * - CJK（中日韩）字符基本 1 字符 ≈ 1 token；
 * - 拉丁文本约 4 字符 ≈ 1 token；
 * - 每条消息还有少量结构开销（role、分隔符），按固定值计入上下文估算。
 */
import type { ChatMessage } from './ai-service.ts';

const CJK_PATTERN = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;

/** 每条消息的结构开销（role 字段、分隔符等），与 OpenAI 的量级一致 */
export const PER_MESSAGE_OVERHEAD = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  // 按码点遍历：emoji 等代理对只算一个字符，不会被拆成两个
  for (const char of text) {
    if (CJK_PATTERN.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

/** 估算整段上下文的 token 数（正文 + 引用 + 每条的消息开销） */
export function estimateConversationTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += PER_MESSAGE_OVERHEAD;
    total += estimateTokens(message.content);
    if (message.quote) total += estimateTokens(message.quote);
  }
  return total;
}

/** 把 token 数压成人读的短标签：1234 → 1.2k */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}
