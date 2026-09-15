import { useCallback, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { TITLE_MAX_LENGTH, type ChatSummary } from '@/services/chat-storage';

/**
 * 会话级操作浮层：打开 / 重命名 / 删除。
 * 列表行的长按与行尾「更多」共用同一个浮层，避免维护两套确认逻辑。
 * 删除沿用「浮层原地切换成确认态」的方式，保住原来 Alert 那层二次确认。
 */
export function SessionActions({
  /** 被操作的会话；null 表示浮层关闭 */
  chat,
  onClose,
  onOpen,
  onRename,
  onRemove,
}: {
  chat: ChatSummary | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'menu' | 'rename' | 'confirmDelete'>('menu');

  const handleClose = useCallback(() => {
    setMode('menu');
    onClose();
  }, [onClose]);

  const handleSubmitRename = () => {
    if (!chat) return;
    const title = draft.trim();
    if (title.length === 0) return;
    void onRename(chat.id, title);
    handleClose();
  };

  const handleConfirmDelete = () => {
    if (!chat) return;
    void onRemove(chat.id);
    handleClose();
  };

  const menuActions: SheetAction[] = chat
    ? [
        { key: 'open', label: '打开', onPress: () => onOpen(chat.id) },
        {
          key: 'rename',
          label: '重命名',
          keepOpen: true,
          onPress: () => {
            setDraft(chat.title);
            setMode('rename');
          },
        },
        {
          key: 'remove',
          label: '删除会话',
          tone: 'danger',
          // 同样不关浮层：先切到确认态，避免手滑一次就删掉整段对话
          keepOpen: true,
          onPress: () => setMode('confirmDelete'),
        },
      ]
    : [];

  const actions: SheetAction[] =
    mode === 'rename'
      ? [{ key: 'save', label: '保存', tone: 'primary', onPress: handleSubmitRename }]
      : mode === 'confirmDelete'
        ? [{ key: 'confirm-remove', label: '确认删除', tone: 'danger', onPress: handleConfirmDelete }]
        : menuActions;

  const title = mode === 'rename' ? '重命名会话' : mode === 'confirmDelete' ? '删除会话' : '会话';

  const message =
    mode === 'confirmDelete'
      ? `确定删除「${chat?.title ?? ''}」？此操作不可撤销。`
      : mode === 'rename'
        ? undefined
        : chat?.title;

  return (
    <ActionSheet
      visible={chat !== null}
      title={title}
      message={message}
      actions={actions}
      avoidKeyboard={mode === 'rename'}
      onClose={handleClose}>
      {mode === 'rename' ? (
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
          autoFocus
          // 改名绝大多数是「整条换掉」而不是微调，所以进来就全选
          selectTextOnFocus
          maxLength={TITLE_MAX_LENGTH}
          returnKeyType="done"
          onSubmitEditing={handleSubmitRename}
          placeholder="会话标题"
          placeholderTextColor={theme.textTertiary}
        />
      ) : null}
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  input: {
    fontSize: 15,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
