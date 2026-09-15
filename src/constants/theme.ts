import { Platform } from 'react-native';

import { SANS_FONT_FAMILY } from './fonts';

/**
 * 语义化颜色 token —— 所有 UI 颜色必须从这里取，禁止在组件里写死色值，
 * 否则暗色模式会出现白底白字。light / dark 两套必须保持键完全一致
 * （ThemeColor 类型依赖二者的交集）。
 *
 * 配色：深青绿（交互/关键操作）+ 暖橙（点睛/CTA）。
 * - primary 是「承载文字的填充色」，已实测与 onPrimary 的对比度 ≥4.5:1；
 *   亮一档的品牌青绿放在 secondary，只用于装饰，不再往它上面压文字。
 * - cta（橙）用于发送这类关键动作，配深色 onCta，避免白字压橙对比不足。
 */
export const Colors = {
  light: {
    // 文本
    text: '#0F172A',
    textSecondary: '#475569',
    textTertiary: '#64748B',
    onPrimary: '#FFFFFF',
    onCta: '#3B1204',
    link: '#0F766E',

    // 表面
    background: '#F0FDFA',
    backgroundElement: '#E2F6F1',
    backgroundSelected: '#C6EDE6',
    backgroundInput: '#FFFFFF',
    border: '#CDE8E3',
    borderStrong: '#A6D8D0',

    // 品牌
    primary: '#0F766E',
    secondary: '#0D9488',
    cta: '#F97316',

    // 对话气泡
    bubbleUser: '#0F766E',
    bubbleUserText: '#FFFFFF',
    bubbleAssistant: '#FFFFFF',
    bubbleAssistantText: '#0F172A',

    // 代码
    codeBackground: '#EAFBF4',
    codeText: '#115E59',

    // 引用
    quoteBorder: '#14B8A6',
    quoteBackground: '#F0FDFA',

    // 提示条 / 错误
    noticeBackground: '#FFEDD5',
    noticeText: '#9A3412',
    danger: '#DC2626',

    // 浮层（底部操作表）
    overlay: 'rgba(15, 23, 42, 0.32)',
    backgroundSheet: '#FFFFFF',
  },
  dark: {
    // 文本
    text: '#F0FDFA',
    textSecondary: '#94A3B8',
    textTertiary: '#7C8FA3',
    onPrimary: '#04211F',
    onCta: '#04211F',
    link: '#5EEAD4',

    // 表面
    background: '#04211F',
    backgroundElement: '#0B2C2A',
    backgroundSelected: '#12403C',
    backgroundInput: '#0B2C2A',
    border: '#1D4642',
    borderStrong: '#2C5C57',

    // 品牌
    primary: '#14B8A6',
    secondary: '#2DD4BF',
    cta: '#FB923C',

    // 对话气泡
    bubbleUser: '#0F766E',
    bubbleUserText: '#F0FDFA',
    bubbleAssistant: '#0B2C2A',
    bubbleAssistantText: '#D6F5F1',

    // 代码
    codeBackground: '#06201F',
    codeText: '#99F6E4',

    // 引用
    quoteBorder: '#2DD4BF',
    quoteBackground: '#06201F',

    // 提示条 / 错误
    noticeBackground: '#3A2410',
    noticeText: '#FDBA74',
    danger: '#F87171',

    // 浮层（底部操作表）
    overlay: 'rgba(0, 0, 0, 0.6)',
    backgroundSheet: '#0B2C2A',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * 字体族 token。
 *
 * 原生端 `sans` 是运行时加载的字体（见 src/constants/fonts.ts）：加载完成前该名字不可用，
 * 系统会静默回退到默认字体，不会白屏。web 端交给 CSS 字体栈，变量定义在 src/global.css。
 */
export const Fonts = Platform.select({
  ios: {
    sans: SANS_FONT_FAMILY,
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: SANS_FONT_FAMILY,
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: `${SANS_FONT_FAMILY}, Spline Sans, Inter, ui-sans-serif, system-ui, sans-serif`,
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * 这里原来有个 BottomTabInset（模板给的 ios:50 / android:80 估值），已删。
 * 原生 tab bar 的避让不需要手算高度：iOS 上原生会自动给页面里第一个 ScrollView 加
 * contentInset，底部固定元素用 useSafeAreaInsets() 取即可（tab bar 已计入安全区），
 * 手动再加一个估算值会和原生处理叠加成双份空白。
 */
export const MaxContentWidth = 800;
export const BorderRadius = {
  small: 8,
  medium: 12,
  large: 16,
  xl: 24,
} as const;
