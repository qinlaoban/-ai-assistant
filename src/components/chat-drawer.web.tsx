import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Web 端的空实现。
 *
 * 桌面端已经有顶部胶囊导航，再叠一层抽屉是多余的；用户也明确要求
 * 「Web 保持现状」。这里提供与 chat-drawer.tsx 完全一致的 API 但什么都不渲染，
 * 这样调用方（对话页的汉堡按钮、根布局）不需要写平台分支。
 */

interface ChatDrawerApi {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const noop = () => {};

const ChatDrawerContext = createContext<ChatDrawerApi | null>(null);

export function useChatDrawer(): ChatDrawerApi {
  const value = useContext(ChatDrawerContext);
  if (!value) {
    throw new Error('useChatDrawer 必须在 <ChatDrawerHost> 内使用');
  }
  return value;
}

export function ChatDrawerHost({ children }: { children: ReactNode }) {
  const api = useMemo<ChatDrawerApi>(() => ({ open: noop, close: noop, isOpen: false }), []);

  return <ChatDrawerContext.Provider value={api}>{children}</ChatDrawerContext.Provider>;
}
