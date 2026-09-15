import { useState } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/sonner"
import { formatShortcut, isMacPlatform } from "@/lib/utils"
import {
  DEFAULT_CLOSE_TAB_SHORTCUT,
  DEFAULT_SEARCH_PANEL_CLOSE_SHORTCUT,
  DEFAULT_APP_SHORTCUTS,
} from "@/stores/useSettings"
import { SettingsSectionCard } from "./SettingsSectionCard"
import { ShortcutField } from "./ShortcutField"
import { getFixedAppShortcuts } from "@/lib/fixed-app-shortcuts"

interface SettingsShortcutsProps {
  closeTabShortcut: string
  setCloseTabShortcut: (shortcut: string) => void
  searchPanelCloseShortcut: string
  setSearchPanelCloseShortcut: (shortcut: string) => void
  appShortcuts: Record<string, string>
  setAppShortcut: (id: string, shortcut: string) => void
  resetAppShortcuts: () => void
  singleTabMode: boolean
}
const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]"

const FIXED_APP_SHORTCUTS = getFixedAppShortcuts()

/** 单标签模式下 UI 与热键均禁用的自定义动作，不参与冲突占用。 */
const TAB_ONLY_APP_SHORTCUT_IDS = new Set([
  "newTab",
])

const ALWAYS_FIXED_SHORTCUT_VALUES = [
  FIXED_APP_SHORTCUTS.openSettings,
  FIXED_APP_SHORTCUTS.editorFindOpen,
  FIXED_APP_SHORTCUTS.newNote,
  "Mod+G",
  "Mod+Shift+G",
  "Mod+=",
  "Mod+-",
  "Mod+0",
  "F3",
  "Shift+F3",
  // 浏览器/编辑器固定行为不可被自定义动作覆盖。
  "Mod+S",
  "Mod+B",
  "Mod+I",
  "Mod+U",
  "Mod+E",
  "Mod+K",
  "Mod+Shift+S",
  "Mod+A",
  "Mod+Z",
  "Mod+Shift+Z",
  "Mod+Y",
]

/** 仅多标签模式生效的固定快捷键。 */
const TAB_ONLY_FIXED_SHORTCUT_VALUES = [
  FIXED_APP_SHORTCUTS.reopenTab,
  ...Array.from({ length: 9 }, (_, index) => `Mod+${index + 1}`),
  "Ctrl+Tab",
  "Ctrl+Shift+Tab",
]

const FIXED_SHORTCUT_VALUES = [
  ...ALWAYS_FIXED_SHORTCUT_VALUES,
  ...TAB_ONLY_FIXED_SHORTCUT_VALUES,
]

// eslint-disable-next-line react-refresh/only-export-components
export function normalizeShortcutForConflict(
  shortcut: string,
  isMac = isMacPlatform(),
) {
  const normalized = shortcut
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => {
      if (["mod", "cmdorctrl", "cmdorcontrol", "commandorcontrol"].includes(part)) {
        return isMac ? "meta" : "ctrl"
      }
      if (["meta", "command", "cmd"].includes(part)) return "meta"
      if (["control", "ctrl"].includes(part)) return "ctrl"
      if (["alt", "option"].includes(part)) return "alt"
      if (part === "escape") return "esc"
      if (part === " ") return "space"
      return part
    })

  const modifiers = ["ctrl", "meta", "alt", "shift"].filter((part) =>
    normalized.includes(part),
  )
  const key = normalized.find((part) => !modifiers.includes(part))
  return [...modifiers, ...(key ? [key] : [])].join("+")
}

// Collect all currently configured shortcuts to detect conflicts
// eslint-disable-next-line react-refresh/only-export-components
export function getAllConfiguredShortcuts(
  appShortcuts: Record<string, string>,
  closeTabShortcut: string,
  searchPanelCloseShortcut: string,
  excludeId: string,
  isMac = isMacPlatform(),
  singleTabMode = false,
): string[] {
  const fixedValues = singleTabMode
    ? ALWAYS_FIXED_SHORTCUT_VALUES
    : FIXED_SHORTCUT_VALUES
  const shortcuts = fixedValues.map((shortcut) =>
    normalizeShortcutForConflict(shortcut, isMac),
  )
  for (const [id, s] of Object.entries(appShortcuts)) {
    if (id === excludeId || !s) continue
    // 单标签模式下这些动作不注册热键，也不应占用可配置位。
    if (singleTabMode && TAB_ONLY_APP_SHORTCUT_IDS.has(id)) continue
    shortcuts.push(normalizeShortcutForConflict(s, isMac))
  }
  // 单标签模式隐藏「关闭标签」配置，其值不参与冲突。
  if (!singleTabMode && excludeId !== "close-tab" && closeTabShortcut) {
    shortcuts.push(normalizeShortcutForConflict(closeTabShortcut, isMac))
  }
  if (excludeId !== "search-panel-close" && searchPanelCloseShortcut) {
    shortcuts.push(normalizeShortcutForConflict(searchPanelCloseShortcut, isMac))
  }
  return shortcuts
}

function makeAppShortcutSetter(
  id: string,
  setAppShortcut: (id: string, shortcut: string) => void,
  appShortcuts: Record<string, string>,
  closeTabShortcut: string,
  searchPanelCloseShortcut: string,
  singleTabMode: boolean,
) {
  return (shortcut: string) => {
    if (shortcut) {
      const existing = getAllConfiguredShortcuts(
        appShortcuts,
        closeTabShortcut,
        searchPanelCloseShortcut,
        id,
        isMacPlatform(),
        singleTabMode,
      )
      if (existing.includes(normalizeShortcutForConflict(shortcut))) {
        toast.warning("快捷键冲突", {
          description: `${formatShortcut(shortcut)} 已被其他操作占用，请选择其他快捷键。`,
        })
        return
      }
    }
    setAppShortcut(id, shortcut)
  }
}

function makeCloseSetter(
  excludeId: string,
  setter: (s: string) => void,
  appShortcuts: Record<string, string>,
  closeTabShortcut: string,
  searchPanelCloseShortcut: string,
  singleTabMode: boolean,
) {
  return (shortcut: string) => {
    if (shortcut) {
      const existing = getAllConfiguredShortcuts(
        appShortcuts,
        closeTabShortcut,
        searchPanelCloseShortcut,
        excludeId,
        isMacPlatform(),
        singleTabMode,
      )
      if (existing.includes(normalizeShortcutForConflict(shortcut))) {
        toast.warning("快捷键冲突", {
          description: `${formatShortcut(shortcut)} 已被其他操作占用，请选择其他快捷键。`,
        })
        return
      }
    }
    setter(shortcut)
  }
}

const FIXED_SHORTCUTS = [
  { label: "新建笔记", shortcut: FIXED_APP_SHORTCUTS.newNote },
  { label: "页内查找", shortcut: FIXED_APP_SHORTCUTS.editorFindOpen },
  { label: "恢复最近关闭的标签页（Chrome 逻辑）", shortcut: FIXED_APP_SHORTCUTS.reopenTab, tabOnly: true },
  { label: "打开设置", shortcut: FIXED_APP_SHORTCUTS.openSettings },
  { label: "切换标签页（1~8 对应序号，9 到最后）", shortcut: "Mod+1~9", tabOnly: true },
  { label: "循环切换标签页", shortcut: "Ctrl+Tab", tabOnly: true },
  { label: "反向循环切换标签页", shortcut: "Ctrl+Shift+Tab", tabOnly: true },
  { label: "查找下一处", shortcut: "Mod+G" },
  { label: "查找上一处", shortcut: "Mod+Shift+G" },
  { label: "字号放大", shortcut: "Mod+=" },
  { label: "字号缩小", shortcut: "Mod+-" },
  { label: "重置字号", shortcut: "Mod+0" },
  { label: "继续查找（F3）", shortcut: "F3" },
  { label: "反向继续查找", shortcut: "Shift+F3" },
  { label: "手动保存", shortcut: "Mod+S" },
  { label: "加粗", shortcut: "Mod+B" },
  { label: "斜体", shortcut: "Mod+I" },
  { label: "下划线", shortcut: "Mod+U" },
  { label: "行内代码", shortcut: "Mod+E" },
  { label: "链接", shortcut: "Mod+K" },
  { label: "删除线", shortcut: "Mod+Shift+S" },
  { label: "全选", shortcut: "Mod+A" },
  { label: "撤销", shortcut: "Mod+Z" },
  { label: "重做", shortcut: "Mod+Shift+Z" },
  { label: "重做（Windows）", shortcut: "Mod+Y" },
]

function KbdShortcut({ shortcut }: { shortcut: string }) {
  // 范围键仍需格式化 Mod，避免直接把内部存储值展示给用户。
  if (shortcut.includes("~")) {
    return (
      <kbd className="inline-flex items-center rounded-[6px] bg-[var(--goose-interactive-hover)] px-2 py-0.5 font-mono text-xs text-muted-foreground">
        {formatShortcut(shortcut)}
      </kbd>
    )
  }
  const parts = shortcut.split("+")
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex items-center rounded-[6px] bg-[var(--goose-interactive-hover)] px-2 py-0.5 font-mono text-xs text-muted-foreground"
        >
          {formatShortcut(part)}
        </kbd>
      ))}
    </span>
  )
}

export function SettingsShortcuts({
  closeTabShortcut,
  setCloseTabShortcut,
  searchPanelCloseShortcut,
  setSearchPanelCloseShortcut,
  appShortcuts,
  setAppShortcut,
  resetAppShortcuts,
  singleTabMode,
}: SettingsShortcutsProps) {
  const [confirmReset, setConfirmReset] = useState(false)

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    resetAppShortcuts()
    setCloseTabShortcut(DEFAULT_CLOSE_TAB_SHORTCUT)
    setSearchPanelCloseShortcut(DEFAULT_SEARCH_PANEL_CLOSE_SHORTCUT)
    setConfirmReset(false)
    toast.success("已恢复全部快捷键默认值")
  }

  const safeSetAppShortcut = (id: string) =>
    makeAppShortcutSetter(
      id,
      setAppShortcut,
      appShortcuts,
      closeTabShortcut,
      searchPanelCloseShortcut,
      singleTabMode,
    )

  const safeSetCloseTab = makeCloseSetter(
    "close-tab",
    setCloseTabShortcut,
    appShortcuts,
    closeTabShortcut,
    searchPanelCloseShortcut,
    singleTabMode,
  )
  const safeSetSearchPanelClose = makeCloseSetter(
    "search-panel-close",
    setSearchPanelCloseShortcut,
    appShortcuts,
    closeTabShortcut,
    searchPanelCloseShortcut,
    singleTabMode,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">快捷键</h3>
          <p className="mt-1 text-sm text-muted-foreground">自定义应用内的键盘快捷键或鼠标侧键。</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-1 shrink-0 rounded-[10px]"
          onClick={handleReset}
          onBlur={() => setConfirmReset(false)}
        >
          {confirmReset ? "再次点击确认恢复" : "恢复默认"}
        </Button>
      </div>

      <SettingsSectionCard title="全局动作">
        <ShortcutField
          id="shortcut-toggle-sidebar"
          title="收起 / 展开侧栏"
          description="折叠或展开左侧导航栏，在编辑器聚焦时也可触发。"
          value={appShortcuts.toggleSidebar ?? DEFAULT_APP_SHORTCUTS.toggleSidebar}
          onChange={safeSetAppShortcut("toggleSidebar")}
          resetValue={DEFAULT_APP_SHORTCUTS.toggleSidebar}
        />
        <div className="mt-2">
          <ShortcutField
            id="shortcut-toggle-ai-panel"
            title="开关 AI 面板"
            description="展开或折叠右侧 AI 助手面板。"
            value={appShortcuts.toggleAIPanel ?? DEFAULT_APP_SHORTCUTS.toggleAIPanel}
            onChange={safeSetAppShortcut("toggleAIPanel")}
            resetValue={DEFAULT_APP_SHORTCUTS.toggleAIPanel}
          />
        </div>
        <div className="mt-2">
          <ShortcutField
            id="shortcut-open-search"
            title="全局搜索"
            description="打开全局搜索面板快速跳转页面。"
            value={appShortcuts.openSearch ?? DEFAULT_APP_SHORTCUTS.openSearch}
            onChange={safeSetAppShortcut("openSearch")}
            resetValue={DEFAULT_APP_SHORTCUTS.openSearch}
          />
        </div>
        <div className="mt-2">
          <ShortcutField
            id="shortcut-toggle-theme"
            title="切换深色模式"
            description="按 跟随系统 → 浅色 → 深色 循环切换主题。"
            value={appShortcuts.toggleTheme ?? DEFAULT_APP_SHORTCUTS.toggleTheme}
            onChange={safeSetAppShortcut("toggleTheme")}
            resetValue={DEFAULT_APP_SHORTCUTS.toggleTheme}
          />
        </div>
        <div className="mt-2">
          <ShortcutField
            id="shortcut-nav-back"
            title="后退"
            description="返回上一个选中的文件或浏览位置，鼠标后退键同样生效。"
            value={appShortcuts.navBack ?? DEFAULT_APP_SHORTCUTS.navBack}
            onChange={safeSetAppShortcut("navBack")}
            resetValue={DEFAULT_APP_SHORTCUTS.navBack}
          />
        </div>
        <div className="mt-2">
          <ShortcutField
            id="shortcut-nav-forward"
            title="前进"
            description="前往下一个选中的文件或浏览位置，鼠标前进键同样生效。"
            value={appShortcuts.navForward ?? DEFAULT_APP_SHORTCUTS.navForward}
            onChange={safeSetAppShortcut("navForward")}
            resetValue={DEFAULT_APP_SHORTCUTS.navForward}
          />
        </div>
        {!singleTabMode && <>
          <div className="mt-2">
          <ShortcutField
            id="shortcut-new-tab"
            title="新建标签页"
            description="打开欢迎页作为新标签页，可从中搜索或新建笔记。"
            value={appShortcuts.newTab ?? DEFAULT_APP_SHORTCUTS.newTab}
            onChange={safeSetAppShortcut("newTab")}
            resetValue={DEFAULT_APP_SHORTCUTS.newTab}
          />
          </div>
        </>}
      </SettingsSectionCard>

      <SettingsSectionCard title={singleTabMode ? "面板关闭" : "关闭行为"}>
        {!singleTabMode && <ShortcutField
          id="close-tab-shortcut"
          title="关闭快捷键"
          description="默认留空。设置后，按一次依次关闭：通知 → 弹窗 → 搜索框 → 当前标签页。"
          value={closeTabShortcut}
          onChange={safeSetCloseTab}
          resetValue={DEFAULT_CLOSE_TAB_SHORTCUT}
        />}
        <div className={singleTabMode ? "" : "mt-2"}>
          <ShortcutField
            id="search-panel-close-shortcut"
            title="关闭搜索面板"
            description="在搜索面板打开时按下此键关闭搜索面板。"
            value={searchPanelCloseShortcut}
            onChange={safeSetSearchPanelClose}
            resetValue={DEFAULT_SEARCH_PANEL_CLOSE_SHORTCUT}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="固定快捷键">
        <p className="mb-3 text-xs text-muted-foreground">
          以下快捷键固定内置，不参与云同步；在不同系统上会自动换成对应按键。
        </p>
        <div className="space-y-0.5">
          {FIXED_SHORTCUTS.filter((item) => !singleTabMode || !item.tabOnly).map((item) => (
            <div
              key={item.label}
              className={`flex items-center justify-between gap-4 px-4 py-2.5 ${SETTINGS_OPTION_ROW_CLASS}`}
            >
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <KbdShortcut shortcut={item.shortcut} />
            </div>
          ))}
        </div>
      </SettingsSectionCard>
    </div>
  )
}
