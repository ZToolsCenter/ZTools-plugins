import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Clipboard,
  FileImage,
  FolderInput,
  ImageDown,
  Loader2,
  Replace,
  Save,
  SlidersHorizontal,
  X,
  XCircle,
} from "lucide-react";
import "./styles.css";

type OutputFormat = ImageZipOptions["format"];
type JobResult = ImageZipSuccess | ImageZipFailure;
type OutputMode = "overwrite" | "saveAs";
type InputItem =
  | { id: string; kind: "path"; name: string; path: string; size?: number; mode: OutputMode; outputPath?: string }
  | { id: string; kind: "buffer"; name: string; data: ArrayBuffer; size: number; mode: "saveAs"; outputPath?: string };

const formatOptions: Array<{ value: OutputFormat; label: string; hint: string }> = [
  { value: "original", label: "保持格式", hint: "只压缩" },
  { value: "jpeg", label: "JPEG", hint: "照片优先" },
  { value: "png", label: "PNG", hint: "透明图" },
  { value: "webp", label: "WebP", hint: "小体积" },
];
const supportedInputPattern = /\.(jpe?g|png|webp|avif)$/i;
const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = Math.abs(bytes);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const sign = bytes < 0 ? "-" : "";
  return `${sign}${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getFileNameFromPath(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  return parts.at(-1) || filePath;
}

function App() {
  const [inputs, setInputs] = useState<InputItem[]>([]);
  const [format, setFormat] = useState<OutputFormat>("webp");
  const [quality, setQuality] = useState(78);
  const [resultsById, setResultsById] = useState<Record<string, JobResult>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [pendingOverwriteItem, setPendingOverwriteItem] = useState<Extract<InputItem, { kind: "path" }> | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const pathInputs = useMemo(() => inputs.filter((item): item is Extract<InputItem, { kind: "path" }> => item.kind === "path"), [inputs]);
  const bufferInputs = useMemo(
    () => inputs.filter((item): item is Extract<InputItem, { kind: "buffer" }> => item.kind === "buffer"),
    [inputs],
  );
  const results = Object.values(resultsById);
  const failures = results.filter((item): item is ImageZipFailure => !item.ok);
  const progressText = `${results.length}/${inputs.length}`;
  const canRun = inputs.length > 0 && !isRunning;

  useEffect(() => {
    window.ztools?.setExpendHeight?.(560);
  }, []);

  function appendInputs(nextItems: InputItem[]) {
    setInputs((current) => {
      const seen = new Set(current.map((item) => (item.kind === "path" ? item.path : item.id)));
      const deduped = nextItems.filter((item) => {
        const key = item.kind === "path" ? item.path : item.id;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      const merged = [...current, ...deduped];
      return merged;
    });
  }

  function makePathItem(filePath: string, size?: number): InputItem {
    return {
      id: `path:${filePath}`,
      kind: "path",
      name: getFileNameFromPath(filePath),
      path: filePath,
      size,
      mode: "saveAs",
    };
  }

  function makePathItems(filePaths: string[]) {
    const infos = window.imageZip?.getFileInfos?.(filePaths) ?? [];
    if (infos.length === 0) {
      return filePaths.map((filePath) => makePathItem(filePath));
    }
    return filePaths.map((filePath, index) => {
      const info = infos[index];
      return info?.ok ? makePathItem(filePath, info.info.size) : makePathItem(filePath);
    });
  }

  async function fileToInputItem(file: File, index: number): Promise<InputItem> {
    const filePath = window.ztools?.getPathForFile?.(file);
    if (filePath) {
      return makePathItem(filePath, file.size);
    }
    return {
      id: `buffer:${file.name}:${file.size}:${file.lastModified}:${index}`,
      kind: "buffer",
      name: file.name || `clipboard-image-${Date.now()}.png`,
      data: await file.arrayBuffer(),
      size: file.size,
      mode: "saveAs",
    };
  }

  async function appendFiles(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((file) => supportedMimeTypes.has(file.type) || supportedInputPattern.test(file.name));
    if (imageFiles.length === 0) {
      return;
    }
    appendInputs(await Promise.all(imageFiles.map(fileToInputItem)));
  }

  function chooseFiles() {
    const selected = window.ztools?.showOpenDialog?.({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: ["jpg", "jpeg", "png", "webp", "avif"],
        },
      ],
    });
    if (selected?.length) {
      appendInputs(makePathItems(selected));
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    await appendFiles(event.dataTransfer.files);
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      await appendFiles(files);
    }
  }

  function removeInput(id: string) {
    setInputs((current) => current.filter((item) => item.id !== id));
    setResultsById((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function getOutputExtension(result?: ImageZipResult) {
    return result?.outputFormat || (format === "original" ? "webp" : format);
  }

  function getDefaultSaveName(item: InputItem, result?: ImageZipResult) {
    const rawName = item.name || "image";
    const cleanName = rawName.replace(/\.[^.]+$/, "");
    return `${cleanName}-compressed.${getOutputExtension(result)}`;
  }

  function getDefaultSavePath(item: InputItem, result?: ImageZipResult) {
    const defaultDir = window.imageZip?.getDefaultSaveDir?.() || window.imageZip?.getDefaultOutputDir?.();
    if (!defaultDir) {
      return getDefaultSaveName(item, result);
    }
    const separator = defaultDir.includes("\\") ? "\\" : "/";
    return `${defaultDir.replace(/[\\/]+$/, "")}${separator}${getDefaultSaveName(item, result)}`;
  }

  function getBaseOptions() {
    return {
      format,
      quality,
      maxWidth: 0,
      maxHeight: 0,
      suffix: "-compressed",
    };
  }

  function setItemResult(id: string, result: JobResult) {
    setResultsById((current) => ({ ...current, [id]: result }));
  }

  function setMissingPreloadResult(items: InputItem[]) {
    const preloadState = window.imageZipPreloadVersion
      ? `preload 标记 ${window.imageZipPreloadVersion} 已存在，但 imageZip API 不完整`
      : "未检测到 preload 标记，通常是 ZTools 加载了旧插件或没有执行 preload.js";
    setResultsById((current) => ({
      ...current,
      ...Object.fromEntries(
        items.map((item) => [
          item.id,
          {
            ok: false,
            inputPath: item.kind === "path" ? item.path : item.name,
            error: `ZTools preload 未加载，无法调用图片压缩能力（${preloadState}）`,
          } satisfies ImageZipFailure,
        ]),
      ),
    }));
  }

  function setCommitFailure(item: InputItem, error: unknown) {
    setItemResult(item.id, {
      ok: false,
      inputPath: item.kind === "path" ? item.path : item.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  function updateCommittedResult(id: string, commit: ImageZipCommitResult) {
    setResultsById((current) => {
      const currentResult = current[id];
      if (!currentResult?.ok) {
        return current;
      }
      return {
        ...current,
        [id]: {
          ok: true,
          result: {
            ...currentResult.result,
            outputPath: commit.outputPath,
            outputSize: commit.outputSize,
            savedBytes: currentResult.result.originalSize - commit.outputSize,
            ratio: currentResult.result.originalSize > 0 ? 1 - commit.outputSize / currentResult.result.originalSize : 0,
          },
        },
      };
    });
  }

  async function saveItem(item: InputItem, result: ImageZipResult) {
    if (!window.imageZip) {
      setMissingPreloadResult([item]);
      return;
    }
    const picked = window.ztools?.showSaveDialog?.({
      defaultPath: getDefaultSavePath(item, result),
      filters: [
        {
          name: "Image",
          extensions: ["jpg", "jpeg", "png", "webp"],
        },
      ],
    });
    if (!picked) {
      return;
    }
    setActiveItemId(item.id);
    try {
      const commit = window.imageZip.saveOutputFile(result.outputPath, picked);
      updateCommittedResult(item.id, commit);
      setInputs((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id ? { ...currentItem, mode: "saveAs", outputPath: commit.outputPath } : currentItem,
        ),
      );
    } catch (error) {
      setCommitFailure(item, error);
    } finally {
      setActiveItemId(null);
    }
  }

  async function overwriteItem(item: Extract<InputItem, { kind: "path" }>, result: ImageZipResult) {
    setPendingOverwriteItem(null);
    if (!window.imageZip) {
      setMissingPreloadResult([item]);
      return;
    }
    setActiveItemId(item.id);
    try {
      const commit = window.imageZip.overwriteOutputFile(result.outputPath, item.path, result.outputFormat);
      updateCommittedResult(item.id, commit);
      setInputs((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id && currentItem.kind === "path"
            ? {
                ...currentItem,
                name: getFileNameFromPath(commit.outputPath),
                path: commit.outputPath,
                size: commit.outputSize,
                mode: "overwrite",
                outputPath: undefined,
              }
            : currentItem,
        ),
      );
    } catch (error) {
      setCommitFailure(item, error);
    } finally {
      setActiveItemId(null);
    }
  }

  async function runCompression() {
    if (!window.imageZip) {
      setMissingPreloadResult(inputs);
      return;
    }
    if (inputs.length === 0) {
      return;
    }

    setIsRunning(true);
    setResultsById({});
    setInputs((current) => current.map((item) => ({ ...item, mode: "saveAs", outputPath: undefined })));

    try {
      const baseOptions = getBaseOptions();
      const nextResultsById: Record<string, JobResult> = {};
      for (const item of pathInputs) {
        setActiveItemId(item.id);
        const [result] = await window.imageZip.compressImages([item.path], {
          ...baseOptions,
          overwriteOriginal: false,
        });
        nextResultsById[item.id] = result;
        setResultsById({ ...nextResultsById });
      }
      for (const item of bufferInputs) {
        setActiveItemId(item.id);
        const [result] = await window.imageZip.compressImageBuffers([{ name: item.name, data: item.data }], {
          ...baseOptions,
          overwriteOriginal: false,
        });
        nextResultsById[item.id] = result;
        setResultsById({ ...nextResultsById });
      }
      setResultsById(nextResultsById);
    } catch (error) {
      setResultsById(
        Object.fromEntries(
          inputs.map((item) => [
            item.id,
            {
              ok: false,
              inputPath: item.kind === "path" ? item.path : item.name,
              error: error instanceof Error ? error.message : String(error),
            } satisfies ImageZipFailure,
          ]),
        ),
      );
    } finally {
      setActiveItemId(null);
      setIsRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="tool-card" aria-label="图片压缩工具">
        <div
          className={`queue-zone ${isDragging ? "dragging" : ""} ${inputs.length === 0 ? "empty" : ""}`}
          tabIndex={0}
          aria-label="待处理图片，支持拖入或粘贴"
          onDragEnter={() => setIsDragging(true)}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onPaste={handlePaste}
        >
          {inputs.length === 0 ? (
            <div className="empty-queue">
              <div className="drop-icon" aria-hidden="true">
                <Clipboard size={24} />
              </div>
              <strong>拖入图片，或直接粘贴截图</strong>
              <span>支持批量拖入和多次追加。</span>
              <button className="ghost-action" type="button" onClick={chooseFiles} disabled={!window.ztools?.showOpenDialog}>
                <FolderInput size={16} />
                <span>选择图片</span>
              </button>
            </div>
          ) : (
            <div className="input-list" aria-label="待处理图片列表">
              {inputs.map((item) => {
              const itemResult = resultsById[item.id];
              const isProcessingItem = isRunning && activeItemId === item.id;
              const rowState = itemResult?.ok ? "done" : itemResult ? "error" : "pending";
              return (
                <div className={`input-chip ${rowState} ${isProcessingItem ? "processing" : ""}`} key={item.id}>
                  <FileImage size={16} />
                  <div className="file-flow">
                    <div className="file-flow-main">
                      <span>{item.name}</span>
                      <small>
                        {itemResult?.ok
                          ? item.mode === "overwrite"
                            ? "已覆盖"
                            : item.outputPath
                              ? "已保存"
                              : "已处理"
                          : "待处理"}
                      </small>
                    </div>
                    <div className="file-metrics">
                      <span>
                        原始 <strong>{formatBytes(itemResult?.ok ? itemResult.result.originalSize : item.size ?? 0)}</strong>
                      </span>
                      <span>
                        输出 <strong>{itemResult?.ok ? formatBytes(itemResult.result.outputSize) : "-"}</strong>
                      </span>
                      <span>
                        减少{" "}
                        <strong>
                          {itemResult?.ok ? `${Math.max(0, itemResult.result.ratio * 100).toFixed(1)}%` : "-"}
                        </strong>
                      </span>
                    </div>
                    {itemResult && !itemResult.ok ? (
                      <div className="inline-result failure">
                        <XCircle size={15} />
                        <strong>{itemResult.error}</strong>
                      </div>
                    ) : null}
                  </div>
                  <div className="input-actions">
                    <button
                      type="button"
                      aria-label={`覆盖原图 ${item.name}`}
                      title="覆盖原图"
                      className={`text-action ${item.mode === "overwrite" ? "active" : ""}`}
                      onClick={() => item.kind === "path" && setPendingOverwriteItem(item)}
                      disabled={item.kind !== "path" || !itemResult?.ok || activeItemId === item.id || isRunning}
                    >
                      {activeItemId === item.id && !isRunning && item.mode === "overwrite" ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <Replace size={16} />
                      )}
                      <span>覆盖</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`另存为 ${item.name}`}
                      title="另存为"
                      className={`text-action ${item.mode === "saveAs" ? "active" : ""}`}
                      onClick={() => itemResult?.ok && saveItem(item, itemResult.result)}
                      disabled={!itemResult?.ok || activeItemId === item.id || isRunning}
                    >
                      {activeItemId === item.id && !isRunning && item.mode === "saveAs" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                      <span>保存</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`关闭 ${item.name}`}
                      title="关闭"
                      className="close-action"
                      onClick={() => removeInput(item.id)}
                      disabled={isRunning}
                    >
                      <X size={16} />
                    </button>
                    {pendingOverwriteItem?.id === item.id ? (
                      <div className="confirm-popover" role="dialog" aria-modal="false">
                        <strong>确认覆盖原图？</strong>
                        <span>{item.name}</span>
                        <div className="confirm-actions">
                          <button type="button" className="confirm-secondary" onClick={() => setPendingOverwriteItem(null)}>
                            取消
                          </button>
                          <button
                            type="button"
                            className="confirm-danger"
                            onClick={() => itemResult?.ok && overwriteItem(pendingOverwriteItem, itemResult.result)}
                          >
                            覆盖
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            </div>
          )
          }
        </div>

        <form className="settings-panel" onSubmit={(event) => event.preventDefault()}>
          <div className="settings-rows">
            <fieldset className="format-grid">
              <legend>
                <FileImage size={14} />
                <span>目标格式</span>
              </legend>
              {formatOptions.map((option) => (
                <label className={`format-option ${format === option.value ? "selected" : ""}`} key={option.value}>
                  <input
                    type="radio"
                    name="format"
                    value={option.value}
                    checked={format === option.value}
                    onChange={() => setFormat(option.value)}
                  />
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </label>
              ))}
            </fieldset>

            <div className="slider-row">
              <label htmlFor="quality">
                <SlidersHorizontal size={14} />
                <span>质量</span>
              </label>
              <output>{quality}</output>
              <input
                id="quality"
                type="range"
                min="1"
                max="100"
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value))}
              />
            </div>
          </div>

          <button className="primary-action" type="button" onClick={runCompression} disabled={!canRun}>
            {isRunning ? <Loader2 className="spin" size={20} /> : <ImageDown size={20} />}
            <span>{isRunning ? "正在压缩" : "开始处理"}</span>
            <small>{progressText}</small>
          </button>
        </form>

      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
