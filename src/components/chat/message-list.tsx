import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  FlatList,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { ChatMessage } from '@/components/chat/chat-message';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type {
  ChatMessage as ChatMessageData,
  MessageAttachment,
} from '@/services/ai-service';
import {
  buildDateSeparatedList,
  messageVersionView,
  startOfDay,
  type MessageListItem,
} from '@/services/chat-messages';

/** 离底部这么近就认为「用户在跟读」，新内容到达时继续自动滚动 */
const AUTO_SCROLL_THRESHOLD = 80;
/** 首批渲染条数：够铺满一屏即可，后续由虚拟化按需补齐 */
const INITIAL_NUM_TO_RENDER = 12;
/** 每批追加渲染上限，避免一次性渲染过多行 */
const MAX_TO_RENDER_PER_BATCH = 10;
/** 视窗外保留的屏数；调小于默认的 21 可显著降低常驻视图数量 */
const WINDOW_SIZE = 10;
/** 「今天」基准的刷新间隔：只为跨天时校正分隔文案 */
const MINUTE = 60_000;
/** 变高行跳转失败后的最大重试次数，避免 onScrollToIndexFailed 反复触发形成死循环 */
const MAX_JUMP_RETRY = 1;

/** 日期分隔条：居中的浅色胶囊，弱化处理不抢正文 */
const DateSeparator = memo(function DateSeparator({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.dateRow}>
      <View
        style={[
          styles.datePill,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <Text style={[styles.dateText, { color: theme.textTertiary }]}>{label}</Text>
      </View>
    </View>
  );
});

/**
 * 单条消息行。
 *
 * 用 memo 固定：流式期间每 60ms 会刷新一次 messages，但只有「正在流式的那一条」
 * 内容在变，其余行的 props 不变，应该被跳过。回调在这一层由 index 现算，
 * 从而避免父级在 map/renderItem 里内联闭包（内联闭包会让 memo 恒失效）。
 */
const MessageRow = memo(function MessageRow({
  role,
  content,
  streaming,
  index,
  canLongPress,
  createdAt,
  quote,
  attachments,
  versionActive,
  versionTotal,
  highlight,
  onLongPressIndex,
  onVersionChange,
}: {
  role: 'user' | 'assistant';
  content: string;
  streaming: boolean;
  index: number;
  canLongPress: boolean;
  createdAt?: number;
  quote?: string;
  attachments?: MessageAttachment[];
  versionActive?: number;
  versionTotal?: number;
  highlight: 'none' | 'match' | 'active';
  onLongPressIndex: (index: number) => void;
  onVersionChange?: (index: number, delta: -1 | 1) => void;
}) {
  const handleLongPress = useCallback(() => onLongPressIndex(index), [onLongPressIndex, index]);
  const handleVersionChange = useCallback(
    (delta: -1 | 1) => onVersionChange?.(index, delta),
    [onVersionChange, index]
  );

  return (
    <ChatMessage
      role={role}
      content={content}
      isStreaming={streaming}
      createdAt={createdAt}
      quote={quote}
      attachments={attachments}
      versionActive={versionActive}
      versionTotal={versionTotal}
      highlight={highlight}
      onVersionChange={onVersionChange ? handleVersionChange : undefined}
      onLongPress={canLongPress ? handleLongPress : undefined}
    />
  );
});

interface MessageListProps {
  messages: ChatMessageData[];
  isStreaming: boolean;
  /** 当前会话标识：切换会话时强制回到贴底 */
  conversationKey: string;
  /** 长按某条消息（传入稳定回调，不在行内新建） */
  onLongPressIndex: (index: number) => void;
  /** 切换某条消息的历史版本（传入稳定回调） */
  onVersionChange?: (index: number, delta: -1 | 1) => void;
  /** 搜索命中的消息下标（全部命中，用于描边强调） */
  matchedIndexes?: readonly number[];
  /** 当前聚焦的命中下标（强调色描边） */
  activeMatchIndex?: number | null;
  /** 请求滚动到该消息下标；值变化时触发一次跳转 */
  scrollToIndex?: number | null;
  ListEmptyComponent?: ReactElement | null;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * 消息列表。用 FlatList 做虚拟化：长对话时只保留视窗附近的行，
 * 避免消息数增长后每帧都要布局全部气泡。日期分隔被预处理进同一个 data 数组，
 * 由 FlatList 一起虚拟化——不用 SectionList 的分组：消息是变高内容，测量更贵，
 * 而且分组会让「按消息下标跳转」多一层换算。
 *
 * 自动滚动语义与原 ScrollView 实现保持一致：用户贴底时内容增长自动滚到底，
 * 用户主动上滑后不再打扰；切换会话、或在末尾追加新消息时重新贴底。
 */
export function MessageList({
  messages,
  isStreaming,
  conversationKey,
  onLongPressIndex,
  onVersionChange,
  matchedIndexes,
  activeMatchIndex,
  scrollToIndex,
  ListEmptyComponent,
  style,
  contentContainerStyle,
}: MessageListProps) {
  const listRef = useRef<FlatList<MessageListItem>>(null);
  const followingRef = useRef(true);
  const prevLengthRef = useRef(messages.length);
  const prevKeyRef = useRef(conversationKey);
  /**
   * 已处理过的跳转请求。data 会随流式刷新反复变化，必须靠它区分
   * 「用户点了上/下一条」和「只是列表内容变了」，否则流式期间会被反复拉回命中位置。
   */
  const handledJumpRef = useRef<{ target: number | null; retry: number }>({
    target: null,
    retry: 0,
  });
  const jumpRetryRef = useRef(0);
  /** 自增触发「测量完成后重试跳转」，不用定时器 */
  const [jumpRetry, setJumpRetry] = useState(0);

  /**
   * 「今天」的零点。不能把 `Date.now()` 直接写进渲染体（会破坏渲染纯度，
   * 本项目开了 React Compiler），所以用惰性 state 存一次，再每分钟校正一次；
   * 只有跨天时值才变，不会因为每分钟的检查而重渲染整表。
   */
  const [todayStart, setTodayStart] = useState(() => startOfDay(Date.now()));
  useEffect(() => {
    const timer = setInterval(() => {
      setTodayStart((prev) => {
        const next = startOfDay(Date.now());
        return next === prev ? prev : next;
      });
    }, MINUTE);
    return () => clearInterval(timer);
  }, []);

  const data = useMemo(
    () => buildDateSeparatedList(messages, todayStart),
    [messages, todayStart]
  );

  const matchedSet = useMemo(() => new Set(matchedIndexes ?? []), [matchedIndexes]);

  // 会话切换或末尾新增消息时恢复「跟读」；content updates 期间长度不变，不会打断用户上滑
  useEffect(() => {
    if (prevKeyRef.current !== conversationKey || messages.length > prevLengthRef.current) {
      followingRef.current = true;
    }
    prevKeyRef.current = conversationKey;
    prevLengthRef.current = messages.length;
  }, [conversationKey, messages.length]);

  // 搜索跳转：把目标消息滚到视窗中部；同时关掉「跟读」，免得被后续的自动滚动拉回底部
  useEffect(() => {
    if (scrollToIndex === null || scrollToIndex === undefined) {
      handledJumpRef.current = { target: null, retry: 0 };
      jumpRetryRef.current = 0;
      return;
    }
    const handled = handledJumpRef.current;
    // 换了目标就重置重试预算；同一目标且重试次数没变则说明只是列表内容变了，不重复滚动
    if (handled.target !== scrollToIndex) jumpRetryRef.current = 0;
    if (handled.target === scrollToIndex && handled.retry === jumpRetry) return;

    const flatIndex = data.findIndex(
      (item) => item.kind === 'message' && item.index === scrollToIndex
    );
    if (flatIndex < 0) return;
    handledJumpRef.current = { target: scrollToIndex, retry: jumpRetry };
    followingRef.current = false;
    listRef.current?.scrollToIndex({ index: flatIndex, animated: true, viewPosition: 0.5 });
  }, [scrollToIndex, jumpRetry, data]);

  /**
   * 消息是变高内容（Markdown），不能给 getItemLayout：目标行还没被测量时
   * scrollToIndex 会失败。先按平均行高把目标滚进视窗，等它被测量后再重试一次精确定位。
   */
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      if (jumpRetryRef.current >= MAX_JUMP_RETRY) return;
      jumpRetryRef.current += 1;
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      });
      setJumpRetry((n) => n + 1);
    },
    []
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const distanceToBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    followingRef.current = distanceToBottom < AUTO_SCROLL_THRESHOLD;
  }, []);

  const handleContentSizeChange = useCallback(() => {
    if (followingRef.current) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, []);

  const lastIndex = messages.length - 1;
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MessageListItem>) => {
      if (item.kind === 'date') {
        return <DateSeparator label={item.label} />;
      }
      const message = item.message;
      const view = messageVersionView(message);
      const highlight =
        activeMatchIndex === item.index
          ? 'active'
          : matchedSet.has(item.index)
            ? 'match'
            : 'none';
      return (
        <MessageRow
          role={message.role}
          content={message.content}
          streaming={isStreaming && item.index === lastIndex && message.role === 'assistant'}
          index={item.index}
          canLongPress={!isStreaming}
          createdAt={message.createdAt}
          quote={message.quote}
          attachments={message.attachments}
          versionActive={view?.active}
          versionTotal={view?.total}
          highlight={highlight}
          onLongPressIndex={onLongPressIndex}
          onVersionChange={onVersionChange}
        />
      );
    },
    [isStreaming, lastIndex, onLongPressIndex, onVersionChange, activeMatchIndex, matchedSet]
  );

  const keyExtractor = useCallback((item: MessageListItem) => item.key, []);

  return (
    <FlatList
      ref={listRef}
      style={style}
      contentContainerStyle={contentContainerStyle}
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListEmptyComponent={ListEmptyComponent}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onContentSizeChange={handleContentSizeChange}
      onScrollToIndexFailed={handleScrollToIndexFailed}
      initialNumToRender={INITIAL_NUM_TO_RENDER}
      maxToRenderPerBatch={MAX_TO_RENDER_PER_BATCH}
      windowSize={WINDOW_SIZE}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  dateRow: { alignItems: 'center', paddingVertical: Spacing.two },
  datePill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dateText: { fontSize: 12, fontWeight: '600' },
});
