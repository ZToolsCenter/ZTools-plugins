import { UToolsAdapter } from "@/lib/utools";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import * as LucideIcons from "lucide-react";
import {
  AUTO_CLOSE_INACTIVE_TABS_HOURS_MAX,
  AUTO_CLOSE_INACTIVE_TABS_HOURS_MIN,
  UTOOLS_WINDOW_HEIGHT_MAX,
  UTOOLS_WINDOW_HEIGHT_MIN,
  type CustomAction,
  type SearchProvider,
} from "@/stores/useSettings";
import { SearchProviderSortableGrid } from "./SearchProviderSortableGrid";
import { SettingsSectionCard } from "./settings/SettingsSectionCard";

interface SettingsGeneralProps {
  searchProviders: SearchProvider[];
  toggleSearchProvider: (id: string) => void;
  reorderSearchProviders: (nextIds: string[]) => void;
  addCustomSearchProvider: (
    provider: Pick<SearchProvider, "name" | "urlTemplate">,
  ) => void;
  updateCustomSearchProvider: (
    id: string,
    provider: Pick<SearchProvider, "name" | "urlTemplate">,
  ) => void;
  removeCustomSearchProvider: (id: string) => void;
  openSearchInUtools: boolean;
  setOpenSearchInUtools: (enabled: boolean) => void;
  useInternalImageViewer: boolean;
  setUseInternalImageViewer: (enabled: boolean) => void;
  windowHeight: number;
  setWindowHeight: (height: number) => void;
  autoOpenLastNote: boolean;
  setAutoOpenLastNote: (enabled: boolean) => void;
  singleTabMode: boolean;
  setSingleTabMode: (enabled: boolean) => void;
  autoCloseInactiveTabs: boolean;
  setAutoCloseInactiveTabs: (enabled: boolean) => void;
  autoCloseInactiveTabsHours: number;
  setAutoCloseInactiveTabsHours: (hours: number) => void;
  showRecentInSearch: boolean;
  setShowRecentInSearch: (enabled: boolean) => void;
  notebookDropdownHoverExpand: boolean;
  setNotebookDropdownHoverExpand: (enabled: boolean) => void;
  customActions?: CustomAction[];
  addCustomAction?: (action: Omit<CustomAction, "id">) => void;
  updateCustomAction?: (
    id: string,
    updates: Partial<Omit<CustomAction, "id">>,
  ) => void;
  removeCustomAction?: (id: string) => void;
}

const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]";

const SETTINGS_SWITCH_CLASS =
  "data-[state=unchecked]:bg-[hsl(var(--foreground)/0.12)]";

export function SettingsGeneral({
  searchProviders,
  toggleSearchProvider,
  reorderSearchProviders,
  addCustomSearchProvider,
  updateCustomSearchProvider,
  removeCustomSearchProvider,
  openSearchInUtools,
  setOpenSearchInUtools,
  useInternalImageViewer,
  setUseInternalImageViewer,
  windowHeight,
  setWindowHeight,
  autoOpenLastNote,
  setAutoOpenLastNote,
  singleTabMode,
  setSingleTabMode,
  autoCloseInactiveTabs,
  setAutoCloseInactiveTabs,
  autoCloseInactiveTabsHours,
  setAutoCloseInactiveTabsHours,
  showRecentInSearch,
  setShowRecentInSearch,
  notebookDropdownHoverExpand,
  setNotebookDropdownHoverExpand,
  customActions = [],
  addCustomAction = () => {},
  updateCustomAction = () => {},
  removeCustomAction = () => {},
}: SettingsGeneralProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">
          通用
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          配置应用的通用设置。
        </p>
      </div>

      <SettingsSectionCard title="行为设置">
        <div
          className={`flex items-center justify-between gap-4 p-4 ${SETTINGS_OPTION_ROW_CLASS}`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <LucideIcons.PanelTop
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label htmlFor="single-tab-mode" className="cursor-pointer">
                极简工作区
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              只保留当前笔记；从侧栏、搜索或最近访问打开时直接替换，不显示标签管理操作。
            </p>
          </div>
          <Switch
            id="single-tab-mode"
            checked={singleTabMode}
            onCheckedChange={setSingleTabMode}
            className={SETTINGS_SWITCH_CLASS}
          />
        </div>
        <div
          className={`mt-2 flex items-center justify-between gap-4 p-4 ${SETTINGS_OPTION_ROW_CLASS}`}
        >
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.FileClock
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label htmlFor="auto-open-last-note" className="cursor-pointer">
                自动打开上次笔记
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              打开应用就直接跳到你上次编辑的那篇笔记，省去再点一次的麻烦。
            </p>
          </div>
          <Switch
            id="auto-open-last-note"
            checked={autoOpenLastNote}
            onCheckedChange={setAutoOpenLastNote}
            className={SETTINGS_SWITCH_CLASS}
          />
        </div>
        <div
          className={`flex items-center justify-between gap-4 p-4 mt-2 ${SETTINGS_OPTION_ROW_CLASS}`}
        >
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.MousePointer2
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label htmlFor="notebook-hover-expand" className="cursor-pointer">
                悬停展开笔记本切换
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              鼠标停在笔记本名称上就自动弹出切换菜单，不用点击。
            </p>
          </div>
          <Switch
            id="notebook-hover-expand"
            checked={notebookDropdownHoverExpand}
            onCheckedChange={setNotebookDropdownHoverExpand}
            className={SETTINGS_SWITCH_CLASS}
          />
        </div>
        {!singleTabMode && (
          <div
            className={`flex items-center justify-between gap-4 p-4 mt-2 ${SETTINGS_OPTION_ROW_CLASS}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <LucideIcons.TimerOff
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <Label
                  htmlFor="auto-close-inactive-tabs"
                  className="cursor-pointer"
                >
                  自动关闭未访问标签
                </Label>
              </div>
              <p className="mt-1 pl-7 text-xs text-muted-foreground">
                开启后，超过设定时间未访问的普通标签会自动关闭；固定标签和当前标签会保留。
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Input
                type="number"
                min={AUTO_CLOSE_INACTIVE_TABS_HOURS_MIN}
                max={AUTO_CLOSE_INACTIVE_TABS_HOURS_MAX}
                step={1}
                value={autoCloseInactiveTabsHours}
                disabled={!autoCloseInactiveTabs}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) {
                    setAutoCloseInactiveTabsHours(next);
                  }
                }}
                className="h-8 w-20 text-right text-sm"
                aria-label="自动关闭标签小时数"
              />
              <span className="text-xs text-muted-foreground">小时</span>
              <Switch
                id="auto-close-inactive-tabs"
                checked={autoCloseInactiveTabs}
                onCheckedChange={setAutoCloseInactiveTabs}
                className={SETTINGS_SWITCH_CLASS}
              />
            </div>
          </div>
        )}
      </SettingsSectionCard>

      <SettingsSectionCard title="搜索设置">
        <div
          className={`flex items-center justify-between gap-4 p-4 ${SETTINGS_OPTION_ROW_CLASS}`}
        >
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.History
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label htmlFor="show-recent-in-search" className="cursor-pointer">
                搜索框显示最近访问
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              关闭后搜索框里不再出现「最近访问」分组，只显示搜索结果。
            </p>
          </div>
          <Switch
            id="show-recent-in-search"
            checked={showRecentInSearch}
            onCheckedChange={setShowRecentInSearch}
            className={SETTINGS_SWITCH_CLASS}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={
          <span className="flex items-center gap-2">
            <LucideIcons.Search
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            搜索引擎
          </span>
        }
        description="配置右键菜单中显示的搜索引擎，支持拖拽排序。"
      >
        <SearchProviderSortableGrid
          providers={searchProviders}
          toggleSearchProvider={toggleSearchProvider}
          reorderSearchProviders={reorderSearchProviders}
          addCustomSearchProvider={addCustomSearchProvider}
          updateCustomSearchProvider={updateCustomSearchProvider}
          removeCustomSearchProvider={removeCustomSearchProvider}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title="插件设置">
        <div
          className={`flex items-center justify-between gap-4 p-4 ${SETTINGS_OPTION_ROW_CLASS}`}
        >
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.Plug2
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label htmlFor="open-in-utools" className="cursor-pointer">
                使用 uTools 打开链接
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              开启后，搜索结果和笔记中的网页链接会在 uTools
              内置浏览器里打开；关闭则用系统浏览器。
            </p>
          </div>
          <Switch
            id="open-in-utools"
            checked={openSearchInUtools ?? false}
            onCheckedChange={setOpenSearchInUtools}
            className={SETTINGS_SWITCH_CLASS}
          />
        </div>
        <div
          className={`mt-2 flex items-center justify-between gap-4 p-4 ${SETTINGS_OPTION_ROW_CLASS}`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <LucideIcons.Image
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label
                htmlFor="use-internal-image-viewer"
                className="cursor-pointer"
              >
                图片使用内置预览
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              默认关闭，由系统图片查看器打开；开启后使用鹅笔记内置灯箱。
            </p>
          </div>
          <Switch
            id="use-internal-image-viewer"
            checked={useInternalImageViewer}
            onCheckedChange={setUseInternalImageViewer}
            className={SETTINGS_SWITCH_CLASS}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="窗口高度">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <LucideIcons.MoveVertical
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            <Label>窗口高度</Label>
          </div>
          <span className="text-sm text-muted-foreground">
            {windowHeight}px
          </span>
        </div>
        <Slider
          value={[windowHeight]}
          min={UTOOLS_WINDOW_HEIGHT_MIN}
          max={UTOOLS_WINDOW_HEIGHT_MAX}
          step={10}
          onValueChange={([val]) => {
            // 拖动过程仅更新本地显示值，避免高频调用 uTools API 导致卡死
            setWindowHeight(val);
          }}
          onValueCommit={([val]) => {
            // 释放后再实际调整窗口高度
            UToolsAdapter.setExpendHeight(val);
          }}
          className="py-2"
        />
      </SettingsSectionCard>

      <SettingsSectionCard
        title={
          <span className="flex items-center gap-2">
            <LucideIcons.Zap
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            快捷动作
          </span>
        }
        description="右键菜单里直接跳转到其他插件，名称和指令都填完才能生效。"
        actions={
          <Button
            size="sm"
            variant="secondary"
            className="rounded-[10px]"
            onClick={() => {
              addCustomAction({
                name: "",
                command: "",
                isEnabled: true,
              });
            }}
          >
            <LucideIcons.Plus className="mr-1 h-4 w-4" />
            添加
          </Button>
        }
      >
        {customActions.length > 0 ? (
          <div className="space-y-2">
            {customActions.map((action) => (
              <div
                key={action.id}
                className={`flex items-center gap-2 px-2 py-2 ${SETTINGS_OPTION_ROW_CLASS}`}
              >
                <Input
                  placeholder="名称"
                  value={action.name}
                  onChange={(e) =>
                    updateCustomAction(action.id, { name: e.target.value })
                  }
                  onBlur={(e) =>
                    updateCustomAction(action.id, {
                      name: e.target.value.trim(),
                    })
                  }
                  className="h-8 text-sm"
                />
                <Input
                  placeholder="指令"
                  value={action.command}
                  onChange={(e) =>
                    updateCustomAction(action.id, {
                      command: e.target.value,
                    })
                  }
                  onBlur={(e) =>
                    updateCustomAction(action.id, {
                      command: e.target.value.trim(),
                    })
                  }
                  className="h-8 text-sm"
                />
                <Input
                  placeholder="插件名（可选）"
                  value={action.pluginName || ""}
                  onChange={(e) =>
                    updateCustomAction(action.id, {
                      pluginName: e.target.value || undefined,
                    })
                  }
                  onBlur={(e) =>
                    updateCustomAction(action.id, {
                      pluginName: e.target.value.trim() || undefined,
                    })
                  }
                  className="h-8 text-sm"
                />
                <Switch
                  checked={action.isEnabled}
                  onCheckedChange={(checked) =>
                    updateCustomAction(action.id, { isEnabled: checked })
                  }
                  className={SETTINGS_SWITCH_CLASS}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-[10px]"
                  onClick={() => removeCustomAction(action.id)}
                >
                  <LucideIcons.Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            暂无快捷动作，点击右上角添加。
          </p>
        )}
      </SettingsSectionCard>
    </div>
  );
}
