/**
 * 独立首次引导全屏页：配置凭证（必做）+ 可选工作区。
 * 有凭证进工作台后自动播界面导览 1 次；无主表面常驻入口；设置可重置。
 * 不在主界面空态内嵌起步清单。
 */
import {
  Check,
  FolderPlus,
  KeyRound,
  ArrowRight,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { isFsAvailable } from "@/lib/fs";
import {
  deriveChecklistStatus,
  type ChecklistItem,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { useSettings } from "@/stores/settings";
import { useWorkspaces } from "@/stores/useWorkspaces";

const ITEM_ICONS = {
  apiKey: KeyRound,
  workspace: FolderPlus,
} as const;

function openAiSettings() {
  window.dispatchEvent(
    new CustomEvent("goose-agent:open-settings", {
      detail: { section: "ai" },
    }),
  );
}

export interface OnboardingScreenProps {
  /** 进入主工作台（侧栏 + 会话） */
  onEnter: () => void;
}

export function OnboardingScreen({ onEnter }: OnboardingScreenProps) {
  const ai = useSettings((s) => s.ai);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const addFromPicker = useWorkspaces((s) => s.addFromPicker);

  const status = deriveChecklistStatus({
    settings: ai,
    workspaces,
  });

  // 引导页两项：Key 必做、工作区可选；进工作台后自动播导览（非顶栏入口）
  const setupItems = status.items;
  const setupDoneCount = status.doneCount;
  const progressPct = Math.round((setupDoneCount / setupItems.length) * 100);
  const canEnter = status.hasApiKey;

  const handleAddWorkspace = async () => {
    if (!isFsAvailable()) {
      const isUtools =
        typeof window !== "undefined" && Boolean(window.gooseAgent);
      toast.error(
        isUtools
          ? "本机文件桥不可用，请检查 gooseFs"
          : "当前环境无本机文件桥；请在 uTools 中打开本插件",
      );
      return;
    }
    try {
      const item = await addFromPicker();
      if (!item) return;
      toast.success(`已添加：${item.name}`);
    } catch (err) {
      console.error("[onboarding] addFromPicker failed:", err);
      toast.error("选择文件夹失败");
    }
  };

  const handleAction = (item: ChecklistItem) => {
    if (item.action === "open-ai-settings") {
      openAiSettings();
      return;
    }
    if (item.action === "add-workspace") {
      void handleAddWorkspace();
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-bg text-fg">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 flex flex-col items-center text-center">
            <div
              className="flex size-11 items-center justify-center rounded-[14px] bg-accent-subtle text-[20px]"
              aria-hidden
            >
              🪿
            </div>
            <h1 className="mt-3 text-[17px] font-semibold tracking-tight text-fg">
              欢迎使用鹅的 Agent
            </h1>
            <p className="mt-1.5 text-[12.5px] leading-snug text-fg-faint">
              先完成起步配置，再进入工作台对话
            </p>
          </div>

          <div
            className="overflow-hidden rounded-panel bg-surface text-left"
            role="region"
            aria-label="起步配置"
          >
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold tracking-tight text-fg">
                  起步配置
                </p>
                <p className="mt-0.5 text-[11px] text-fg-faint">
                  {setupDoneCount}/{setupItems.length} 已完成
                  {canEnter ? " · 可进入工作台" : " · 需先配置 Key"}
                </p>
              </div>
            </div>

            <div
              className="mx-4 mb-2 h-1 overflow-hidden rounded-full bg-border-soft"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-fg transition-[width] duration-200 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <ul className="px-2 pb-2" role="list">
              {setupItems.map((item) => {
                const Icon = ITEM_ICONS[item.id];
                const isKeyCta = item.id === "apiKey" && !item.done;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "flex gap-2.5 rounded-[12px] px-2 py-2.5",
                      !item.done && isKeyCta ? "bg-bg" : null,
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                        item.done
                          ? "bg-copied-subtle text-copied"
                          : "bg-bg text-fg-faint",
                      )}
                      aria-hidden
                    >
                      {item.done ? (
                        <Check size={13} strokeWidth={2.25} />
                      ) : (
                        <Icon size={12} strokeWidth={1.75} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-[12.5px] font-medium leading-snug",
                          item.done ? "text-fg-faint" : "text-fg",
                        )}
                      >
                        {item.title}
                        {item.id === "workspace" ? (
                          <span className="ml-1 font-normal text-fg-faint">
                            （可选）
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-fg-faint">
                        {item.id === "workspace" && !item.done
                          ? "用于读写本地文件；可不加直接对话"
                          : item.description}
                      </p>
                      {item.actionLabel && item.action ? (
                        <button
                          type="button"
                          onClick={() => handleAction(item)}
                          className={cn(
                            "mt-2 inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-medium",
                            "transition-colors duration-150",
                            isKeyCta
                              ? "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active"
                              : "bg-bg text-fg hover:bg-surface-hover",
                          )}
                        >
                          {item.actionLabel}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <button
            type="button"
            onClick={onEnter}
            disabled={!canEnter}
            className={cn(
              "mt-4 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[12px]",
              "text-[13px] font-medium transition-colors duration-150",
              canEnter
                ? "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active"
                : "bg-surface text-fg-faint opacity-70",
            )}
          >
            进入工作台
            <ArrowRight size={15} strokeWidth={1.75} />
          </button>

          {!canEnter ? (
            <p className="mt-2.5 text-center text-[11px] text-fg-faint">
              配置凭证后即可进入
            </p>
          ) : (
            <p className="mt-2.5 text-center text-[11px] text-fg-faint">
              工作区可稍后在左侧添加
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
