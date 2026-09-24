import { useState } from "react";
import { ArrowLeft, RotateCcw, Trash2, AlertTriangle } from "lucide-react";
import type { AccountData } from "@/lib/types";

interface TrashBinProps {
  trash: AccountData[];
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onEmptyTrash: () => void;
  onBack: () => void;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function daysUntilExpiry(deletedAt: number): number {
  const expiryMs = deletedAt + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiryMs - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function TrashBin({ trash, onRestore, onPermanentDelete, onEmptyTrash, onBack }: TrashBinProps) {
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleEmptyTrash = () => {
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    onEmptyTrash();
    setConfirmEmpty(false);
  };

  const handlePermanentDelete = (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    onPermanentDelete(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center gap-2 px-4 pb-2 pt-4">
        <button
          onClick={onBack}
          className="icon-control rounded-lg p-2 text-fg-muted"
          aria-label="返回"
        >
          <ArrowLeft size={17} />
        </button>
        <h1 className="flex-1 text-[15px] font-serif font-semibold tracking-tight text-fg">
          回收站
        </h1>
        {trash.length > 0 && (
          confirmEmpty ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleEmptyTrash}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-timer-low transition-colors hover:bg-danger-soft active:bg-danger-faint"
              >
                确认清空
              </button>
              <button
                onClick={() => setConfirmEmpty(false)}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface active:bg-surface-active"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={handleEmptyTrash}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-fg-faint transition-colors hover:bg-surface hover:text-fg-muted active:bg-surface-active"
            >
              清空
            </button>
          )
        )}
      </header>

      {trash.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-16">
          <div className="rounded-2xl bg-surface p-4">
            <Trash2 size={24} className="text-fg-faint" />
          </div>
          <p className="text-[13px] text-fg-faint">回收站是空的</p>
          <p className="text-[11px] text-fg-faint">删除的账户会在此保留 30 天</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <div className="mb-1 flex items-center gap-1.5 px-1">
            <AlertTriangle size={11} className="text-fg-faint" />
            <span className="text-[11px] text-fg-faint">
              {trash.length} 个已删除账户，30 天后自动永久删除
            </span>
          </div>
          {trash.map((account) => {
            const displayName = account.note
              || (account.issuer ? `${account.issuer} (${account.name})` : account.name);
            const isConfirmingDelete = confirmDeleteId === account.id;
            const remaining = daysUntilExpiry(account.deletedAt ?? 0);

            return (
              <div
                key={account.id}
                className="cell-enter flex items-center gap-3 rounded-cell border bg-surface p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">
                    {displayName}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-fg-faint">
                    {formatTimeAgo(account.deletedAt ?? account.createdAt)} 删除
                    {remaining <= 7 && (
                      <span className="text-timer-low"> · {remaining} 天后过期</span>
                    )}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onRestore(account.id)}
                    className="rounded-lg p-2 text-fg-faint transition-colors hover:bg-bg hover:text-copied active:bg-surface-active"
                    aria-label="恢复"
                  >
                    <RotateCcw size={14} />
                  </button>
                  {isConfirmingDelete ? (
                    <button
                      onClick={() => handlePermanentDelete(account.id)}
                      className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-timer-low transition-colors hover:bg-danger-soft active:bg-danger-faint"
                    >
                      确认
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePermanentDelete(account.id)}
                      className="rounded-lg p-2 text-fg-faint transition-colors hover:bg-bg hover:text-timer-low active:bg-surface-active"
                      aria-label="永久删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
