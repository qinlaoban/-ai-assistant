import { useCallback, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

/** 被操作消息的摘要：折成一行再截断，否则一条长消息会把操作表撑爆 */
function summarize(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return '（空消息）';
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
}

/**
 * 消息级操作浮层：复制 / 重新生成 / 编辑并重发 / 删除。
 * 条目按消息角色和流式状态决定，避免出现「对用户消息重新生成」这类无效项。
 */
export function MessageActions({
  /** 当前被操作的消息下标；null 表示浮层关闭 */
  index,
  onClose,
  onNotify,
}: {
  index: number | null;
  onClose: () => void;
  onNotify: (text: string) => void;
}) {
  const theme = useTheme();
  const {
    messages,
    isStreaming,
    regenerate,
    continueGeneration,
    editAndResend,
    deleteMessage,
    copyMessage,
    quoteMessage,
    speakingIndex,
    speakMessage,
  } = useChat();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // 除了 null 还要防越界：截断/删除之后下标可能已经落在列表之外，
  // 那时应该当作「没有可操作对象」把浮层收掉，而不是渲染一个空壳
  const message = index === null ? null : (messages[index] ?? null);

  const handleClose = useCallback(() => {
    setEditing(false);
    onClose();
  }, [onClose]);

  const handleCopy = async () => {
    if (index === null) return;
    // 失败原因已经由 store 塞进错误条了，这里只在成功时给正反馈
    if (await copyMessage(index)) onNotify('已复制');
  };

  const handleSubmitEdit = () => {
    if (index === null) return;
    const text = draft.trim();
    if (text.length === 0) return;
    void editAndResend(index, text);
    handleClose();
  };

  // 流式期间 messages 还在被 flush 改写，除复制外的操作一律先禁掉，免得和收尾逻辑抢状态
  const busy = isStreaming;

  // 「继续生成」只对「最后一条、且有内容的助手消息」有意义：
  // 中间那条已经被后续问答接上了，谈不上续写
  const canContinue =
    message?.role === 'assistant' &&
    index === messages.length - 1 &&
    message.content.length > 0;

  const actions: SheetAction[] = message
    ? [
        { key: 'copy', label: '复制', onPress: () => void handleCopy() },
        {
          key: 'quote',
          label: '引用',
          onPress: () => {
            if (index === null) return;
            quoteMessage(index);
            onNotify('已引用到输入框');
          },
        },
        // 朗读只对助手回答有意义；正在念的那条再点一次即停止
        ...(message.role === 'assistant' && message.content.length > 0
          ? [
              {
                key: 'speak',
                label: speakingIndex === index ? '停止朗读' : '朗读',
                onPress: () => {
                  if (index !== null) speakMessage(index);
                },
              } satisfies SheetAction,
            ]
          : []),
        message.role === 'assistant'
          ? {
              key: 'regenerate',
              label: '重新生成',
              disabled: busy,
              onPress: () => {
                if (index !== null) void regenerate(index);
              },
            }
          : {
              key: 'edit',
              label: '编辑并重发',
              disabled: busy,
              // 不关浮层：把同一块面板原地换成编辑表单，少一次开合动作
              keepOpen: true,
              onPress: () => {
                setDraft(message.content);
                setEditing(true);
              },
            },
        ...(canContinue
          ? [
              {
                key: 'continue',
                label: '继续生成',
                disabled: busy,
                onPress: () => void continueGeneration(),
              } satisfies SheetAction,
            ]
          : []),
        {
          key: 'delete',
          label: '删除这条消息',
          tone: 'danger',
          disabled: busy,
          onPress: () => {
            if (index !== null) void deleteMessage(index);
          },
        },
      ]
    : [];

  const title = editing ? '编辑消息' : message?.role === 'user' ? '你的消息' : 'AI 回复';

  return (
    <ActionSheet
      visible={message !== null}
      title={title}
      message={editing || !message ? undefined : summarize(message.content)}
      actions={
        editing
          ? [{ key: 'send', label: '发送', tone: 'primary', onPress: handleSubmitEdit }]
          : actions
      }
      avoidKeyboard={editing}
      onClose={handleClose}>
      {editing ? (
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
          multiline
          autoFocus
          placeholder="修改后重新发送"
          placeholderTextColor={theme.textTertiary}
        />
      ) : null}
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 88,
    maxHeight: 180,
    fontSize: 15,
    lineHeight: 21,
    padding: Spacing.three,
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
