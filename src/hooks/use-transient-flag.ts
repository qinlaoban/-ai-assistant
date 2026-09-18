import { useCallback, useEffect, useState } from 'react';

/** 轻反馈的默认时长：够看见，又不会一直挂在界面上 */
const FLASH_MS = 1600;

/**
 * 一个「亮一下就自动熄灭」的瞬时标记。
 *
 * 用于「已保存」这类确认反馈：不该常驻，也不需要用户去关掉，所以做成自动熄灭。
 */
export function useTransientFlag(duration = FLASH_MS): [boolean, () => void] {
  const [visible, setVisible] = useState(false);
  // 必须用 useCallback 固定：调用方会把它放进 effect 依赖，每次渲染换新函数会反复触发
  const flash = useCallback(() => setVisible(true), []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [visible, duration]);

  return [visible, flash];
}

/**
 * 把 `useDraftField` 的 `savedTick` 转成一次「已保存」闪烁。
 * tick 为 0 表示还没提交过 —— 首次进入设置页不该闪一下。
 */
export function useSavedFlash(savedTick: number, duration = FLASH_MS): boolean {
  const [visible, flash] = useTransientFlag(duration);

  useEffect(() => {
    if (savedTick === 0) return;
    flash();
  }, [savedTick, flash]);

  return visible;
}
