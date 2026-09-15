import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MoreIcon } from '@/components/icons';
import { SessionActions } from '@/components/session-actions';
import { ThemedText } from '@/components/themed-text';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';
import type { ChatSummary } from '@/services/chat-storage';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatTime(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

interface SessionRowProps {
  chat: ChatSummary;
  active: boolean;
  now: number;
  onOpen: (id: string) => void;
  onOpenActions: (id: string) => void;
}

/**
 * 会话行。
 *
 * memo 固定：会话列表在抽屉关闭时也应尽量少重渲染；行内不新建回调，
 * 由父级传稳定的 `onOpen` / `onOpenActions`，再在这一层按 id 现算。
 */
const SessionRow = memo(function SessionRow({
  chat,
  active,
  now,
  onOpen,
  onOpenActions,
}: SessionRowProps) {
  const theme = useTheme();
  const handleOpen = useCallback(() => onOpen(chat.id), [onOpen, chat.id]);
  const handleActions = useCallback(() => onOpenActions(chat.id), [onOpenActions, chat.id]);

  return (
    <View
      style={[
        styles.chatRow,
        {
          backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: theme.border,
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        style={styles.chatBody}
        onPress={handleOpen}
        onLongPress={handleActions}>
        <ThemedText type="small" numberOfLines={1} style={styles.chatTitle}>
          {chat.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textTertiary" style={styles.chatMeta}>
          {formatTime(chat.updatedAt, now)}
        </ThemedText>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`更多操作：${chat.title}`}
        onPress={handleActions}
        hitSlop={8}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
        <MoreIcon color={theme.textSecondary} />
      </Pressable>
    </View>
  );
});

/**
 * 会话列表（搜索框 + 行 + 空态 + 会话操作表）。
 *
 * 原生端的抽屉与 Web 的会话页共用这一份实现，两边的差别只有「选中之后干什么」，
 * 交给 `onOpened` 决定：抽屉用它收起自己，Web 页面用它跳回对话页。
 */
export function SessionList({
  onOpened,
  emptyHint = '还没有历史会话。发一条消息就会自动保存。',
  ownScroll = false,
}: {
  /** 会话被打开后的回调 */
  onOpened?: () => void;
  /** 一条会话都没有时的提示文案 */
  emptyHint?: string;
  /**
   * 是否自带滚动容器。
   * 抽屉里高度固定，需要自己滚（用 FlatList 虚拟化）；Web 页面外面已经有一层
   * 页面级 ScrollView，再嵌一层会让高度算不出来，所以那边传 false。
   */
  ownScroll?: boolean;
}) {
  const theme = useTheme();
  const { chats, currentChatId, openChat, removeChat, renameChat } = useChat();

  const [query, setQuery] = useState('');
  /** 只存 id，标题永远从最新的 chats 里取，重命名之后摘要不会显示成旧值 */
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  /**
   * 相对时间的基准。不能直接 `Date.now()` 写进渲染体——那会破坏渲染纯度
   * （本项目开了 React Compiler），这里改成每分钟自增一次。
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);

  // 关闭回调必须稳定：它进了操作表手势识别器的依赖，每次渲染换新函数会重建识别器
  const closeActions = useCallback(() => setActiveChatId(null), []);

  const handleOpen = useCallback(
    async (id: string) => {
      await openChat(id);
      onOpened?.();
    },
    [openChat, onOpened]
  );

  /** 行内 onPress 需要的是同步函数；真正的异步打开丢给 handleOpen */
  const open = useCallback(
    (id: string) => {
      void handleOpen(id);
    },
    [handleOpen]
  );

  // 会话量级只有几十条，直接在内存里过滤；不需要防抖，也不需要给存储层加索引
  const keyword = query.trim().toLowerCase();
  const visibleChats = useMemo(
    () =>
      keyword.length === 0
        ? chats
        : chats.filter((chat) => chat.title.toLowerCase().includes(keyword)),
    [chats, keyword]
  );

  const activeChat =
    activeChatId === null ? null : (chats.find((chat) => chat.id === activeChatId) ?? null);

  const rowProps = useCallback(
    (chat: ChatSummary): SessionRowProps => ({
      chat,
      active: chat.id === currentChatId,
      now,
      onOpen: open,
      onOpenActions: setActiveChatId,
    }),
    [currentChatId, now, open]
  );

  const keyExtractor = useCallback((chat: ChatSummary) => chat.id, []);

  const emptyCard = (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <ThemedText type="small" themeColor="textSecondary">
        {chats.length === 0 ? emptyHint : `没有匹配「${query.trim()}」的会话。`}
      </ThemedText>
    </View>
  );

  return (
    <>
      <View
        style={[
          styles.searchWrapper,
          { backgroundColor: theme.backgroundInput, borderColor: theme.border },
        ]}>
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          value={query}
          onChangeText={setQuery}
          placeholder="搜索会话标题"
          placeholderTextColor={theme.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除搜索"
            onPress={() => setQuery('')}
            hitSlop={8}
            style={({ pressed }) => [styles.searchClear, pressed && styles.pressed]}>
            <Text style={[styles.searchClearText, { color: theme.textTertiary }]}>×</Text>
          </Pressable>
        ) : null}
      </View>

      {ownScroll ? (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={visibleChats}
          renderItem={({ item }) => <SessionRow {...rowProps(item)} />}
          keyExtractor={keyExtractor}
          ListEmptyComponent={emptyCard}
          keyboardShouldPersistTaps="handled"
        />
      ) : visibleChats.length === 0 ? (
        emptyCard
      ) : (
        visibleChats.map((chat) => <SessionRow key={chat.id} {...rowProps(chat)} />)
      )}

      <SessionActions
        chat={activeChat}
        onClose={closeActions}
        onOpen={open}
        onRename={renameChat}
        onRemove={removeChat}
      />
    </>
  );
}

const styles = StyleSheet.create({
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: Spacing.three },
  searchClear: { paddingLeft: Spacing.two },
  searchClearText: { fontSize: 18, fontWeight: '600', lineHeight: 22 },
  list: { flex: 1 },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.two },
  card: {
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chatBody: { flex: 1, padding: Spacing.three, gap: Spacing.half },
  chatTitle: { fontSize: 15 },
  chatMeta: { fontSize: 12 },
  moreButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  pressed: { opacity: 0.7 },
});
