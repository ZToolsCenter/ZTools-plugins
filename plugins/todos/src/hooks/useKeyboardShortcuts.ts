import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onSave?: () => void;
  onDelete?: () => void;
  onSearch?: () => void;
  onToggleView?: () => void;
  onEscape?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl/Cmd + S: 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handlers.onSave?.();
    }

    // Ctrl/Cmd + D: 删除
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      handlers.onDelete?.();
    }

    // Ctrl/Cmd + F: 搜索
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      handlers.onSearch?.();
    }

    // Ctrl/Cmd + E: 切换视图
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      handlers.onToggleView?.();
    }

    // Escape: 取消/关闭
    if (e.key === 'Escape') {
      handlers.onEscape?.();
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
