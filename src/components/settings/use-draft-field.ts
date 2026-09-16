import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 文本类设置的「草稿 + 提交」。
 *
 * 不能直接把输入框受控于 store：那会变成每敲一个字就写一次文件。
 * 但只在失焦时提交又会丢掉「改完立刻切走」的输入，所以统一在这里处理
 * 「停笔一段时间后提交 + 卸载时把未落盘的草稿补交」。
 *
 * `setDraft(value, true)` 用于需要立刻生效的场景（例如点快捷选项）。
 */
export function useDraftField(
  saved: string,
  commit: (value: string) => void,
  delay: number
): { draft: string; setDraft: (value: string, immediate?: boolean) => void } {
  const [draft, setDraftState] = useState(saved);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(saved);

  /**
   * 调用方传的 `commit` 通常是渲染期内联箭头（身份每次渲染都变）。
   * 用 ref 承载它，卸载补交的 effect 才能把依赖留空 —— 否则每次按键都会触发一次
   * cleanup，把 500ms 的防抖击穿成「逐字写文件」。
   */
  const commitRef = useRef(commit);

  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  // timerRef 非空即代表「有未提交的改动」，直接拿它当脏标记，不必再维护一个布尔值
  useEffect(
    () => () => {
      if (timerRef.current === null) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      commitRef.current(draftRef.current);
    },
    []
  );

  const setDraft = useCallback(
    (value: string, immediate = false) => {
      draftRef.current = value;
      setDraftState(value);

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (immediate) {
        commit(value);
        return;
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        commit(value);
      }, delay);
    },
    [commit, delay]
  );

  return { draft, setDraft };
}
