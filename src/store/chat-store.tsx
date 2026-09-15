import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import * as Clipboard from 'expo-clipboard';

import {
  DEFAULT_GENERATION_SETTINGS,
  normalizeGenerationSettings,
  type GenerationSettings,
} from '@/constants/chat-params';
import {
  addUsage,
  DEFAULT_MODEL,
  isAbortError,
  sendMessageStream,
  ZERO_USAGE,
  type ChatMessage,
  type MessageAttachment,
  type Usage,
} from '@/services/ai-service';
import { attachDataUrls } from '@/services/attachments';
import {
  finalizeAssistantMessage,
  makeQuote,
  rollbackAssistantSeed,
  seedVersionsFor,
  switchMessageVersion,
  type AssistantSeed,
} from '@/services/chat-messages';
import {
  clearApiKey,
  createChatId,
  deleteChat as deleteStoredChat,
  deriveTitle,
  getApiKey,
  getGenerationSettings,
  getModel,
  listChats,
  loadChat,
  renameChat as renameStoredChat,
  saveApiKey,
  saveChat,
  saveGenerationSettings,
  saveModel,
  type ChatSummary,
} from '@/services/chat-storage';
import { haltSpeech, speakText } from '@/services/speech';

const EMPTY_TITLE = '新对话';

/** 流式期间合并 setState 的间隔：60ms 约 16fps，肉眼连续，又不至于逐 token 重渲染 */
const STREAM_FLUSH_MS = 60;

/**
 * 消息级 id，只用于列表的稳定 key（算法与 chat-storage 的 createChatId 同款）。
 * 不落盘也能用，但落盘后切回会话才能保持同一套 key，因此一并存进会话文件。
 */
function createMessageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ChatContextValue {
  messages: ChatMessage[];
  chats: ChatSummary[];
  currentChatId: string | null;
  currentTitle: string;
  isStreaming: boolean;
  isReady: boolean;
  error: string | null;
  apiKey: string;
  model: string;
  hasApiKey: boolean;
  /** 生成参数：系统提示词 / 随机性 / 最大长度 */
  generationSettings: GenerationSettings;
  /** 最近一次请求的用量；还没调过模型时为 null */
  usage: Usage | null;
  /** 当前会话的累计用量 */
  sessionUsage: Usage;
  /** 当前待发送的引用上下文；null 表示没有引用 */
  quotedText: string | null;
  /** 正在朗读的消息下标；null 表示没有在朗读 */
  speakingIndex: number | null;
  sendMessage: (text: string, attachments?: MessageAttachment[]) => Promise<void>;
  stopStreaming: () => void;
  retry: () => Promise<void>;
  /** 重新生成第 index 条助手消息（丢弃它及其之后的内容，旧内容保留为一个历史版本） */
  regenerate: (messageIndex: number) => Promise<void>;
  /** 从最后一个被停止/截断的助手消息处继续生成 */
  continueGeneration: () => Promise<void>;
  /** 切换第 index 条助手消息的历史版本（-1 上一个 / +1 下一个） */
  switchVersion: (messageIndex: number, delta: -1 | 1) => Promise<void>;
  /** 引用第 index 条消息的正文到输入区（下一次发送生效） */
  quoteMessage: (messageIndex: number) => void;
  /** 取消当前引用 */
  clearQuote: () => void;
  /** 用新内容替换第 index 条用户消息并重发 */
  editAndResend: (messageIndex: number, text: string) => Promise<void>;
  deleteMessage: (messageIndex: number) => Promise<void>;
  /** 复制第 index 条消息，返回是否成功（失败时错误条已经给出原因） */
  copyMessage: (messageIndex: number) => Promise<boolean>;
  /** 朗读第 index 条消息；对正在朗读的那条再点一次即停止 */
  speakMessage: (messageIndex: number) => void;
  /** 停止朗读 */
  stopSpeaking: () => void;
  startNewChat: () => void;
  openChat: (id: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  refreshChats: () => Promise<void>;
  updateApiKey: (key: string) => Promise<void>;
  resetApiKey: () => Promise<void>;
  updateModel: (model: string) => Promise<void>;
  updateGenerationSettings: (patch: Partial<GenerationSettings>) => Promise<void>;
  dismissError: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) {
    throw new Error('useChat 必须在 <ChatProvider> 内使用');
  }
  return value;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [title, setTitle] = useState(EMPTY_TITLE);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(
    DEFAULT_GENERATION_SETTINGS
  );
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sessionUsage, setSessionUsage] = useState<Usage>(ZERO_USAGE);
  /** 待发送的引用；放进状态而不是输入区局部，才能让长按操作表与输入区解耦 */
  const [quotedText, setQuotedText] = useState<string | null>(null);
  /** 正在朗读的消息下标 */
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);

  // 流式回调发生在异步闭包里，必须用 ref 读最新值，否则拿到的是发起请求那一刻的旧状态
  const messagesRef = useRef<ChatMessage[]>([]);
  const chatIdRef = useRef<string | null>(null);
  const metaRef = useRef({ title: EMPTY_TITLE, createdAt: 0 });
  const pendingRef = useRef('');
  /** 流式内容的固定前缀：续写时是被续写的原文，其余情况为空串 */
  const streamBaseRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 每次切换/新建会话自增，用来让在途请求的结果失效（避免老会话的回答写进新会话） */
  const epochRef = useRef(0);
  const apiKeyRef = useRef('');
  const modelRef = useRef<string>(DEFAULT_MODEL);
  const settingsRef = useRef<GenerationSettings>(DEFAULT_GENERATION_SETTINGS);
  /** 累计用量要在异步收尾的 persist() 里读到最新值，所以必须走 ref */
  const sessionUsageRef = useRef<Usage>(ZERO_USAGE);
  /** 朗读状态要在 TTS 回调里读到最新值（回调不在 React 渲染里，闭包捕获的 state 会过期） */
  const speakingIndexRef = useRef<number | null>(null);

  const commitMessages = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const refreshChats = useCallback(async () => {
    setChats(await listChats());
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 三项配置并行读，避免串行等待把启动门控拖长（isReady 一慢就会多闪一次空屏）
      const [key, savedModel, savedSettings] = await Promise.all([
        getApiKey(),
        getModel(),
        getGenerationSettings(),
      ]);
      if (!alive) return;
      if (key) {
        apiKeyRef.current = key;
        setApiKey(key);
      }
      if (savedModel) {
        modelRef.current = savedModel;
        setModel(savedModel);
      }
      settingsRef.current = savedSettings;
      setGenerationSettings(savedSettings);
      if (!alive) return;
      // 首屏不再等会话列表读完：先放行界面，列表异步填充，
      // 否则启动耗时会随历史会话数量线性增长
      setIsReady(true);
      await refreshChats();
    })();
    return () => {
      alive = false;
    };
  }, [refreshChats]);

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
      abortRef.current?.abort();
      // 朗读是设备能力，卸载时必须主动收口，否则会一直在后台念
      void haltSpeech();
    },
    []
  );

  // ------------------------------------------------------------ 流式刷新

  const flushCommit = useCallback(() => {
    const base = messagesRef.current;
    const last = base[base.length - 1];
    if (last?.role !== 'assistant') return;
    // 必须保留原消息的 id：id 一变列表 key 就变，气泡会被卸载重建，表现为闪烁与滚动跳位
    // 续写时前缀拼在增量之前，普通发送时前缀为空串，行为与改造前一致
    commitMessages([
      ...base.slice(0, -1),
      { ...last, content: streamBaseRef.current + pendingRef.current },
    ]);
  }, [commitMessages]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushCommit();
    }, STREAM_FLUSH_MS);
  }, [flushCommit]);

  const flushNow = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushCommit();
  }, [flushCommit]);

  const persist = useCallback(async (updatedAt: number = Date.now()) => {
    const id = chatIdRef.current;
    if (!id || messagesRef.current.length === 0) return;
    await saveChat({
      id,
      title: metaRef.current.title,
      createdAt: metaRef.current.createdAt,
      updatedAt,
      messages: messagesRef.current,
      // 全为 0 时存储层会当作「未知」丢掉，不会往文件里塞无意义的零值
      usage: sessionUsageRef.current,
    });
  }, []);

  /**
   * 把当前会话的摘要就地写回列表，替代流式收尾时的整表重读。
   * 摘要字段都在 ref 里，不需要为了刷新列表再读一遍全部会话文件。
   */
  const upsertCurrentChat = useCallback((updatedAt: number) => {
    const id = chatIdRef.current;
    if (!id || messagesRef.current.length === 0) return;
    const summary: ChatSummary = {
      id,
      title: metaRef.current.title,
      createdAt: metaRef.current.createdAt,
      updatedAt,
    };
    setChats((prev) => {
      const rest = prev.filter((chat) => chat.id !== id);
      return [summary, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  /** 统一的会话切换：作废在途请求、清掉定时器、重置全部镜像状态 */
  const beginChat = useCallback(
    (
      nextId: string | null,
      meta: { title: string; createdAt: number; usage?: Usage },
      next: ChatMessage[]
    ) => {
      epochRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      streamingRef.current = false;
      setIsStreaming(false);
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingRef.current = '';
      streamBaseRef.current = '';
      // 引用与朗读都属于「当前这条会话」，切走后不该残留
      setQuotedText(null);
      speakingIndexRef.current = null;
      setSpeakingIndex(null);
      void haltSpeech();
      chatIdRef.current = nextId;
      metaRef.current = meta;
      setChatId(nextId);
      setTitle(meta.title);
      setError(null);
      // 用量跟着会话走：换个会话就该显示那个会话自己的累计值
      setUsage(null);
      sessionUsageRef.current = meta.usage ?? ZERO_USAGE;
      setSessionUsage(sessionUsageRef.current);
      commitMessages(next);
    },
    [commitMessages]
  );

  // ------------------------------------------------------------ 对外动作

  const startNewChat = useCallback(() => {
    beginChat(null, { title: EMPTY_TITLE, createdAt: 0 }, []);
  }, [beginChat]);

  const openChat = useCallback(
    async (id: string) => {
      const stored = await loadChat(id);
      if (!stored) {
        await refreshChats(); // 文件已不在，刷新列表
        return;
      }
      beginChat(
        stored.id,
        { title: stored.title, createdAt: stored.createdAt, usage: stored.usage },
        stored.messages
      );
    },
    [beginChat, refreshChats]
  );

  const removeChat = useCallback(
    async (id: string) => {
      await deleteStoredChat(id);
      if (chatIdRef.current === id) {
        beginChat(null, { title: EMPTY_TITLE, createdAt: 0 }, []);
      }
      await refreshChats();
    },
    [beginChat, refreshChats]
  );

  const renameChat = useCallback(async (id: string, title: string) => {
    const renamed = await renameStoredChat(id, title);
    if (!renamed) return;
    // 就地替换而不是整表重读：重命名不改 updatedAt，列表顺序不会变
    setChats((prev) => prev.map((chat) => (chat.id === renamed.id ? renamed : chat)));
    // 正在看的会话改了名，顶栏要立刻跟上；metaRef 也必须同步，
    // 否则下一次 persist() 会把旧标题原样写回文件，改名当场失效
    if (chatIdRef.current === id) {
      metaRef.current = { ...metaRef.current, title: renamed.title };
      setTitle(renamed.title);
    }
  }, []);

  /**
   * 请求内核：把「已经确定好的完整历史」发给模型。
   *
   * 「首次发送」「重新生成」「编辑并重发」的差别只在历史怎么构造，
   * 请求 / 节流 / 失效 / 落盘这一整套必须只有一份实现，否则三处逻辑会各自漂移。
   * 本函数会在传入历史之后补一条空的助手气泡占位，流式过程中原地替换它。
   */
  const runCompletion = useCallback(
    async (history: ChatMessage[], epoch: number, seed?: AssistantSeed) => {
      // extend（继续生成）：history 末尾已经是要续写的那条助手消息，不新增占位，
      // 流式结果以它的已有正文为前缀累加；其余情况补一条空占位，流式原地替换。
      const extend = seed?.mode === 'extend';
      streamBaseRef.current = extend ? (seed?.appendBase ?? '') : '';
      pendingRef.current = '';
      commitMessages(
        extend
          ? [...history]
          : [
              ...history,
              {
                role: 'assistant',
                content: '',
                id: seed?.id ?? createMessageId(),
                createdAt: seed?.createdAt ?? Date.now(),
              },
            ]
      );
      setError(null);
      streamingRef.current = true;
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // 图片附件到这一步才读成 data URL：只在本次请求的内存里存在，绝不写回 state
        const wireHistory = await attachDataUrls(history);
        await sendMessageStream(
          wireHistory,
          {
            model: modelRef.current,
            apiKey: apiKeyRef.current,
            baseUrl: settingsRef.current.apiBaseUrl,
            systemPrompt: settingsRef.current.systemPrompt,
            temperature: settingsRef.current.temperature,
            maxTokens: settingsRef.current.maxTokens,
          },
          {
            onDelta: (delta) => {
              pendingRef.current += delta;
              scheduleFlush();
            },
            onUsage: (next) => {
              setUsage(next);
              const total = addUsage(sessionUsageRef.current, next);
              sessionUsageRef.current = total;
              setSessionUsage(total);
            },
          },
          controller.signal
        );
      } catch (err) {
        // 「停止生成」和切换会话都会 abort 在途请求，这种取消不该弹给用户看
        if (!isAbortError(err, controller.signal)) {
          setError(err instanceof Error ? err.message : '请求失败');
        }
      } finally {
        // 期间用户可能已经切了会话，这轮结果就不能再往新会话里写
        if (epochRef.current === epoch) {
          flushNow();
          const list = messagesRef.current;
          const lastIndex = list.length - 1;
          const last = list[lastIndex];
          if (last && last.content === '') {
            // 一个字都没收到（报错 / 立刻中止）就别留一条空气泡；
            // 重新生成时得把被替换的旧内容还原回去，否则这条回复会被整条抹掉
            commitMessages(rollbackAssistantSeed(history, seed));
          } else if (last) {
            // 收尾归档：重新生成追加新版本，续写写回当前版本，全新回复保持单版本
            const finalized = finalizeAssistantMessage(last, seed);
            if (finalized !== last) {
              commitMessages([...list.slice(0, lastIndex), finalized]);
            }
          }
          streamingRef.current = false;
          setIsStreaming(false);
          abortRef.current = null;
          streamBaseRef.current = '';
          const updatedAt = Date.now();
          await persist(updatedAt);
          // 就地更新摘要即可：不必为了刷新列表而重读全部会话文件
          upsertCurrentChat(updatedAt);
        }
      }
    },
    [commitMessages, flushNow, persist, scheduleFlush, upsertCurrentChat]
  );

  /**
   * 从指定下标处重发：丢掉 index 及其之后的消息，把剩余历史重新请求一遍。
   * 传入 replacement 时用它替换 index 这条（「编辑并重发」用）。
   */
  const resendFrom = useCallback(
    async (index: number, replacement?: ChatMessage, seed?: AssistantSeed) => {
      if (streamingRef.current) return;
      const all = messagesRef.current;
      if (index < 0 || index >= all.length) return;

      const head = all.slice(0, index);
      const history = replacement ? [...head, replacement] : head;
      // 截断后没有任何可发送的内容，就没什么可请求的
      if (history.length === 0) return;

      await runCompletion(history, epochRef.current, seed);
    },
    [runCompletion]
  );

  const sendMessage = useCallback(
    async (text: string, attachments?: MessageAttachment[]) => {
      const content = text.trim();
      const files = attachments ?? [];
      // 只发一张图、不写字也是合法的
      if ((content.length === 0 && files.length === 0) || streamingRef.current) return;
      if (!apiKeyRef.current) {
        setError('请先设置 API Key');
        return;
      }

      // 首次发送时惰性建会话——旧版只在 currentChatId 非空时才保存，
      // 而首页从不新建会话，导致所有对话都没落盘
      if (!chatIdRef.current) {
        const id = createChatId();
        chatIdRef.current = id;
        // 只发附件时没有正文，退化用第一个附件的文件名当标题，总比「新对话」有信息量
        metaRef.current = {
          title: deriveTitle(content || files[0]?.name || ''),
          createdAt: Date.now(),
        };
        setChatId(id);
        setTitle(metaRef.current.title);
      }

      const history: ChatMessage[] = [
        ...messagesRef.current,
        {
          role: 'user',
          content,
          id: createMessageId(),
          createdAt: Date.now(),
          // 引用只用一次：发出去之后就从输入区清掉，避免下一条又被带上
          quote: quotedText ?? undefined,
          attachments: files.length > 0 ? files : undefined,
        },
      ];
      setQuotedText(null);
      await runCompletion(history, epochRef.current);
    },
    [quotedText, runCompletion]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(async () => {
    if (streamingRef.current) return;
    const all = messagesRef.current;
    for (let i = all.length - 1; i >= 0; i -= 1) {
      // 请求失败时那条空的助手气泡已在收尾阶段被撤销，所以最后一条 user 就是失败点本身，
      // 保留它原样重发即可（换成 sendMessage(content) 会重新生成一个 id，无谓地换 key）
      if (all[i].role === 'user') {
        await resendFrom(i, all[i]);
        return;
      }
    }
  }, [resendFrom]);

  const regenerate = useCallback(
    async (messageIndex: number) => {
      const all = messagesRef.current;
      const target = all[messageIndex];
      // 只对助手消息有意义：从它这里截断，等于让模型把这一问重新答一遍
      if (target?.role !== 'assistant') return;
      // 带上旧内容作为历史版本：新的回答会追加成新版本，用户可随时切回去
      await resendFrom(messageIndex, undefined, {
        id: target.id,
        createdAt: target.createdAt,
        versions: seedVersionsFor(target),
      });
    },
    [resendFrom]
  );

  const continueGeneration = useCallback(async () => {
    if (streamingRef.current) return;
    const all = messagesRef.current;
    const last = all[all.length - 1];
    // 只有「最后一条是被停止/截断的助手消息」才有续写的意义
    if (!last || last.role !== 'assistant' || last.content.length === 0) return;
    await runCompletion([...all], epochRef.current, {
      mode: 'extend',
      id: last.id,
      createdAt: last.createdAt,
      versions: seedVersionsFor(last),
      appendBase: last.content,
    });
  }, [runCompletion]);

  const switchVersion = useCallback(
    async (messageIndex: number, delta: -1 | 1) => {
      // 流式期间列表还在被 flush 改写，切换版本会跟收尾抢同一份 messages
      if (streamingRef.current) return;
      const all = messagesRef.current;
      const target = all[messageIndex];
      if (!target) return;
      const next = switchMessageVersion(target, delta);
      if (next === target) return; // 已是首/末版本，不动
      commitMessages([...all.slice(0, messageIndex), next, ...all.slice(messageIndex + 1)]);
      await persist();
    },
    [commitMessages, persist]
  );

  const quoteMessage = useCallback((messageIndex: number) => {
    const message = messagesRef.current[messageIndex];
    if (!message) return;
    const quote = makeQuote(message.content);
    if (quote.length === 0) return;
    setQuotedText(quote);
  }, []);

  const clearQuote = useCallback(() => setQuotedText(null), []);

  const editAndResend = useCallback(
    async (messageIndex: number, text: string) => {
      const content = text.trim();
      if (content.length === 0) return;
      const all = messagesRef.current;
      const target = all[messageIndex];
      if (target?.role !== 'user') return;
      // 沿用原消息的 id：列表 key 不变，这次编辑不会让整段气泡重挂载；
      // 时间戳与引用也一并保留，编辑正文不该改变这条消息的「身份」
      await resendFrom(messageIndex, {
        role: 'user',
        content,
        id: target.id ?? createMessageId(),
        createdAt: target.createdAt ?? Date.now(),
        quote: target.quote,
      });
    },
    [resendFrom]
  );

  const deleteMessage = useCallback(
    async (messageIndex: number) => {
      // 流式期间列表还在被 flush 改写，此时删会跟流式收尾抢同一份 messages
      if (streamingRef.current) return;
      const all = messagesRef.current;
      if (messageIndex < 0 || messageIndex >= all.length) return;
      commitMessages([...all.slice(0, messageIndex), ...all.slice(messageIndex + 1)]);
      await persist();
      await refreshChats();
    },
    [commitMessages, persist, refreshChats]
  );

  const copyMessage = useCallback(async (messageIndex: number): Promise<boolean> => {
    const message = messagesRef.current[messageIndex];
    if (!message || message.content.length === 0) return false;
    try {
      await Clipboard.setStringAsync(message.content);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '复制失败');
      return false;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    speakingIndexRef.current = null;
    setSpeakingIndex(null);
    void haltSpeech();
  }, []);

  const speakMessage = useCallback(
    (messageIndex: number) => {
      const message = messagesRef.current[messageIndex];
      if (!message || message.content.length === 0) return;
      // 对正在朗读的那条再点一次 = 停止
      if (speakingIndexRef.current === messageIndex) {
        stopSpeaking();
        return;
      }
      // 先掐掉上一条，再开始新的：TTS 会把多次 speak 排进队列，不主动停止会连着念
      void haltSpeech();
      speakingIndexRef.current = messageIndex;
      setSpeakingIndex(messageIndex);
      speakText(message.content, () => {
        // 播完 / 被停止 / 出错都走这里。只有状态仍指向这一条时才清，
        // 否则「停止上一条后立刻朗读下一条」会被上一条的回调误清
        if (speakingIndexRef.current === messageIndex) {
          speakingIndexRef.current = null;
          setSpeakingIndex(null);
        }
      });
    },
    [stopSpeaking]
  );

  const updateApiKey = useCallback(async (key: string) => {
    const trimmed = key.trim();
    if (trimmed.length === 0) return;
    await saveApiKey(trimmed);
    apiKeyRef.current = trimmed;
    setApiKey(trimmed);
    setError(null);
  }, []);

  const resetApiKey = useCallback(async () => {
    await clearApiKey();
    apiKeyRef.current = '';
    setApiKey('');
  }, []);

  const updateModel = useCallback(async (next: string) => {
    await saveModel(next);
    modelRef.current = next;
    setModel(next);
  }, []);

  const updateGenerationSettings = useCallback(async (patch: Partial<GenerationSettings>) => {
    // 走一遍归一化：滑杆/输入框可能给出越界值，写进 ref 之前必须先钳制
    const next = normalizeGenerationSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = next;
    setGenerationSettings(next);
    await saveGenerationSettings(next);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  const value = useMemo<ChatContextValue>(
    () => ({
      messages,
      chats,
      currentChatId: chatId,
      currentTitle: title,
      isStreaming,
      isReady,
      error,
      apiKey,
      model,
      hasApiKey: apiKey.length > 0,
      generationSettings,
      usage,
      sessionUsage,
      quotedText,
      speakingIndex,
      sendMessage,
      stopStreaming,
      retry,
      regenerate,
      continueGeneration,
      switchVersion,
      quoteMessage,
      clearQuote,
      editAndResend,
      deleteMessage,
      copyMessage,
      speakMessage,
      stopSpeaking,
      startNewChat,
      openChat,
      removeChat,
      renameChat,
      refreshChats,
      updateApiKey,
      resetApiKey,
      updateModel,
      updateGenerationSettings,
      dismissError,
    }),
    [
      messages,
      chats,
      chatId,
      title,
      isStreaming,
      isReady,
      error,
      apiKey,
      model,
      generationSettings,
      usage,
      sessionUsage,
      quotedText,
      speakingIndex,
      sendMessage,
      stopStreaming,
      retry,
      regenerate,
      continueGeneration,
      switchVersion,
      quoteMessage,
      clearQuote,
      editAndResend,
      deleteMessage,
      copyMessage,
      speakMessage,
      stopSpeaking,
      startNewChat,
      openChat,
      removeChat,
      renameChat,
      refreshChats,
      updateApiKey,
      resetApiKey,
      updateModel,
      updateGenerationSettings,
      dismissError,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
