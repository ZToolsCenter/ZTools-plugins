import { useState, useRef, useEffect, type CSSProperties, type ReactNode } from "react";
import { Search, Plus, X, MoreHorizontal, Moon, Sun, ArrowDownUp, Trash2, Lock, LockOpen, LayoutGrid, List, Columns3, Palette, Check } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupButton } from "@/components/ui/input-group";
import type { ViewMode } from "@/stores/useAccounts";
import { ACCENT_OPTIONS, type AccentColor } from "@/lib/accent-color";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  hasAccounts: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: ViewMode;
  onToggleView: () => void;
  onAdd: () => void;
  onManageData: () => void;
  onTrash: () => void;
  isDark: boolean;
  isThemeLocked: boolean;
  onToggleDark: () => void;
  onToggleThemeLock: () => void;
  accentColor: AccentColor;
  onAccentColorChange: (accentColor: AccentColor) => void;
  trashCount: number;
}

export function Header({
  hasAccounts,
  searchQuery,
  onSearchChange,
  viewMode,
  onToggleView,
  onAdd,
  onManageData,
  onTrash,
  isDark,
  isThemeLocked,
  onToggleDark,
  onToggleThemeLock,
  accentColor,
  onAccentColorChange,
  trashCount,
}: HeaderProps) {
  const VIEW_CYCLE: Record<ViewMode, ViewMode> = {
    compact: "grid",
    grid: "list",
    list: "compact",
  };

  const VIEW_LABELS: Record<ViewMode, string> = {
    compact: "紧凑三列视图",
    grid: "双列网格视图",
    list: "列表视图",
  };

  const VIEW_ICONS: Record<ViewMode, ReactNode> = {
    compact: <Columns3 size={17} />,
    grid: <LayoutGrid size={17} />,
    list: <List size={17} />,
  };

  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);

  // 外部灌入搜索词（如 uTools quick 进入带关键字）时自动展开搜索框，
  // 让用户看到当前过滤条件、也能一键清除。
  useEffect(() => {
    if (searchQuery) setSearching(true);
  }, [searchQuery]);

  const handleSearchToggle = () => {
    if (searching) {
      setSearching(false);
      onSearchChange("");
    } else {
      setSearching(true);
    }
  };

  return (
    <header
      className={`absolute top-0 z-[4] flex h-[45px] items-center gap-2 px-4 ${
        searching ? "inset-x-0 bg-bg" : "right-0"
      }`}
    >
      <h1 className="sr-only">验证码</h1>
      {searching ? (
        <InputGroup className="flex-1 h-[33px]">
          <InputGroupAddon>
            <Search size={14} className="text-fg-faint" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            aria-label="搜索账户"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索账户..."
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              onClick={handleSearchToggle}
              size="icon-xs"
              variant="ghost"
              aria-label="清除并关闭搜索"
              className="text-fg-faint shadow-none hover:bg-transparent hover:text-fg-muted"
            >
              <X size={13} />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <>
          {hasAccounts && (
            <>
              <button
                onClick={onToggleView}
                className="icon-control rounded-lg p-2 text-fg-muted"
                aria-label={`当前${VIEW_LABELS[viewMode]}，点击切换`}
                title={VIEW_LABELS[VIEW_CYCLE[viewMode]]}
              >
                {VIEW_ICONS[viewMode]}
              </button>
              <button
                onClick={handleSearchToggle}
                className="icon-control rounded-lg p-2 text-fg-muted"
                aria-label="搜索"
              >
                <Search size={17} />
              </button>
            </>
          )}
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          className="icon-control rounded-lg p-2 text-fg-muted"
          aria-label="菜单"
        >
          <MoreHorizontal size={17} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={onManageData} className="gap-2.5 text-[13px]">
            <ArrowDownUp size={14} />
            导入 / 导出
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTrash} className="gap-2.5 text-[13px]">
            <Trash2 size={14} />
            回收站
            {trashCount > 0 && (
              <span className="ml-auto rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-timer-low">
                {trashCount}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onToggleDark}
            className="gap-2.5 text-[13px]"
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
            {isDark ? "切换到浅色模式" : "切换到深色模式"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onToggleThemeLock}
            className="gap-2.5 text-[13px]"
          >
            {isThemeLocked ? <Lock size={14} /> : <LockOpen size={14} />}
            {isThemeLocked ? "改为跟随系统" : "锁定当前主题"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5 text-[13px]">
              <Palette size={14} />
              强调色
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              {ACCENT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => onAccentColorChange(option.value)}
                  className="gap-2 text-[12.5px]"
                  aria-current={accentColor === option.value ? "true" : undefined}
                >
                  <span
                    className="accent-swatch"
                    style={{
                      "--swatch-light": option.light,
                      "--swatch-dark": option.dark,
                    } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span>{option.label}</span>
                  <Check
                    size={13}
                    className={`ml-auto ${accentColor === option.value ? "opacity-100" : "opacity-0"}`}
                    aria-hidden="true"
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        onClick={onAdd}
        className="primary-control rounded-lg bg-accent p-2 text-accent-fg active:scale-95"
        aria-label="添加账户"
      >
        <Plus size={17} strokeWidth={2.5} />
      </button>
    </header>
  );
}
