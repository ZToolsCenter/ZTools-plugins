/**
 * 定时任务创建 / 编辑表单。
 * 控件统一 HeroUI（Select / ToggleButtonGroup / NumberField / Input），禁止原生 select/number。
 * 每天/工作日/每周执行时间：双 NumberField（时 : 分）。
 */
import { useMemo, useState, type FocusEvent } from "react";
import type { Key, Selection } from "react-aria-components";
import { toast } from "@/lib/toast";
import {
  DEFAULT_AUTOMATION_PERMISSION_MODE,
  fireAutomation,
  isValidCronExpression,
  MIN_INTERVAL_MINUTES,
  type Schedule,
} from "@/lib/automations";
import {
  PERMISSION_MODE_LABELS,
  PERMISSION_MODES,
  isPermissionMode,
  type PermissionMode,
} from "@/lib/agent/permission";
import {
  Button,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
} from "@/lib/heroui";
import { useAutomations } from "@/stores/useAutomations";
import { useWorkspaces } from "@/stores/useWorkspaces";

type ScheduleKind = Schedule["kind"];

const NONE_WORKSPACE = "__none__";

const SCHEDULE_PRESETS: { kind: ScheduleKind; label: string }[] = [
  { kind: "daily", label: "每天" },
  { kind: "weekdays", label: "工作日" },
  { kind: "weekly", label: "每周" },
  { kind: "interval", label: "间隔" },
  { kind: "once", label: "一次性" },
  { kind: "manual", label: "仅手动" },
  { kind: "cron", label: "高级 cron" },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: "日" },
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
] as const;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseDatetimeLocal(value: string): number | null {
  if (!value.trim()) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 聚焦时全选当前文本，便于直接改写时/分/间隔 */
function selectAllOnFocus(e: FocusEvent<HTMLInputElement>) {
  // 延后到下一帧，避免与浏览器默认光标定位抢焦点
  requestAnimationFrame(() => {
    e.target.select();
  });
}

type FormScheduleState = {
  kind: ScheduleKind;
  hour: number;
  minute: number;
  dayOfWeek: number;
  everyMinutes: number;
  onceAt: string;
  cronExpression: string;
};

function scheduleToFormState(schedule: Schedule): FormScheduleState {
  const now = new Date();
  const base: FormScheduleState = {
    kind: schedule.kind,
    hour: now.getHours(),
    minute: now.getMinutes(),
    dayOfWeek: 1,
    everyMinutes: MIN_INTERVAL_MINUTES,
    onceAt: toDatetimeLocalValue(now.getTime() + 60 * 60 * 1000),
    cronExpression: "0 9 * * *",
  };
  switch (schedule.kind) {
    case "daily":
    case "weekdays":
      return {
        ...base,
        kind: schedule.kind,
        hour: schedule.hour,
        minute: schedule.minute,
      };
    case "weekly":
      return {
        ...base,
        kind: "weekly",
        dayOfWeek: schedule.dayOfWeek,
        hour: schedule.hour,
        minute: schedule.minute,
      };
    case "interval":
      return {
        ...base,
        kind: "interval",
        everyMinutes: Math.max(
          MIN_INTERVAL_MINUTES,
          schedule.everyMinutes || MIN_INTERVAL_MINUTES,
        ),
      };
    case "once":
      return {
        ...base,
        kind: "once",
        onceAt: toDatetimeLocalValue(
          Number.isFinite(schedule.atMs) && schedule.atMs > 0
            ? schedule.atMs
            : now.getTime() + 60 * 60 * 1000,
        ),
      };
    case "cron":
      return {
        ...base,
        kind: "cron",
        cronExpression: schedule.expression || "0 9 * * *",
      };
    case "manual":
    default:
      return { ...base, kind: "manual" };
  }
}

function buildSchedule(state: FormScheduleState): Schedule | null {
  const hour = Math.min(23, Math.max(0, Math.floor(state.hour) || 0));
  const minute = Math.min(59, Math.max(0, Math.floor(state.minute) || 0));
  switch (state.kind) {
    case "manual":
      return { kind: "manual" };
    case "daily":
      return { kind: "daily", hour, minute };
    case "weekdays":
      return { kind: "weekdays", hour, minute };
    case "weekly":
      return {
        kind: "weekly",
        dayOfWeek: Math.min(6, Math.max(0, Math.floor(state.dayOfWeek) || 0)),
        hour,
        minute,
      };
    case "interval": {
      const mins = Math.floor(Number(state.everyMinutes));
      if (!Number.isFinite(mins) || mins < MIN_INTERVAL_MINUTES) return null;
      return { kind: "interval", everyMinutes: mins };
    }
    case "once": {
      const atMs = parseDatetimeLocal(state.onceAt);
      if (atMs == null) return null;
      return { kind: "once", atMs };
    }
    case "cron": {
      const expression = state.cronExpression.trim();
      if (!expression || !isValidCronExpression(expression)) return null;
      return { kind: "cron", expression };
    }
    default:
      return null;
  }
}

function firstSelectedKey(keys: Selection): string | null {
  if (keys === "all") return null;
  const next = Array.from(keys)[0];
  return typeof next === "string" ? next : null;
}

/** block：避免 HeroUI Label 默认 inline 与下方控件挤在同一行 */
const fieldLabelClass = "block text-[12.5px] font-medium text-fg";

function clampHour(n: number): number {
  return Math.min(23, Math.max(0, Math.floor(n) || 0));
}

function clampMinute(n: number): number {
  return Math.min(59, Math.max(0, Math.floor(n) || 0));
}

/** 执行时间：时 : 分 双 NumberField，聚焦全选 */
function ScheduleTimeField({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) {
  const h = clampHour(hour);
  const m = clampMinute(minute);
  return (
    <div className="flex h-9 items-center gap-1">
      <NumberField
        value={h}
        minValue={0}
        maxValue={23}
        onChange={(v) => {
          if (v == null || Number.isNaN(v)) return;
          onChange(clampHour(v), m);
        }}
        aria-label="小时"
      >
        <NumberField.Group className="h-9 w-[3.25rem]">
          <NumberField.Input
            className="px-1 text-center text-[12.5px] tabular-nums"
            onFocus={selectAllOnFocus}
          />
        </NumberField.Group>
      </NumberField>
      <span
        className="select-none text-[13px] font-medium text-fg-muted"
        aria-hidden
      >
        :
      </span>
      <NumberField
        value={m}
        minValue={0}
        maxValue={59}
        onChange={(v) => {
          if (v == null || Number.isNaN(v)) return;
          onChange(h, clampMinute(v));
        }}
        aria-label="分钟"
      >
        <NumberField.Group className="h-9 w-[3.25rem]">
          <NumberField.Input
            className="px-1 text-center text-[12.5px] tabular-nums"
            onFocus={selectAllOnFocus}
          />
        </NumberField.Group>
      </NumberField>
    </div>
  );
}

function IntervalMinutesField({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <NumberField
      value={value}
      minValue={MIN_INTERVAL_MINUTES}
      onChange={(v) => {
        if (v == null || Number.isNaN(v)) return;
        onChange(Math.max(MIN_INTERVAL_MINUTES, Math.floor(v)));
      }}
      aria-label="间隔分钟"
    >
      <NumberField.Group className="h-9 w-[6.5rem]">
        <NumberField.DecrementButton />
        <NumberField.Input
          className="text-center text-[12.5px] tabular-nums"
          onFocus={selectAllOnFocus}
        />
        <NumberField.IncrementButton />
      </NumberField.Group>
    </NumberField>
  );
}

export interface AutomationFormProps {
  editId?: string;
  onCancel: () => void;
  /** openedDetail=true 表示保存并立即运行后进入详情 */
  onSaved: (id: string, openedDetail: boolean) => void;
}

export function AutomationForm({
  editId,
  onCancel,
  onSaved,
}: AutomationFormProps) {
  const getAutomation = useAutomations((s) => s.getAutomation);
  const create = useAutomations((s) => s.create);
  const update = useAutomations((s) => s.update);
  const workspaces = useWorkspaces((s) => s.workspaces);

  const existing = editId ? getAutomation(editId) : undefined;

  const [name, setName] = useState(() => existing?.name ?? "");
  /** 默认不选择工作区；编辑时保留原绑定（含 null） */
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => {
    if (existing) {
      return existing.workspaceId?.trim() ? existing.workspaceId : null;
    }
    return null;
  });
  const [prompt, setPrompt] = useState(() => existing?.prompt ?? "");
  const [scheduleState, setScheduleState] = useState<FormScheduleState>(() =>
    scheduleToFormState(
      existing?.schedule ?? {
        kind: "daily",
        hour: 9,
        minute: 0,
      },
    ),
  );
  /** 定时任务默认完整权限（含 runCommand）；对话 Composer 默认仍是工作区读写 */
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    existing?.permissionMode && isPermissionMode(existing.permissionMode)
      ? existing.permissionMode
      : DEFAULT_AUTOMATION_PERMISSION_MODE,
  );
  const [saving, setSaving] = useState(false);

  const needsTime =
    scheduleState.kind === "daily" ||
    scheduleState.kind === "weekdays" ||
    scheduleState.kind === "weekly";

  const validationError = useMemo(() => {
    if (!name.trim()) return "请填写名称";
    if (!prompt.trim()) return "请填写指令";
    if (scheduleState.kind === "interval") {
      const mins = Math.floor(Number(scheduleState.everyMinutes));
      if (!Number.isFinite(mins) || mins < MIN_INTERVAL_MINUTES) {
        return `间隔至少 ${MIN_INTERVAL_MINUTES} 分钟`;
      }
    }
    if (scheduleState.kind === "once") {
      if (parseDatetimeLocal(scheduleState.onceAt) == null) {
        return "请选择有效的执行时间";
      }
    }
    if (scheduleState.kind === "cron") {
      const expr = scheduleState.cronExpression.trim();
      if (!expr) return "请填写 cron 表达式";
      if (!isValidCronExpression(expr)) return "cron 表达式无效";
    }
    return null;
  }, [name, prompt, scheduleState]);

  const setKind = (kind: ScheduleKind) => {
    setScheduleState((prev) => ({ ...prev, kind }));
  };

  const handleWorkspaceSelection = (key: Key | null) => {
    if (key == null) return;
    const id = String(key);
    if (id === NONE_WORKSPACE) {
      setWorkspaceId(null);
      return;
    }
    if (workspaces.some((w) => w.id === id)) {
      setWorkspaceId(id);
    }
  };

  const handleScheduleSelection = (keys: Selection) => {
    const key = firstSelectedKey(keys);
    if (!key) return;
    if (SCHEDULE_PRESETS.some((p) => p.kind === key)) {
      setKind(key as ScheduleKind);
    }
  };

  const handleWeekdaySelection = (keys: Selection) => {
    const key = firstSelectedKey(keys);
    if (key == null) return;
    const day = Number(key);
    if (!Number.isFinite(day) || day < 0 || day > 6) return;
    setScheduleState((s) => ({ ...s, dayOfWeek: day }));
  };

  const persist = async (andRun: boolean) => {
    if (saving) return;
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const schedule = buildSchedule(scheduleState);
    if (!schedule) {
      toast.error("日程配置无效");
      return;
    }

    setSaving(true);
    try {
      let id = editId;
      if (id && existing) {
        update(id, {
          name: name.trim(),
          prompt: prompt.trim(),
          workspaceId,
          schedule,
          permissionMode,
        });
      } else {
        id = create({
          name: name.trim(),
          prompt: prompt.trim(),
          workspaceId,
          schedule,
          permissionMode,
          enabled: true,
        });
      }

      if (andRun && id) {
        const result = await fireAutomation(id, { reason: "manual" });
        if (result.ok) {
          toast.success("已保存并开始运行");
        } else if (result.skipped) {
          toast(result.error || "已跳过本次运行");
        } else {
          toast.error(result.error || "触发失败");
        }
        onSaved(id, true);
      } else if (id) {
        toast.success(editId ? "已保存" : "已创建");
        onSaved(id, false);
      }
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const workspaceSelectedKey = workspaceId ?? NONE_WORKSPACE;
  const workspaceLabel =
    workspaceId == null
      ? "不选择工作区"
      : (workspaces.find((w) => w.id === workspaceId)?.name ?? "不选择工作区");

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col px-3 py-3 pb-8">
      <div className="space-y-4">
        {/* 1. 名称 */}
        <div className="space-y-1.5">
          <Label htmlFor="auto-name" className={fieldLabelClass}>
            名称
          </Label>
          <Input
            id="auto-name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：每日站会摘要"
            autoComplete="off"
          />
        </div>

        {/* 2. 工作区（可选，默认不选择） */}
        <div className="space-y-1.5">
          <Label className={fieldLabelClass}>工作区</Label>
          <Select
            aria-label="工作区"
            selectedKey={workspaceSelectedKey}
            onSelectionChange={handleWorkspaceSelection}
            fullWidth
          >
            <Select.Trigger className="h-9 w-full">
              <Select.Value>
                {() => (
                  <span className="truncate text-[12.5px] text-fg">
                    {workspaceLabel}
                  </span>
                )}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="min-w-[var(--trigger-width)]">
              <ListBox aria-label="工作区列表">
                <ListBox.Item
                  id={NONE_WORKSPACE}
                  textValue="不选择工作区"
                  className="cursor-pointer text-[12.5px]"
                >
                  不选择工作区
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {workspaces.map((w) => (
                  <ListBox.Item
                    key={w.id}
                    id={w.id}
                    textValue={w.name}
                    className="cursor-pointer text-[12.5px]"
                  >
                    {w.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        {/* 2b. 权限模式 */}
        <div className="space-y-1.5">
          <Label className={fieldLabelClass}>权限模式</Label>
          <Select
            aria-label="权限模式"
            selectedKey={permissionMode}
            onSelectionChange={(key) => {
              if (key == null) return;
              const id = String(key);
              if (isPermissionMode(id)) setPermissionMode(id);
            }}
            fullWidth
          >
            <Select.Trigger className="h-9 w-full">
              <Select.Value>
                {() => (
                  <span className="truncate text-[12.5px] text-fg">
                    {PERMISSION_MODE_LABELS[permissionMode]}
                  </span>
                )}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="min-w-[var(--trigger-width)]">
              <ListBox aria-label="权限模式列表">
                {PERMISSION_MODES.map((mode) => (
                  <ListBox.Item
                    key={mode}
                    id={mode}
                    textValue={PERMISSION_MODE_LABELS[mode]}
                    className="cursor-pointer text-[12.5px]"
                  >
                    {PERMISSION_MODE_LABELS[mode]}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        {/* 3. 指令 */}
        <div className="space-y-1.5">
          <Label htmlFor="auto-prompt" className={fieldLabelClass}>
            指令
          </Label>
          <TextArea
            id="auto-prompt"
            fullWidth
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述要自动执行的任务…"
            className="min-h-[10rem]"
          />
        </div>

        {/* 4. 日程 */}
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className={fieldLabelClass}>日程</Label>
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={new Set([scheduleState.kind])}
              onSelectionChange={handleScheduleSelection}
              disallowEmptySelection
              isDetached
              size="sm"
              aria-label="日程类型"
              className="flex flex-wrap gap-1.5"
            >
              {SCHEDULE_PRESETS.map((p) => (
                <ToggleButton
                  key={p.kind}
                  id={p.kind}
                  className="h-8 px-3 text-[12px]"
                >
                  {p.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </div>

          {needsTime ? (
            <div className="flex flex-wrap items-center gap-3">
              {scheduleState.kind === "weekly" ? (
                <ToggleButtonGroup
                  selectionMode="single"
                  selectedKeys={new Set([String(scheduleState.dayOfWeek)])}
                  onSelectionChange={handleWeekdaySelection}
                  disallowEmptySelection
                  isDetached
                  size="sm"
                  aria-label="星期"
                  className="flex flex-wrap gap-1.5"
                >
                  {WEEKDAY_OPTIONS.map((d) => (
                    <ToggleButton
                      key={d.value}
                      id={String(d.value)}
                      className="size-8 min-w-8 px-0 text-[12px]"
                    >
                      {d.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              ) : null}
              <ScheduleTimeField
                hour={scheduleState.hour}
                minute={scheduleState.minute}
                onChange={(hour, minute) =>
                  setScheduleState((s) => ({ ...s, hour, minute }))
                }
              />
            </div>
          ) : null}

          {scheduleState.kind === "interval" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-fg-muted">每</span>
              <IntervalMinutesField
                value={scheduleState.everyMinutes}
                onChange={(everyMinutes) =>
                  setScheduleState((s) => ({ ...s, everyMinutes }))
                }
              />
              <span className="text-[12px] text-fg-muted">
                分钟（最少 {MIN_INTERVAL_MINUTES}）
              </span>
            </div>
          ) : null}

          {scheduleState.kind === "once" ? (
            <Input
              type="datetime-local"
              fullWidth
              value={scheduleState.onceAt}
              onChange={(e) =>
                setScheduleState((s) => ({ ...s, onceAt: e.target.value }))
              }
              onFocus={selectAllOnFocus}
              className="max-w-xs"
              aria-label="执行时间"
            />
          ) : null}

          {scheduleState.kind === "cron" ? (
            <Input
              fullWidth
              value={scheduleState.cronExpression}
              onChange={(e) =>
                setScheduleState((s) => ({
                  ...s,
                  cronExpression: e.target.value,
                }))
              }
              onFocus={selectAllOnFocus}
              placeholder="分 时 日 月 周，如 0 9 * * 1-5"
              className="font-mono text-[12px]"
              aria-label="cron 表达式"
            />
          ) : null}
        </div>

        {/* 5. 按钮 */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            isDisabled={saving}
            onPress={() => void persist(false)}
          >
            保存
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={saving}
            onPress={() => void persist(true)}
          >
            保存并立即运行
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={saving}
            onPress={onCancel}
          >
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
