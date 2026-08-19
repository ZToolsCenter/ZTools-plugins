import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import type { SettingsTab, SettingsTabConfig } from "./types";

interface SettingsScaffoldProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  tabs: SettingsTabConfig[];
  children: ReactNode;
  feedbackBanner?: ReactNode;
  appsBanner?: ReactNode;
}

export function SettingsScaffold({
  activeTab,
  onTabChange,
  tabs,
  children,
  feedbackBanner,
  appsBanner,
}: SettingsScaffoldProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionsRef = useRef<Partial<Record<SettingsTab, number>>>({});
  const previousActiveTabRef = useRef<SettingsTab>(activeTab);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const previousActiveTab = previousActiveTabRef.current;

    if (!scrollContainer || previousActiveTab === activeTab) return;

    scrollPositionsRef.current[previousActiveTab] = scrollContainer.scrollTop;
    scrollContainer.scrollTop = scrollPositionsRef.current[activeTab] ?? 0;
    previousActiveTabRef.current = activeTab;
  }, [activeTab]);

  const handleTabChange = (tab: SettingsTab) => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollPositionsRef.current[activeTab] = scrollContainer.scrollTop;
    }

    onTabChange(tab);
  };

  const handleScroll = () => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollPositionsRef.current[activeTab] = scrollContainer.scrollTop;
    }
  };

  return (
    <div className="workspace-shell flex h-full flex-col bg-[hsl(var(--goose-shell-bg))] text-foreground">
      <div className="flex h-14 items-center justify-between bg-[hsl(var(--goose-shell-bg))] pt-4 px-6 pr-14">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[hsl(var(--goose-selected-bg))]">
            <SettingsIcon className="h-5 w-5 text-foreground/80" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">设置</h1>
            <p className="text-xs text-muted-foreground">配置应用偏好与数据管理</p>
          </div>
        </div>
      </div>

      <div className="workspace-stage flex-1 overflow-hidden p-3">
        <div className="workspace-main-sheet flex w-60 shrink-0 flex-col overflow-hidden rounded-[16px] bg-[hsl(var(--goose-shell-bg))]">
          <nav className="flex-1 space-y-1 p-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Button
                  key={tab.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleTabChange(tab.id)}
                  className={cn(
                    "h-auto w-full justify-start gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    activeTab === tab.id
                      ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                      : "text-muted-foreground hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{tab.label}</span>
                </Button>
              );
            })}
          </nav>

          {feedbackBanner || appsBanner ? (
            <div className="space-y-3 p-3">
              {feedbackBanner}
              {appsBanner}
            </div>
          ) : null}
        </div>

        <div className="workspace-main-sheet flex-1 overflow-hidden rounded-[18px]">
          <div className="workspace-editor-surface h-full overflow-hidden rounded-[16px]">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="h-full overflow-y-auto p-6"
            >
              <div className="mx-auto w-full max-w-5xl">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
