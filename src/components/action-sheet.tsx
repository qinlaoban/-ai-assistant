import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BorderRadius, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** web 上没有原生动画模块，硬开 useNativeDriver 只会退化成 JS 动画并打一条警告 */
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

/** 拖过这个距离（或甩得比这个速度更快）就认为用户想关掉浮层 */
const DISMISS_DISTANCE = 72;
const DISMISS_VELOCITY = 0.8;
/** 入场位移：从下方轻轻推上来，而不是硬切 */
const ENTER_OFFSET = 28;
const ENTER_DURATION = 180;
const SETTLE_DURATION = 160;

export interface SheetAction {
  key: string;
  label: string;
  /** danger 用于删除这类不可逆操作，用错误色渲染；primary 用于确认类主操作 */
  tone?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
  /** 需要浮层原地换成另一种形态时（如「编辑并重发」）不要自动关闭 */
  keepOpen?: boolean;
  onPress: () => void;
}

export interface ActionSheetProps {
  visible: boolean;
  /** 顶部小字说明，例如「会话」 */
  title?: string;
  /** 被操作对象的摘要，超过两行自动截断 */
  message?: string;
  actions?: SheetAction[];
  onClose: () => void;
  /** 内容里含输入框时打开：键盘弹起要把浮层顶上去，否则输入框会被盖住 */
  avoidKeyboard?: boolean;
  /** 需要自定义内容（比如重命名输入框）时替代 actions 渲染 */
  children?: ReactNode;
}

type SheetTone = SheetAction['tone'];

function actionTone(theme: ReturnType<typeof useTheme>, tone: SheetTone): string {
  if (tone === 'danger') return theme.danger;
  if (tone === 'primary') return theme.primary;
  return theme.text;
}

/**
 * 统一的底部操作表。
 *
 * 之所以自研而不用 ActionSheetIOS / Alert：两端 API 差异大，Alert 又做不出
 * 「消息摘要 + 多个条目 + danger 态」这种结构，自研一份反而更短、且两端表现一致。
 *
 * 手势刻意用 RN 自带的 PanResponder：文件里没有 GestureHandlerRootView，
 * 而 Modal 内部是独立的手势宿主，react-native-gesture-handler 在这里并不可靠。
 */
export function ActionSheet({
  visible,
  title,
  message,
  actions = [],
  onClose,
  avoidKeyboard = false,
  children,
}: ActionSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  // 用 state 而不是 useRef().current：后者等于在渲染期读 ref，
  // 会破坏渲染纯度（本项目开了 React Compiler），这里只需要一个稳定的实例
  const [translateY] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(reduceMotion ? 0 : ENTER_OFFSET);
    Animated.timing(translateY, {
      toValue: 0,
      duration: ENTER_DURATION,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [visible, reduceMotion, translateY]);

  // 依赖里带上 onClose：调用方需要用 useCallback 固定它，否则每次父级渲染都会重建手势识别器。
  // 之所以不绕 ref 去躲这个依赖，是因为「渲染期读 ref」会破坏纯度（本项目开了 React Compiler）。
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // 只接管「明显向下」的纵向手势，否则会把条目上的点击一起抢走
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          translateY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
            onClose();
            return;
          }
          Animated.timing(translateY, {
            toValue: 0,
            duration: SETTLE_DURATION,
            useNativeDriver: USE_NATIVE_DRIVER,
          }).start();
        },
      }),
    [translateY, onClose]
  );

  const runAction = useCallback(
    (action: SheetAction) => {
      if (action.disabled) return;
      // 先关浮层再执行：动作往往会改动列表，留着浮层容易看到中间态。
      // keepOpen 的动作例外（比如把浮层原地换成编辑表单），此时由动作自己决定何时关。
      if (!action.keepOpen) onClose();
      action.onPress();
    },
    [onClose]
  );

  const hasHeading = Boolean(title || message);
  // 含输入框时不接管纵向手势：否则在输入框里上下拖拽选词会被误判成「下滑关闭」
  const panHandlers = avoidKeyboard ? {} : panResponder.panHandlers;

  const sheet = (
    <Animated.View
      {...panHandlers}
      style={[
        styles.sheet,
        {
          backgroundColor: theme.backgroundSheet,
          borderColor: theme.border,
          paddingBottom: Math.max(insets.bottom, Spacing.three),
          transform: [{ translateY }],
        },
      ]}>
      <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />

      {hasHeading ? (
        <View style={styles.heading}>
          {title ? (
            <ThemedText type="small" themeColor="textTertiary">
              {title}
            </ThemedText>
          ) : null}
          {message ? (
            <Text style={[styles.message, { color: theme.text }]} numberOfLines={2}>
              {message}
            </Text>
          ) : null}
        </View>
      ) : null}

      {children}

      {actions.length > 0 ? (
        <View style={[styles.actions, { backgroundColor: theme.backgroundElement }]}>
          {actions.map((action, index) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(action.disabled) }}
              disabled={action.disabled}
              onPress={() => runAction(action)}
              style={({ pressed }) => [
                styles.action,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.border,
                },
                pressed && styles.pressed,
                action.disabled && styles.disabled,
              ]}>
              <Text style={[styles.actionLabel, { color: actionTone(theme, action.tone) }]}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [
          styles.action,
          styles.cancel,
          { backgroundColor: theme.backgroundElement },
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.actionLabel, { color: theme.textSecondary }]}>取消</Text>
      </Pressable>
    </Animated.View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭"
          onPress={onClose}
          style={[styles.overlay, { backgroundColor: theme.overlay }]}
        />

        {avoidKeyboard ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {sheet}
          </KeyboardAvoidingView>
        ) : (
          sheet
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.one,
  },
  heading: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.half },
  message: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  actions: { borderRadius: BorderRadius.large, overflow: 'hidden' },
  action: { paddingVertical: Spacing.three, alignItems: 'center' },
  actionLabel: { fontSize: 16, fontWeight: '600' },
  cancel: { borderRadius: BorderRadius.large },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
