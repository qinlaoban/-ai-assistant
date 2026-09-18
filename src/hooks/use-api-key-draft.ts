import { useCallback, useState } from 'react';

import { useTransientFlag } from '@/hooks/use-transient-flag';
import { useChat } from '@/store/chat-store';

/**
 * 「输入密钥 → 落盘」这件事的唯一实现。
 *
 * 密钥有两个入口：首次启动的整屏引导，以及设置页里的卡片。两处排版完全不同，
 * 但「什么算可保存」「失败怎么呈现」「成功后给什么反馈」的判断必须只有一份 ——
 * 否则改一次错误文案就会漏掉另一处，两处行为会慢慢漂移。
 *
 * 返回值刻意只覆盖草稿与提交，界面长什么样交给调用方。
 */
export function useApiKeyDraft(): {
  draft: string;
  setDraft: (value: string) => void;
  /** 保存成功返回 true；返回 false 时失败原因已写进 error */
  save: () => Promise<boolean>;
  busy: boolean;
  /** 保存失败的文案（写安全存储失败、Key 为空等） */
  error: string | null;
  /** 刚刚保存成功，用于短暂的「已保存」反馈 */
  saved: boolean;
  canSave: boolean;
} {
  const { updateApiKey } = useChat();

  const [draft, setDraftState] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, flashSaved] = useTransientFlag();

  const setDraft = useCallback((value: string) => {
    setDraftState(value);
    // 一改动就把上一次的成败提示收掉，避免「已保存」挂在一个刚被改过的输入框上
    setError(null);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const next = draft.trim();
    if (next.length === 0 || busy) return false;
    setBusy(true);
    setError(null);
    try {
      await updateApiKey(next);
      setDraftState('');
      flashSaved();
      return true;
    } catch (err) {
      // 写安全存储失败必须说出来：用户以为存上了、下次启动却要重填，比当场报错更糟
      setError(err instanceof Error ? err.message : '保存失败，请重试');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, draft, flashSaved, updateApiKey]);

  return {
    draft,
    setDraft,
    save,
    busy,
    error,
    saved,
    canSave: draft.trim().length > 0 && !busy,
  };
}
