import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 设置页的分区原语。
 *
 * 分区标题刻意比对话页的 `subtitle`（32px）小一号：对话页只有两三个分区，
 * 大字号撑得住；设置页分区多，全用大字号会把层级压平、页面显得很吵。
 */
export function SettingsSection({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText themeColor="textSecondary" style={styles.title}>
        {title}
      </ThemedText>
      {caption ? (
        <ThemedText type="small" themeColor="textTertiary" style={styles.caption}>
          {caption}
        </ThemedText>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

/** 统一的圆角卡片容器：设置页里除了 chips 以外的内容都装在这里面 */
export function SettingsCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        style,
      ]}>
      {children}
    </View>
  );
}

/** 弱化的补充说明，用于「仅保存在本机」这类注解 */
export function SettingsNote({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="small" themeColor="textTertiary" style={styles.note}>
      {children}
    </ThemedText>
  );
}

/**
 * 字段标题右侧的注解位：平时显示填法提示，刚落盘时短暂让位给「已保存」。
 *
 * 设置页没有提交按钮，用户改完无从确认是否存上；这里复用本来就要显示提示的位置做反馈，
 * 不额外占版面，也不会像 Toast 那样打断操作。
 */
export function FieldHint({ hint, saved }: { hint: string; saved: boolean }) {
  return saved ? (
    <ThemedText type="small" themeColor="link">
      已保存
    </ThemedText>
  ) : (
    <ThemedText type="small" themeColor="textTertiary">
      {hint}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.one },
  title: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  caption: { fontSize: 12 },
  body: { gap: Spacing.two, marginTop: Spacing.one },
  card: {
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  note: { fontSize: 12, lineHeight: 18 },
});
