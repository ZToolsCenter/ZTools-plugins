import {
  BadgeCheck,
  Blend,
  Box,
  ChevronDown,
  ChevronUp,
  Check,
  ChevronsUpDown,
  Clipboard,
  Crop,
  FileArchive,
  FileImage,
  FilePlus2,
  FolderOpen,
  GalleryHorizontalEnd,
  ImageDown,
  ImagePlus,
  Layers3,
  List,
  Loader2,
  PanelRight,
  RotateCcw,
  Scissors,
  Settings2,
  SquareRoundCorner,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CropBox,
  GifOptions,
  ImageFormat,
  ImageJobSettings,
  MergeImagesOptions,
  ProcessResult,
  SourceFile,
  WatermarkPosition
} from "../shared/types";
import {
  buildModuleJobSettings,
  defaultCropForFile,
  isImageProcessingModule,
  type ModuleId
} from "../shared/module-jobs";
import {
  containedImageRect,
  cropBoxStyle,
  cropFromDragPoints,
  pointToImageCoordinates,
  type Rect
} from "./crop-geometry";
import { basename, shortPath } from "./path-display";
import { mergeImageJobSettings } from "./settings";

const modules: Array<{ id: ModuleId; label: string; icon: typeof FileImage }> = [
  { id: "compress", label: "压缩", icon: ImageDown },
  { id: "watermark", label: "水印", icon: Blend },
  { id: "format", label: "转换", icon: ChevronsUpDown },
  { id: "resize", label: "尺寸", icon: Settings2 },
  { id: "crop", label: "裁剪", icon: Crop },
  { id: "rotate", label: "旋转", icon: RotateCcw },
  { id: "border", label: "边框", icon: Box },
  { id: "round", label: "圆角", icon: SquareRoundCorner },
  { id: "pdf", label: "PDF", icon: FileArchive },
  { id: "merge", label: "拼图", icon: Layers3 },
  { id: "gif", label: "GIF", icon: GalleryHorizontalEnd },
  { id: "manual", label: "手裁", icon: Scissors }
];

const formats: ImageFormat[] = ["jpeg", "png", "webp", "avif", "heif", "tiff", "gif"];
const positions: Array<{ value: WatermarkPosition; label: string }> = [
  { value: "northwest", label: "左上" },
  { value: "north", label: "上" },
  { value: "northeast", label: "右上" },
  { value: "west", label: "左" },
  { value: "center", label: "中" },
  { value: "east", label: "右" },
  { value: "southwest", label: "左下" },
  { value: "south", label: "下" },
  { value: "southeast", label: "右下" }
];

const outputNamingOptions = [
  { value: "{name}-{index}.{ext}", label: "序号" },
  { value: "{name}.{ext}", label: "原名" },
  { value: "{name}-done.{ext}", label: "完成" }
];

const compressionPresets = [
  { value: "small", label: "小文件", description: "60" },
  { value: "balanced", label: "均衡", description: "82" },
  { value: "clear", label: "清晰", description: "94" }
];

const resizePresets = [
  { value: "original", label: "原尺寸", description: "不缩放" },
  { value: "wide", label: "宽屏", description: "1920" },
  { value: "social", label: "社媒", description: "1080" },
  { value: "square", label: "方图", description: "1024" }
];

const cropPresets = [
  { value: "full", label: "全图", description: "100%" },
  { value: "square", label: "方形", description: "居中" },
  { value: "top", label: "上半", description: "50%" },
  { value: "left", label: "左半", description: "50%" }
];

const gifSizePresets = [
  { value: "small", label: "小图", description: "480p" },
  { value: "medium", label: "标准", description: "640p" },
  { value: "large", label: "高清", description: "960p" }
];

const defaultSettings = (): ImageJobSettings => ({
  output: {
    directory: window.services?.getDefaultOutputDirectory?.() ?? "",
    namingPattern: "{name}-{index}.{ext}",
    overwrite: false
  },
  format: { type: "webp", quality: 82, keepMetadata: false },
  compression: { quality: 82, keepMetadata: false },
  resize: { mode: "fit", width: 1600, withoutEnlargement: true },
  watermark: {
    enabled: false,
    kind: "text",
    text: "ZTools",
    position: "southeast",
    opacity: 0.72,
    fontSize: 32,
    color: "#ffffff",
    margin: 24,
    rotation: 0
  },
  border: { enabled: false, width: 12, color: "#7dd3fc" },
  rounded: { enabled: false, radius: 24 },
  rotate: 0
});

const defaultMerge: MergeImagesOptions = {
  layout: "vertical",
  columns: 3,
  gap: 12,
  background: "#ffffff"
};

const defaultGif: GifOptions = {
  width: 640,
  height: 480,
  delayMs: 120,
  loop: 0,
  background: "#ffffff"
};

export function App() {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [active, setActive] = useState<ModuleId>("compress");
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [settings, setSettings] = useState<ImageJobSettings>(() => {
    const saved = window.ztools?.dbStorage?.getItem?.("image-batch-settings");
    return mergeImageJobSettings(defaultSettings(), saved);
  });
  const [mergeOptions, setMergeOptions] = useState<MergeImagesOptions>(defaultMerge);
  const [gifOptions, setGifOptions] = useState<GifOptions>(defaultGif);
  const [results, setResults] = useState<ProcessResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [showFileTray, setShowFileTray] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const imageFiles = useMemo(() => files.filter((file) => file.type === "image"), [files]);
  const pdfFiles = useMemo(() => files.filter((file) => file.type === "pdf"), [files]);
  const selectedFile = useMemo(
    () => imageFiles.find((file) => file.path === selectedPath) ?? imageFiles[0],
    [imageFiles, selectedPath]
  );
  const successfulResults = results.filter((item) => item.ok).length;
  const filesOpen = showFileTray && files.length > 0;
  const resultsOpen = showResults || busy;

  useEffect(() => {
    const onEnter = (event: Event) => {
      const custom = event as CustomEvent<{ files: SourceFile[] }>;
      addFiles(custom.detail.files);
    };
    const onProgress = (event: Event) => {
      const custom = event as CustomEvent<{ completed: number; total: number }>;
      setProgress(`${custom.detail.completed}/${custom.detail.total}`);
    };
    window.addEventListener("image-batch-enter", onEnter);
    window.addEventListener("image-batch-progress", onProgress);
    return () => {
      window.removeEventListener("image-batch-enter", onEnter);
      window.removeEventListener("image-batch-progress", onProgress);
    };
  }, [files]);

  useEffect(() => {
    window.ztools?.dbStorage?.setItem?.("image-batch-settings", settings);
  }, [settings]);

  useEffect(() => {
    if (!selectedPath && imageFiles.length > 0) {
      setSelectedPath(imageFiles[0].path);
      return;
    }
    if (selectedPath && !imageFiles.some((file) => file.path === selectedPath)) {
      setSelectedPath(imageFiles[0]?.path ?? "");
    }
  }, [imageFiles, selectedPath]);

  function addFiles(nextFiles: SourceFile[]) {
    setFiles((current) => {
      const byPath = new Map(current.map((file) => [file.path, file]));
      for (const file of nextFiles) byPath.set(file.path, file);
      return Array.from(byPath.values());
    });
  }

  async function chooseFiles() {
    addFiles(await window.services.chooseFiles());
  }

  async function chooseOutputDirectory() {
    const directory = await window.services.chooseDirectory();
    if (directory) {
      setSettings((current) => ({ ...current, output: { ...current.output, directory } }));
    }
  }

  async function chooseWatermarkImage() {
    const imagePath = await window.services.chooseWatermarkImage();
    if (imagePath) {
      setSettings((current) => ({
        ...current,
        watermark: { ...current.watermark!, enabled: true, kind: "image", imagePath }
      }));
    }
  }

  async function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDropActive(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.services.getPathForFile(file))
      .filter(Boolean);
    addFiles(await window.services.resolveFiles(paths));
  }

  async function processSelectedImageModule() {
    if (!isImageProcessingModule(active)) return;
    if (imageFiles.length === 0) return notify("没有可处理图片");
    setBusy(true);
    setProgress(`0/${imageFiles.length}`);
    setResults([]);
    setShowFileTray(false);
    setShowResults(true);
    try {
      const jobSettings = buildModuleJobSettings(active, settings, selectedFile);
      const processed = await window.services.processImages(
        imageFiles.map((file) => file.path),
        jobSettings
      );
      setResults(processed);
      const okCount = processed.filter((item) => item.ok).length;
      notify(`${activeModuleLabel()}已完成 ${okCount}/${processed.length}`);
    } catch (error) {
      showOperationError(selectedFile?.path ?? "", error);
    } finally {
      setBusy(false);
    }
  }

  async function runActiveModule() {
    if (active === "pdf") return runMergePdfs();
    if (active === "merge") return runMergeImages();
    if (active === "gif") return runGif();
    return processSelectedImageModule();
  }

  function canRunActiveModule() {
    if (active === "pdf") return pdfFiles.length >= 2;
    if (active === "merge" || active === "gif") return imageFiles.length >= 2;
    return imageFiles.length > 0;
  }

  function activeModuleLabel() {
    return modules.find((module) => module.id === active)?.label ?? "当前模块";
  }

  function showOperationError(inputPath: string, error: unknown) {
    const message = errorMessage(error);
    setResults([{ inputPath, outputPath: "", ok: false, error: message }]);
    notify(message);
  }

  async function runMergePdfs() {
    if (pdfFiles.length < 2) return notify("至少选择 2 个 PDF");
    const output = await window.services.savePath(`${settings.output.directory}/merged.pdf`, ["pdf"]);
    if (!output) return;
    setBusy(true);
    setShowFileTray(false);
    setShowResults(true);
    try {
      const outputPath = await window.services.mergePdfs(pdfFiles.map((file) => file.path), output);
      setResults([{ inputPath: pdfFiles[0].path, outputPath, ok: true }]);
      notify("PDF 已合并");
    } catch (error) {
      showOperationError(pdfFiles[0]?.path ?? "", error);
    } finally {
      setBusy(false);
    }
  }

  async function runMergeImages() {
    if (imageFiles.length < 2) return notify("至少选择 2 张图片");
    const output = await window.services.savePath(`${settings.output.directory}/merged.png`, ["png"]);
    if (!output) return;
    setBusy(true);
    setShowFileTray(false);
    setShowResults(true);
    try {
      const outputPath = await window.services.mergeImages(imageFiles.map((file) => file.path), output, mergeOptions);
      setResults([{ inputPath: imageFiles[0].path, outputPath, ok: true }]);
      notify("图片已合并");
    } catch (error) {
      showOperationError(imageFiles[0]?.path ?? "", error);
    } finally {
      setBusy(false);
    }
  }

  async function runGif() {
    if (imageFiles.length < 2) return notify("至少选择 2 张图片");
    const output = await window.services.savePath(`${settings.output.directory}/motion.gif`, ["gif"]);
    if (!output) return;
    setBusy(true);
    setShowFileTray(false);
    setShowResults(true);
    try {
      const outputPath = await window.services.createGif(imageFiles.map((file) => file.path), output, gifOptions);
      setResults([{ inputPath: imageFiles[0].path, outputPath, ok: true }]);
      notify("GIF 已合成");
    } catch (error) {
      showOperationError(imageFiles[0]?.path ?? "", error);
    } finally {
      setBusy(false);
    }
  }

  function removeFile(filePath: string) {
    setFiles((current) => current.filter((file) => file.path !== filePath));
    if (selectedPath === filePath) setSelectedPath("");
    if (files.length <= 1) setShowFileTray(false);
  }

  function clearFiles() {
    setFiles([]);
    setSelectedPath("");
    setResults([]);
    setShowFileTray(false);
    setShowResults(false);
  }

  function toggleFilesDropdown() {
    setShowFileTray((current) => !current);
    setShowResults(false);
  }

  function toggleResultsDropdown() {
    setShowResults((current) => !current);
    setShowFileTray(false);
  }

  function updateSettings(patch: Partial<ImageJobSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function updateOutput<K extends keyof ImageJobSettings["output"]>(key: K, value: ImageJobSettings["output"][K]) {
    setSettings((current) => ({ ...current, output: { ...current.output, [key]: value } }));
  }

  function applyCompressionPreset(value: string) {
    const quality = value === "small" ? 60 : value === "clear" ? 94 : 82;
    updateSettings({ compression: { ...settings.compression, quality } });
  }

  function activeCompressionPreset() {
    const quality = settings.compression?.quality ?? 82;
    if (quality <= 66) return "small";
    if (quality >= 90) return "clear";
    return "balanced";
  }

  function applyResizePreset(value: string) {
    if (value === "original") {
      updateSettings({ resize: undefined });
      return;
    }
    if (value === "square") {
      updateSettings({ resize: { mode: "cover", width: 1024, height: 1024, withoutEnlargement: true } });
      return;
    }
    const width = value === "social" ? 1080 : 1920;
    updateSettings({ resize: { mode: "long-edge", width, withoutEnlargement: true } });
  }

  function activeResizePreset() {
    const resize = settings.resize;
    if (!resize) return "original";
    if (resize.mode === "cover" && resize.width === 1024 && resize.height === 1024) return "square";
    if (resize.width === 1080) return "social";
    if (resize.width === 1920) return "wide";
    return "";
  }

  function applyCropPreset(value: string) {
    const base = defaultCropForFile(selectedFile);
    const width = base.width;
    const height = base.height;
    if (value === "square") {
      const side = Math.min(width, height);
      updateSettings({
        crop: {
          left: Math.round((width - side) / 2),
          top: Math.round((height - side) / 2),
          width: side,
          height: side
        }
      });
      return;
    }
    if (value === "top") {
      updateSettings({ crop: { left: 0, top: 0, width, height: Math.max(1, Math.round(height / 2)) } });
      return;
    }
    if (value === "left") {
      updateSettings({ crop: { left: 0, top: 0, width: Math.max(1, Math.round(width / 2)), height } });
      return;
    }
    updateSettings({ crop: base });
  }

  function applyGifSizePreset(value: string) {
    const size = value === "small" ? { width: 480, height: 360 } : value === "large" ? { width: 960, height: 720 } : { width: 640, height: 480 };
    setGifOptions((current) => ({ ...current, ...size }));
  }

  function activeGifSizePreset() {
    if (gifOptions.width <= 480) return "small";
    if (gifOptions.width >= 900) return "large";
    return "medium";
  }

  return (
    <main
      className={`app-shell ${dropActive ? "is-drop" : ""}`}
      onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
    >
      <section className="workspace">
        <div className="workspace-head">
          <div className="workspace-tools">
            <button className="output-target" onClick={chooseOutputDirectory} title={settings.output.directory}>
              <FolderOpen size={15} />
              <span>输出到</span>
              <strong>{shortPath(settings.output.directory)}</strong>
            </button>
            <div className="output-options">
              <Select
                label="命名"
                value={settings.output.namingPattern}
                options={outputNamingOptions}
                onChange={(namingPattern) => updateOutput("namingPattern", namingPattern)}
              />
              <Toggle label="覆盖" checked={settings.output.overwrite} onChange={(overwrite) => updateOutput("overwrite", overwrite)} />
            </div>
          </div>
          <div className="workspace-actions">
            <button className="primary" onClick={chooseFiles}>
              <FilePlus2 size={16} />
              导入
            </button>
            <button onClick={clearFiles} title="清空列表">
              <Trash2 size={16} />
            </button>
            <button
              className={`toggle-button ${filesOpen ? "active" : ""}`}
              onClick={toggleFilesDropdown}
              disabled={files.length === 0}
              aria-pressed={filesOpen}
              title="文件列表"
            >
              <List size={15} />
              列表 {files.length}
              {filesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              className={`toggle-button ${resultsOpen ? "active" : ""}`}
              onClick={toggleResultsDropdown}
              disabled={!busy && results.length === 0}
              aria-pressed={resultsOpen}
              title="处理结果"
            >
              <PanelRight size={15} />
              结果 {successfulResults}
              {resultsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button className="primary run-button" onClick={runActiveModule} disabled={busy || !canRunActiveModule()}>
              {busy ? <Loader2 className="spin" size={16} /> : <BadgeCheck size={16} />}
              执行
            </button>
          </div>
          {filesOpen && (
            <div className="workspace-dropdown file-dropdown" aria-label="已导入文件">
              <div className="dropdown-title">
                <strong>已导入</strong>
                <span>{files.length} 个文件</span>
              </div>
              <div className="dropdown-list">
                {files.map((file) => (
                  <button
                    key={file.path}
                    className={`file-row ${file.path === selectedFile?.path ? "active" : ""}`}
                    onClick={() => file.type === "image" && setSelectedPath(file.path)}
                  >
                    <FileImage size={16} />
                    <span>{file.name}</span>
                    <small>{file.type === "image" ? `${file.width ?? "-"}×${file.height ?? "-"}` : "PDF"}</small>
                    <i
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeFile(file.path);
                      }}
                    >
                      ×
                    </i>
                  </button>
                ))}
              </div>
            </div>
          )}
          {resultsOpen && (
            <div className="workspace-dropdown result-dropdown" aria-label="处理结果">
              <div className="dropdown-title">
                <strong>{busy ? `处理中 ${progress}` : "处理结果"}</strong>
                <span>{successfulResults}/{results.length || imageFiles.length || pdfFiles.length || 0}</span>
              </div>
              <div className="dropdown-list">
                {results.length === 0 ? (
                  <div className="dropdown-empty">{busy ? "等待输出..." : "暂无结果"}</div>
                ) : (
                  results.map((result) => (
                    <button key={`${result.inputPath}-${result.outputPath}`} className="result-row" onClick={() => result.outputPath && window.services.reveal(result.outputPath)}>
                      {result.ok ? <Check size={14} /> : <PanelRight size={14} />}
                      <span>{result.ok ? basename(result.outputPath) : result.error}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className={`workspace-body ${files.length > 0 ? "has-files" : "is-empty"}`}>
          <div className="preview-pane">
            <div className="preview-surface">
              {active === "manual" && selectedFile ? (
                <ManualCropEditor
                  file={selectedFile}
                  crop={settings.crop}
                  onChange={(crop) => updateSettings({ crop })}
                />
              ) : selectedFile ? (
                <img className="preview-image" src={window.services.fileUrl(selectedFile.path)} alt="" />
              ) : (
                <div className="preview-empty">
                  <ImagePlus size={34} />
                  <span>拖入图片或 PDF</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="controls">
        <div className="control-head">
          <div className="brand-row">
            <img src="./logo.svg" alt="" className="brand-mark" />
            <div className="brand-copy">
              <h1>图片批处理</h1>
              <div className="metrics" aria-label="导入统计">
                <span>{imageFiles.length} 图片</span>
                <span>{pdfFiles.length} PDF</span>
                <span>{successfulResults} 输出</span>
              </div>
            </div>
          </div>
        </div>

        <nav className="module-grid">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <button key={module.id} className={active === module.id ? "active" : ""} onClick={() => setActive(module.id)}>
                <Icon size={15} />
                {module.label}
              </button>
            );
          })}
        </nav>

        <div className="control-panel">
          {active === "compress" && (
            <Group title="图片压缩">
              <PresetGrid items={compressionPresets} active={activeCompressionPreset()} onPick={applyCompressionPreset} />
              <Range
                label="质量"
                value={settings.compression?.quality ?? 82}
                min={20}
                max={100}
                onChange={(quality) =>
                  updateSettings({
                    compression: { ...settings.compression, quality }
                  })
                }
              />
              <Toggle
                label="保留元数据"
                checked={Boolean(settings.compression?.keepMetadata ?? settings.format?.keepMetadata)}
                onChange={(keepMetadata) => updateSettings({ compression: { ...settings.compression, keepMetadata } })}
              />
            </Group>
          )}

          {active === "watermark" && (
            <Group title="添加水印">
              <Toggle
                label="启用"
                checked={Boolean(settings.watermark?.enabled)}
                onChange={(enabled) => updateSettings({ watermark: { ...settings.watermark!, enabled } })}
              />
              <Segmented
                value={settings.watermark?.kind ?? "text"}
                options={[
                  { value: "text", label: "文字" },
                  { value: "image", label: "图片" }
                ]}
                onChange={(kind) => updateSettings({ watermark: { ...settings.watermark!, kind: kind as "text" | "image" } })}
              />
              {settings.watermark?.kind === "text" ? (
                <TextInput
                  label="文字"
                  value={settings.watermark.text ?? ""}
                  onChange={(text) => updateSettings({ watermark: { ...settings.watermark!, text } })}
                />
              ) : (
                <button onClick={chooseWatermarkImage}>
                  <Clipboard size={15} />
                  选择水印图
                </button>
              )}
              <PositionGrid
                value={settings.watermark?.position ?? "southeast"}
                onChange={(position) => updateSettings({ watermark: { ...settings.watermark!, position } })}
              />
              <Range
                label="透明"
                value={Math.round((settings.watermark?.opacity ?? 0.72) * 100)}
                min={5}
                max={100}
                onChange={(opacity) => updateSettings({ watermark: { ...settings.watermark!, opacity: opacity / 100 } })}
              />
              <NumberInput
                label="字号"
                value={settings.watermark?.fontSize ?? 32}
                min={8}
                max={180}
                onChange={(fontSize) => updateSettings({ watermark: { ...settings.watermark!, fontSize } })}
              />
              <ColorInput
                label="颜色"
                value={settings.watermark?.color ?? "#ffffff"}
                onChange={(color) => updateSettings({ watermark: { ...settings.watermark!, color } })}
              />
            </Group>
          )}

          {active === "format" && (
            <Group title="格式转换">
              <Segmented
                value={settings.format?.type ?? "webp"}
                options={formats.map((format) => ({ value: format, label: format.toUpperCase() }))}
                onChange={(type) => updateSettings({ format: { ...(settings.format ?? { type: "webp" }), type: type as ImageFormat } })}
              />
              <Range
                label="质量"
                value={settings.format?.quality ?? 82}
                min={20}
                max={100}
                onChange={(quality) => updateSettings({ format: { ...(settings.format ?? { type: "webp" }), quality } })}
              />
            </Group>
          )}

          {active === "resize" && (
            <Group title="调整尺寸">
              <PresetGrid items={resizePresets} active={activeResizePreset()} onPick={applyResizePreset} />
              <Select
                label="模式"
                value={settings.resize?.mode ?? "fit"}
                options={[
                  { value: "fit", label: "适应" },
                  { value: "cover", label: "填充" },
                  { value: "contain", label: "留白" },
                  { value: "exact", label: "拉伸" },
                  { value: "long-edge", label: "长边" },
                  { value: "short-edge", label: "短边" }
                ]}
                onChange={(mode) => updateSettings({ resize: { ...(settings.resize ?? { mode: "fit" }), mode: mode as any } })}
              />
              <NumberInput
                label="宽"
                value={settings.resize?.width ?? 0}
                min={0}
                max={12000}
                onChange={(width) => updateSettings({ resize: { ...(settings.resize ?? { mode: "fit" }), width: width || undefined } })}
              />
              <NumberInput
                label="高"
                value={settings.resize?.height ?? 0}
                min={0}
                max={12000}
                onChange={(height) => updateSettings({ resize: { ...(settings.resize ?? { mode: "fit" }), height: height || undefined } })}
              />
              <Toggle
                label="禁止放大"
                checked={settings.resize?.withoutEnlargement ?? true}
                onChange={(withoutEnlargement) => updateSettings({ resize: { ...(settings.resize ?? { mode: "fit" }), withoutEnlargement } })}
              />
            </Group>
          )}

          {active === "crop" && (
            <Group title="图片裁剪">
              <PresetGrid items={cropPresets} active="" onPick={applyCropPreset} />
              <CropReadout crop={settings.crop} />
              <button onClick={() => updateSettings({ crop: undefined })}>清除裁剪</button>
            </Group>
          )}

          {active === "rotate" && (
            <Group title="旋转翻转">
              <Segmented
                value={String(settings.rotate ?? 0)}
                options={[
                  { value: "0", label: "0°" },
                  { value: "90", label: "90°" },
                  { value: "180", label: "180°" },
                  { value: "270", label: "270°" }
                ]}
                onChange={(rotate) => updateSettings({ rotate: Number(rotate) })}
              />
              <Segmented
                value={settings.flip ?? "none"}
                options={[
                  { value: "none", label: "无" },
                  { value: "horizontal", label: "水平" },
                  { value: "vertical", label: "垂直" },
                  { value: "both", label: "双向" }
                ]}
                onChange={(flip) => updateSettings({ flip: flip === "none" ? undefined : (flip as any) })}
              />
            </Group>
          )}

          {active === "border" && (
            <Group title="添加边框">
              <Toggle
                label="启用"
                checked={Boolean(settings.border?.enabled)}
                onChange={(enabled) => updateSettings({ border: { ...settings.border!, enabled } })}
              />
              <Range label="宽度" value={settings.border?.width ?? 12} min={1} max={80} onChange={(width) => updateSettings({ border: { ...settings.border!, width } })} />
              <ColorInput label="颜色" value={settings.border?.color ?? "#7dd3fc"} onChange={(color) => updateSettings({ border: { ...settings.border!, color } })} />
            </Group>
          )}

          {active === "round" && (
            <Group title="设置圆角">
              <Toggle
                label="启用"
                checked={Boolean(settings.rounded?.enabled)}
                onChange={(enabled) => updateSettings({ rounded: { ...settings.rounded!, enabled } })}
              />
              <Range label="半径" value={settings.rounded?.radius ?? 24} min={1} max={240} onChange={(radius) => updateSettings({ rounded: { ...settings.rounded!, radius } })} />
              <ColorInput label="背景" value={settings.rounded?.background ?? "#000000"} onChange={(background) => updateSettings({ rounded: { ...settings.rounded!, background } })} />
            </Group>
          )}

          {active === "pdf" && (
            <Group title="合并 PDF">
              <button className="primary wide" onClick={runMergePdfs} disabled={busy || pdfFiles.length < 2}>
                <FileArchive size={16} />
                合并 PDF
              </button>
            </Group>
          )}

          {active === "merge" && (
            <Group title="合并图片">
              <Segmented
                value={mergeOptions.layout}
                options={[
                  { value: "vertical", label: "纵向" },
                  { value: "horizontal", label: "横向" },
                  { value: "grid", label: "宫格" }
                ]}
                onChange={(layout) => setMergeOptions((current) => ({ ...current, layout: layout as MergeImagesOptions["layout"] }))}
              />
              <NumberInput label="列" value={mergeOptions.columns ?? 3} min={1} max={12} onChange={(columns) => setMergeOptions((current) => ({ ...current, columns }))} />
              <Range label="间距" value={mergeOptions.gap} min={0} max={80} onChange={(gap) => setMergeOptions((current) => ({ ...current, gap }))} />
              <ColorInput label="背景" value={mergeOptions.background} onChange={(background) => setMergeOptions((current) => ({ ...current, background }))} />
              <button className="primary wide" onClick={runMergeImages} disabled={busy || imageFiles.length < 2}>
                <Layers3 size={16} />
                合并图片
              </button>
            </Group>
          )}

          {active === "gif" && (
            <Group title="合成 GIF">
              <PresetGrid items={gifSizePresets} active={activeGifSizePreset()} onPick={applyGifSizePreset} />
              <SizeReadout width={gifOptions.width} height={gifOptions.height} />
              <Range label="间隔" value={gifOptions.delayMs} min={40} max={1000} onChange={(delayMs) => setGifOptions((current) => ({ ...current, delayMs }))} />
              <Range label="循环" value={gifOptions.loop} min={0} max={10} onChange={(loop) => setGifOptions((current) => ({ ...current, loop }))} />
              <button className="primary wide" onClick={runGif} disabled={busy || imageFiles.length < 2}>
                <GalleryHorizontalEnd size={16} />
                合成 GIF
              </button>
            </Group>
          )}

          {active === "manual" && (
            <Group title="手动裁剪">
              <CropReadout crop={settings.crop} />
              <button onClick={() => updateSettings({ crop: undefined })}>清除裁剪</button>
            </Group>
          )}
        </div>
      </section>
    </main>
  );
}

function PresetGrid({
  items,
  active,
  onPick
}: {
  items: Array<{ value: string; label: string; description?: string }>;
  active: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="preset-grid">
      {items.map((item) => (
        <button key={item.value} className={item.value === active ? "active" : ""} onClick={() => onPick(item.value)}>
          <span>{item.label}</span>
          {item.description && <small>{item.description}</small>}
        </button>
      ))}
    </div>
  );
}

function PositionGrid({ value, onChange }: { value: WatermarkPosition; onChange: (position: WatermarkPosition) => void }) {
  return (
    <div className="position-grid" aria-label="水印位置">
      {positions.map((position) => (
        <button
          key={position.value}
          className={position.value === value ? "active" : ""}
          onClick={() => onChange(position.value)}
          title={position.label}
        >
          <span>{position.label}</span>
        </button>
      ))}
    </div>
  );
}

function CropReadout({ crop }: { crop?: CropBox }) {
  return (
    <div className="readout-grid">
      <span>左 {crop?.left ?? 0}</span>
      <span>上 {crop?.top ?? 0}</span>
      <span>宽 {crop?.width ?? 0}</span>
      <span>高 {crop?.height ?? 0}</span>
    </div>
  );
}

function SizeReadout({ width, height }: { width: number; height: number }) {
  return (
    <div className="readout-grid">
      <span>宽 {width}</span>
      <span>高 {height}</span>
    </div>
  );
}

function ManualCropEditor({
  file,
  crop,
  onChange
}: {
  file: SourceFile;
  crop?: CropBox;
  onChange: (crop: CropBox) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [natural, setNatural] = useState({ width: file.width ?? 1, height: file.height ?? 1 });
  const [stageGeometry, setStageGeometry] = useState<{ stageRect: Rect; imageRect: Rect } | null>(null);
  const stageGeometryRef = useRef<{ stageRect: Rect; imageRect: Rect } | null>(null);

  useEffect(() => {
    setNatural({ width: file.width ?? 1, height: file.height ?? 1 });
    stageGeometryRef.current = null;
    setStageGeometry(null);
    setDragStart(null);
  }, [file.path, file.width, file.height]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const updateGeometry = () => {
      const rect = stage.getBoundingClientRect();
      const stageRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      const geometry = { stageRect, imageRect: containedImageRect(stageRect, natural) };
      stageGeometryRef.current = geometry;
      setStageGeometry(geometry);
    };

    updateGeometry();
    const observer = new ResizeObserver(updateGeometry);
    observer.observe(stage);
    window.addEventListener("resize", updateGeometry);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateGeometry);
    };
  }, [file.path, natural.width, natural.height]);

  function measureGeometry() {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const stageRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    return { stageRect, imageRect: containedImageRect(stageRect, natural) };
  }

  function point(event: React.PointerEvent<HTMLDivElement>, geometry: { stageRect: Rect; imageRect: Rect }) {
    return pointToImageCoordinates({ x: event.clientX, y: event.clientY }, geometry.imageRect, natural);
  }

  function start(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const geometry = stageGeometryRef.current ?? measureGeometry();
    if (!geometry) return;
    stageGeometryRef.current = geometry;
    setStageGeometry(geometry);
    setDragStart(point(event, geometry));
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart) return;
    const geometry = stageGeometryRef.current;
    if (!geometry) return;
    const current = point(event, geometry);
    onChange(cropFromDragPoints(dragStart, current, natural));
  }

  function end(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragStart(null);
  }

  const style = crop && stageGeometry ? cropBoxStyle(crop, stageGeometry.stageRect, stageGeometry.imageRect, natural) : undefined;

  return (
    <div ref={stageRef} className="crop-stage" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <img
        ref={imgRef}
        src={window.services.fileUrl(file.path)}
        alt=""
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onLoad={(event) =>
          setNatural({
            width: event.currentTarget.naturalWidth || file.width || 1,
            height: event.currentTarget.naturalHeight || file.height || 1
          })
        }
      />
      {style && <div className="crop-box" style={style} />}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="control-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="range" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} />
      <b>{value}</b>
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field color-field">
      <span>{label}</span>
      <input type="color" value={value.startsWith("#") ? value : "#ffffff"} onChange={(event) => onChange(event.target.value)} />
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Segmented({
  value,
  options,
  onChange
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.value} className={option.value === value ? "active" : ""} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function notify(message: string) {
  window.ztools?.showNotification?.(message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
