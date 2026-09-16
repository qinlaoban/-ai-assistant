// 刻意用相对路径 + 显式 .ts 扩展名，而不是 @/ 别名：
// 这样本文件才能被 Node 直接加载（Node 的 ESM 解析要求写全扩展名），
// scripts/check-api.ts 的连通性自检与 tests/ 才能复用真实请求实现，而不是另写一份模仿代码。
import { DEFAULT_API_BASE_URL, normalizeBaseUrl } from '../constants/chat-params.ts';

/**
 * 从接口地址里取出主机名，供错误文案使用。
 * 不用 `new URL()`：Hermes 上的 URL 支持并不完整，正则足够且行为确定。
 */
function hostOf(baseUrl: string | undefined): string {
  const normalized = normalizeBaseUrl(baseUrl ?? DEFAULT_API_BASE_URL);
  const match = /^https?:\/\/([^/]+)/.exec(normalized);
  return match ? match[1] : normalized;
}

/** 消息附件 */
export interface MessageAttachment {
  id: string;
  /** image 走多模态图片通道；file 是文本类文件，内容会被内联进正文 */
  kind: 'image' | 'file';
  /** 本地文件 URI */
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  /** 文本类文件的内容（选择时已读入并截断） */
  text?: string;
  /**
   * 图片的 data URL。**只存在于请求期内存里**：
   * 它体积很大，落到会话文件里会让读写都变重，所以 state 与存储永远不含这个字段。
   */
  dataUrl?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 本地消息 id，仅用于列表的稳定 key；发送前会被剥掉，不会离开设备 */
  id?: string;
  /** 本地时间戳，仅用于展示；旧消息没有该字段时不显示时间 */
  createdAt?: number;
  /** 该条助手回复的全部版本（按生成先后排列）；长度 > 1 时才展示版本切换器 */
  versions?: string[];
  /** 当前展示版本在 versions 中的下标；content 恒等于 versions[activeVersion] */
  activeVersion?: number;
  /** 用户消息引用的上下文；仅用于气泡渲染，请求时会被折进正文 */
  quote?: string;
  /** 该条用户消息携带的附件 */
  attachments?: MessageAttachment[];
}

/**
 * 请求期间才会被拼进 body 的消息形态。
 * 刻意不复用 ChatMessage：那个是「本地消息」，而 system 属于「请求期注入的上下文」，
 * 不该混进 UI 渲染与本地存储，所以单独用一个仅本层可见的类型。
 */
interface WireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | WireContentPart[];
}

/** chat/completions 的多模态片段：content 允许是「文本 + 图片」数组 */
type WireContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

export function addUsage(base: Usage, next: Usage): Usage {
  return {
    promptTokens: base.promptTokens + next.promptTokens,
    completionTokens: base.completionTokens + next.completionTokens,
    totalTokens: base.totalTokens + next.totalTokens,
  };
}

export interface AIConfig {
  model: string;
  apiKey: string;
  /** 接口地址，填到 /v1 为止；不传则用 OpenAI 官方地址 */
  baseUrl?: string;
  /** 系统提示词：只在请求期注入，既不落盘也不渲染 */
  systemPrompt?: string;
  /** 随机性 */
  temperature?: number;
  /** 最大生成长度；<= 0 视为不限制，不下发 */
  maxTokens?: number;
}

export interface AICallbacks {
  /** 收到的是「增量」而非累积文本，调用方自行拼接 */
  onDelta: (delta: string) => void;
  /** 服务端在流末尾回传的用量；部分服务端不回传，届时不会被调用 */
  onUsage?: (usage: Usage) => void;
}

export const DEFAULT_MODEL = 'gpt-4o-mini';

export class AIError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AIError';
    this.status = status;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const detail = body?.error?.message;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  if (response.status === 401) return 'API Key 无效或已过期（HTTP 401）';
  if (response.status === 429) return '请求过于频繁或额度不足（HTTP 429）';
  return `请求失败（HTTP ${response.status}）`;
}

/** 把服务端 `usage` 字段收敛成内部结构；字段缺失时返回 null 而不是 0，好让调用方区分「没有」和「真的是 0」 */
function toUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  const prompt = typeof source.prompt_tokens === 'number' ? source.prompt_tokens : null;
  const completion = typeof source.completion_tokens === 'number' ? source.completion_tokens : null;
  const total = typeof source.total_tokens === 'number' ? source.total_tokens : null;
  if (prompt === null && completion === null && total === null) return null;
  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: total ?? (prompt ?? 0) + (completion ?? 0),
  };
}

interface ParsedSseEvent {
  delta: string | null;
  usage: Usage | null;
}

/**
 * 从单个 SSE 事件块里抽出增量文本与用量。
 * 一个事件块可能有多行 `data:`，OpenAI 正常只发一行，但两者都要能处理。
 * 末尾那个 usage 块通常 `choices` 为空数组，所以两条通道必须独立判断、互不早退。
 */
function parseSseEvent(event: string): ParsedSseEvent {
  let delta = '';
  let usage: Usage | null = null;

  for (const line of event.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload.length === 0 || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      const content = parsed?.choices?.[0]?.delta?.content;
      if (typeof content === 'string') delta += content;
      const parsedUsage = toUsage(parsed?.usage);
      if (parsedUsage) usage = parsedUsage;
    } catch {
      // 半条 JSON 不该出现（已按 \n\n 切分），真出现就丢弃这一行
    }
  }

  return { delta: delta.length > 0 ? delta : null, usage };
}

/** 把引用折成 Markdown 引用块：模型必须看到被引用的上下文 */
function foldQuote(quote: string, content: string): string {
  const quoted = quote
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${quoted}\n\n${content}`;
}

/**
 * 把一条本地消息收敛成请求体里的 content。
 *
 * - 没有可用附件时返回**纯字符串**（与引入附件之前逐字一致，老测试仍成立）；
 * - 有图片或文本附件时才升级成片段数组：正文（含引用与内联的文件内容）在前，图片在后。
 * - 文本文件走正文而不是多模态通道：chat/completions 只认图片，txt/md/json 只有内联才有意义。
 */
function toWireContent(message: ChatMessage): string | WireContentPart[] {
  const body =
    message.quote && message.quote.trim().length > 0
      ? foldQuote(message.quote, message.content)
      : message.content;

  const attachments = message.attachments ?? [];
  const fileTexts = attachments.filter((item) => item.kind === 'file' && item.text);
  const images = attachments.filter(
    (item): item is MessageAttachment & { dataUrl: string } =>
      item.kind === 'image' && typeof item.dataUrl === 'string'
  );

  if (fileTexts.length === 0 && images.length === 0) return body;

  const sections = [body];
  for (const file of fileTexts) {
    sections.push(`【附件：${file.name}】\n${file.text}`);
  }

  const parts: WireContentPart[] = [{ type: 'text', text: sections.join('\n\n') }];
  for (const image of images) {
    parts.push({ type: 'image_url', image_url: { url: image.dataUrl } });
  }
  return parts;
}

/**
 * 收敛成请求体形态：剥掉 id / createdAt / versions / attachments 等**本地字段**，
 * 再按需前置 system 提示词。
 *
 * 唯一有意为之的例外是 `quote`：引用只在气泡上渲染，请求时必须让模型看到，
 * 因此在这一层把引用折进正文，而不是把 `> ...` 混进用户气泡的显示内容里。
 * 新增的本地字段都不在这里取值，自然不会被下发。
 */
function toWireMessages(messages: ChatMessage[], systemPrompt?: string): WireMessage[] {
  const outgoing: WireMessage[] = messages.map((message) => ({
    role: message.role,
    content: toWireContent(message),
  }));
  const trimmed = systemPrompt?.trim();
  if (trimmed) outgoing.unshift({ role: 'system', content: trimmed });
  return outgoing;
}

/** 可选参数只在真正设置过时才下发，保证默认配置的请求体与改动前逐字一致 */
function toRequestBody(messages: ChatMessage[], config: AIConfig, includeUsage: boolean) {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toWireMessages(messages, config.systemPrompt),
    stream: true,
  };

  // 不加这个，流式响应里不会带 usage，用量统计就永远是空的。
  // 但它不是所有兼容实现都认，被拒时由调用方摘掉重发。
  if (includeUsage) body.stream_options = { include_usage: true };

  if (typeof config.temperature === 'number' && Number.isFinite(config.temperature)) {
    body.temperature = config.temperature;
  }
  if (typeof config.maxTokens === 'number' && config.maxTokens > 0) {
    // 字段名用 max_completion_tokens：OpenAI 已把它作为 max_tokens 的替代，
    // 而小米 MiMo 这类兼容实现只认这个名字（传 max_tokens 会被拒）
    body.max_completion_tokens = config.maxTokens;
  }

  return body;
}

/**
 * 发一次请求，并把传输层失败翻译成人话；取消原样抛出交给上层归一。
 * 单独抽出来是因为 stream_options 被拒时需要原样重发一次。
 */
async function postChatCompletions(
  messages: ChatMessage[],
  config: AIConfig,
  signal: AbortSignal | undefined,
  includeUsage: boolean
): Promise<Response> {
  const endpoint = `${normalizeBaseUrl(config.baseUrl ?? DEFAULT_API_BASE_URL)}/chat/completions`;

  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(toRequestBody(messages, config, includeUsage)),
      signal,
    });
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const raw = error instanceof Error ? error.message : String(error);
    throw new AIError(describeTransportError(raw, hostOf(config.baseUrl)) ?? raw);
  }
}

/**
 * 把**传输层**的失败翻译成能指导下一步动作的文案。
 *
 * 这类错误来自原生网络栈，原始信息形如
 * `fetch failed: UnexpectedException: The request timed out. (at ExpoModulesCore/Promise.swift:56)`，
 * 直接丢给用户既看不懂，也不知道该去改什么。命中不了就返回 null，保留原文以免掩盖线索。
 */
function describeTransportError(raw: string, host: string): string | null {
  if (/timed out|timeout/i.test(raw)) {
    return `连接超时：连不上 ${host}。请确认手机网络能访问该域名（部分地区需要代理）。`;
  }
  if (/offline|not connected|network connection (was )?lost/i.test(raw)) {
    return '网络不可用：请检查手机的 Wi-Fi 或蜂窝网络。';
  }
  if (/cannot find host|hostname could not be found|nodename nor servname|could not resolve/i.test(raw)) {
    return `无法解析 ${host}：DNS 查询失败，请检查设置里的接口地址是否正确。`;
  }
  if (/secure connection|ssl|tls|certificate/i.test(raw)) {
    return `与 ${host} 的安全连接建立失败：证书无效或网络被干扰，请确认该地址支持 HTTPS。`;
  }
  return null;
}

/** 归一化后的取消错误，调用方只需识别这一种形状 */
function createAbortError(): Error {
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

/**
 * 判断一次失败是否来自「我们主动取消」。
 *
 * 不能只认 `AbortError`：Expo 的原生 fetch 在取消流时会抛自己的异常
 * （iOS 是 `FetchRequestCanceledException`，reason 为 "Fetch request has been canceled"，
 * 见 expo/ios/Fetch/FetchExceptions.swift；Android 同理），名字与 web 上的 AbortError
 * 完全不同。所以以「signal 已 abort」为主要依据，再兜一层名字/文案匹配，
 * 覆盖 signal 已被重置的边角情况。
 */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!(error instanceof Error)) return false;
  // 带 HTTP 状态码的一律是服务端回的错，与「用户取消」无关。
  // 必须早于下面的兜底正则：服务端文案完全可能含 cancel（如 subscription canceled），
  // 一旦被判成取消，上层就会静默吞掉这个真实失败（不落错误条、不提示）。
  if (error instanceof AIError && typeof error.status === 'number') return false;
  return (
    error.name === 'AbortError' ||
    error.name === 'CanceledError' ||
    error.name === 'FetchRequestCanceledException' ||
    /abort|cancel/i.test(error.message)
  );
}

/**
 * 流式请求的实现。callbacks.onDelta 收到的是「增量」而非累积文本，调用方自行拼接。
 * 失败时抛 AIError，调用方负责把错误呈现到 UI（本层不弹窗、不依赖 RN）。
 */
async function streamCompletion(
  messages: ChatMessage[],
  config: AIConfig,
  callbacks: AICallbacks,
  signal?: AbortSignal
): Promise<string> {
  let response = await postChatCompletions(messages, config, signal, true);

  if (!response.ok) {
    const detail = await readErrorMessage(response);

    // 部分 OpenAI 兼容实现（如小米 MiMo）不认 stream_options，会直接 400。
    // 确认是它引起的就摘掉重发一次：宁可少一份用量统计，也不能整个回答都拿不到。
    if (response.status === 400 && /stream_options|include_usage/i.test(detail)) {
      response = await postChatCompletions(messages, config, signal, false);
      if (!response.ok) {
        throw new AIError(await readErrorMessage(response), response.status);
      }
    } else {
      throw new AIError(detail, response.status);
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new AIError('响应体不可读，可能是当前运行环境不支持流式读取');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const consume = (events: string[]) => {
    for (const event of events) {
      const { delta, usage } = parseSseEvent(event);
      // usage 可能单独成块，也可能整场都不出现（服务端差异），两种都要能忍
      if (usage) callbacks.onUsage?.(usage);
      if (delta === null) continue;
      fullText += delta;
      callbacks.onDelta(delta);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // stream: true 让解码器自己留住被切断的多字节字符（中文场景必须）
      buffer += decoder.decode(value, { stream: true });

      // 事件以空行分隔；最后一段通常不完整，必须留到下一轮再拼
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      consume(events);
    }

    // 收尾：冲掉解码器余量，并处理 buffer 里最后一个没有结尾空行的事件
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      consume(buffer.split(/\r?\n\r?\n/));
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

/**
 * 对外的流式请求入口。
 *
 * 把「主动取消」归一成 `AbortError`：iOS 原生、Android 原生与 web 在取消时抛出的
 * 形状各不相同，调用方不该为此写三套判断。非取消类失败原样抛出，仍是 AIError。
 */
export async function sendMessageStream(
  messages: ChatMessage[],
  config: AIConfig,
  callbacks: AICallbacks,
  signal?: AbortSignal
): Promise<string> {
  try {
    return await streamCompletion(messages, config, callbacks, signal);
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError();
    throw error;
  }
}
