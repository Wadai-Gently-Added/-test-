// 各シート(貼り付け/マイ一覧/コード編集/印刷)の開閉state。
// 旧実装の「openX()の先頭で必ずcloseAllSheets()を呼ぶ」仕様をstateレベルで再現:
// openは一度に1つしかセットできない構造にしている(シートの透明重なりを構造的に防ぐ)。
import { useCallback, useState } from 'react';

export type SheetName = 'paste' | 'list' | 'code' | 'print' | null;

export function useSheets() {
  const [openSheet, setOpenSheet] = useState<SheetName>(null);

  const openOne = useCallback((name: Exclude<SheetName, null>) => { setOpenSheet(name); }, []);
  const closeAll = useCallback(() => { setOpenSheet(null); }, []);

  return { openSheet, openOne, closeAll };
}
