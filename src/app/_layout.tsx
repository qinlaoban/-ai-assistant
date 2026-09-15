import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

// web 端会真正引入全局 CSS；原生端解析到空实现（见 src/global-css.ts）
import '@/global-css';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { ChatDrawerHost } from '@/components/chat-drawer';
import { LoadingScreen } from '@/components/loading-screen';
import { SANS_FONT_SOURCES } from '@/constants/fonts';
import { ChatProvider, useChat } from '@/store/chat-store';

SplashScreen.preventAutoHideAsync();

/**
 * 等 API Key / 会话列表读完之后再挂载界面，
 * 否则会先闪一下「请输入 API Key」再跳进对话。
 * 等待期间给一个跟随主题的加载态，而不是纯色白屏。
 */
function AppShell() {
  const { isReady } = useChat();

  if (!isReady) {
    return <LoadingScreen />;
  }

  return <AppTabs />;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // 字体加载刻意不参与就绪判断：观感问题不该把首屏拦下来。
  // 加载完成时这个 hook 会触发一次重渲染，样式随之切到正式字体。
  const [, fontError] = useFonts(SANS_FONT_SOURCES);

  useEffect(() => {
    if (fontError) {
      console.warn('[fonts] Plus Jakarta Sans 加载失败，已回退系统字体:', fontError.message);
    }
  }, [fontError]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ChatProvider>
        {/* 抽屉挂在最外层才能盖住原生 Tab 栏，挂在页面里底部会被 Tab 栏压住 */}
        <ChatDrawerHost>
          <AnimatedSplashOverlay />
          <AppShell />
        </ChatDrawerHost>
      </ChatProvider>
    </ThemeProvider>
  );
}
