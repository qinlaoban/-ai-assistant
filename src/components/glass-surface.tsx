import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useState, type ReactNode } from 'react';
import { Platform, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * 毛玻璃容器（iOS 26+ Liquid Glass）。
 *
 * 只负责「背景」这一层：布局、间距、分隔线由调用方通过 style 传入，
 * 这样不支持毛玻璃时除了底色之外的表现与改造前完全一致。
 *
 * 两道探测都要过才算支持：
 * - `isLiquidGlassAvailable()` 看系统版本与组件是否存在；
 * - `isGlassEffectAPIAvailable()` 是因为部分 iOS 26 beta 并没有该 API，直接用会崩
 *   （见 expo/expo#40911）。
 *
 * 另外注意：非 iOS 平台上 `GlassView` 只是个透传 props 的普通 `View`，**不会给任何底色**，
 * 所以不支持时这里必须自己补一层纯色，否则顶栏与输入区会整块变透明、文字糊在消息上。
 */
export function GlassSurface({
  children,
  style,
  /** 不支持毛玻璃时用来兜底的纯色；默认用主题的次级表面色 */
  fallbackColor,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  fallbackColor?: ColorValue;
}) {
  const theme = useTheme();
  const [supported] = useState(
    () => Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable()
  );

  if (!supported) {
    return (
      <View
        style={[
          style,
          { backgroundColor: fallbackColor ?? theme.backgroundElement, borderColor: theme.border },
        ]}>
        {children}
      </View>
    );
  }

  return (
    <GlassView
      glassEffectStyle="regular"
      // 颜色方案跟随系统，与 ThemeProvider 的选择一致，不在这里另开一套
      style={[style, { borderColor: theme.border }]}>
      {children}
    </GlassView>
  );
}
