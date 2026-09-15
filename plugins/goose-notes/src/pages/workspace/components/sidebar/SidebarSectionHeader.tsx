interface SidebarSectionHeaderProps {
  title: string;
  onSearch: () => void;
  onCreate: () => void;
  createTitle: string;
  view: "pages" | "outline";
  onSwitchToPages: () => void;
  onSwitchToOutline: () => void;
}

export function SidebarSectionHeader({
  title,
  onSearch,
  onCreate,
  createTitle,
  view,
  onSwitchToPages,
  onSwitchToOutline,
}: SidebarSectionHeaderProps) {
  const appShortcuts = useSettings((state) => state.appShortcuts);
  const searchShortcut = appShortcuts.openSearch
    ? formatShortcut(appShortcuts.openSearch)
    : "";
  const createShortcut = formatShortcut(getFixedAppShortcuts().newNote);

  return (
    <div className="group flex items-center justify-between pl-0 pr-[9px] py-1.5 text-xs font-medium text-[hsl(var(--goose-nav-title))] dark:text-[hsl(var(--goose-nav-title))]">
      <div className="group/tab-switch inline-flex items-center gap-0.5 rounded-[8px] p-0.5">
        <button
          type="button"
          onClick={onSwitchToPages}
          className={cn(
            "group/page-tab relative inline-flex h-6 min-w-[42px] items-center justify-center overflow-hidden rounded-[7px] px-2 py-1 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
            view === "pages"
              ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
              : "text-muted-foreground hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
          )}
          aria-pressed={view === "pages"}
          aria-label={view === "pages" ? "收起全部页面" : title}
        >
          <span
            className={cn(
              "transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
              view === "pages" &&
                "group-hover/page-tab:-translate-y-1 group-hover/page-tab:opacity-0 group-focus-visible/page-tab:-translate-y-1 group-focus-visible/page-tab:opacity-0",
            )}
          >
            {title}
          </span>
          {view === "pages" && (
            <LucideIcons.ListCollapse
              aria-hidden="true"
              className="absolute h-3.5 w-3.5 translate-y-1 opacity-0 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/page-tab:translate-y-0 group-hover/page-tab:opacity-100 group-focus-visible/page-tab:translate-y-0 group-focus-visible/page-tab:opacity-100"
            />
          )}
        </button>
        <span
          className={cn(
            "px-0.5 text-muted-foreground/70 transition-colors",
            "group-hover/tab-switch:text-foreground/80",
          )}
          aria-hidden="true"
        >
          /
        </span>
        <button
          type="button"
          onClick={onSwitchToOutline}
          className={cn(
            "rounded-[7px] px-2 py-1 transition-colors",
            view === "outline"
              ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
              : "text-muted-foreground hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
          )}
          aria-pressed={view === "outline"}
        >
          大纲
        </button>
      </div>
      <TooltipProvider delayDuration={600}>
        <div className="flex items-center gap-1 text-muted-foreground dark:text-muted-foreground/70">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)]"
                aria-label="搜索"
                onClick={onSearch}
              >
                <LucideIcons.Search className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="flex items-center gap-2">
                <span>搜索</span>
                {searchShortcut && (
                  <span className="text-[11px] text-muted-foreground">
                    {searchShortcut}
                  </span>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)]"
                aria-label={createTitle}
                onClick={onCreate}
              >
                <LucideIcons.Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="flex items-center gap-2">
                <span>{createTitle}</span>
                {createShortcut && (
                  <span className="text-[11px] text-muted-foreground">
                    {createShortcut}
                  </span>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
