import { useCallback } from "react";

export interface ViewModeActionsOptions {
  setSourceMode: (value: boolean | ((previous: boolean) => boolean)) => void;
  setReadingMode: (value: boolean | ((previous: boolean) => boolean)) => void;
  setFocusedBlockId: (id: string | null) => void;
  setSelectedBlockIds: (ids: string[]) => void;
  showToast: (message: string) => void;
}

export function useViewModeActions({ setSourceMode, setReadingMode, setFocusedBlockId, setSelectedBlockIds, showToast }: ViewModeActionsOptions) {
  const handleToggleReadingMode = useCallback(() => {
    setReadingMode((previous) => {
      const next = !previous;
      if (next) {
        setSourceMode(false);
        setFocusedBlockId(null);
        setSelectedBlockIds([]);
        showToast("已开启阅读模式（只读，无法修改内容）");
      } else showToast("已退出阅读模式，恢复实时编辑");
      return next;
    });
  }, [setFocusedBlockId, setReadingMode, setSelectedBlockIds, setSourceMode, showToast]);

  const handleChangeViewMode = useCallback((mode: "live" | "source" | "reading") => {
    if (mode === "live") {
      setSourceMode(false); setReadingMode(false); showToast("已切换至实时预览模式");
    } else if (mode === "source") {
      setReadingMode(false); setSourceMode(true); showToast("已切换至源代码模式");
    } else {
      setSourceMode(false); setFocusedBlockId(null); setSelectedBlockIds([]); setReadingMode(true);
      showToast("已开启阅读模式（只读，无法修改内容）");
    }
  }, [setFocusedBlockId, setReadingMode, setSelectedBlockIds, setSourceMode, showToast]);

  return { handleToggleReadingMode, handleChangeViewMode };
}
