/**
 * 定时任务详情：开关、立即运行、摘要、编辑/删除、运行历史。
 */
import { useMemo, useState } from "react";
import { Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  fireAutomation,
  formatScheduleLabel,
  type AutomationRun,
  type AutomationRunStatus,
} from "@/lib/automations";
import { PERMISSION_MODE_LABELS } from "@/lib/agent/permission";
import {
  Button,
  Modal,
  Switch,
  useOverlayState,
} from "@/lib/heroui";
import { cn } from "@/lib/utils";
import { useAgentChats } from "@/stores/useAgentChats";
import { useAutomations } from "@/stores/useAutomations";
import { useWorkspaces } from "@/stores/useWorkspaces";
import { formatNextRunHuman } from "./AutomationList";
import { AUTOMATION_RUNTIME_HINT_SHORT } from "./runtimeNote";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatRunTime(ms: number): string {
  const d = new Date(ms);
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return `${mo}-${day} ${h}:${m}:${s}`;
}

const STATUS_LABEL: Record<AutomationRunStatus, string> = {
  running: "运行中",
  success: "成功",
  error: "失败",
  skipped: "已跳过",
};

const STATUS_COLOR: Record<AutomationRunStatus, string> = {
  running: "text-accent",
  success: "text-copied",
  error: "text-timer-low",
  skipped: "text-fg-faint",
};

const REASON_LABEL: Record<AutomationRun["reason"], string> = {
  schedule: "定时",
  manual: "手动",
  catchup: "补跑",
};

export interface AutomationDetailProps {
  id: string;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onOpenConversation?: (conversationId: string) => void;
}

export function AutomationDetail({
  id,
  onBack,
  onEdit,
  onDeleted,
  onOpenConversation,
}: AutomationDetailProps) {
  const auto = useAutomations((s) => s.automations[id]);
  const listRuns = useAutomations((s) => s.listRuns);
  const setEnabled = useAutomations((s) => s.setEnabled);
  const remove = useAutomations((s) => s.remove);
  const isInFlight = useAutomations((s) => s.isInFlight(id));
  const workspaces = useWorkspaces((s) => s.workspaces);
  const setActiveWs = useWorkspaces((s) => s.setActive);

  const deleteModal = useOverlayState();
  const [firing, setFiring] = useState(false);

  // 订阅 runs 数组以便刷新
  const runsAll = useAutomations((s) => s.runs);
  const runs = useMemo(() => {
    void runsAll;
    return listRuns(id);
  }, [id, listRuns, runsAll]);

  if (!auto) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-3 py-8 text-center">
        <p className="text-[13px] text-fg-faint">任务不存在或已删除</p>
        <Button size="sm" variant="secondary" className="mt-3" onPress={onBack}>
          返回列表
        </Button>
      </div>
    );
  }

  const workspaceName = auto.workspaceId
    ? (workspaces.find((w) => w.id === auto.workspaceId)?.name ?? "未知工作区")
    : "不选择工作区";

  const handleToggle = (enabled: boolean) => {
    setEnabled(id, enabled);
    toast.success(enabled ? "已启用" : "已暂停");
  };

  const handleFire = async () => {
    if (firing || isInFlight) return;
    setFiring(true);
    try {
      const result = await fireAutomation(id, { reason: "manual" });
      if (result.ok) {
        toast.success("已开始运行");
      } else if (result.skipped) {
        toast(result.error || "已跳过");
      } else {
        toast.error(result.error || "触发失败");
      }
    } catch {
      toast.error("触发失败");
    } finally {
      setFiring(false);
    }
  };

  const handleDelete = () => {
    remove(id);
    deleteModal.close();
    toast.success("已删除");
    onDeleted();
  };

  const openRunConversation = (conversationId: string) => {
    useAgentChats.getState().setActiveConversation(conversationId);
    if (auto.workspaceId) {
      setActiveWs(auto.workspaceId);
    }
    onOpenConversation?.(conversationId);
  };

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-4 px-3 py-3 pb-8">
      {/* 操作栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <span className="text-[12.5px] text-fg-muted">
            {auto.enabled ? "已启用" : "已暂停"}
          </span>
          <Switch
            aria-label={auto.enabled ? "暂停任务" : "启用任务"}
            isSelected={auto.enabled}
            onChange={handleToggle}
          >
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>
        </div>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={firing || isInFlight}
          onPress={() => void handleFire()}
        >
          <Play className="size-3.5" strokeWidth={1.75} />
          立即运行
        </Button>
        <Button size="sm" variant="ghost" onPress={onEdit}>
          <Pencil className="size-3.5" strokeWidth={1.75} />
          编辑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-timer-low"
          onPress={() => deleteModal.open()}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
          删除
        </Button>
      </div>

      {/* 摘要 */}
      <section className="rounded-panel border border-border bg-surface p-4">
        <h3 className="mb-2 text-[12.5px] font-semibold text-fg">摘要</h3>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1.5 text-[12.5px]">
          <dt className="text-fg-faint">日程</dt>
          <dd className="min-w-0 break-words text-fg">
            {formatScheduleLabel(auto.schedule)}
          </dd>
          <dt className="text-fg-faint">工作区</dt>
          <dd className="min-w-0 break-words text-fg">{workspaceName}</dd>
          <dt className="text-fg-faint">权限</dt>
          <dd className="text-fg">
            {PERMISSION_MODE_LABELS[auto.permissionMode] ?? "工作区读写"}
          </dd>
          <dt className="text-fg-faint">下次运行</dt>
          <dd className="text-fg">{formatNextRunHuman(auto.nextRunAt)}</dd>
          <dt className="text-fg-faint">上次运行</dt>
          <dd className="text-fg">
            {auto.lastRunAt != null
              ? `${formatNextRunHuman(auto.lastRunAt)}${
                  auto.lastRunStatus
                    ? ` · ${STATUS_LABEL[auto.lastRunStatus]}`
                    : ""
                }`
              : "—"}
          </dd>
          {auto.consecutiveFailures > 0 ? (
            <>
              <dt className="text-fg-faint">连续失败</dt>
              <dd className="text-timer-low">{auto.consecutiveFailures}</dd>
            </>
          ) : null}
        </dl>
        {auto.prompt.trim() ? (
          <div className="mt-3 border-t border-border-soft pt-3">
            <p className="mb-1 text-[11.5px] text-fg-faint">指令</p>
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg">
              {auto.prompt}
            </p>
          </div>
        ) : null}
        <p className="mt-3 border-t border-border-soft pt-3 text-[11.5px] leading-relaxed text-fg-faint">
          {AUTOMATION_RUNTIME_HINT_SHORT}
        </p>
      </section>

      {/* 运行历史 */}
      <section className="rounded-panel border border-border bg-surface p-4">
        <h3 className="mb-2 text-[12.5px] font-semibold text-fg">
          运行历史
          {runs.length > 0 ? (
            <span className="ml-1.5 font-normal text-fg-faint">
              {runs.length}
            </span>
          ) : null}
        </h3>
        {runs.length === 0 ? (
          <p className="text-[12px] text-fg-faint">暂无运行记录</p>
        ) : (
          <ul className="space-y-1" role="list">
            {runs.map((run) => {
              const clickable = Boolean(run.conversationId);
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => {
                      if (run.conversationId) {
                        openRunConversation(run.conversationId);
                      }
                    }}
                    className={cn(
                      "flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left text-[12px]",
                      clickable
                        ? "cursor-pointer hover:bg-surface-hover"
                        : "cursor-default opacity-90",
                    )}
                  >
                    <span className="shrink-0 tabular-nums text-fg-faint">
                      {formatRunTime(run.startedAt)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-medium",
                        STATUS_COLOR[run.status],
                      )}
                    >
                      {STATUS_LABEL[run.status]}
                    </span>
                    <span className="shrink-0 text-fg-faint">
                      {REASON_LABEL[run.reason]}
                    </span>
                    {run.error ? (
                      <span className="min-w-0 flex-1 truncate text-fg-faint">
                        {run.error}
                      </span>
                    ) : clickable ? (
                      <span className="min-w-0 flex-1 truncate text-fg-faint">
                        查看会话
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Modal state={deleteModal}>
        <Modal.Backdrop isDismissable className="bg-black/40">
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog className="rounded-xl bg-surface text-fg shadow-lg ring-1 ring-border">
              <Modal.Header className="px-4 pt-4">
                <Modal.Heading className="text-[14px] font-semibold text-fg">
                  删除定时任务
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="px-4 py-2">
                <p className="text-[12.5px] leading-relaxed text-fg-muted">
                  确定删除「{auto.name || "未命名任务"}」？运行历史将一并清除，此操作不可撤销。
                </p>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-2 px-4 pb-4 pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => deleteModal.close()}
                >
                  取消
                </Button>
                <Button size="sm" variant="danger" onPress={handleDelete}>
                  删除
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
