/**
 * 定时任务全页壳（ADR 0017）：列表 / 新建编辑 / 详情。
 */
import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/lib/heroui";
import { AutomationDetail } from "./AutomationDetail";
import { AutomationForm } from "./AutomationForm";
import { AutomationList } from "./AutomationList";
import { AUTOMATION_RUNTIME_HINT_SHORT } from "./runtimeNote";

export interface AutomationsPageProps {
  onBack: () => void;
  /** 打开 fire 产生的会话并回工作台 */
  onOpenConversation?: (conversationId: string) => void;
}

type PageMode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }
  | { kind: "detail"; id: string };

export function AutomationsPage({
  onBack,
  onOpenConversation,
}: AutomationsPageProps) {
  const [mode, setMode] = useState<PageMode>({ kind: "list" });

  const headerTitle =
    mode.kind === "create"
      ? "新建定时任务"
      : mode.kind === "edit"
        ? "编辑定时任务"
        : mode.kind === "detail"
          ? "任务详情"
          : "定时任务";

  const headerSub =
    mode.kind === "list" ? AUTOMATION_RUNTIME_HINT_SHORT : undefined;

  const onHeaderBack = () => {
    if (mode.kind === "list") {
      onBack();
      return;
    }
    if (mode.kind === "edit") {
      setMode({ kind: "detail", id: mode.id });
      return;
    }
    if (mode.kind === "detail" || mode.kind === "create") {
      setMode({ kind: "list" });
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg text-fg">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          onPress={onHeaderBack}
          className="icon-control size-8 min-w-8 text-fg-muted"
          aria-label={mode.kind === "list" ? "返回工作台" : "返回"}
        >
          <ArrowLeft size={18} strokeWidth={1.75} />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[14px] font-semibold leading-tight text-fg">
            {headerTitle}
          </h1>
          {headerSub ? (
            <p className="text-[11.5px] leading-tight text-fg-faint">
              {headerSub}
            </p>
          ) : null}
        </div>
        {mode.kind === "list" ? (
          <Button size="sm" onPress={() => setMode({ kind: "create" })}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            新建
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode.kind === "list" ? (
          <AutomationList
            onSelect={(id) => setMode({ kind: "detail", id })}
            onCreate={() => setMode({ kind: "create" })}
          />
        ) : null}

        {mode.kind === "create" ? (
          <AutomationForm
            onCancel={() => setMode({ kind: "list" })}
            onSaved={(id) => setMode({ kind: "detail", id })}
          />
        ) : null}

        {mode.kind === "edit" ? (
          <AutomationForm
            editId={mode.id}
            onCancel={() => setMode({ kind: "detail", id: mode.id })}
            onSaved={(id) => setMode({ kind: "detail", id })}
          />
        ) : null}

        {mode.kind === "detail" ? (
          <AutomationDetail
            id={mode.id}
            onBack={() => setMode({ kind: "list" })}
            onEdit={() => setMode({ kind: "edit", id: mode.id })}
            onDeleted={() => setMode({ kind: "list" })}
            onOpenConversation={onOpenConversation}
          />
        ) : null}
      </div>
    </div>
  );
}
