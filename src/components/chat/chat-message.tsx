import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Markdown } from '@/components/chat/markdown';
import { TypingIndicator } from '@/components/chat/typing-indicator';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PaperclipIcon,
  SparkleIcon,
} from '@/components/icons';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MessageAttachment } from '@/services/ai-service';
import { quoteSummary } from '@/services/chat-messages';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  /** 正在流式输出：内容为空时显示脉冲点，已有内容时显示光标条 */
  isStreaming?: boolean;
  /** 发送时间（毫秒）；旧消息没有该字段时不显示，不伪造 */
  createdAt?: number;
  /** 引用的上下文；只有用户消息会带 */
  quote?: string;
  /** 该条消息的附件；只有用户消息会带 */
  attachments?: MessageAttachment[];
  /** 思考型模型的推理过程；非空时在正文上方渲染可折叠的思考区 */
  reasoning?: string;
  /**
   * 版本指示（用两个数字而不是对象：memo 按下标/总数比较值，
   * 传对象会让每次 render 都判定为新 props，流式期间整列表跟着重渲染）
   */
  versionActive?: number;
  versionTotal?: number;
  /** 切换历史版本（-1 上一个 / +1 下一个） */
  onVersionChange?: (delta: -1 | 1) => void;
  /**
   * 会话内搜索命中态：
   * - 'match' 命中但未聚焦，描边用较强的分隔色；
   * - 'active' 当前聚焦，用强调色。
   * 只换颜色不换宽度，跳转时不会布局跳动。
   */
  highlight?: 'none' | 'match' | 'active';
  /** 长按气泡打开操作表；流式期间父级不传，避免截断正在进行的请求 */
  onLongPress?: () => void;
}

/** 时钟格式（HH:mm）。入参固定时结果确定，渲染期调用是纯的 */
function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 思考过程折叠区。
 *
 * 思考期间（正文还没开始输出）默认展开，让用户看到推理正在进行；正文一来就自动收起，
 * 避免长推理把答案挤出屏幕。收起后仍可手动展开回看。
 * 独立成 memo 组件：流式期间只有正在改写的那条消息会重渲染。
 */
const ReasoningBlock = memo(function ReasoningBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(streaming);

  // 从「思考中」转为结束的那一刻自动收起一次；之后展开/折叠交给用户
  const wasStreamingRef = useRef(streaming);
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) setExpanded(false);
    wasStreamingRef.current = streaming;
  }, [streaming]);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  return (
    <View
      style={[
        styles.reasoning,
        { backgroundColor: theme.codeBackground, borderColor: theme.border },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? '收起思考过程' : '展开思考过程'}
        onPress={toggle}
        hitSlop={6}
        style={({ pressed }) => [styles.reasoningHeader, pressed && styles.pressed]}>
        <SparkleIcon size={14} color={theme.textTertiary} />
        <Text style={[styles.reasoningTitle, { color: theme.textSecondary }]}>
          {streaming ? '思考中…' : '思考过程'}
        </Text>
        <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>
          <ChevronRightIcon size={14} color={theme.textTertiary} />
        </View>
      </Pressable>
      {expanded ? (
        <Text selectable style={[styles.reasoningText, { color: theme.textSecondary }]}>
          {text}
        </Text>
      ) : null}
    </View>
  );
});

export const ChatMessage = memo(function ChatMessage({
  role,
  content,
  isStreaming = false,
  createdAt,
  quote,
  attachments,
  reasoning,
  versionActive = 0,
  versionTotal,
  onVersionChange,
  highlight = 'none',
  onLongPress,
}: ChatMessageProps) {
  const theme = useTheme();
  const isUser = role === 'user';
  const showVersionBar =
    Boolean(onVersionChange) && typeof versionTotal === 'number' && versionTotal > 1;

  const highlightColor =
    highlight === 'active' ? theme.cta : highlight === 'match' ? theme.borderStrong : null;
  const versionCount = versionTotal ?? 0;

  return (
    <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
      <Pressable
        onLongPress={onLongPress}
        // 只监听长按、不监听单击：否则会把 markdown 里的链接点击一起吃掉
        delayLongPress={280}
        disabled={!onLongPress}
        accessibilityRole={onLongPress ? 'button' : undefined}
        accessibilityLabel={onLongPress ? '长按打开消息操作' : undefined}
        style={({ pressed }) => [
          styles.bubble,
          isUser
            ? {
                backgroundColor: theme.bubbleUser,
                // 常态边框与底色同色＝不可见，只为命中态预留出稳定宽度
                borderColor: highlightColor ?? theme.bubbleUser,
                borderBottomRightRadius: BorderRadius.small,
              }
            : {
                backgroundColor: theme.bubbleAssistant,
                borderColor: highlightColor ?? theme.border,
                borderBottomLeftRadius: BorderRadius.small,
              },
          pressed && styles.pressed,
        ]}>
        {isUser ? (
          <>
            {attachments && attachments.length > 0 ? (
              <View style={styles.attachments}>
                {attachments.map((item) =>
                  item.kind === 'image' ? (
                    <Image
                      key={item.id}
                      source={{ uri: item.uri }}
                      style={styles.attachmentImage}
                      contentFit="cover"
                      accessibilityLabel={item.name}
                    />
                  ) : (
                    <View
                      key={item.id}
                      style={[styles.attachmentFile, { borderColor: theme.bubbleUserText }]}>
                      <PaperclipIcon size={13} color={theme.bubbleUserText} />
                      <Text
                        style={[styles.attachmentFileName, { color: theme.bubbleUserText }]}
                        numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                  )
                )}
              </View>
            ) : null}
            {quote ? (
              <View
                style={[
                  styles.quote,
                  {
                    backgroundColor: theme.quoteBackground,
                    borderLeftColor: theme.quoteBorder,
                  },
                ]}>
                <Text
                  style={[styles.quoteText, { color: theme.textSecondary }]}
                  numberOfLines={2}>
                  {quoteSummary(quote)}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.userText, { color: theme.bubbleUserText }]}>{content}</Text>
          </>
        ) : (
          <>
            {reasoning && reasoning.length > 0 ? (
              // 正文还没开始时才算「思考中」，正文一来就自动收起思考区
              <ReasoningBlock text={reasoning} streaming={isStreaming && content.length === 0} />
            ) : null}
            {isStreaming && content.length === 0 && !reasoning ? <TypingIndicator /> : null}
            <Markdown text={content} color={theme.bubbleAssistantText} />
            {isStreaming && content.length > 0 ? (
              <View style={[styles.caret, { backgroundColor: theme.textTertiary }]} />
            ) : null}
          </>
        )}
      </Pressable>

      {showVersionBar && onVersionChange ? (
        <View
          style={[
            styles.versionBar,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="上一个版本"
            accessibilityState={{ disabled: versionActive <= 0 }}
            disabled={versionActive <= 0}
            hitSlop={6}
            onPress={() => onVersionChange(-1)}
            style={({ pressed }) => [styles.versionArrow, pressed && styles.pressed]}>
            <ChevronLeftIcon
              size={16}
              color={versionActive <= 0 ? theme.textTertiary : theme.link}
            />
          </Pressable>
          <Text style={[styles.versionText, { color: theme.textSecondary }]}>
            {`${versionActive + 1}/${versionCount}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="下一个版本"
            accessibilityState={{ disabled: versionActive >= versionCount - 1 }}
            disabled={versionActive >= versionCount - 1}
            hitSlop={6}
            onPress={() => onVersionChange(1)}
            style={({ pressed }) => [styles.versionArrow, pressed && styles.pressed]}>
            <ChevronRightIcon
              size={16}
              color={versionActive >= versionCount - 1 ? theme.textTertiary : theme.link}
            />
          </Pressable>
        </View>
      ) : null}

      {typeof createdAt === 'number' ? (
        <Text style={[styles.time, { color: theme.textTertiary }]}>
          {formatClock(createdAt)}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  rowRight: { alignItems: 'flex-end' },
  rowLeft: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '86%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.large,
    // 固定 1px：命中态只换颜色，不换宽度，避免气泡在搜索跳转时跳动
    borderWidth: 1,
  },
  userText: { fontSize: 15, lineHeight: 22 },
  // 附件区：图片缩略图平铺，文本文件用一枚带边框的小胶囊
  attachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  attachmentImage: { width: 96, height: 96, borderRadius: BorderRadius.small },
  attachmentFile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    maxWidth: '100%',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: BorderRadius.small,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachmentFileName: { fontSize: 12, flexShrink: 1 },
  // 引用块：左侧品牌色竖线的浅底块
  quote: {
    borderLeftWidth: 3,
    borderRadius: BorderRadius.small,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    marginBottom: Spacing.two,
  },
  quoteText: { fontSize: 13, lineHeight: 18 },
  caret: { width: 8, height: 3, borderRadius: 2, marginTop: Spacing.one },
  versionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.one,
    borderRadius: BorderRadius.small,
    borderWidth: StyleSheet.hairlineWidth,
  },
  versionArrow: { paddingHorizontal: Spacing.one, paddingVertical: 2 },
  versionText: { fontSize: 12, fontWeight: '600', minWidth: 30, textAlign: 'center' },
  // 思考过程折叠区：比正文更弱化的浅底块，表头可点开/收起
  reasoning: {
    borderRadius: BorderRadius.small,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    marginBottom: Spacing.two,
    gap: Spacing.one,
  },
  reasoningHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  reasoningTitle: { fontSize: 12, fontWeight: '600', flex: 1 },
  reasoningText: { fontSize: 13, lineHeight: 20 },
  time: { fontSize: 11, marginTop: 2, marginHorizontal: Spacing.one },
  // 长按期间给一点压感反馈；用透明度而不是缩放，避免文字在按住时糊掉或位移
  pressed: { opacity: 0.85 },
});
