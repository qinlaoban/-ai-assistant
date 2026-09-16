/**
 * 消息层的纯函数集合 —— 版本切换、引用摘要与收尾归档。
 *
 * 刻意与 store 分开：这些都是「输入消息 → 输出消息」的纯变换，不依赖 React / 原生模块，
 * 因此可以被 Node 直接加载并单测（沿用 ai-service.ts 的相对路径 + `.ts` 扩展名写法）。
 */
import type { ChatMessage, Usage } from './ai-service.ts';

/**
 * 引用的字符上限。
 * 引用只是给模型的上下文提示，没必要把整篇长文复制进每一次请求，否则请求体会迅速膨胀。
 */
export const QUOTE_MAX_LENGTH = 200;

/** 把任意文本压成一行，并按上限截断（折叠空白后仍可能很长） */
export function squeeze(text: string, maxLength: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}…` : oneLine;
}

/** 从被引用的消息正文里裁出可引用的片段 */
export function makeQuote(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > QUOTE_MAX_LENGTH ? oneLine.slice(0, QUOTE_MAX_LENGTH) : oneLine;
}

/** 引用在输入区/气泡上的展示摘要 */
export function quoteSummary(quote: string): string {
  return squeeze(quote, QUOTE_MAX_LENGTH);
}

/**
 * 请求内核的「助手消息种子」：描述这次流式要写进哪条助手消息、以什么方式增长。
 *
 * - 普通发送：不传 —— 末尾补一条全新的空助手消息，流式原地替换
 * - 原地重新生成：传 id / createdAt 与 versions（含被替换掉的旧内容），收尾时把新内容追加为新版本
 * - 继续生成：mode = 'extend' —— 在现有末条助手消息上续写，不新增消息
 */
export interface AssistantSeed {
  mode?: 'append' | 'extend';
  /** 重新生成时沿用被替换消息的 id，避免列表 key 变化导致气泡重挂载 */
  id?: string;
  createdAt?: number;
  /** 已生成过的历史版本（按先后排列，**含被替换的旧内容**） */
  versions?: string[];
  /** 续写前缀：extend 模式下以该正文为基础累加增量 */
  appendBase?: string;
}

/**
 * 是否该把当前会话写盘。
 *
 * 关键点是**不再以「消息为空」为跳过条件**：把最后一条消息删掉时也必须写一次空数组，
 * 否则磁盘上仍是旧内容，下一次刷新列表 / 重启 App 会把已删消息原样读回来，
 * 等于用户的删除被静默撤销。只有「还没建会话」（新对话、一条都没发过）才跳过。
 */
// 用类型谓词：调用方 `if (!shouldPersist(id)) return;` 之后 id 会被收窄成 string
export function shouldPersist(chatId: string | null): chatId is string {
  return typeof chatId === 'string' && chatId.length > 0;
}

/**
 * 用量去重：部分网关会把同一份 usage 重复回传，照单累加会让用量成倍放大。
 * 只有三个字段完全一致的才认定为重复。
 */
export function isSameUsage(previous: Usage | null, next: Usage): boolean {
  if (!previous) return false;
  return (
    previous.promptTokens === next.promptTokens &&
    previous.completionTokens === next.completionTokens &&
    previous.totalTokens === next.totalTokens
  );
}

/** 把下标钳制到 [0, length-1]，非法值回退到最后一项 */
function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length - 1;
  return Math.min(length - 1, Math.max(0, Math.trunc(value)));
}

/** 版本指示：仅在存在多个版本时返回，单版本或旧消息返回 null（不显示切换器） */
export function messageVersionView(
  message: ChatMessage
): { active: number; total: number } | null {
  const versions = message.versions;
  if (!versions || versions.length <= 1) return null;
  const active = clampIndex(message.activeVersion ?? versions.length - 1, versions.length);
  return { active, total: versions.length };
}

/** 切换版本（纯函数）：越界、单版本或已在端点时原样返回，避免无谓的重渲染 */
export function switchMessageVersion(message: ChatMessage, delta: -1 | 1): ChatMessage {
  const view = messageVersionView(message);
  if (!view) return message;
  const next = clampIndex(view.active + delta, view.total);
  if (next === view.active) return message;
  const versions = message.versions as string[];
  // content 与 versions[activeVersion] 必须同步，content 是显示/请求/存储的唯一权威值
  return { ...message, activeVersion: next, content: versions[next] };
}

/** 重新生成前，取这条助手消息的已有版本（含它自己）；没有版本列表时把自己当作唯一版本 */
export function seedVersionsFor(message: ChatMessage): string[] {
  if (message.versions && message.versions.length > 0) return [...message.versions];
  return [message.content];
}

/**
 * 收尾：把流式结果并入版本列表（纯函数）。
 *
 * - extend：结果写回**当前版本**，版本数不变（续写不产生新版本）
 * - 带 versions 的 append：新内容追加成**新版本**并指向它（重新生成）
 * - 其它（全新回复）：不引入版本字段，保持单版本
 */
export function finalizeAssistantMessage(message: ChatMessage, seed?: AssistantSeed): ChatMessage {
  if (seed?.mode === 'extend') {
    const versions = (seed.versions ?? [message.content]).slice();
    const active = clampIndex(message.activeVersion ?? versions.length - 1, versions.length);
    if (versions[active] === message.content) return message;
    versions[active] = message.content;
    return { ...message, versions, activeVersion: active };
  }
  if (seed?.versions && seed.versions.length > 0) {
    const versions = [...seed.versions, message.content];
    return { ...message, versions, activeVersion: versions.length - 1 };
  }
  return message;
}

/**
 * 流式一个字都没产出时的回滚。
 *
 * 普通发送：丢掉空气泡（与既有行为一致）。
 * 重新生成：必须把被替换的旧内容还原回去，否则这条回复会被整条抹掉。
 * 续写：history 本身就是原样，直接返回。
 */
export function rollbackAssistantSeed(
  history: ChatMessage[],
  seed?: AssistantSeed
): ChatMessage[] {
  if (seed?.mode === 'extend') return history;
  if (!seed?.id) return history;
  const versions = seed.versions && seed.versions.length > 0 ? seed.versions : [''];
  const lastIndex = versions.length - 1;
  return [
    ...history,
    {
      role: 'assistant',
      content: versions[lastIndex],
      id: seed.id,
      createdAt: seed.createdAt,
      versions,
      activeVersion: lastIndex,
    },
  ];
}

// ---------------------------------------------------------------- 日期分隔

const DAY_MS = 24 * 60 * 60 * 1000;

/** 把时间戳归零到「本地时区的当天零点」 */
export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 分隔文案：今天 / 昨天 / YYYY-MM-DD */
export function formatDayLabel(timestamp: number, todayStart: number): string {
  const day = startOfDay(timestamp);
  if (day === todayStart) return '今天';
  if (day === todayStart - DAY_MS) return '昨天';
  const date = new Date(day);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/** 列表里的一行：要么是日期分隔，要么是一条消息 */
export type MessageListItem =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'message'; key: string; index: number; message: ChatMessage };

/**
 * 把消息预处理成「日期分隔 + 消息」的联合数组，供 FlatList 一次性消费。
 *
 * 旧的/无 `createdAt` 的消息**不参与分组**（不伪造时间），并且会打断分组，
 * 避免把一条没有时间的历史消息错误地归到相邻某一天里。
 */
export function buildDateSeparatedList(
  messages: ChatMessage[],
  todayStart: number
): MessageListItem[] {
  const items: MessageListItem[] = [];
  let currentDay: number | null = null;

  messages.forEach((message, index) => {
    if (typeof message.createdAt === 'number') {
      const day = startOfDay(message.createdAt);
      if (day !== currentDay) {
        currentDay = day;
        items.push({
          kind: 'date',
          // 带上 index：极端情况下消息时间倒流会让同一天出现两次，key 不能重复
          key: `date-${day}-${index}`,
          label: formatDayLabel(message.createdAt, todayStart),
        });
      }
    } else {
      currentDay = null;
    }
    items.push({
      kind: 'message',
      key: message.id ?? `idx-${index}`,
      index,
      message,
    });
  });

  return items;
}
