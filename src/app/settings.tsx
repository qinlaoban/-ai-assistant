import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
import { EndpointSection } from '@/components/settings/endpoint-section';
import { GenerationSection } from '@/components/settings/generation-section';
import { SettingsCard, SettingsNote, SettingsSection } from '@/components/settings/settings-section';
import { UsageStats } from '@/components/settings/usage-stats';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

function maskKey(key: string): string {
  if (key.length <= 12) return '••••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiKey, usage, sessionUsage, resetApiKey } = useChat();

  const [clearKeyVisible, setClearKeyVisible] = useState(false);
  // 关闭回调必须稳定：它进了操作表手势识别器的依赖，每次渲染换新函数会重建识别器
  const closeClearKey = useCallback(() => setClearKeyVisible(false), []);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          // 顶部：与对话页、会话页保持一致，iOS 由原生安全区自动让开，Android 得自己让开状态栏
          Platform.OS === 'android' && { paddingTop: insets.top + Spacing.three },
          // 底部：原生 tab bar 覆盖在内容之上，且不会给这个 ScrollView 自动加 contentInset，
          // 不自己让出高度时，最后一行「所有配置仅保存在本机…」会被 tab bar 压住。
          // insets.bottom 已包含 tab bar（见 index.tsx 的说明）；Android 的 tab 页已被原生
          // SafeAreaView 垫开，这里只留视觉间距即可。
          Platform.OS === 'ios' && { paddingBottom: insets.bottom + Spacing.five },
        ]}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <ThemedText type="subtitle" style={styles.pageTitle}>
            设置
          </ThemedText>

          <EndpointSection />
          <GenerationSection />

          <SettingsSection title="用量" caption="由服务端返回，仅供参考">
            <UsageStats
              promptTokens={usage ? usage.promptTokens : null}
              completionTokens={usage ? usage.completionTokens : null}
              sessionTokens={sessionUsage.totalTokens > 0 ? sessionUsage.totalTokens : null}
            />
          </SettingsSection>

          <SettingsSection title="API Key">
            <SettingsCard style={styles.keyCard}>
              <View style={styles.keyInfo}>
                <Text style={[styles.keyText, { color: theme.text }]}>
                  {apiKey.length > 0 ? maskKey(apiKey) : '未设置'}
                </Text>
                <ThemedText type="small" themeColor="textTertiary">
                  保存在本机安全存储，只发往上面填写的接口地址
                </ThemedText>
              </View>
              {apiKey.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="清除 API Key"
                  onPress={() => setClearKeyVisible(true)}
                  hitSlop={8}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <Text style={[styles.dangerText, { color: theme.danger }]}>清除</Text>
                </Pressable>
              ) : null}
            </SettingsCard>
          </SettingsSection>

          <SettingsNote>所有配置仅保存在本机，不会上传到任何第三方服务器。</SettingsNote>
        </View>
      </ScrollView>

      <ActionSheet
        visible={clearKeyVisible}
        title="API Key"
        message="清除后需要重新填入才能继续对话"
        onClose={closeClearKey}
        actions={[
          {
            key: 'clear',
            label: '清除密钥',
            tone: 'danger',
            onPress: () => void resetApiKey(),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  // 这里的 paddingBottom 只是基础视觉间距；iOS 避开 tab bar 的额外间距在 contentContainerStyle 里按安全区追加
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five },
  inner: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.four },
  pageTitle: { paddingTop: Spacing.four },
  keyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  keyInfo: { flex: 1, gap: Spacing.half },
  keyText: { fontSize: 15, fontWeight: '600' },
  dangerText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
