import { useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button, Input, Label, TextArea } from "@/lib/heroui";
import { BUILTIN_PERSONAS, type AgentPersona } from "@/lib/agent/persona";
import { useSettings } from "@/stores/settings";
import { SettingsSectionCard } from "./SettingsSectionCard";
import { cn } from "@/lib/utils";

const ROW_CLASS = "rounded-[12px] border border-border-soft bg-bg";

/**
 * 角色 Tab：内置预设 + 自定义（名称 / 性格）+ 选中当前角色。
 */
export function SettingsPersona() {
  const selectedPersonaId = useSettings((s) => s.persona.selectedPersonaId);
  const customPersonas = useSettings((s) => s.persona.customPersonas);
  const setSelectedPersonaId = useSettings((s) => s.setSelectedPersonaId);
  const addCustomPersona = useSettings((s) => s.addCustomPersona);
  const updateCustomPersona = useSettings((s) => s.updateCustomPersona);
  const removeCustomPersona = useSettings((s) => s.removeCustomPersona);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSnippet, setDraftSnippet] = useState("");

  const allPersonas = useMemo(
    () => [...BUILTIN_PERSONAS, ...customPersonas],
    [customPersonas],
  );

  const editing = useMemo(
    () =>
      editingId
        ? customPersonas.find((p) => p.id === editingId) ?? null
        : null,
    [editingId, customPersonas],
  );

  const startEdit = (persona: AgentPersona) => {
    if (persona.isBuiltin) return;
    setEditingId(persona.id);
    setDraftName(persona.name);
    setDraftSnippet(persona.systemSnippet);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
    setDraftSnippet("");
  };

  const saveEdit = () => {
    if (!editingId) return;
    updateCustomPersona(editingId, {
      name: draftName,
      systemSnippet: draftSnippet,
    });
    toast.success("角色已更新");
    cancelEdit();
  };

  const handleAdd = () => {
    const id = addCustomPersona({
      name: "新角色",
      systemSnippet: "描述这个角色的性格与说话方式。",
    });
    setEditingId(id);
    setDraftName("新角色");
    setDraftSnippet("描述这个角色的性格与说话方式。");
  };

  const handleRemove = (id: string) => {
    removeCustomPersona(id);
    if (editingId === id) cancelEdit();
    toast.success("已删除自定义角色");
  };

  return (
    <div className="min-w-0 space-y-3.5">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">
          角色
        </h3>
        <p className="mt-0.5 text-[11.5px] leading-snug text-fg-faint">
          选择全局默认性格；自定义角色可编辑名称与性格文本
        </p>
      </div>

      <SettingsSectionCard title="预设与自定义">
        <div className="space-y-1.5">
          {allPersonas.map((persona) => {
            const selected = persona.id === selectedPersonaId;
            return (
              <div
                key={persona.id}
                className={cn(
                  "flex min-w-0 items-start gap-2 px-3 py-2.5",
                  ROW_CLASS,
                  selected && "border-border bg-accent-subtle",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSelectedPersonaId(persona.id)}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-fg">
                      {persona.name}
                    </span>
                    {persona.isBuiltin ? (
                      <span className="shrink-0 text-[10.5px] text-fg-faint">
                        内置
                      </span>
                    ) : null}
                    {selected ? (
                      <Check
                        className="ml-auto h-3.5 w-3.5 shrink-0 text-fg"
                        strokeWidth={2}
                        aria-label="已选中"
                      />
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg-faint">
                    {persona.systemSnippet || "（无性格文本）"}
                  </p>
                </button>
                {!persona.isBuiltin ? (
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => startEdit(persona)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label={`删除 ${persona.name}`}
                      onPress={() => handleRemove(persona.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-2">
          <Button size="sm" variant="secondary" onPress={handleAdd}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            新建角色
          </Button>
        </div>
      </SettingsSectionCard>

      {editing ? (
        <SettingsSectionCard title="编辑自定义角色">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="persona-name"
                className="text-[12.5px] font-medium text-fg"
              >
                名称
              </Label>
              <Input
                id="persona-name"
                fullWidth
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="角色名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="persona-snippet"
                className="text-[12.5px] font-medium text-fg"
              >
                性格文本
              </Label>
              <TextArea
                id="persona-snippet"
                fullWidth
                value={draftSnippet}
                onChange={(e) => setDraftSnippet(e.target.value)}
                placeholder="描述性格、语气与偏好…"
                className="min-h-[8rem]"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onPress={saveEdit}>
                保存
              </Button>
              <Button size="sm" variant="secondary" onPress={cancelEdit}>
                取消
              </Button>
            </div>
          </div>
        </SettingsSectionCard>
      ) : null}
    </div>
  );
}
