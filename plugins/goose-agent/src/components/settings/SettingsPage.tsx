import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "@/lib/toast";
import { resetOnboardingTour } from "@/lib/onboarding";
import { useSettings } from "@/stores/settings";
import { SettingsAI } from "./SettingsAI";
import { SettingsAppearance } from "./SettingsAppearance";
import { SettingsMcp } from "./SettingsMcp";
import { SettingsNav, type SettingsTabId } from "./SettingsNav";
import { SettingsPersona } from "./SettingsPersona";
import { SettingsPrompt } from "./SettingsPrompt";
import { SettingsSkills, type OpenSkillsEditorOpts } from "./SettingsSkills";

interface SettingsPageProps {
  onBack: () => void;
  /** 打开时定位的设置 Tab（如从技能编辑器返回） */
  initialTab?: SettingsTabId;
  /** 打开技能编辑器全页 */
  onOpenSkillsEditor?: (opts: OpenSkillsEditorOpts) => void;
}

/**
 * 设置独立全页：左侧垂直导航 + 右侧独占内容。
 */
export function SettingsPage({
  onBack,
  initialTab,
  onOpenSkillsEditor,
}: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTabId>(initialTab ?? "model");

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const ai = useSettings((s) => s.ai);
  const setAISelectedModelId = useSettings((s) => s.setAISelectedModelId);
  const saveAICustomConfig = useSettings((s) => s.saveAICustomConfig);
  const setPreferredAuthMode = useSettings((s) => s.setPreferredAuthMode);
  const setOAuthSession = useSettings((s) => s.setOAuthSession);
  const setProviderEnabled = useSettings((s) => s.setProviderEnabled);

  const handleResetTour = () => {
    resetOnboardingTour();
    toast.success("已重置界面导览");
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg text-fg">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="icon-control inline-flex size-8 items-center justify-center rounded-md text-fg-muted"
          title="返回"
          aria-label="返回工作台"
        >
          <ArrowLeft size={18} strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[14px] font-semibold leading-tight text-fg">
            设置
          </h1>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SettingsNav active={tab} onChange={setTab} />

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3">
          {tab === "model" ? (
            <div className="mx-auto w-full max-w-[640px]">
              <SettingsAI
                ai={ai}
                selectedModelId={ai.selectedModelId}
                setSelectedModelId={setAISelectedModelId}
                saveCustomConfig={saveAICustomConfig}
                setPreferredAuthMode={setPreferredAuthMode}
                setOAuthSession={setOAuthSession}
                setProviderEnabled={setProviderEnabled}
              />
              {import.meta.env.DEV ? (
                <div
                  className="mt-4 rounded-panel bg-bg p-4"
                  data-testid="dev-onboarding-reset"
                >
                  <p className="text-[12.5px] font-medium text-fg">开发</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-fg-faint">
                    仅开发模式可见。重置导览进度，不清除 Key 与工作区。
                  </p>
                  <button
                    type="button"
                    onClick={handleResetTour}
                    className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-surface-hover px-3 text-[12.5px] font-medium text-fg hover:bg-surface-active"
                  >
                    重置界面导览
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "persona" ? (
            <div className="mx-auto w-full max-w-[640px]">
              <SettingsPersona />
            </div>
          ) : null}

          {tab === "prompt" ? (
            <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col">
              <SettingsPrompt />
            </div>
          ) : null}

          {tab === "skills" ? (
            <div className="mx-auto w-full max-w-[640px]">
              <SettingsSkills onOpenSkillsEditor={onOpenSkillsEditor} />
            </div>
          ) : null}

          {tab === "mcp" ? (
            <div className="mx-auto w-full max-w-[640px]">
              <SettingsMcp />
            </div>
          ) : null}

          {tab === "appearance" ? (
            <div className="mx-auto w-full max-w-[640px]">
              <SettingsAppearance />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
