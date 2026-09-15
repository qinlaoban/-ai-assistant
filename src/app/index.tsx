import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { AnimatedIcon } from '@/components/animated-icon';
import { useChatDrawer } from '@/components/chat-drawer';
import { MessageActions } from '@/components/chat/message-actions';
import { MessageList } from '@/components/chat/message-list';
import { SearchBar } from '@/components/chat/search-bar';
import { VoiceButton, type VoiceStatus } from '@/components/chat/voice-button';
import { EmptySuggestions } from '@/components/empty-suggestions';
import { GlassSurface } from '@/components/glass-surface';
import {
  CloseIcon,
  MenuIcon,
  MoreIcon,
  PaperclipIcon,
  PlusIcon,
  SparkleIcon,
} from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Toast } from '@/components/toast';
import { PROMPT_TEMPLATES } from '@/constants/prompt-templates';
import { BorderRadius, Spacing } from '@/constants/theme';
import { usePersistentDraft } from '@/hooks/use-persistent-draft';
import { useTheme } from '@/hooks/use-theme';
import type { MessageAttachment } from '@/services/ai-service';
import {
  captureImageAttachment,
  MAX_ATTACHMENTS,
  pickImageAttachments,
  pickTextAttachments,
} from '@/services/attachments';
import { exportConversation } from '@/services/chat-export';
import { quoteSummary } from '@/services/chat-messages';
import { NEW_CHAT_DRAFT_ID } from '@/services/chat-storage';
import { estimateTokens, formatTokenCount } from '@/services/tokens';
import { useChat } from '@/store/chat-store';

/** 轻提示悬浮在输入区上方的高度 */
const TOAST_OFFSET = 72;

/** 空附件列表的稳定引用：直接写 [] 字面量会让依赖它的 useCallback 每次渲染都失效 */
const NO_ATTACHMENTS: MessageAttachment[] = [];

function ApiKeySetup() {
  const theme = useTheme();
  const { updateApiKey, error } = useChat();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (value.trim().length === 0) return;
    setBusy(true);
    await updateApiKey(value);
    setBusy(false);
    setValue('');
  };

  return (
    <View style={[styles.setup, { backgroundColor: theme.background }]}>
      <AnimatedIcon />
      <ThemedText type="title" style={styles.setupTitle}>
        AI Assistant
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
        填入 OpenAI API Key 即可开始。Key 只保存在本机安全存储中，不会上传到别处。
      </ThemedText>

      <TextInput
        style={[
          styles.keyInput,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.backgroundInput,
          },
        ]}
        value={value}
        onChangeText={setValue}
        placeholder="sk-..."
        placeholderTextColor={theme.textTertiary}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={submit}
      />

      <Pressable
        accessibilityRole="button"
        onPress={submit}
        disabled={busy || value.trim().length === 0}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.primary },
          (busy || value.trim().length === 0) && styles.disabled,
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>保存并开始</Text>
      </Pressable>

      {error ? (
        <Text style={[styles.setupError, { color: theme.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {
    messages,
    isStreaming,
    error,
    hasApiKey,
    currentTitle,
    currentChatId,
    quotedText,
    sendMessage,
    stopStreaming,
    retry,
    startNewChat,
    switchVersion,
    clearQuote,
    dismissError,
  } = useChat();

  const { open: openDrawer } = useChatDrawer();

  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    // iOS 用 will* 才能在键盘动画开始时就同步挤出去，did* 会慢半拍
    const [showEvent, hideEvent] =
      Platform.OS === 'ios'
        ? (['keyboardWillShow', 'keyboardWillHide'] as const)
        : (['keyboardDidShow', 'keyboardDidHide'] as const);

    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  /**
   * 输入草稿按会话持久化。草稿主体在「新对话」阶段还没有 id，用固定 key 暂存。
   * 刻意放在本地 hook 而不是 store：草稿每敲一个字就变，进全局 Context 会牵连其他消费者。
   */
  const draftId = currentChatId ?? NEW_CHAT_DRAFT_ID;
  const { draft, setDraft, resetDraft } = usePersistentDraft(draftId);

  /** 当前被长按的消息下标；null 表示操作表关闭 */
  const [actionIndex, setActionIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** 会话内搜索：是否展开、关键词、当前命中的第几条（0 起） */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  /** 顶栏「更多」菜单 */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 提示词模板浮层 */
  const [templatesOpen, setTemplatesOpen] = useState(false);
  /** 语音输入状态；由 VoiceButton 上抛，工具栏据此显示提示 */
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  /**
   * 待发送附件。用「所属草稿 id + 列表」一起存：切换会话后 id 对不上，
   * 附件自然失效 —— 不需要额外的清理 effect（也就避开了 effect 里直接 setState）。
   */
  const [pendingAttachments, setPendingAttachments] = useState<{
    id: string;
    items: MessageAttachment[];
  }>({ id: draftId, items: [] });
  const attachments = pendingAttachments.id === draftId ? pendingAttachments.items : NO_ATTACHMENTS;
  /** 附件选择浮层 */
  const [attachOpen, setAttachOpen] = useState(false);

  const notify = useCallback((text: string) => setToast(text), []);
  // 停留时长由 Toast 自己掌握，这里只负责在它播完动画后把文案清掉
  const handleToastHidden = useCallback(() => setToast(null), []);
  // 关闭回调必须稳定：它进了操作表手势识别器的依赖，每次渲染换新函数会重建识别器
  const closeActions = useCallback(() => setActionIndex(null), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeTemplates = useCallback(() => setTemplatesOpen(false), []);

  const handleSend = async () => {
    const text = draft.trim();
    // 只发附件、不写字也是合法的
    if ((text.length === 0 && attachments.length === 0) || isStreaming) return;
    const outgoing = attachments;
    resetDraft();
    setAttachments([]);
    await sendMessage(text, outgoing);
  };

  /** 模板插进输入框：空输入直接填，已有内容就换行追加，不覆盖用户已写的字 */
  const applyTemplate = useCallback(
    (text: string) => {
      const next =
        draft.trim().length === 0
          ? text
          : `${draft.replace(/\s+$/, '')}\n\n${text.trimEnd()}`;
      setDraft(next);
    },
    [draft, setDraft]
  );

  const templateActions: SheetAction[] = PROMPT_TEMPLATES.map((template) => ({
    key: template.key,
    label: template.label,
    onPress: () => applyTemplate(template.text),
  }));

  // 输入 token 预估：只在有内容时显示，给一个量级参考
  const draftTokens = useMemo(() => estimateTokens(draft), [draft]);

  const handleVoiceStatus = useCallback((status: VoiceStatus) => setVoiceStatus(status), []);

  /** 转写结果拼到已有草稿后面，不覆盖用户已经写好的字 */
  const handleTranscript = useCallback(
    (text: string) => {
      const merged =
        draft.trim().length === 0 ? text : `${draft.replace(/\s+$/, '')} ${text}`;
      setDraft(merged);
    },
    [draft, setDraft]
  );

  const setAttachments = useCallback(
    (items: MessageAttachment[]) => setPendingAttachments({ id: draftId, items }),
    [draftId]
  );

  const closeAttach = useCallback(() => setAttachOpen(false), []);

  const addAttachments = useCallback(
    async (picker: () => Promise<MessageAttachment[]>) => {
      try {
        const picked = await picker();
        if (picked.length === 0) return;
        const overflow = attachments.length + picked.length > MAX_ATTACHMENTS;
        if (overflow) notify(`一条消息最多带 ${MAX_ATTACHMENTS} 个附件`);
        setAttachments([...attachments, ...picked].slice(0, MAX_ATTACHMENTS));
      } catch (err) {
        notify(err instanceof Error ? err.message : '选择附件失败');
      }
    },
    [attachments, notify, setAttachments]
  );

  const removeAttachment = useCallback(
    (id: string) => setAttachments(attachments.filter((item) => item.id !== id)),
    [attachments, setAttachments]
  );

  const attachActions: SheetAction[] = [
    { key: 'camera', label: '拍照', onPress: () => void addAttachments(captureImageAttachment) },
    {
      key: 'library',
      label: '从相册选择',
      onPress: () => void addAttachments(pickImageAttachments),
    },
    {
      key: 'file',
      label: '选择文本文件',
      onPress: () => void addAttachments(pickTextAttachments),
    },
  ];

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setActiveMatch(0);
  }, []);

  // 换关键词就从第一个命中重新开始，避免停留在越界的下标上
  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    setActiveMatch(0);
  }, []);

  // 命中集合：只在关键词或消息变化时重算，O(n) 且仅在输入时触发
  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (keyword.length === 0) return [];
    const hits: number[] = [];
    messages.forEach((message, index) => {
      if (message.content.toLowerCase().includes(keyword)) hits.push(index);
    });
    return hits;
  }, [messages, query]);

  const gotoMatch = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      setActiveMatch((prev) => (prev + delta + matches.length) % matches.length);
    },
    [matches.length]
  );
  // 稳定回调：SearchBar 是 memo，内联箭头会让它在每次流式刷新时都重渲染
  const prevMatch = useCallback(() => gotoMatch(-1), [gotoMatch]);
  const nextMatch = useCallback(() => gotoMatch(1), [gotoMatch]);

  const handleExport = useCallback(async () => {
    const outcome = await exportConversation(messages, {
      title: currentTitle,
      updatedAt: Date.now(),
    });
    if (outcome === 'shared') notify('已导出为 Markdown');
    else if (outcome === 'copied') notify('已复制 Markdown 到剪贴板');
    else notify('导出失败，请稍后再试');
  }, [messages, currentTitle, notify]);

  const menuActions: SheetAction[] = [
    {
      key: 'search',
      label: '搜索对话',
      onPress: () => setSearchOpen(true),
    },
    {
      key: 'export',
      label: '导出为 Markdown',
      onPress: () => void handleExport(),
    },
  ];

  // 只用于错误条的「重试」判断；用 useMemo 固定，避免每次流式 flush 都 O(n) 扫描。
  // 必须放在提前 return 之前，否则 Hook 调用顺序会随分支变化
  const hasUserMessage = useMemo(
    () => messages.some((message) => message.role === 'user'),
    [messages]
  );

  /** 需要滚动到的消息下标；搜索关闭或没有命中时为 null */
  const matchTarget =
    searchOpen && matches.length > 0
      ? matches[Math.min(activeMatch, matches.length - 1)]
      : null;

  if (!hasApiKey) {
    return <ApiKeySetup />;
  }

  /**
   * 输入区固定在容器底部，而原生 tab bar 是叠加在内容之上的：
   * 原生只会给页面里第一个 ScrollView 自动加 contentInset，固定底部的 View 拿不到，
   * 所以这里必须自己让出 tab bar 的高度。
   *
   * safeAreaInsets.bottom 已经包含 tab bar（UIKit 把覆盖在内容上的 bars 计入安全区），
   * 键盘弹起时 tab bar 被键盘盖住，这段间距就该收掉，否则输入框会悬空一大截。
   */
  // 有正文或有附件就能发（只发一张图是合法用法）
  const canSend = draft.trim().length > 0 || attachments.length > 0;

  const composerBottomInset = keyboardVisible
    ? Spacing.two
    : Platform.OS === 'android'
      ? // Android 上 expo-router 把每个 tab 页包进 <SafeAreaView edges={{bottom:true}}>，
        // 而 rnscreens 的 TabsContainer.getInterfaceInsets() 会把 tab bar 高度报给这个
        // SafeAreaView，所以固定底部的输入区已经被原生垫开了，这里再加就成了双份
        Spacing.two
      : Math.max(insets.bottom, Spacing.two);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.background,
          // 顶部没人管：iOS 的 SafeAreaProvider 只负责「测量」不给 padding，
          // Android 的自动 SafeAreaView 只兜 bottom；而 header 是 ScrollView 的
          // 兄弟节点，拿不到原生给 ScrollView 的自动 contentInset
          paddingTop: insets.top,
        },
      ]}>
      <GlassSurface
        style={[styles.header, { borderBottomColor: theme.border }]}
        // 顶栏原本就没有自己的底色，兜底时也用页面底色，观感才和改造前一致
        fallbackColor={theme.background}>
        {/* 抽屉入口只在原生端出现：Web 已经有顶部胶囊导航，多一个入口反而多余 */}
        {Platform.OS === 'web' ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开会话抽屉"
            onPress={openDrawer}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerButton,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <MenuIcon color={theme.text} />
          </Pressable>
        )}

        <ThemedText type="smallBold" numberOfLines={1} style={styles.headerTitle}>
          {currentTitle}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="更多"
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: theme.backgroundElement },
            pressed && styles.pressed,
          ]}>
          <MoreIcon color={theme.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新建对话"
          onPress={startNewChat}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: theme.backgroundElement },
            pressed && styles.pressed,
          ]}>
          <PlusIcon color={theme.text} />
        </Pressable>
      </GlassSurface>

      {searchOpen ? (
        <SearchBar
          value={query}
          onChangeText={handleQueryChange}
          matchCount={matches.length}
          activeIndex={Math.min(activeMatch, Math.max(matches.length - 1, 0))}
          onPrev={prevMatch}
          onNext={nextMatch}
          onClose={closeSearch}
        />
      ) : null}

      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        // 切换会话时强制重新贴底；尚在「新对话」阶段用固定 key
        conversationKey={currentChatId ?? 'new'}
        onLongPressIndex={setActionIndex}
        onVersionChange={switchVersion}
        matchedIndexes={searchOpen ? matches : undefined}
        activeMatchIndex={matchTarget}
        scrollToIndex={matchTarget}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ThemedText type="subtitle" style={styles.centered}>
              有什么可以帮你？
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              支持 Markdown、代码块和表格。
            </ThemedText>
            <EmptySuggestions onPick={(text) => setDraft(text)} />
          </View>
        }
      />

      {error ? (
        <View style={[styles.errorBar, { backgroundColor: theme.noticeBackground }]}>
          <Text style={[styles.errorText, { color: theme.noticeText }]} numberOfLines={3}>
            {error}
          </Text>
          <View style={styles.errorActions}>
            {hasUserMessage && !isStreaming ? (
              <Pressable accessibilityRole="button" onPress={retry} hitSlop={8}>
                <Text style={[styles.errorAction, { color: theme.link }]}>重试</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={dismissError} hitSlop={8}>
              <Text style={[styles.errorAction, { color: theme.noticeText }]}>关闭</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {quotedText ? (
          <View
            style={[
              styles.quoteChip,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                borderLeftColor: theme.quoteBorder,
              },
            ]}>
            <Text
              style={[styles.quoteChipText, { color: theme.textSecondary }]}
              numberOfLines={1}>
              {quoteSummary(quotedText)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消引用"
              onPress={clearQuote}
              hitSlop={8}
              style={({ pressed }) => [styles.quoteChipClose, pressed && styles.pressed]}>
              <CloseIcon size={16} color={theme.textTertiary} />
            </Pressable>
          </View>
        ) : null}
        <GlassSurface
          style={[
            styles.composer,
            { borderTopColor: theme.border, paddingBottom: composerBottomInset },
          ]}>
          {attachments.length > 0 ? (
            <View style={styles.attachmentTray}>
              {attachments.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.attachmentChip,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  ]}>
                  {item.kind === 'image' ? (
                    <Image
                      source={{ uri: item.uri }}
                      style={styles.attachmentThumb}
                      contentFit="cover"
                    />
                  ) : (
                    <PaperclipIcon size={13} color={theme.textSecondary} />
                  )}
                  <Text
                    style={[styles.attachmentName, { color: theme.textSecondary }]}
                    numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`移除附件 ${item.name}`}
                    onPress={() => removeAttachment(item.id)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.attachmentRemove, pressed && styles.pressed]}>
                    <CloseIcon size={14} color={theme.textTertiary} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.backgroundInput,
                borderColor: theme.border,
              },
            ]}
            value={draft}
            onChangeText={setDraft}
            placeholder="输入消息…"
            placeholderTextColor={theme.textTertiary}
            multiline
            editable={!isStreaming}
            onSubmitEditing={handleSend}
          />

          <View style={styles.composerBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="插入提示词模板"
              onPress={() => setTemplatesOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}>
              <SparkleIcon size={20} color={theme.textSecondary} />
            </Pressable>

            <VoiceButton
              disabled={isStreaming}
              onTranscript={handleTranscript}
              onError={notify}
              onStatusChange={handleVoiceStatus}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加附件"
              onPress={() => setAttachOpen(true)}
              disabled={isStreaming}
              hitSlop={8}
              style={({ pressed }) => [
                styles.toolButton,
                isStreaming && styles.disabled,
                pressed && styles.pressed,
              ]}>
              <PaperclipIcon size={20} color={theme.textSecondary} />
            </Pressable>

            <View style={styles.composerSpacer} />

            {/* 语音状态优先显示：录音/识别期间比 token 数更要紧 */}
            {voiceStatus === 'recording' ? (
              <Text style={[styles.voiceHint, { color: theme.cta }]}>录音中，再点结束</Text>
            ) : voiceStatus === 'transcribing' ? (
              <Text style={[styles.voiceHint, { color: theme.textTertiary }]}>识别中…</Text>
            ) : draftTokens > 0 ? (
              <Text style={[styles.tokenHint, { color: theme.textTertiary }]}>
                {`≈${formatTokenCount(draftTokens)} tokens`}
              </Text>
            ) : null}

            {isStreaming ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="停止生成"
                onPress={stopStreaming}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.actionText, { color: theme.text }]}>停止</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="发送"
                onPress={handleSend}
                disabled={!canSend}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: theme.cta },
                  !canSend && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.actionText, { color: theme.onCta }]}>发送</Text>
              </Pressable>
            )}
          </View>
        </GlassSurface>
      </KeyboardAvoidingView>

      <Toast
        message={toast}
        bottom={composerBottomInset + TOAST_OFFSET}
        onHidden={handleToastHidden}
      />

      {/* 关闭时彻底卸载：它订阅了 messages，常驻会在每次流式 flush 重建 actions 数组 */}
      {actionIndex === null ? null : (
        <MessageActions index={actionIndex} onClose={closeActions} onNotify={notify} />
      )}

      <ActionSheet
        visible={menuOpen}
        title={currentTitle}
        actions={menuActions}
        onClose={closeMenu}
      />

      <ActionSheet
        visible={templatesOpen}
        title="提示词模板"
        message="点一条填进输入框，补上具体内容再发送"
        actions={templateActions}
        onClose={closeTemplates}
      />

      <ActionSheet
        visible={attachOpen}
        title="添加附件"
        message={`图片以多模态发送；文本类文件会内联进正文（最多 ${MAX_ATTACHMENTS} 个）`}
        actions={attachActions}
        onClose={closeAttach}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  setup: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  setupTitle: { fontSize: 24, fontWeight: '600', textAlign: 'center' },
  setupError: { fontSize: 13, textAlign: 'center' },
  centered: { textAlign: 'center' },
  keyInput: {
    width: '100%',
    fontSize: 16,
    padding: Spacing.three,
    borderRadius: BorderRadius.large,
    borderWidth: 1,
  },
  primaryButton: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: BorderRadius.large,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1 },
  headerButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: BorderRadius.small,
  },
  messages: { flex: 1 },
  messagesContent: {
    paddingTop: Spacing.three,
    // 避开底部 tab bar 的间距由原生自动 contentInset 提供（见 composerBottomInset 的注释），
    // 这里再加一次会和它叠成双份空白
    paddingBottom: Spacing.four,
  },
  empty: { alignItems: 'center', paddingVertical: Spacing.six, gap: Spacing.two },
  errorBar: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: BorderRadius.medium,
    gap: Spacing.two,
  },
  errorText: { fontSize: 13, lineHeight: 19 },
  errorActions: { flexDirection: 'row', gap: Spacing.four, justifyContent: 'flex-end' },
  errorAction: { fontSize: 13, fontWeight: '600' },
  // 竖排：输入框一行，工具栏一行（模板 / 语音 / 附件 … 右下角发送）
  composer: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 36,
  },
  composerSpacer: { flex: 1 },
  // 待发送附件：一排可移除的小胶囊，图片给缩略图
  attachmentTray: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    maxWidth: 200,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: BorderRadius.small,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachmentThumb: { width: 22, height: 22, borderRadius: 4 },
  attachmentName: { fontSize: 12, flexShrink: 1 },
  attachmentRemove: { padding: Spacing.half },
  toolButton: { paddingVertical: Spacing.one, paddingRight: Spacing.two },
  tokenHint: { fontSize: 11 },
  voiceHint: { fontSize: 11, fontWeight: '600' },
  // 引用胶囊：左侧品牌色竖线 + 一行摘要 + 取消
  quoteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: BorderRadius.small,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
  },
  quoteChipText: { flex: 1, fontSize: 13, lineHeight: 18 },
  quoteChipClose: { padding: Spacing.half },
  input: {
    // 不再 flex:1：输入框独占一行，flex 会把它在竖排里撑高
    minHeight: 40,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 120,
  },
  actionButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.large,
    justifyContent: 'center',
  },
  actionText: { fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
