import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { ArrowLeft, Check, Copy, Trash2, MapPin, Clock, Globe, Monitor, Tag, Pencil, FolderOpen } from "lucide-react";
import { useOtpCode } from "@/hooks/useOtpCode";
import { formatCode } from "@/lib/otp";
import type { AccountData, VaultGroup } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AccountDetailProps {
  account: AccountData;
  groups: VaultGroup[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onCopy: (text: string) => boolean | Promise<boolean>;
  onUpdateNote: (id: string, note: string) => void;
  onUpdateRemark: (id: string, remark: string) => void;
  onUpdateGroup: (id: string, groupId: string | null) => void;
}

const DAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatCreatedAt(ts: number): string {
  const d = new Date(ts);
  const day = DAY_NAMES[d.getDay()];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${day} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatLocation(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

export function AccountDetail({
  account,
  groups,
  onClose,
  onDelete,
  onCopy,
  onUpdateNote,
  onUpdateRemark,
  onUpdateGroup,
}: AccountDetailProps) {
  const { code, remaining, period } = useOtpCode(account);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const [editingRemark, setEditingRemark] = useState(false);
  const [remarkValue, setRemarkValue] = useState(account.remark ?? "");
  const [barReady, setBarReady] = useState(false);
  const [nameOverflow, setNameOverflow] = useState(false);
  const noteInputRef = useRef<HTMLInputElement>(null);
  const remarkInputRef = useRef<HTMLInputElement>(null);
  const nameSpanRef = useRef<HTMLSpanElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setBarReady(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  const isTotp = account.type === "totp";
  const isLow = isTotp && remaining <= 5;
  const progress = isTotp ? remaining / period : 1;

  const originalName = account.originalName
    || (account.issuer ? `${account.issuer} (${account.name})` : account.name);

  const displayName = account.note || originalName;

  useLayoutEffect(() => {
    const el = nameSpanRef.current;
    if (!el) return;
    setNameOverflow(el.scrollWidth > el.clientWidth + 1);
  }, [displayName]);

  useEffect(() => {
    if (editingNote) {
      const el = noteInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [editingNote]);

  useEffect(() => {
    if (editingRemark) remarkInputRef.current?.focus();
  }, [editingRemark]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const handleCopy = useCallback(async () => {
    setCopyError(false);
    const success = await onCopy(code);
    if (!success) {
      setCopyError(true);
      return;
    }
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [code, onCopy]);

  const handleDelete = useCallback(() => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete(account.id);
  }, [confirmingDelete, account.id, onDelete]);

  const handleStartEditName = useCallback(() => {
    setNoteValue(displayName);
    setEditingNote(true);
  }, [displayName]);

  const handleNoteSave = useCallback(() => {
    const trimmed = noteValue.trim();
    // 空 / 与原始名相同 → 清空 note 恢复默认
    const next = (!trimmed || trimmed === originalName) ? "" : trimmed;
    if (next !== (account.note ?? "")) {
      onUpdateNote(account.id, next);
    }
    setEditingNote(false);
  }, [noteValue, account.id, account.note, originalName, onUpdateNote]);

  const handleNoteKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") handleNoteSave();
    if (e.key === "Escape") {
      setEditingNote(false);
    }
  }, [handleNoteSave]);

  const handleRemarkSave = useCallback(() => {
    const trimmed = remarkValue.trim();
    if (trimmed !== (account.remark ?? "")) {
      onUpdateRemark(account.id, trimmed);
    }
    setEditingRemark(false);
  }, [remarkValue, account.id, account.remark, onUpdateRemark]);

  const handleRemarkKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") handleRemarkSave();
    if (e.key === "Escape") {
      setRemarkValue(account.remark ?? "");
      setEditingRemark(false);
    }
  }, [handleRemarkSave, account.remark]);

  const meta = account.meta;

  const metaItems: { icon: React.ReactNode; label: string; value: string }[] = [];

  if (originalName !== displayName) {
    metaItems.push({
      icon: <Tag size={13} />,
      label: "原始名称",
      value: originalName,
    });
  }

  const createdAt = formatCreatedAt(account.createdAt);

  if (meta?.location) {
    metaItems.push({
      icon: <MapPin size={13} />,
      label: "添加位置",
      value: formatLocation(meta.location.latitude, meta.location.longitude),
    });
  }

  if (meta?.timezone) {
    metaItems.push({
      icon: <Globe size={13} />,
      label: "时区",
      value: meta.timezone,
    });
  }

  if (meta?.platform) {
    metaItems.push({
      icon: <Monitor size={13} />,
      label: "设备",
      value: meta.platform,
    });
  }

  const remark = account.remark ?? "";
  const groupOptions = [
    { value: null, label: "未分组" },
    ...[...groups]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"))
      .map((group) => ({ value: group.id, label: group.name })),
  ];

  return (
    <TooltipProvider delay={200}>
    <div className="flex min-h-screen flex-col bg-bg px-5 pb-6 pt-4">
      {/* 顶栏 */}
      <div className="mb-6 flex items-center gap-2">
        <button
          autoFocus
          onClick={onClose}
          className="icon-control rounded-lg p-2 text-fg-muted"
          aria-label="返回"
        >
          <ArrowLeft size={17} />
        </button>
        <span className="text-[15px] font-serif font-semibold tracking-tight text-fg">
          账户详情
        </span>
      </div>

      {/* 名称（可编辑） + 备注 */}
      <div className="mb-5">
        {editingNote ? (
          <Input
            ref={noteInputRef}
            type="text"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onBlur={handleNoteSave}
            onKeyDown={handleNoteKeyDown}
            placeholder={originalName}
            className="h-[44px] px-3.5 py-0 text-[18px] font-semibold leading-none"
            style={{ caretColor: "var(--color-accent)" }}
          />
        ) : (
          <button
            onClick={handleStartEditName}
            className="group flex h-[44px] w-full min-w-0 items-center gap-2 rounded-cell border border-transparent px-3.5 text-left transition-colors hover:border-border hover:bg-surface active:bg-surface-active"
          >
            {nameOverflow ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      ref={nameSpanRef}
                      className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-none text-fg"
                    >
                      {displayName}
                    </span>
                  }
                />
                <TooltipContent>{displayName}</TooltipContent>
              </Tooltip>
            ) : (
              <span
                ref={nameSpanRef}
                className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-none text-fg"
              >
                {displayName}
              </span>
            )}
            <Pencil size={13} className="shrink-0 text-fg-faint" />
          </button>
        )}

        {/* 备注行 */}
        <div className="mt-2">
          {editingRemark ? (
            <Input
              ref={remarkInputRef}
              type="text"
              value={remarkValue}
              onChange={(e) => setRemarkValue(e.target.value)}
              onBlur={handleRemarkSave}
              onKeyDown={handleRemarkKeyDown}
              placeholder="添加备注"
              className="h-[32px] px-3.5 py-0 text-[12.5px] leading-none"
            />
          ) : (
            <button
              onClick={() => { setRemarkValue(remark); setEditingRemark(true); }}
              className="group flex h-[32px] w-full items-center gap-2 rounded-cell border border-transparent px-3.5 text-left transition-colors hover:border-border hover:bg-surface active:bg-surface-active"
            >
              <span className={`min-w-0 flex-1 truncate text-[12.5px] leading-none ${remark ? "text-fg-muted" : "text-fg-faint"}`}>
                {remark || "添加备注"}
              </span>
              <Pencil size={11} className="shrink-0 text-fg-faint" />
            </button>
          )}
        </div>
      </div>

      {/* 验证码区 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => void handleCopy()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void handleCopy();
          }
        }}
        className={`mb-2 flex cursor-pointer items-center justify-between rounded-cell border p-5 transition-all duration-150 ${
          copied
            ? "copied-flash border-copied-border"
            : "bg-surface hover:bg-surface-hover active:scale-[0.98]"
        }`}
      >
        <span
          className={`flex h-[34px] items-center font-mono text-[34px] font-semibold leading-none tracking-[0.08em] transition-colors duration-200 ${
            copied ? "text-copied" : isLow ? "text-timer-low" : "text-fg"
          }`}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {copied ? (
            <span className="flex items-center gap-2 text-[22px]">
              <Check size={22} strokeWidth={2.5} />
              已复制
            </span>
          ) : (
            formatCode(code)
          )}
        </span>
        {!copied && (
          <Copy size={17} className="text-fg-faint" />
        )}
      </div>
      {copyError && (
        <p role="alert" className="mb-2 text-[12px] text-timer-low">
          复制失败，请检查剪贴板权限后重试
        </p>
      )}

      {/* 进度条 */}
      {isTotp && (
        <div className="mb-6 h-[4px] w-full overflow-hidden rounded-full bg-border-soft">
          <div
            className={`timer-bar h-full rounded-full ${
              isLow ? "bg-timer-low" : "bg-accent"
            } ${barReady && remaining !== period ? "" : "timer-reset"}`}
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      )}

      {!isTotp && (
        <div className="mb-6 flex items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-fg-faint">
            HOTP
          </span>
          <span className="text-[10px] text-fg-faint">
            #{account.counter}
          </span>
        </div>
      )}

      {/* 分组与添加时间 */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <section className="flex min-w-0 flex-col rounded-cell border bg-surface px-3.5 py-3" aria-labelledby="account-group-label">
          <div className="mb-2 flex items-center gap-2">
            <FolderOpen size={13} className="text-fg-faint" />
            <span id="account-group-label" className="text-[11px] text-fg-faint">分组</span>
          </div>
          <Select<string>
            items={groupOptions}
            value={account.groupId ?? null}
            onValueChange={(value) => onUpdateGroup(account.id, value)}
          >
            <SelectTrigger
              className="group/select h-9 w-full min-w-0 text-[12.5px]"
              aria-label="移动到分组"
            >
              <SelectValue placeholder="未分组" />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {groupOptions.map((option) => (
                  <SelectItem key={option.value ?? "ungrouped"} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {groups.length === 0 && (
            <p className="mt-2 text-[10.5px] leading-snug text-fg-faint">
              可在主界面创建分组
            </p>
          )}
        </section>

        <section className="flex min-w-0 flex-col rounded-cell border bg-surface px-3.5 py-3" aria-labelledby="account-created-label">
          <div className="mb-2 flex items-center gap-2">
            <Clock size={13} className="text-fg-faint" />
            <span id="account-created-label" className="text-[11px] text-fg-faint">添加时间</span>
          </div>
          <time
            dateTime={new Date(account.createdAt).toISOString()}
            className="break-words text-[12px] leading-relaxed text-fg-muted"
          >
            {createdAt}
          </time>
        </section>
      </div>

      {/* 元数据 */}
      {metaItems.length > 0 && <div className="mb-6 rounded-cell border bg-surface p-4">
        <div className="flex flex-col gap-3">
          {metaItems.map((item) => (
            <div key={item.label} className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 text-fg-faint">{item.icon}</span>
              <div className="min-w-0">
                <span className="block text-[11px] text-fg-faint">{item.label}</span>
                <span className="block text-[12.5px] text-fg-muted">{item.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* 删除 */}
      <div className="mt-auto">
        {confirmingDelete ? (
          <div className="flex items-center justify-between rounded-cell border border-danger-border bg-danger-faint px-4 py-3">
            <span className="text-[12.5px] text-fg-muted">确认删除此账户？</span>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 rounded-lg bg-timer-low px-3 py-1.5 text-[12px] font-medium text-danger-fg transition-[filter,transform] hover:brightness-95 active:translate-y-px active:brightness-90"
              >
                <Check size={12} />
                确认
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="rounded-lg border px-3 py-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-hover active:bg-surface-active"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleDelete}
            className="flex w-full items-center justify-center gap-1.5 rounded-cell border py-2.5 text-[12.5px] text-fg-faint transition-colors hover:border-danger-border hover:bg-danger-faint hover:text-timer-low active:bg-danger-soft"
          >
            <Trash2 size={13} />
            删除账户
          </button>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}
