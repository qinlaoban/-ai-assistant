import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiKeySection } from '@/components/settings/api-key-section';
import { EndpointSection } from '@/components/settings/endpoint-section';
import { GenerationSection } from '@/components/settings/generation-section';
import { SettingsNote, SettingsSection } from '@/components/settings/settings-section';
import { UsageStats } from '@/components/settings/usage-stats';
import { ThemedText } from '@/components/themed-text';
import { findProviderByBaseUrl, normalizeBaseUrl } from '@/constants/chat-params';
import { BorderRadius, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

/**
 * 「当前配置」概览。
 *
 * 设置项散在下面几个分区里，光看输入框很难确认「现在到底生效的是哪一套」；
 * 这里把服务商与模型汇总成一行，顺便把「还没设 Key」这种会直接导致发不出消息的状态顶到最前面。
 */
function CurrentConfig() {
  const theme = useTheme();
  const { model, apiKey, generationSettings } = useChat();

  const endpoint = normalizeBaseUrl(generationSettings.apiBaseUrl);
  const provider = findProviderByBaseUrl(endpoint);
  // 认不出服务商就是自定义/中转网关，这时直接把地址亮出来比写「自定义地址」更有用
  const target = provider ? provider.label : endpoint.replace(/^https?:\/\//, '');

  return (
    <View
      style={[
        styles.summary,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryProvider, { color: theme.text }]} numberOfLines={1}>
          {target}
        </Text>
        <ThemedText
          type="small"
          themeColor="textTertiary"
          numberOfLines={1}
          style={styles.summaryModel}>
          {model.length > 0 ? model : '未填模型 ID'}
        </ThemedText>
      </View>
      {apiKey.length > 0 ? (
        <ThemedText type="small" themeColor="textTertiary" numberOfLines={1}>
          {endpoint}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="danger">
          尚未设置 API Key，到「API Key」分区填入后才能对话
        </ThemedText>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { usage, sessionUsage } = useChat();

  return (
    <View
      // native tabs 的硬性结构要求：包装层一旦被「折叠」掉，框架就找不到屏幕里那个
      // ScrollView —— 自动 contentInset 不生效、「点击已激活 tab 回到顶部」失效，
      // iOS 18 及更早还会让 tab bar 一进入就是透明的。
      // 见 Expo native-tabs 文档的 Safe Area Handling / Common problems。
      collapsable={false}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scroll}
        // 自己接管安全区，不依赖框架的自动 contentInset：本页原先正是因为它没生效，
        // 才出现「设置」标题被状态栏压住。关掉自动调整后，下面这行 padding 就是唯一来源，
        // 两端行为一致，也不会与自动机制叠加成双份留白。
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.content,
          // 顶部让开状态栏；标题自身的 paddingTop 负责一点呼吸空间
          { paddingTop: insets.top },
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

          <CurrentConfig />
          <EndpointSection />
          <GenerationSection />

          <SettingsSection title="用量" caption="由服务端返回，仅供参考">
            <UsageStats
              promptTokens={usage ? usage.promptTokens : null}
              completionTokens={usage ? usage.completionTokens : null}
              sessionTokens={sessionUsage.totalTokens > 0 ? sessionUsage.totalTokens : null}
            />
          </SettingsSection>

          <ApiKeySection />

          <SettingsNote>所有配置仅保存在本机，不会上传到任何第三方服务器。</SettingsNote>
        </View>
      </ScrollView>
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
  summary: {
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  // 服务商名与模型 ID 都可能很长（中转地址会直接显示域名），两边都要能收缩，别把对方挤没
  summaryProvider: { flexShrink: 1, fontSize: 15, fontWeight: '700' },
  summaryModel: { flexShrink: 1, textAlign: 'right' },
});
