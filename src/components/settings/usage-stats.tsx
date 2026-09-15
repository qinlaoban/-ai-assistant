import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** 没有数据时显示占位符而不是 0——0 和「还没调过」是两回事 */
const NO_DATA = '—';

function formatTokens(value: number | null): string {
  if (value === null) return NO_DATA;
  return value.toLocaleString('en-US');
}

function UsageStat({ label, value }: { label: string; value: number | null }) {
  const theme = useTheme();

  return (
    <View style={[styles.cell, { backgroundColor: theme.backgroundInput, borderColor: theme.border }]}>
      <ThemedText type="code" themeColor="textSecondary" style={styles.value}>
        {formatTokens(value)}
      </ThemedText>
      <ThemedText themeColor="textTertiary" style={styles.label}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * 用量三格：最近一次的输入 / 输出，以及本会话累计。
 * 数值用等宽字体，位数变化时不会左右抖动。
 */
export function UsageStats({
  promptTokens,
  completionTokens,
  sessionTokens,
}: {
  promptTokens: number | null;
  completionTokens: number | null;
  sessionTokens: number | null;
}) {
  return (
    <View style={styles.row}>
      <UsageStat label="输入" value={promptTokens} />
      <UsageStat label="输出" value={completionTokens} />
      <UsageStat label="本会话累计" value={sessionTokens} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.one,
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  value: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 11 },
});
