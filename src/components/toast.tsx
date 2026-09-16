import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** web 上没有原生动画模块，硬开 useNativeDriver 只会退化成 JS 动画并打一条警告 */
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

const FADE_IN_MS = 160;
/** 停留时长要够读完一句短提示，又不能挡着后续操作 */
const HOLD_MS = 1400;
const FADE_OUT_MS = 200;

/**
 * 轻提示。
 *
 * 生命周期自己管：淡入 → 停留 → 淡出，动画播完后再通过 onHidden 请父级把 message 置空。
 * 这样文案在整个动画期间都还在 props 里，不需要在组件内部另存一份副本，
 * 也就避开了「同步 props 到 state」那类既容易出错、又难读的写法。
 */
export function Toast({
  message,
  seq = 0,
  bottom,
  onHidden,
}: {
  message: string | null;
  /**
   * 同一条文案再次出现时的递增序号。
   * 少了它，连点两次「复制」时 message 没变 → 不重渲染 → effect 不重跑 →
   * 第二条提示完全不出现。
   */
  seq?: number;
  /** 悬浮在输入区上方的高度 */
  bottom: number;
  /** 动画播完的通知。父级必须用 useCallback 固定它，否则每次渲染都会把动画重启 */
  onHidden: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: reduceMotion ? 0 : FADE_IN_MS,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.delay(HOLD_MS),
      Animated.timing(opacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : FADE_OUT_MS,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]);
    animation.start(({ finished }) => {
      // 被下一条提示打断时（finished 为 false）不要通知，否则会把新提示一起清掉
      if (finished) onHidden();
    });
    return () => animation.stop();
  }, [message, seq, opacity, reduceMotion, onHidden]);

  if (!message) return null;

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          bottom,
          backgroundColor: theme.backgroundSheet,
          borderColor: theme.border,
          opacity,
          // 纯提示，绝不能参与手势，否则会挡住下面输入框的点击。
          // 写在 style 里：`pointerEvents` 作为 prop 已废弃
          pointerEvents: 'none',
        },
      ]}>
      <Text style={[styles.text, { color: theme.text }]}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { fontSize: 13, fontWeight: '600' },
});
