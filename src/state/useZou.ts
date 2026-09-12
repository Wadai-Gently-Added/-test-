import { useCallback, useEffect, useState } from 'react';

/** 強制再描画フック(contextに乗せないJS状態の変更をUIへ反映するための最小手段) */
export function useForceUpdate(): () => void {
  const [, setTick] = useState(0);
  return useCallback(() => setTick(t => t + 1), []);
}

/**
 * debounceフック(TODO改善#3のsaveDraft debounceと同じ思想の一般版)。
 * 依存配列は初回のみのrefで保持する(depsの毎回比較を避ける軽量実装)。
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
  const fnRef = { current: fn };
  fnRef.current = fn;
  return useCallback((...args: A) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      fnRef.current(...args);
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** beforeunload / visibilitychange(hidden) のタイミングで確実に掃除したい処理を登録する */
export function useUnloadFlush(flush: () => void): void {
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);
}
