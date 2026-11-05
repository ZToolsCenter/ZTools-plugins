import { useI18n } from "../app/i18n";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { OperationContext } from "../app/OperationContext";
import "./operation-toast.css";
const stageLabels: Record<string, string> = {
  download: "下载文件",
  validate: "校验文件",
  verify: "校验文件",
  save: "保存技能",
};
// A native modal makes the rest of the document inert. Mount inside the most
// recently opened dialog so the toast remains visible and its controls usable.
function useToastHost() {
  const [host, setHost] = useState<HTMLElement>(() => document.body);
  useEffect(() => {
    const openingOrder = new Map<HTMLDialogElement, number>();
    let sequence = 0;
    const updateHost = (records: MutationRecord[] = []) => {
      for (const record of records) {
        if (
          record.type === "attributes" &&
          record.oldValue === null &&
          record.target instanceof HTMLDialogElement &&
          record.target.open
        ) {
          openingOrder.set(record.target, ++sequence);
        }
      }
      const dialogs = Array.from(
        document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
      );
      for (const dialog of openingOrder.keys()) {
        if (!dialog.isConnected || !dialog.open) openingOrder.delete(dialog);
      }
      for (const dialog of dialogs) {
        if (!openingOrder.has(dialog)) openingOrder.set(dialog, ++sequence);
      }
      const topDialog = dialogs.reduce<HTMLDialogElement | undefined>(
        (top, dialog) =>
          !top || openingOrder.get(dialog)! > openingOrder.get(top)!
            ? dialog
            : top,
        undefined,
      );
      setHost(topDialog ?? document.body);
    };
    const observer = new MutationObserver(updateHost);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
      attributeOldValue: true,
    });
    updateHost();
    return () => observer.disconnect();
  }, []);
  return host;
}
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.max(0, bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function OperationToast() {
  const { t } = useI18n();
  const { error, busy, notice, cancel, dismissError, dismissNotice, progress } =
    useContext(OperationContext);
  const host = useToastHost();
  const dismissNoticeRef = useRef(dismissNotice);
  useEffect(() => {
    dismissNoticeRef.current = dismissNotice;
  }, [dismissNotice]);
  useEffect(() => {
    if (!notice || error || busy) return;
    const timeout = window.setTimeout(() => dismissNoticeRef.current(), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice, error, busy]);
  if (!error && !busy && !notice) return null;
  const state = error ? "error" : busy ? "busy" : "success";
  const hasTotal =
    progress !== null &&
    Number.isFinite(progress.totalFiles) &&
    progress.totalFiles > 0;
  const completedFiles = progress
    ? Math.min(
        Math.max(0, progress.completedFiles),
        Math.max(0, progress.totalFiles),
      )
    : 0;
  const percentage = hasTotal
    ? Math.floor((completedFiles / progress.totalFiles) * 100)
    : undefined;
  const stageLabel =
    (progress?.stage &&
      stageLabels[progress.stage] &&
      t(stageLabels[progress.stage])) ||
    (hasTotal ? t("下载文件") : t("正在处理…"));
  return createPortal(
    <div className="operation-toast-region">
      <div
        className={`operation-toast operation-toast-${state}`}
        role={state === "error" ? "alert" : "status"}
        aria-atomic="true"
        data-operation-state={state}
      >
        <div className="operation-toast-heading">
          {state === "error" ? (
            <TriangleAlert size={19} aria-hidden="true" />
          ) : state === "busy" ? (
            <LoaderCircle size={19} className="spin" aria-hidden="true" />
          ) : (
            <Check size={19} aria-hidden="true" />
          )}
          <span className="operation-toast-message">
            {error || busy || notice}
          </span>
          {state === "busy" ? (
            <button className="text-button" onClick={cancel}>
              {t("取消操作")}
            </button>
          ) : (
            <button
              className="icon-button"
              aria-label={
                state === "error" ? t("关闭错误提示") : t("关闭成功提示")
              }
              onClick={state === "error" ? dismissError : dismissNotice}
            >
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </div>
        {state === "busy" && (
          <div className="operation-toast-progress">
            <progress aria-label={t("操作进度")} max={100} value={percentage} />
            <div className="operation-toast-progress-detail">
              <span>{stageLabel}</span>
              {hasTotal && (
                <span>
                  {t("{done} / {total} 个文件 · {percentage}%", {
                    done: completedFiles,
                    total: progress.totalFiles,
                    percentage: percentage!,
                  })}
                </span>
              )}
            </div>
            {progress?.currentFile && (
              <p className="operation-toast-file" title={progress.currentFile}>
                {progress.currentFile}
              </p>
            )}
            {progress !== null && progress.totalBytes > 0 && (
              <p className="operation-toast-bytes">
                {formatBytes(progress.completedBytes)} /{" "}
                {formatBytes(progress.totalBytes)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>,
    host,
  );
}
