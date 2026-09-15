import { memo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '@/components/icons';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 会话内搜索条。
 *
 * 视觉沿用会话列表搜索框（圆角描边），右侧是「n/m」计数与上/下跳转、关闭。
 * 没有命中时显示「无结果」而不是留空 —— 空手而归也要有交代。
 */
export const SearchBar = memo(function SearchBar({
  value,
  onChangeText,
  matchCount,
  activeIndex,
  onPrev,
  onNext,
  onClose,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** 命中总数 */
  matchCount: number;
  /** 当前聚焦的命中下标（0 起） */
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const hasQuery = value.trim().length > 0;
  const counter = !hasQuery ? '' : matchCount === 0 ? '无结果' : `${activeIndex + 1}/${matchCount}`;

  return (
    <View
      style={[
        styles.wrapper,
        { backgroundColor: theme.backgroundInput, borderColor: theme.border },
      ]}>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder="在当前对话中查找"
        placeholderTextColor={theme.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="search"
        onSubmitEditing={onNext}
      />

      {hasQuery ? (
        <Text style={[styles.counter, { color: theme.textTertiary }]}>{counter}</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="上一个结果"
        accessibilityState={{ disabled: matchCount === 0 }}
        disabled={matchCount === 0}
        hitSlop={6}
        onPress={onPrev}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <ChevronLeftIcon size={18} color={matchCount === 0 ? theme.textTertiary : theme.text} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="下一个结果"
        accessibilityState={{ disabled: matchCount === 0 }}
        disabled={matchCount === 0}
        hitSlop={6}
        onPress={onNext}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <ChevronRightIcon size={18} color={matchCount === 0 ? theme.textTertiary : theme.text} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭搜索"
        hitSlop={6}
        onPress={onClose}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <CloseIcon size={18} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: Spacing.three, paddingRight: Spacing.one },
  counter: { fontSize: 13, fontWeight: '600', minWidth: 44, textAlign: 'right' },
  iconButton: { padding: Spacing.one },
  pressed: { opacity: 0.6 },
});
