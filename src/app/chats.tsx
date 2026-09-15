import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionList } from '@/components/session-list';
import { ThemedText } from '@/components/themed-text';
import { BorderRadius, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

/**
 * Web 端的会话页。
 *
 * 原生端已经没有这一页了——会话列表进了抽屉（见 src/components/chat-drawer.tsx），
 * 底部 Tab 只保留 Home 与设置。列表本身由 SessionList 与抽屉共用。
 */
export default function ChatsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { startNewChat, refreshChats } = useChat();

  // 首页发完消息后回到本页，列表要跟着更新
  useFocusEffect(
    useCallback(() => {
      void refreshChats();
    }, [refreshChats])
  );

  const handleNew = () => {
    startNewChat();
    router.navigate('/');
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        // iOS 会把页面里第一个 ScrollView 的上下安全区自动避开；Android 只自动处理底部，
        // 顶部状态栏得自己让开
        Platform.OS === 'android' && { paddingTop: insets.top },
      ]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle">会话</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={handleNew}
            style={({ pressed }) => [
              styles.smallButton,
              { backgroundColor: theme.primary },
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.smallButtonText, { color: theme.onPrimary }]}>新建</Text>
          </Pressable>
        </View>

        {/* ownScroll 保持默认 false：外面已经有页面级 ScrollView，再嵌一层高度会算不出来 */}
        <SessionList onOpened={() => router.navigate('/')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // 底部避开 tab bar 的留白由原生自动 contentInset 提供，这里只留视觉间距
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five },
  inner: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.two },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  smallButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: BorderRadius.small,
  },
  smallButtonText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
