import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AnimatedIcon } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useApiKeyDraft } from '@/hooks/use-api-key-draft';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

/**
 * 首次启动的密钥引导页（整屏）。
 *
 * 与设置页的「API Key」卡片共用 useApiKeyDraft，「输入 → 保存」的行为只有一份；
 * 这里只负责整屏引导的排版。之所以仍在首屏而不是设置页：一条 Key 都没有时
 * 对话页没有任何可用操作，直接把入口摆在面前比让人自己去找设置快得多。
 */
export function ApiKeySetup() {
  const theme = useTheme();
  // store 的 error 是请求期错误（例如 Key 填错后发消息失败），与保存失败是两回事，两个都要显示
  const { error } = useChat();
  const { draft, setDraft, save, error: saveError, canSave } = useApiKeyDraft();

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
        value={draft}
        onChangeText={setDraft}
        placeholder="sk-..."
        placeholderTextColor={theme.textTertiary}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={() => void save()}
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => void save()}
        disabled={!canSave}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.primary },
          !canSave && styles.disabled,
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>保存并开始</Text>
      </Pressable>

      {error || saveError ? (
        <Text style={[styles.setupError, { color: theme.danger }]}>{error ?? saveError}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
