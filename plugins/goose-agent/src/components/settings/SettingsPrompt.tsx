import { useCallback, useEffect, useState } from "react";
import { Copy, Save } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button, Label, Switch, TextArea } from "@/lib/heroui";
import {
  isAiContextAvailable,
  readGlobalAgentsPrompt,
  readProjectAgentsPrompt,
  writeGlobalAgentsPrompt,
  writeProjectAgentsPrompt,
} from "@/lib/agent/localContext";
import { useSettings } from "@/stores/settings";
import { useWorkspaces } from "@/stores/useWorkspaces";
import { SettingsSectionCard } from "./SettingsSectionCard";
import { cn } from "@/lib/utils";

const ROW_CLASS = "rounded-[12px] border border-border-soft bg-bg";

/**
 * 提示词 Tab：编辑全局 AGENTS.md；有工作区时可选展示项目 AGENTS.md。
 * 只要编辑 / 选中复制 / 阅读；无导出分享。
 */
export function SettingsPrompt() {
  const readGlobalPromptEnabled = useSettings((s) => s.ai.readGlobalPrompt);
  const setAIReadGlobalPrompt = useSettings((s) => s.setAIReadGlobalPrompt);

  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const workspaceRoot =
    workspaces.find((w) => w.id === activeId)?.path?.trim() || null;

  const [apiReady, setApiReady] = useState(false);
  const [globalDraft, setGlobalDraft] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [globalDirty, setGlobalDirty] = useState(false);
  const [projectDirty, setProjectDirty] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingProject, setSavingProject] = useState(false);

  const reload = useCallback(() => {
    const ready = isAiContextAvailable();
    setApiReady(ready);
    if (!ready) {
      setGlobalDraft("");
      setProjectDraft("");
      setGlobalDirty(false);
      setProjectDirty(false);
      return;
    }
    setGlobalDraft(readGlobalAgentsPrompt() ?? "");
    setGlobalDirty(false);
    if (workspaceRoot) {
      setProjectDraft(readProjectAgentsPrompt(workspaceRoot) ?? "");
      setProjectDirty(false);
    } else {
      setProjectDraft("");
      setProjectDirty(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    reload();
  }, [reload]);

  const copyText = async (text: string) => {
    const value = text ?? "";
    try {
      if (typeof window !== "undefined" && window.gooseAgent?.copyText) {
        window.gooseAgent.copyText(value);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error("no clipboard");
      }
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleSaveGlobal = () => {
    if (!apiReady) {
      toast.error("需 uTools 真机");
      return;
    }
    setSavingGlobal(true);
    try {
      const ok = writeGlobalAgentsPrompt(globalDraft);
      if (ok) {
        setGlobalDirty(false);
        toast.success("全局提示词已保存");
      } else {
        toast.error("保存失败", {
          description: "请确认 preload 已支持 writeGlobalPrompt",
        });
      }
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveProject = () => {
    if (!apiReady || !workspaceRoot) {
      toast.error(workspaceRoot ? "需 uTools 真机" : "请先挂载工作区");
      return;
    }
    setSavingProject(true);
    try {
      const ok = writeProjectAgentsPrompt(workspaceRoot, projectDraft);
      if (ok) {
        setProjectDirty(false);
        toast.success("项目提示词已保存");
      } else {
        toast.error("保存失败", {
          description: "请确认 preload 已支持 writeProjectPrompt",
        });
      }
    } finally {
      setSavingProject(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5">
      <div className="min-w-0 shrink-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">
          提示词
        </h3>
        <p className="mt-0.5 text-[11.5px] leading-snug text-fg-faint">
          编辑全局 ~/AGENTS.md；有工作区时可编辑项目 AGENTS.md
        </p>
        {!apiReady ? (
          <p className="mt-1 text-[11px] leading-snug text-fg-faint">
            需 uTools 真机读写；浏览器预览为空。
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "flex min-w-0 shrink-0 items-center justify-between gap-3 px-3 py-2.5",
          ROW_CLASS,
        )}
      >
        <div className="min-w-0 flex-1 space-y-0.5 pr-1">
          <Label className="cursor-pointer text-[13px] font-medium text-fg">
            读取全局提示词
          </Label>
          <div className="break-words text-[11.5px] leading-snug text-fg-faint">
            开启后并入系统提示
          </div>
        </div>
        <Switch
          aria-label="读取全局提示词"
          isSelected={readGlobalPromptEnabled}
          onChange={setAIReadGlobalPrompt}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </div>

      <SettingsSectionCard
        className="flex min-h-0 flex-1 flex-col"
        contentClassName="flex min-h-0 flex-1 flex-col space-y-2"
        title="全局 AGENTS.md"
        description="路径：~/AGENTS.md"
        actions={
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label="复制全局提示词"
              onPress={() => {
                void copyText(globalDraft);
              }}
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
            <Button
              size="sm"
              isDisabled={!apiReady || savingGlobal || !globalDirty}
              onPress={handleSaveGlobal}
            >
              <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
              {savingGlobal ? "保存中…" : "保存"}
            </Button>
          </div>
        }
      >
        <TextArea
          aria-label="全局提示词"
          fullWidth
          value={globalDraft}
          onChange={(e) => {
            setGlobalDraft(e.target.value);
            setGlobalDirty(true);
          }}
          placeholder={
            apiReady
              ? "在此编辑全局 AGENTS.md…"
              : "需 uTools 真机后可编辑"
          }
          disabled={!apiReady}
          className="min-h-[min(50vh,22rem)] flex-1 font-mono text-[12px] leading-relaxed"
        />
      </SettingsSectionCard>

      {workspaceRoot ? (
        <SettingsSectionCard
          title="项目 AGENTS.md"
          description={`工作区：${workspaceRoot}`}
          actions={
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label="复制项目提示词"
                onPress={() => {
                  void copyText(projectDraft);
                }}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
              <Button
                size="sm"
                isDisabled={!apiReady || savingProject || !projectDirty}
                onPress={handleSaveProject}
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                {savingProject ? "保存中…" : "保存"}
              </Button>
            </div>
          }
        >
          <TextArea
            aria-label="项目提示词"
            fullWidth
            value={projectDraft}
            onChange={(e) => {
              setProjectDraft(e.target.value);
              setProjectDirty(true);
            }}
            placeholder={
              apiReady
                ? "在此编辑项目 AGENTS.md…"
                : "需 uTools 真机后可编辑"
            }
            disabled={!apiReady}
            className="min-h-[12rem] font-mono text-[12px] leading-relaxed"
          />
        </SettingsSectionCard>
      ) : (
        <p className="shrink-0 text-[11.5px] leading-snug text-fg-faint">
          挂载工作区后可编辑项目 AGENTS.md
        </p>
      )}
    </div>
  );
}
