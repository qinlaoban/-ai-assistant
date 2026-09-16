import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionList } from '@/components/session-list';
import { ThemedText } from '@/components/themed-text';
import { normalizeBaseUrl } from '@/constants/chat-params';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

/** 左缘拉出热区宽度 */
const EDGE_WIDTH = 22;
const OPEN_DURATION = 220;
const CLOSE_DURATION = 180;
/** 拖动超过面板宽度的这个比例就算「松手即开/关」 */
const COMMIT_RATIO = 0.32;
/** 甩动速度阈值（px/ms） */
const COMMIT_VELOCITY = 0.5;

interface ChatDrawerApi {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const ChatDrawerContext = createContext<ChatDrawerApi | null>(null);

export function useChatDrawer(): ChatDrawerApi {
  const value = useContext(ChatDrawerContext);
  if (!value) {
    throw new Error('useChatDrawer 必须在 <ChatDrawerHost> 内使用');
  }
  return value;
}

/**
 * 抽屉宿主：把抽屉挂在**所有内容之上**。
 *
 * 之所以不在对话页内部渲染，是因为原生 Tab 栏是叠加在页面内容之上的，
 * 挂在页面里的话抽屉底部（设置入口与接口状态）会被 Tab 栏盖住。
 * 挂到最外层才能真正铺满全屏。
 *
 * Web 端使用同名的 chat-drawer.web.tsx，那里是空实现——Web 保持原有的顶部胶囊导航。
 */
export function ChatDrawerHost({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const api = useMemo<ChatDrawerApi>(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <ChatDrawerContext.Provider value={api}>
      <View style={styles.host}>
        {children}
        <ChatDrawer visible={isOpen} onOpen={open} onClose={close} />
      </View>
    </ChatDrawerContext.Provider>
  );
}

/**
 * 抽屉里的实际内容。
 *
 * 刻意与「面板外壳」拆开：外壳要常驻（关闭态也要能感知左缘右滑），
 * 而这里订阅了 chat store。流式期间每 60ms 会刷新一次 messages，
 * 若内容常驻，抽屉与会话列表会被一起重渲染。拆开后由外壳控制挂载时机，
 * 只在打开（及收起动画期间）才订阅。
 */
function DrawerContent({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const { model, generationSettings, startNewChat } = useChat();

  // 这里刻意不刷新列表：chats 在 store 里一直被就地维护（新建 / 重命名 / 删除 / 流式收尾
  // 都会同步），而 refreshChats 是「读全部文件 → 整体覆盖」，流式进行中拉开抽屉时
  // 那份过期快照可能在就地更新之后落地，把当前会话的顺序和标题盖回旧值。

  const handleNewChat = () => {
    startNewChat();
    onClose();
  };

  const handleOpenSettings = () => {
    onClose();
    router.navigate('/settings');
  };

  // 状态信息：让用户在抽屉里就能确认当前在跟哪家服务商说话
  const endpoint = normalizeBaseUrl(generationSettings.apiBaseUrl).replace(/^https?:\/\//, '');

  return (
    <>
      <View style={styles.panelHeader}>
        <ThemedText type="smallBold">会话</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={handleNewChat}
          style={({ pressed }) => [
            styles.newButton,
            { backgroundColor: theme.primary },
            pressed && styles.pressed,
          ]}>
          <Text style={[styles.newButtonText, { color: theme.onPrimary }]}>新对话</Text>
        </Pressable>
      </View>

      <SessionList onOpened={onClose} ownScroll />

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          onPress={handleOpenSettings}
          hitSlop={8}
          style={({ pressed }) => [styles.footerAction, pressed && styles.pressed]}>
          <ThemedText type="small" themeColor="textSecondary">
            设置
          </ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textTertiary" numberOfLines={1}>
          {model}
        </ThemedText>
        <ThemedText type="small" themeColor="textTertiary" numberOfLines={1}>
          {endpoint}
        </ThemedText>
      </View>
    </>
  );
}

function ChatDrawer({
  visible,
  onOpen,
  onClose,
}: {
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const drawerWidth = Math.min(width * 0.84, 360);

  /**
   * 0 = 完全收起，1 = 完全展开。
   * 用归一化的进度而不是直接动画像素：面板宽度会随屏幕尺寸变化，
   * 进度制的话尺寸一变，插值出的位移自动就对了。
   *
   * 用 state 保存 Animated.Value 而不是 ref——渲染期读 ref 会破坏渲染纯度
   * （本项目开了 React Compiler，react-hooks 规则会直接报错）。
   */
  const [progress] = useState(() => new Animated.Value(0));
  /**
   * 内容是否挂载。收起动画跑完后才卸载，既保留滑出效果，
   * 又避免关闭态下抽屉内容跟着流式刷新重渲染。
   */
  const [contentMounted, setContentMounted] = useState(false);

  const translateX = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] }),
    [progress, drawerWidth]
  );

  const settle = useCallback(
    (toValue: 0 | 1, duration: number, onSettled?: (finished: boolean) => void) => {
      // web 上原生动画模块缺失，web 端本来就不会加载本文件，这里直接用原生驱动
      Animated.timing(progress, { toValue, duration, useNativeDriver: true }).start(({ finished }) =>
        onSettled?.(finished)
      );
    },
    [progress]
  );

  // 外部开关驱动动画：用户从边缘拖到一半松手时，会从当前位置平滑补完剩下的行程
  useEffect(() => {
    settle(visible ? 1 : 0, visible ? OPEN_DURATION : CLOSE_DURATION, (finished) => {
      // 开合动画结束后再决定内容的挂载：展开则挂上，收起则卸下
      if (finished) setContentMounted(visible);
    });
  }, [visible, settle]);

  const edgePan = useMemo(
    () =>
      PanResponder.create({
        // 只在收起状态下、且明显向右拖时才接管，免得和页面其他纵向滚动抢手势
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !visible && gesture.dx > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          progress.setValue(Math.min(1, Math.max(0, gesture.dx / drawerWidth)));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx > drawerWidth * COMMIT_RATIO || gesture.vx > COMMIT_VELOCITY) {
            onOpen();
            return;
          }
          settle(0, CLOSE_DURATION);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [visible, drawerWidth, progress, onOpen, settle]
  );

  const panelPan = useMemo(
    () =>
      PanResponder.create({
        // 只接管明显向左的横向拖拽；纵向留给列表自己的滚动
        onMoveShouldSetPanResponder: (_event, gesture) =>
          visible && gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          progress.setValue(Math.min(1, Math.max(0, 1 + gesture.dx / drawerWidth)));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -drawerWidth * COMMIT_RATIO || gesture.vx < -COMMIT_VELOCITY) {
            onClose();
            return;
          }
          settle(1, OPEN_DURATION);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [visible, drawerWidth, progress, onClose, settle]
  );

  const shouldRenderContent = visible || contentMounted;

  return (
    <View
      // 收起时整体让出触摸，只保留左缘热区；展开时才接管。
      // 必须写在 style 里：`pointerEvents` 作为组件 prop 已废弃，且被忽略时遮罩会整屏吞掉手势
      style={[styles.root, { pointerEvents: visible ? 'auto' : 'box-none' }]}>
      <Animated.View
        style={[
          styles.overlay,
          {
            backgroundColor: theme.overlay,
            opacity: progress,
            pointerEvents: visible ? 'auto' : 'none',
          },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭会话抽屉"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        {...panelPan.panHandlers}
        style={[
          styles.panel,
          {
            width: drawerWidth,
            backgroundColor: theme.background,
            borderRightColor: theme.border,
            paddingTop: insets.top + Spacing.three,
            paddingBottom: insets.bottom,
            transform: [{ translateX }],
          },
        ]}>
        {shouldRenderContent ? <DrawerContent onClose={onClose} /> : null}
      </Animated.View>

      {visible ? null : (
        <View
          {...edgePan.panHandlers}
          style={[styles.edge, { width: EDGE_WIDTH }]}
          // 纯手势热区，不该被无障碍聚焦
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  // 铺满全屏并裁掉收起状态下移到屏幕外的面板，否则它的子元素还会继续吃到触摸
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    // 用 boxShadow：shadow* 系列已废弃（Expo 57 默认新架构，boxShadow 在两端都可用）
    boxShadow: '4px 0 16px rgba(0, 0, 0, 0.12)',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  newButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: BorderRadius.small,
  },
  newButtonText: { fontSize: 13, fontWeight: '600' },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    gap: Spacing.half,
  },
  footerAction: { paddingBottom: Spacing.half },
  edge: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  pressed: { opacity: 0.7 },
});
