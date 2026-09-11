// 常時点灯(Wake Lock)フック。旧js/viewer.jsの実装を移植。
// pointer:coarse判定でもPCで表示されるケースがあったため、UA文字列判定でスマホ/タブレットのみに絞る。
// ただしiPadOS 13以降のSafariは初期設定でUAが「Macintosh」を名乗るため、
// タッチ対応のMacintosh名乗り=iPadとみなして追加で拾う。
// iOS Safari(特にホーム画面追加時)は、視認できる状態のまま常時点灯が黙って解除される
// ことがあるため、visibilitychangeだけに頼らず、定期的にも生きてるか確認して再取得する。
import { useEffect, useRef, useState } from 'react';
import { STR } from '../lib/i18n';

interface WakeLockSentinel {
  release: () => Promise<void>;
  addEventListener: (type: string, cb: () => void) => void;
}

export function useWakeLock(): { supported: boolean; active: boolean; toggle: () => Promise<void> } {
  const [supported] = useState<boolean>(() => {
    if (!('wakeLock' in navigator)) return false;
    const isIPadOSDisguisedAsMac = /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || isIPadOSDisguisedAsMac;
  });
  const [active, setActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wantedRef = useRef(false);

  async function request(): Promise<boolean> {
    if (!('wakeLock' in navigator)) return false;
    try {
      wakeLockRef.current = await (navigator as unknown as {
        wakeLock: { request: (t: 'screen') => Promise<WakeLockSentinel> };
      }).wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null; });
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!supported) return;
    const reacquire = () => {
      if (wantedRef.current && document.visibilityState === 'visible' && !wakeLockRef.current) request();
    };
    document.addEventListener('visibilitychange', reacquire);
    const timer = setInterval(reacquire, 15000);
    return () => {
      document.removeEventListener('visibilitychange', reacquire);
      clearInterval(timer);
    };
  }, [supported]);

  const toggle = async (): Promise<void> => {
    if (!supported) return;
    if (wantedRef.current) {
      wantedRef.current = false;
      if (wakeLockRef.current) {
        try { await wakeLockRef.current.release(); } catch { /* ignore */ }
        wakeLockRef.current = null;
      }
      setActive(false);
    } else {
      const ok = await request();
      if (ok) { wantedRef.current = true; setActive(true); }
      else alert(STR.common.wakeLockFailed);
    }
  };

  return { supported, active, toggle };
}
