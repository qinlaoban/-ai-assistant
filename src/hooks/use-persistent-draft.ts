import { useCallback, useEffect, useRef, useState } from 'react';

import { clearDraft, getDraft, saveDraft } from '@/services/chat-storage';

/** 打字停下来多久之后落盘 */
const DEFAULT_COMMIT_DELAY = 400;

/**
 * 会持久化的输入草稿。
 *
 * - 切换会话：先把上一份立刻落盘，再载入新会话的草稿；
 * - 打字：停下来 400ms 后才写盘，避免逐字写文件；
 * - 卸载：flush 掉尚未落盘的内容。
 *
 * 刻意不放 store：草稿每敲一个字就变，塞进全局 Context 会牵连抽屉、会话列表等所有消费者。
 *
 * 内部状态按「所属会话 id + 文本」整体存，切换会话那一刻草稿立即变空 ——
 * 否则在异步读取返回之前，输入框显示的还是**上一个会话**的草稿，
 * 这个窗口里点发送会把 A 的话发到 B 会话里。
 */
export function usePersistentDraft(
  draftId: string,
  commitDelay: number = DEFAULT_COMMIT_DELAY
): {
  draft: string;
  setDraft: (text: string) => void;
  /** 发送后清空并抹掉已存的草稿 */
  resetDraft: () => void;
} {
  const [stored, setStored] = useState<{ id: string; text: string }>({ id: draftId, text: '' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ id: string; text: string } | null>(null);
  /** 用户是否已经动过输入框：动过就别再被异步载入的历史草稿覆盖 */
  const touchedRef = useRef(false);

  const draft = stored.id === draftId ? stored.text : '';

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void saveDraft(pending.id, pending.text);
  }, []);

  const setDraft = useCallback(
    (text: string) => {
      touchedRef.current = true;
      setStored({ id: draftId, text });
      pendingRef.current = { id: draftId, text };
      // 已经排好一次写盘就等它执行：定时器里的 pending 永远是「最新一份」
      if (timerRef.current !== null) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, commitDelay);
    },
    [draftId, commitDelay, flush]
  );

  const resetDraft = useCallback(() => {
    touchedRef.current = true;
    setStored({ id: draftId, text: '' });
    pendingRef.current = null;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void clearDraft(draftId);
  }, [draftId]);

  // 切到新的草稿主体：载入它的历史草稿；切走前把上一份 flush 掉
  useEffect(() => {
    touchedRef.current = false;
    let alive = true;
    void getDraft(draftId).then((saved) => {
      if (alive && !touchedRef.current) setStored({ id: draftId, text: saved });
    });
    return () => {
      alive = false;
      flush();
    };
  }, [draftId, flush]);

  return { draft, setDraft, resetDraft };
}
