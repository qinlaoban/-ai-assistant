import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionSheet } from '@/components/action-sheet';
import { SettingsCard, SettingsNote, SettingsSection } from '@/components/settings/settings-section';
import { ThemedText } from '@/components/themed-text';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useApiKeyDraft } from '@/hooks/use-api-key-draft';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

function maskKey(key: string): string {
  if (key.length <= 12) return '••••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

/**
 * 「API Key」分区。
 *
 * 密钥是跟着服务商走的：换一家服务商基本就要换一把 Key，所以这里必须能**直接替换**。
 * 只给「清除」是不够的 —— apiKey 一旦被清空，首页会立刻切回全屏的首次引导页，
 * 用户本意只是换把 Key，却被弹出去重走一遍引导流程。
 *
 * 「输入 → 保存」的逻辑与首启引导页共用 useApiKeyDraft，这里只负责排版与清除入口。
 */
export function ApiKeySection() {
  const theme = useTheme();
  const { apiKey, resetApiKey } = useChat();
  const { draft, setDraft, save, error, saved, canSave } = useApiKeyDraft();

  const [clearVisible, setClearVisible] = useState(false);
  // 关闭回调必须稳定：它进了操作表手势识别器的依赖，每次渲染换新函数会重建识别器
  const closeClear = useCallback(() => setClearVisible(false), []);

  return (
    <SettingsSection title="API Key" caption="各家密钥不通用，换服务商时在这里替换">
      <SettingsCard>
        <View style={styles.currentRow}>
          <View style={styles.currentInfo}>
            <Text style={[styles.keyText, { color: theme.text }]}>
              {apiKey.length > 0 ? maskKey(apiKey) : '未设置'}
            </Text>
            <ThemedText type="small" themeColor="textTertiary">
              仅保存在本机安全存储，只发往「接口」里填写的地址
            </ThemedText>
          </View>
          {apiKey.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清除 API Key"
              onPress={() => setClearVisible(true)}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}>
              <Text style={[styles.dangerText, { color: theme.danger }]}>清除</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.inputRow}>
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
            placeholder={apiKey.length > 0 ? '粘贴新 Key 以替换' : 'sk-...'}
            placeholderTextColor={theme.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => void save()}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: theme.primary },
              !canSave && styles.disabled,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.saveText, { color: theme.onPrimary }]}>保存</Text>
          </Pressable>
        </View>

        {error ? (
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        ) : saved ? (
          <ThemedText type="small" themeColor="link">
            已保存，下一次请求即生效
          </ThemedText>
        ) : (
          <SettingsNote>替换后立刻对下一次请求生效，历史对话不受影响。</SettingsNote>
        )}
      </SettingsCard>

      <ActionSheet
        visible={clearVisible}
        title="API Key"
        message="清除后需要重新填入才能继续对话"
        onClose={closeClear}
        actions={[
          {
            key: 'clear',
            label: '清除密钥',
            tone: 'danger',
            onPress: () => void resetApiKey(),
          },
        ]}
      />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  currentInfo: { flex: 1, gap: Spacing.half },
  keyText: { fontSize: 15, fontWeight: '600' },
  dangerText: { fontSize: 13, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    flex: 1,
    fontSize: 15,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveButton: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: BorderRadius.medium,
  },
  saveText: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
