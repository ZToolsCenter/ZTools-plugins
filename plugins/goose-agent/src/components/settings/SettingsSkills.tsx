import { useCallback, useEffect, useState } from "react";
import { Label, Switch } from "@/lib/heroui";
import {
  isAiContextAvailable,
  listGlobalDiscoveredSkills,
  listProjectDiscoveredSkills,
  type DiscoveredSkill,
} from "@/lib/agent/localContext";
import { useSettings } from "@/stores/settings";
import { useWorkspaces } from "@/stores/useWorkspaces";
import { SettingsSectionCard } from "./SettingsSectionCard";
import { cn } from "@/lib/utils";

const ROW_CLASS = "rounded-[12px] border border-border-soft bg-bg";
const SKILL_ROW_CLASS =
  "cursor-pointer px-3 py-2.5 transition-colors hover:bg-surface-hover";

export type OpenSkillsEditorOpts = {
  scope?: "global" | "project";
  initialFilePath?: string | null;
};

interface SettingsSkillsProps {
  onOpenSkillsEditor?: (opts: OpenSkillsEditorOpts) => void;
}

/**
 * 技能 Tab：列表全局 + 项目 Skills；开关绑定 ai.readLocalSkills。
 * KEEP：全局/项目分区用 SettingsSectionCard 平铺列表，非手写 accordion；
 * 不迁 Accordion/Disclosure，避免无收益地改布局。
 */
export function SettingsSkills({ onOpenSkillsEditor }: SettingsSkillsProps) {
  const readLocalSkills = useSettings((s) => s.ai.readLocalSkills);
  const setAIReadLocalSkills = useSettings((s) => s.setAIReadLocalSkills);

  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const workspaceRoot =
    workspaces.find((w) => w.id === activeId)?.path?.trim() || null;

  const [apiReady, setApiReady] = useState(false);
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);

  const reload = useCallback(() => {
    const ready = isAiContextAvailable();
    setApiReady(ready);
    if (!ready) {
      setSkills([]);
      return;
    }
    const global = listGlobalDiscoveredSkills();
    const project = workspaceRoot
      ? listProjectDiscoveredSkills(workspaceRoot)
      : [];
    setSkills([...global, ...project]);
  }, [workspaceRoot]);

  useEffect(() => {
    reload();
  }, [reload]);

  const globalSkills = skills.filter((s) => s.scope === "global");
  const projectSkills = skills.filter((s) => s.scope === "project");

  const openSkill = (skill: DiscoveredSkill) => {
    onOpenSkillsEditor?.({
      scope: skill.scope === "project" ? "project" : "global",
      initialFilePath: skill.path,
    });
  };

  return (
    <div className="min-w-0 space-y-3.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-fg">
            技能
          </h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-fg-faint">
            全局 ~/.agents/skills 与项目 .agents/skills；点条目打开编辑器。
          </p>
          {!apiReady ? (
            <p className="mt-1 text-[11px] leading-snug text-fg-faint">
              需 uTools 真机读取；浏览器预览为空。
            </p>
          ) : null}
        </div>
        {onOpenSkillsEditor ? (
          <button
            type="button"
            onClick={() => onOpenSkillsEditor({})}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover px-3 text-[12.5px] font-medium text-fg hover:bg-surface-active"
          >
            打开技能编辑器
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          "flex min-w-0 items-center justify-between gap-3 px-3 py-2.5",
          ROW_CLASS,
        )}
      >
        <div className="min-w-0 flex-1 space-y-0.5 pr-1">
          <Label className="cursor-pointer text-[13px] font-medium text-fg">
            读取本地 Skill
          </Label>
          <div className="break-words text-[11.5px] leading-snug text-fg-faint">
            开启后对话中可加载本地技能
          </div>
        </div>
        <Switch
          aria-label="读取本地 Skill"
          isSelected={readLocalSkills}
          onChange={setAIReadLocalSkills}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </div>

      <SettingsSectionCard
        title="全局 Skills"
        description={apiReady ? `${globalSkills.length} 个` : "不可用"}
      >
        {globalSkills.length === 0 ? (
          <p className="text-[12px] text-fg-faint">
            {apiReady ? "未发现全局 Skill" : "—"}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {globalSkills.map((skill) => (
              <li
                key={`g:${skill.path}`}
                role={onOpenSkillsEditor ? "button" : undefined}
                tabIndex={onOpenSkillsEditor ? 0 : undefined}
                onClick={
                  onOpenSkillsEditor ? () => openSkill(skill) : undefined
                }
                onKeyDown={
                  onOpenSkillsEditor
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openSkill(skill);
                        }
                      }
                    : undefined
                }
                className={cn(
                  ROW_CLASS,
                  onOpenSkillsEditor ? SKILL_ROW_CLASS : "px-3 py-2.5",
                )}
              >
                <div className="truncate text-[13px] font-medium text-fg">
                  {skill.name}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg-faint">
                  {skill.description}
                </p>
                <p className="mt-1 truncate font-mono text-[10.5px] text-fg-faint">
                  全局 · {skill.path}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SettingsSectionCard>

      <SettingsSectionCard
        title="项目 Skills"
        description={
          workspaceRoot
            ? apiReady
              ? `${projectSkills.length} 个`
              : "不可用"
            : "未挂载工作区"
        }
      >
        {!workspaceRoot ? (
          <p className="text-[12px] text-fg-faint">
            挂载工作区后可扫描 .agents/skills
          </p>
        ) : projectSkills.length === 0 ? (
          <p className="text-[12px] text-fg-faint">
            {apiReady ? "未发现项目 Skill" : "—"}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {projectSkills.map((skill) => (
              <li
                key={`p:${skill.path}`}
                role={onOpenSkillsEditor ? "button" : undefined}
                tabIndex={onOpenSkillsEditor ? 0 : undefined}
                onClick={
                  onOpenSkillsEditor ? () => openSkill(skill) : undefined
                }
                onKeyDown={
                  onOpenSkillsEditor
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openSkill(skill);
                        }
                      }
                    : undefined
                }
                className={cn(
                  ROW_CLASS,
                  onOpenSkillsEditor ? SKILL_ROW_CLASS : "px-3 py-2.5",
                )}
              >
                <div className="truncate text-[13px] font-medium text-fg">
                  {skill.name}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg-faint">
                  {skill.description}
                </p>
                <p className="mt-1 truncate font-mono text-[10.5px] text-fg-faint">
                  项目 · {skill.path}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SettingsSectionCard>
    </div>
  );
}
