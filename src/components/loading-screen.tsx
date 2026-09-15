import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 启动加载态。
 *
 * 冷启动时要等 API Key / 会话列表读完才能决定进设置引导还是对话页，
 * 这段空窗期若只给一个纯色 View，观感就是「白屏卡住」。这里给一个跟随主题的
 * 加载反馈，既消除疑虑，也避免首帧在引导页与对话页之间闪跳。
 */
export function LoadingScreen() {
  const theme = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.primary} />
      <ThemedText type="small" themeColor="textTertiary" style={styles.text}>
        正在准备你的会话…
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  text: { textAlign: 'center' },
});
