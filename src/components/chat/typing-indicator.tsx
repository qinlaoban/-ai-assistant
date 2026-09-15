import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PERIOD_MS = 480;
const STAGGER_MS = 140;

/**
 * 等待首个 token 时的三点脉冲。
 * 三个 shared value 必须显式声明——旧实现把 useSharedValue 写在 .map() 里，
 * 属于「在循环里调 Hook」，只是碰巧数组长度固定才不会错位。
 */
export function TypingIndicator() {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  const dot0 = useSharedValue(0.3);
  const dot1 = useSharedValue(0.3);
  const dot2 = useSharedValue(0.3);

  useEffect(() => {
    if (reduceMotion) return;
    const values = [dot0, dot1, dot2];
    values.forEach((value, index) => {
      value.value = withRepeat(
        withDelay(index * STAGGER_MS, withTiming(1, { duration: PERIOD_MS })),
        -1,
        true
      );
    });
    return () => values.forEach(cancelAnimation);
  }, [dot0, dot1, dot2, reduceMotion]);

  const style0 = useAnimatedStyle(() => ({ opacity: dot0.value }));
  const style1 = useAnimatedStyle(() => ({ opacity: dot1.value }));
  const style2 = useAnimatedStyle(() => ({ opacity: dot2.value }));

  return (
    <View style={styles.row} accessibilityLabel="正在生成回答">
      {[style0, style1, style2].map((style, index) => (
        <Animated.View
          key={index}
          style={[styles.dot, { backgroundColor: theme.secondary }, style]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.one, paddingVertical: Spacing.two },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
