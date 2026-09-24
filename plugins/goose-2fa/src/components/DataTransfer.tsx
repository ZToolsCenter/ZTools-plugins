import { useState, useCallback, useEffect, useRef } from "react";
import { ArrowLeft, Download, Upload, Check, Copy, FileUp } from "lucide-react";
import {
  exportAsJson,
  exportAsUris,
  parseImportBundle,
  deduplicateImports,
} from "@/lib/data-transfer";
import { usePlatform } from "@/platform/context";
import type { AccountData, NewAccountInput, VaultGroup } from "@/lib/types";

interface DataTransferProps {
  accounts: AccountData[];
  groups: VaultGroup[];
  onImport: (inputs: NewAccountInput[], groups?: VaultGroup[]) => void;
  onCancel: () => void;
}

type ViewStep =
  | { kind: "menu" }
  | { kind: "preview"; fresh: NewAccountInput[]; groups: VaultGroup[]; dupes: number }
  | { kind: "done"; count: number };

export function DataTransfer({ accounts, groups, onImport, onCancel }: DataTransferProps) {
  const platform = usePlatform();
  const [view, setView] = useState<ViewStep>({ kind: "menu" });
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const flashCopied = useCallback(() => {
    setCopied(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  }, []);

  const flashExported = useCallback(() => {
    setExported(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setExported(false), 1500);
  }, []);

  const handleExportFile = useCallback(async () => {
    setError("");
    try {
      const json = exportAsJson(accounts, groups);
      const ok = await platform.saveToFile(
        json,
        `goose-2fa-backup-${new Date().toISOString().slice(0, 10)}.json`,
      );
      if (ok) flashExported();
    } catch {
      setError("备份保存失败，请检查文件权限后重试");
    }
  }, [accounts, flashExported, groups, platform]);

  const handleCopyUris = useCallback(async () => {
    setError("");
    try {
      const uris = exportAsUris(accounts);
      await platform.copyText(uris);
      flashCopied();
    } catch {
      setError("复制失败，请检查剪贴板权限后重试");
    }
  }, [accounts, flashCopied, platform]);

  const processImportText = useCallback(
    (text: string) => {
      setError("");
      const bundle = parseImportBundle(text);
      if (!bundle || bundle.accounts.length === 0) {
        setError("未找到有效的账户数据");
        return;
      }
      const { newAccounts, dupeCount } = deduplicateImports(bundle.accounts, accounts);
      if (newAccounts.length === 0) {
        setError(`所有 ${dupeCount} 个账户已存在`);
        return;
      }
      setView({ kind: "preview", fresh: newAccounts, groups: bundle.groups, dupes: dupeCount });
    },
    [accounts],
  );

  const handleOpenFile = useCallback(async () => {
    setError("");
    try {
      const content = await platform.readFromFile();
      if (content) processImportText(content);
    } catch {
      setError("读取备份文件失败");
    }
  }, [processImportText, platform]);

  const handleClipboardImport = useCallback(async () => {
    setError("");
    try {
      const text = await platform.readClipboardText();
      if (!text.trim()) {
        setError("剪贴板为空");
        return;
      }
      processImportText(text);
    } catch {
      setError("读取剪贴板失败");
    }
  }, [processImportText, platform]);

  const handleConfirmImport = useCallback(() => {
    if (view.kind !== "preview") return;
    onImport(view.fresh, view.groups);
    setView({ kind: "done", count: view.fresh.length });
  }, [view, onImport]);

  // Import preview
  if (view.kind === "preview") {
    return (
      <div className="slide-in flex flex-col">
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <button
            onClick={() => { setView({ kind: "menu" }); setError(""); }}
            className="icon-control rounded-lg p-2 text-fg-muted"
            aria-label="返回"
          >
            <ArrowLeft size={17} />
          </button>
          <h2 className="flex-1 text-[15px] font-serif font-semibold tracking-tight text-fg">
            确认导入
          </h2>
        </div>

        <div className="flex flex-col gap-4 px-4 pt-2">
          <div className="rounded-cell border bg-surface px-4 py-3">
            <p className="text-[13px] text-fg">
              发现 <span className="font-semibold">{view.fresh.length}</span> 个新账户
              {view.dupes > 0 && (
                <span className="text-fg-faint">
                  {" "}({view.dupes} 个重复已跳过)
                </span>
              )}
            </p>
          </div>

          <div className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
            {view.fresh.map((a, i) => (
              <div
                key={i}
                className="cell-enter flex items-center gap-3 rounded-cell px-3.5 py-2.5"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-[11px] font-semibold uppercase text-accent">
                  {(a.issuer || a.name).slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">
                    {a.issuer || a.name}
                  </p>
                  {a.issuer && (
                    <p className="truncate text-[11px] text-fg-faint">{a.name}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-fg-faint">
                  {a.type}
                </span>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pb-4">
            <button
              onClick={() => { setView({ kind: "menu" }); setError(""); }}
              className="flex-1 rounded-cell border py-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-hover active:bg-surface-active"
            >
              取消
            </button>
            <button
              onClick={handleConfirmImport}
              className="primary-control flex flex-1 items-center justify-center gap-1.5 rounded-cell bg-accent py-2.5 text-[13px] font-medium text-accent-fg active:scale-[0.98]"
            >
              导入 {view.fresh.length} 个账户
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Import done
  if (view.kind === "done") {
    return (
      <div className="slide-in flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-copied-subtle">
          <Check size={28} className="text-copied" strokeWidth={1.5} />
        </div>
        <div className="text-center">
          <h2 className="text-[15px] font-medium text-fg">
            导入完成
          </h2>
          <p className="mt-1 text-[13px] text-fg-muted">
            已成功导入 {view.count} 个账户
          </p>
        </div>
        <button
          onClick={onCancel}
          className="primary-control mt-2 rounded-cell bg-accent px-5 py-2.5 text-[13px] font-medium text-accent-fg active:scale-[0.97]"
        >
          完成
        </button>
      </div>
    );
  }

  // Main menu
  return (
    <div className="slide-in flex flex-col">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <button
          onClick={onCancel}
          className="icon-control rounded-lg p-2 text-fg-muted"
          aria-label="返回"
        >
          <ArrowLeft size={17} />
        </button>
        <h2 className="flex-1 text-[15px] font-serif font-semibold tracking-tight text-fg">
          数据管理
        </h2>
      </div>

      <div className="flex flex-col gap-6 px-4 pt-3">
        {/* Export */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Download size={15} className="text-accent" />
            <h3 className="text-[13px] font-semibold text-fg">导出备份</h3>
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-fg-muted">
            将{accounts.length > 0 ? ` ${accounts.length} 个` : "所有"}账户保存为备份
          </p>
          <p className="mb-3 rounded-lg bg-surface-hover px-3 py-2 text-[11.5px] leading-relaxed text-fg-muted">
            备份与 OTP 链接包含可生成验证码的密钥，请只保存到可信位置。
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleExportFile}
              disabled={accounts.length === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-cell border bg-surface py-2.5 text-[12.5px] font-medium text-fg transition-colors hover:border-border-strong hover:bg-surface-hover active:bg-surface-active disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-surface-hover disabled:text-fg-faint disabled:opacity-100"
            >
              {exported ? (
                <>
                  <Check size={14} className="text-copied" />
                  <span className="text-copied">已保存</span>
                </>
              ) : (
                <>
                  <FileUp size={14} />
                  保存文件
                </>
              )}
            </button>
            <button
              onClick={handleCopyUris}
              disabled={accounts.length === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-cell border bg-surface py-2.5 text-[12.5px] font-medium text-fg transition-colors hover:border-border-strong hover:bg-surface-hover active:bg-surface-active disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-surface-hover disabled:text-fg-faint disabled:opacity-100"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-copied" />
                  <span className="text-copied">已复制</span>
                </>
              ) : (
                <>
                  <Copy size={14} />
                  复制链接
                </>
              )}
            </button>
          </div>
        </section>

        {/* Divider */}
        <div className="h-px bg-border" />

        {/* Import */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Upload size={15} className="text-accent" />
            <h3 className="text-[13px] font-semibold text-fg">导入数据</h3>
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-fg-muted">
            从 JSON 备份或 otpauth:// 链接恢复账户
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleOpenFile}
              className="flex flex-1 items-center justify-center gap-2 rounded-cell border bg-surface py-2.5 text-[12.5px] font-medium text-fg transition-colors hover:border-border-strong hover:bg-surface-hover active:bg-surface-active"
            >
              <FileUp size={14} />
              选择文件
            </button>
            <button
              onClick={handleClipboardImport}
              className="flex flex-1 items-center justify-center gap-2 rounded-cell border bg-surface py-2.5 text-[12.5px] font-medium text-fg transition-colors hover:border-border-strong hover:bg-surface-hover active:bg-surface-active"
            >
              <Copy size={14} />
              从剪贴板
            </button>
          </div>
        </section>

        {error && (
          <p role="alert" className="fade-in rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-timer-low">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
