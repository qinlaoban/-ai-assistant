import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 空态建议：把「不知道该问什么」变成一次点击。
 *
 * 提示语直接写成完整的请求文案，点一下即回填输入框，用户可再编辑后发送。
 * 文案覆盖代码、写作、排错三类高频场景，而不是占位字符串。
 */
const SUGGESTIONS: readonly { label: string; prompt: string }[] = [
  {
    label: '解释一段代码',
    prompt: '帮我逐段解释下面这段代码的作用，并指出可能存在的性能或安全问题：\n',
  },
  {
    label: '提炼成要点',
    prompt: '把下面这段内容提炼成三条要点，每条一句话：\n',
  },
  {
    label: '排查一个报错',
    prompt: '我遇到了下面这个报错，请分析可能的原因并按优先级给出修复方案：\n',
  },
];

export function EmptySuggestions({ onPick }: { onPick: (prompt: string) => void }) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {SUGGESTIONS.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="button"
          accessibilityLabel={`使用建议：${item.label}`}
          onPress={() => onPick(item.prompt)}
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="small" themeColor="link">
            {item.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.7 },
});
