import { lazy, Suspense, useEffect, useState } from "react";
import { OnboardingScreen } from "@/components/onboarding";
import { Toast } from "@/lib/toast";
import {
  SettingsPage,
  type SettingsTabId,
} from "@/components/settings";
import { WorkbenchShell } from "@/components/shell/WorkbenchShell";
import { useAgentHotkeys } from "@/hooks/useAgentHotkeys";
import { applyAppearanceFonts } from "@/lib/appearance/applyAppearance";
import { startAutomationScheduler } from "@/lib/automations";
import { hasConfiguredApiKey } from "@/lib/onboarding";
import { applyWindowHeight } from "@/lib/platform/windowHeight";
import type { PluginEnterDetail } from "@/platform/types";
import { useAgentChats } from "@/stores/useAgentChats";
import { useFileChanges } from "@/stores/useFileChanges";
import { useSettings } from "@/stores/settings";
import { useWorkspaces } from "@/stores/useWorkspaces";

/** 变更差异页含 @pierre/diffs + shiki，整页懒加载，避免进首屏 vendor */
const ChangesPage = lazy(() =>
  import("@/components/changes").then((m) => ({ default: m.ChangesPage })),
);

/** 技能编辑含 CodeMirror 6，整页懒加载（ADR 0016） */
const SkillsEditorPage = lazy(() =>
  import("@/components/skills-editor").then((m) => ({
    default: m.SkillsEditorPage,
  })),
);

/** 定时任务页（与 settings/changes 同级全页） */
const AutomationsPage = lazy(() =>
  import("@/components/automations").then((m) => ({
    default: m.AutomationsPage,
  })),
);

type AppView =
  | "onboarding"
  | "workbench"
  | "settings"
  | "changes"
  | "skills"
  | "automations";

type SkillsNavState = {
  scope?: "global" | "project";
  initialFilePath?: string | null;
};

const SETTINGS_TAB_IDS: SettingsTabId[] = [
  "model",
  "persona",
  "prompt",
  "skills",
  "mcp",
  "appearance",
];

function parseSettingsTab(section?: string): SettingsTabId | null {
  if (!section) return null;
  return SETTINGS_TAB_IDS.includes(section as SettingsTabId)
    ? (section as SettingsTabId)
    : null;
}

/**
 * 视图：独立引导 → 工作台 shell → 设置 / 变更 / 技能 / 定时任务全页。
 * 首次引导不在主界面空态内嵌。
 */
export default function App() {
  const [view, setView] = useState<AppView>(() =>
    hasConfiguredApiKey(useSettings.getState().ai)
      ? "workbench"
      : "onboarding",
  );
  /** 从设置返回时：若从未进入过工作台且仍无 Key，回引导页 */
  const [hasEnteredWorkbench, setHasEnteredWorkbench] = useState(() =>
    hasConfiguredApiKey(useSettings.getState().ai),
  );
  const [skillsOpen, setSkillsOpen] = useState<SkillsNavState | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(null);

  useAgentHotkeys();

  const appearance = useSettings((s) => s.appearance);
  const hydrated = useSettings((s) => s._hasHydrated);
  useEffect(() => {
    if (!hydrated) return;
    applyAppearanceFonts(appearance);
    applyWindowHeight(appearance.windowHeight);
  }, [hydrated, appearance]);

  /**
   * persist 异步水合：首屏 useState 读到的是空初始 ai，会误落 onboarding。
   * 水合完成后若已有有效凭证且仍停在引导，切回工作台。
   * 用户已进入过工作台、或不在 onboarding 时不强制。
   */
  useEffect(() => {
    if (!hydrated) return;
    if (view !== "onboarding") return;
    if (hasEnteredWorkbench) return;
    if (!hasConfiguredApiKey(useSettings.getState().ai)) return;
    setHasEnteredWorkbench(true);
    setView("workbench");
  }, [hydrated, view, hasEnteredWorkbench]);

  const activeConversationId = useAgentChats((s) => s.activeConversationId);
  const focusPath = useFileChanges((s) => s.focusPath);

  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeWsId = useWorkspaces((s) => s.activeId);
  const workspaceRoot =
    workspaces.find((w) => w.id === activeWsId)?.path?.trim() || null;

  const enterWorkbench = () => {
    setHasEnteredWorkbench(true);
    setView("workbench");
  };

  const leaveSettings = () => {
    setSettingsTab(null);
    if (
      hasEnteredWorkbench ||
      hasConfiguredApiKey(useSettings.getState().ai)
    ) {
      setHasEnteredWorkbench(true);
      setView("workbench");
      return;
    }
    setView("onboarding");
  };

  const openSkillsEditor = (opts: SkillsNavState = {}) => {
    setSkillsOpen(opts);
    setView("skills");
  };

  const leaveSkills = () => {
    setView("settings");
    setSettingsTab("skills");
    setSkillsOpen(null);
  };

  const openChanges = (path?: string) => {
    if (path) {
      useFileChanges.getState().setFocusPath(path);
    } else {
      useFileChanges.getState().setFocusPath(null);
    }
    setView("changes");
  };

  const leaveChanges = () => {
    useFileChanges.getState().setFocusPath(null);
    setView("workbench");
  };

  const leaveAutomations = () => {
    setView("workbench");
  };

  /** 离开引导后启动定时任务调度器（幂等；卸载页不 stop，应用存活期间保持运行） */
  useEffect(() => {
    if (view === "onboarding") return;
    startAutomationScheduler();
  }, [view]);

  useEffect(() => {
    const saved = localStorage.getItem("goose-agent-dark");
    const isDark =
      saved !== null
        ? saved === "true"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", isDark);

    const handleThemeChanged = (e: CustomEvent<{ isDark: boolean }>) => {
      if (localStorage.getItem("goose-agent-dark") === null) {
        document.documentElement.classList.toggle("dark", e.detail.isDark);
      }
    };
    window.addEventListener(
      "goose-agent:theme-changed",
      handleThemeChanged as EventListener,
    );

    const handleEnter = (e: Event) => {
      const detail = (e as CustomEvent<PluginEnterDetail>).detail;
      void detail;
    };
    window.addEventListener("goose-agent:plugin-enter", handleEnter);

    /** 任意处可 dispatch 打开设置；detail.section 定位 Tab */
    const handleOpenSettings = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: string }>).detail;
      const tab = parseSettingsTab(detail?.section);
      setSettingsTab(tab);
      setView("settings");
    };
    window.addEventListener(
      "goose-agent:open-settings",
      handleOpenSettings as EventListener,
    );

    /** 任意处可 dispatch 打开技能编辑器 */
    const handleOpenSkillsEditor = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          scope?: "global" | "project";
          initialFilePath?: string | null;
        }>
      ).detail;
      setSkillsOpen({
        scope: detail?.scope,
        initialFilePath: detail?.initialFilePath ?? null,
      });
      setView("skills");
    };
    window.addEventListener(
      "goose-agent:open-skills-editor",
      handleOpenSkillsEditor as EventListener,
    );

    /** 任意处可 dispatch 打开变更页；detail.path 可选聚焦路径 */
    const handleOpenChanges = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      const path = detail?.path?.trim();
      if (path) {
        useFileChanges.getState().setFocusPath(path);
      } else {
        useFileChanges.getState().setFocusPath(null);
      }
      setView("changes");
    };
    window.addEventListener(
      "goose-agent:open-changes",
      handleOpenChanges as EventListener,
    );

    /** 任意处可 dispatch 打开定时任务 */
    const handleOpenAutomations = () => {
      setView("automations");
    };
    window.addEventListener(
      "goose-agent:open-automations",
      handleOpenAutomations,
    );

    return () => {
      window.removeEventListener(
        "goose-agent:theme-changed",
        handleThemeChanged as EventListener,
      );
      window.removeEventListener("goose-agent:plugin-enter", handleEnter);
      window.removeEventListener(
        "goose-agent:open-settings",
        handleOpenSettings as EventListener,
      );
      window.removeEventListener(
        "goose-agent:open-skills-editor",
        handleOpenSkillsEditor as EventListener,
      );
      window.removeEventListener(
        "goose-agent:open-changes",
        handleOpenChanges as EventListener,
      );
      window.removeEventListener(
        "goose-agent:open-automations",
        handleOpenAutomations,
      );
    };
  }, []);

  /**
   * 进过工作台后保持 WorkbenchShell 挂载（hidden），
   * 设置 / 变更 / 技能 / 定时任务叠在上层，避免 LRU pane 与 scroll 被卸载（ADR 0015）。
   */
  const workbenchMounted =
    view !== "onboarding" &&
    (hasEnteredWorkbench || view === "workbench");

  return (
    <>
      {view === "onboarding" ? (
        <OnboardingScreen onEnter={enterWorkbench} />
      ) : (
        <>
          {workbenchMounted ? (
            <main
              className={
                view === "workbench"
                  ? "flex h-full min-h-0 w-full overflow-hidden bg-bg text-fg"
                  : "hidden"
              }
              aria-hidden={view === "workbench" ? undefined : true}
            >
              <WorkbenchShell
                onOpenSettings={() => {
                  setSettingsTab(null);
                  setView("settings");
                }}
                onOpenChanges={openChanges}
              />
            </main>
          ) : null}

          {view === "settings" ? (
            <main className="h-full min-h-0 w-full overflow-hidden bg-bg text-fg">
              <SettingsPage
                onBack={leaveSettings}
                initialTab={settingsTab ?? undefined}
                onOpenSkillsEditor={openSkillsEditor}
              />
            </main>
          ) : null}

          {view === "skills" ? (
            <main className="h-full min-h-0 w-full overflow-hidden bg-bg text-fg">
              <Suspense
                fallback={
                  <div className="flex h-full min-h-0 w-full items-center justify-center bg-bg text-sm text-fg-muted">
                    加载技能编辑…
                  </div>
                }
              >
                <SkillsEditorPage
                  onBack={leaveSkills}
                  workspaceRoot={workspaceRoot}
                  initialScope={skillsOpen?.scope}
                  initialFilePath={skillsOpen?.initialFilePath}
                />
              </Suspense>
            </main>
          ) : null}

          {view === "changes" ? (
            <main className="h-full min-h-0 w-full overflow-hidden bg-bg text-fg">
              <Suspense
                fallback={
                  <div className="flex h-full min-h-0 w-full items-center justify-center bg-bg text-sm text-fg-muted">
                    加载变更…
                  </div>
                }
              >
                <ChangesPage
                  conversationId={activeConversationId}
                  onBack={leaveChanges}
                  initialPath={focusPath}
                />
              </Suspense>
            </main>
          ) : null}

          {view === "automations" ? (
            <main className="h-full min-h-0 w-full overflow-hidden bg-bg text-fg">
              <Suspense
                fallback={
                  <div className="flex h-full min-h-0 w-full items-center justify-center bg-bg text-sm text-fg-muted">
                    加载定时任务…
                  </div>
                }
              >
                <AutomationsPage
                  onBack={leaveAutomations}
                  onOpenConversation={(conversationId) => {
                    useAgentChats
                      .getState()
                      .setActiveConversation(conversationId);
                    const c =
                      useAgentChats.getState().conversations[conversationId];
                    if (c?.workspaceId) {
                      useWorkspaces.getState().setActive(c.workspaceId);
                    }
                    setView("workbench");
                  }}
                />
              </Suspense>
            </main>
          ) : null}
        </>
      )}
      <Toast.Provider
        placement="top end"
        className="goose-toaster"
        maxVisibleToasts={4}
        gap={8}
        width={320}
      />
    </>
  );
}
