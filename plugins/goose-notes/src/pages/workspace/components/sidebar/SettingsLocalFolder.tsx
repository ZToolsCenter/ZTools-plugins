import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LOCAL_FOLDER_EDITOR_CANDIDATES,
  LOCAL_FOLDER_FILE_MANAGER_CANDIDATES,
  LOCAL_FOLDER_TERMINAL_CANDIDATES,
  type LocalFolderOpenAppCandidate,
} from "@/lib/local-folder-open-apps";
import { getCachedAvailableOpenApps, shell } from "@/lib/utools/shell";
import { fs } from "@/lib/utools/fs";
import {
  scanUnreferencedLocalAssets,
  type UnreferencedLocalAsset,
} from "@/lib/local-folder-asset-maintenance";
import { DialogShell } from "@/components/ui/dialog-shell";
import * as LucideIcons from "lucide-react";
import { SettingsSectionCard } from "./settings/SettingsSectionCard";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

interface SettingsLocalFolderProps {
  localFolderFileManager: string;
  setLocalFolderFileManager: (value: string) => void;
  localFolderExternalEditor: string;
  setLocalFolderExternalEditor: (value: string) => void;
  localFolderTerminal: string;
  setLocalFolderTerminal: (value: string) => void;
  localFolderHiddenFolders: string[];
  setLocalFolderHiddenFolders: (folders: string[]) => void;
}

interface OpenAppFieldProps {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  value: string;
  onChange: (value: string) => void;
  defaultLabel: string;
  customPlaceholder: string;
  options: LocalFolderOpenAppCandidate[];
}

const SYSTEM_VALUE = "__system__";
const CUSTOM_VALUE = "__custom__";
const DEFAULT_HIDDEN_FOLDERS = ["assets"];

const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]";

function getSystemDefaultLabels() {
  const platform = navigator.platform || navigator.userAgent;
  if (/Win/i.test(platform)) {
    return {
      fileManager: "系统默认（资源管理器）",
      terminal: "系统默认（命令提示符）",
    };
  }
  if (/Mac/i.test(platform)) {
    return {
      fileManager: "系统默认（访达）",
      terminal: "系统默认（终端）",
    };
  }
  return {
    fileManager: "系统默认（文件管理器）",
    terminal: "系统默认（终端）",
  };
}

function OpenAppField({
  id,
  title,
  description,
  icon: Icon,
  value,
  onChange,
  defaultLabel,
  customPlaceholder,
  options,
}: OpenAppFieldProps) {
  const trimmedValue = value.trim();
  const matchedOption = useMemo(
    () => options.find((option) => option.appName === trimmedValue),
    [options, trimmedValue],
  );
  const isCustomValue = Boolean(trimmedValue && !matchedOption);
  const [customActive, setCustomActive] = useState(isCustomValue);

  useEffect(() => {
    if (isCustomValue) {
      setCustomActive(true);
      return;
    }
    if (trimmedValue && matchedOption) {
      setCustomActive(false);
    }
  }, [isCustomValue, matchedOption, trimmedValue]);

  const selectedValue =
    customActive && !trimmedValue
      ? CUSTOM_VALUE
      : !trimmedValue
        ? SYSTEM_VALUE
        : (matchedOption?.appName ?? CUSTOM_VALUE);
  const selectedLabel =
    customActive && !trimmedValue
      ? "自定义"
      : !trimmedValue
        ? defaultLabel
        : (matchedOption?.label ?? trimmedValue);
  const showCustomInput = customActive || isCustomValue;

  const handleSelect = (nextValue: string) => {
    if (nextValue === SYSTEM_VALUE) {
      setCustomActive(false);
      onChange("");
      return;
    }
    if (nextValue === CUSTOM_VALUE) {
      setCustomActive(true);
      return;
    }
    setCustomActive(false);
    onChange(nextValue);
  };

  return (
    <div className={`space-y-3 p-4 ${SETTINGS_OPTION_ROW_CLASS}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Icon
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            <Label htmlFor={`${id}-custom`} className="cursor-pointer">
              {title}
            </Label>
          </div>
          <p className="mt-1 pl-7 text-xs text-muted-foreground">
            {description}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-9 min-w-36 max-w-56 shrink-0 items-center justify-between gap-2 rounded-[10px] bg-[hsl(var(--background))] px-3 text-left text-sm text-foreground shadow-[inset_0_0_0_1px_hsl(var(--input))] transition-colors hover:bg-[var(--goose-interactive-hover)] focus:bg-[var(--goose-interactive-selected)]"
            >
              <span className="truncate">{selectedLabel}</span>
              <LucideIcons.ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuRadioGroup
              value={selectedValue}
              onValueChange={handleSelect}
            >
              <DropdownMenuRadioItem value={SYSTEM_VALUE}>
                <span className="truncate">{defaultLabel}</span>
              </DropdownMenuRadioItem>
              {options.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.appName}>
                  <span className="truncate">{option.label}</span>
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value={CUSTOM_VALUE}>
                <span>自定义</span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showCustomInput && (
        <div className="pl-7">
          <Input
            id={`${id}-custom`}
            value={trimmedValue}
            onChange={(event) => onChange(event.target.value)}
            onBlur={(event) => onChange(event.target.value.trim())}
            placeholder={customPlaceholder}
            className="h-9 text-sm"
          />
        </div>
      )}
    </div>
  );
}

interface HiddenFoldersFieldProps {
  folders: string[];
  onChange: (folders: string[]) => void;
}

function HiddenFoldersField({ folders, onChange }: HiddenFoldersFieldProps) {
  const [inputValue, setInputValue] = useState("");

  const addFolder = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (folders.includes(name)) return;
    onChange([...folders, name]);
    setInputValue("");
  };

  const removeFolder = (name: string) => {
    onChange(folders.filter((f) => f !== name));
  };

  const resetToDefault = () => {
    onChange([...DEFAULT_HIDDEN_FOLDERS]);
  };

  const isDefault =
    JSON.stringify(folders) === JSON.stringify(DEFAULT_HIDDEN_FOLDERS);

  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-3">
          <LucideIcons.EyeOff
            className="h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
          <Label
            htmlFor="local-folder-hidden-folder-input"
            className="cursor-pointer"
          >
            隐藏文件夹
          </Label>
        </div>
        <p className="mt-1 pl-7 text-xs text-muted-foreground">
          这些文件夹不会显示在本地文件夹笔记本的侧边栏中。
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pl-7">
        {folders.length === 0 && (
          <span className="text-xs text-muted-foreground">
            未隐藏任何文件夹
          </span>
        )}
        {folders.map((folder) => {
          const isDefaultFolder = DEFAULT_HIDDEN_FOLDERS.includes(folder);
          return (
            <Badge
              key={folder}
              variant={isDefaultFolder ? "default" : "secondary"}
              className="gap-1 pr-1.5"
            >
              {folder}
              <button
                type="button"
                disabled={isDefaultFolder}
                onClick={() => removeFolder(folder)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-50 hover:bg-primary-foreground/20"
                aria-label={`移除 ${folder}`}
              >
                <LucideIcons.X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pl-7">
        <Input
          id="local-folder-hidden-folder-input"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addFolder(inputValue);
            }
          }}
          placeholder="如：obsidian"
          className="h-9 text-sm"
        />
        <Button
          type="button"
          size="sm"
          className="h-9 shrink-0"
          onClick={() => addFolder(inputValue)}
        >
          添加
        </Button>
      </div>

      {!isDefault && (
        <div className="pl-7">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            onClick={resetToDefault}
          >
            恢复默认
          </Button>
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
  }
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
}

type LocalAssetKind = "image" | "video" | "audio" | "file";

function getLocalAssetKind(name: string): LocalAssetKind {
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "ico"]
      .includes(ext)
  ) {
    return "image";
  }
  if (["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "flac", "m4a", "ogg"].includes(ext)) return "audio";
  return "file";
}

function localAssetKindLabel(kind: LocalAssetKind): string {
  if (kind === "image") return "图片";
  if (kind === "video") return "视频";
  if (kind === "audio") return "音频";
  return "文件";
}

function LocalAssetKindIcon({ kind }: { kind: LocalAssetKind }) {
  const className = "h-4 w-4";
  if (kind === "image") return <LucideIcons.Image className={className} />;
  if (kind === "video") return <LucideIcons.Film className={className} />;
  if (kind === "audio") return <LucideIcons.Music className={className} />;
  return <LucideIcons.File className={className} />;
}

function assetDirectoryLabel(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : normalized;
}

interface LocalAssetMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: UnreferencedLocalAsset[];
  loading: boolean;
  onDelete: (paths: string[]) => Promise<void>;
}

function LocalAssetMaintenanceDialog({
  open,
  onOpenChange,
  assets,
  loading,
  onDelete,
}: LocalAssetMaintenanceDialogProps) {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedPaths([]);
      setConfirming(false);
      setDeleting(false);
      return;
    }
    setSelectedPaths([]);
    setConfirming(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const assetPaths = new Set(assets.map((asset) => asset.path));
    setSelectedPaths((current) =>
      current.filter((path) => assetPaths.has(path)),
    );
  }, [assets, open]);

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedPaths.includes(asset.path)),
    [assets, selectedPaths],
  );
  const totalSize = useMemo(
    () => assets.reduce((sum, asset) => sum + asset.size, 0),
    [assets],
  );
  const selectedSize = useMemo(
    () => selectedAssets.reduce((sum, asset) => sum + asset.size, 0),
    [selectedAssets],
  );
  const allSelected =
    assets.length > 0 && selectedPaths.length === assets.length;
  const releaseSize = selectedPaths.length > 0 ? selectedSize : totalSize;

  const toggle = (path: string) => {
    setConfirming(false);
    setSelectedPaths((current) =>
      current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path],
    );
  };

  const toggleAll = () => {
    setConfirming(false);
    setSelectedPaths(allSelected ? [] : assets.map((asset) => asset.path));
  };

  const deleteSelected = async () => {
    if (selectedPaths.length === 0) return;
    setDeleting(true);
    try {
      await onDelete(selectedPaths);
      setSelectedPaths([]);
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  };

  const revealAsset = (asset: UnreferencedLocalAsset) => {
    void shell
      .showItemInFolder(asset.path)
      .then((shown) => shown || fs.revealItemInFolder(asset.path));
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="清理未引用静态资源"
      description="删除后无法恢复。"
      contentClassName="grid h-[min(80vh,52rem)] w-[min(96vw,56rem)] max-w-[56rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden !p-0 sm:rounded-[18px]"
      bodyClassName="flex min-h-0 flex-col overflow-hidden px-0 py-0"
      footer={
        confirming ? (
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm text-[var(--goose-color-danger-focus)]">
              将永久删除 {selectedPaths.length} 个文件，释放{" "}
              {formatFileSize(selectedSize)}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                返回
              </Button>
              <Button
                variant="destructive"
                className="min-w-[8rem]"
                onClick={() => void deleteSelected()}
                disabled={deleting || selectedPaths.length === 0}
              >
                {deleting ? "删除中…" : "确认删除"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button
              variant="destructive"
              className="min-w-[8rem]"
              disabled={selectedPaths.length === 0}
              onClick={() => setConfirming(true)}
            >
              {selectedPaths.length > 0
                ? `删除已选 · ${formatFileSize(selectedSize)}`
                : "删除已选"}
            </Button>
          </div>
        )
      }
    >
      {loading ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 py-12 text-sm text-muted-foreground">
          <LucideIcons.LoaderCircle className="h-5 w-5 animate-spin text-foreground" />
          <div>正在扫描资源…</div>
        </div>
      ) : assets.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 py-12 text-sm text-muted-foreground">
          <LucideIcons.CheckCircle2 className="h-5 w-5 text-[var(--goose-color-success)]" />
          <div>没有可清理资源</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-2 pt-1">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0 text-sm text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">
                {assets.length}
              </span>{" "}
              个未引用文件 · 可释放{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatFileSize(releaseSize)}
              </span>
              {selectedPaths.length > 0 ? (
                <span>
                  {" "}
                  · 已选 {selectedPaths.length}
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 shrink-0"
              onClick={toggleAll}
            >
              {allSelected ? "取消全选" : "全选"}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-[14px] border border-[var(--goose-block-subtle-border)] bg-background">
            <div className="h-full max-h-none overflow-y-auto">
              {assets.map((asset, index) => {
                const selected = selectedPaths.includes(asset.path);
                const kind = getLocalAssetKind(asset.name);
                const directory = assetDirectoryLabel(asset.relativePath);
                return (
                  <div
                    key={asset.path}
                    className={cn(
                      "group grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 transition-colors",
                      index > 0 &&
                        "border-t border-[var(--goose-block-subtle-border)]",
                      selected
                        ? "bg-[var(--goose-interactive-selected)]"
                        : "hover:bg-[var(--goose-block-subtle-bg)]",
                    )}
                  >
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)]"
                      aria-pressed={selected}
                      aria-label={
                        selected
                          ? `取消选择 ${asset.name}`
                          : `选择 ${asset.name}`
                      }
                      onClick={() => toggle(asset.path)}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[5px] border",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background",
                        )}
                      >
                        {selected ? (
                          <LucideIcons.Check
                            className="h-3 w-3"
                            strokeWidth={3}
                          />
                        ) : null}
                      </span>
                    </button>

                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-[10px]",
                        selected
                          ? "bg-[var(--goose-icon-chip-on-selected)] text-[var(--goose-interactive-selected-fg)]"
                          : "bg-[var(--goose-block-subtle-bg)] text-muted-foreground",
                      )}
                    >
                      <LocalAssetKindIcon kind={kind} />
                    </div>

                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => toggle(asset.path)}
                    >
                      <div className="truncate text-sm font-medium text-foreground">
                        {asset.name}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {localAssetKindLabel(kind)} · {directory}
                      </div>
                    </button>

                    <div className="shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {formatFileSize(asset.size)}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-[10px] text-muted-foreground hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)]"
                      aria-label={`在文件管理器显示 ${asset.name}`}
                      onClick={() => revealAsset(asset)}
                    >
                      <LucideIcons.FolderSearch className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </DialogShell>
  );
}

export function SettingsLocalFolder({
  localFolderFileManager,
  setLocalFolderFileManager,
  localFolderExternalEditor,
  setLocalFolderExternalEditor,
  localFolderTerminal,
  setLocalFolderTerminal,
  localFolderHiddenFolders,
  setLocalFolderHiddenFolders,
}: SettingsLocalFolderProps) {
  const [fileManagerOptions, setFileManagerOptions] = useState<
    LocalFolderOpenAppCandidate[]
  >(() => {
    const cached = getCachedAvailableOpenApps(LOCAL_FOLDER_FILE_MANAGER_CANDIDATES);
    return cached ? cached.filter((item) => item.id !== "finder") : [];
  });
  const [editorOptions, setEditorOptions] = useState<
    LocalFolderOpenAppCandidate[]
  >(() => getCachedAvailableOpenApps(LOCAL_FOLDER_EDITOR_CANDIDATES) ?? []);
  const [terminalOptions, setTerminalOptions] = useState<
    LocalFolderOpenAppCandidate[]
  >(() => {
    const cached = getCachedAvailableOpenApps(LOCAL_FOLDER_TERMINAL_CANDIDATES);
    return cached ? cached.filter((item) => item.id !== "terminal") : [];
  });
  const systemDefaultLabels = useMemo(() => getSystemDefaultLabels(), []);
  const hiddenFoldersRefreshNonceRef = useRef(0);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [unreferencedAssets, setUnreferencedAssets] = useState<
    UnreferencedLocalAsset[]
  >([]);

  const scanUnreferencedAssets = async () => {
    const notebookState = useNotebooks.getState();
    const activeNotebook = notebookState.activeNotebookId
      ? notebookState.notebooks[notebookState.activeNotebookId]
      : null;
    if (
      activeNotebook?.source !== "local-folder" ||
      !activeNotebook.localPath ||
      !window.gooseFs
    ) {
      toast.warning("请先切换到本地文件夹记事本");
      return;
    }

    setMaintenanceOpen(true);
    setMaintenanceLoading(true);
    try {
      window.dispatchEvent(
        new CustomEvent("goose-note:flush-editor", {
          detail: { immediate: true },
        }),
      );
      await usePages.getState().flushPendingLocalSaves();
      const pages = Object.values(usePages.getState().pages).filter(
        (page) => page.workspaceId === activeNotebook.id,
      );
      setUnreferencedAssets(
        await scanUnreferencedLocalAssets({
          basePath: activeNotebook.localPath,
          pages,
          gooseFs: window.gooseFs,
        }),
      );
    } catch (error) {
      console.error("[settings] 扫描未引用静态资源失败", error);
      toast.error("扫描未引用静态资源失败");
      setMaintenanceOpen(false);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const deleteUnreferencedAssets = async (paths: string[]) => {
    const results = await Promise.all(paths.map((path) => fs.deleteFile(path)));
    const deletedPaths = new Set(paths.filter((_, index) => results[index]));
    setUnreferencedAssets((assets) =>
      assets.filter((asset) => !deletedPaths.has(asset.path)),
    );
    if (deletedPaths.size)
      toast.success(`已删除 ${deletedPaths.size} 个未引用文件`);
    if (deletedPaths.size !== paths.length) toast.error("部分文件删除失败");
  };

  const handleHiddenFoldersChange = (folders: string[]) => {
    setLocalFolderHiddenFolders(folders);
    const refreshNonce = ++hiddenFoldersRefreshNonceRef.current;

    void (async () => {
      try {
        // 重扫会替换 workspace 页面集合；先把编辑器最新内容推进保存队列并等待本地写盘，
        // 避免用户刚编辑完就修改隐藏目录时丢失未落盘内容。
        window.dispatchEvent(
          new CustomEvent("goose-note:flush-editor", {
            detail: { immediate: true },
          }),
        );
        await usePages.getState().flushPendingLocalSaves();
        if (refreshNonce !== hiddenFoldersRefreshNonceRef.current) return;

        const pagesState = usePages.getState();
        const notebookState = useNotebooks.getState();
        const loadedWorkspaceIds = new Set(
          Object.values(pagesState.pages).map((page) => page.workspaceId),
        );
        Object.entries(notebookState.localFolderLoadStates).forEach(
          ([notebookId, state]) => {
            if (state.status === "ready") loadedWorkspaceIds.add(notebookId);
          },
        );
        if (notebookState.activeNotebookId) {
          loadedWorkspaceIds.add(notebookState.activeNotebookId);
        }

        let skippedDirtyNotebook = false;
        for (const notebookId of loadedWorkspaceIds) {
          const notebook = notebookState.notebooks[notebookId];
          if (notebook?.source !== "local-folder" || !notebook.localPath)
            continue;

          const currentPages = usePages.getState();
          const hasDirtyPage = Object.entries(
            currentPages.dirtyLocalPageIds,
          ).some(
            ([pageId, dirty]) =>
              dirty && currentPages.pages[pageId]?.workspaceId === notebookId,
          );
          if (hasDirtyPage) {
            skippedDirtyNotebook = true;
            continue;
          }

          await currentPages.loadLocalFolderPages(
            notebook.id,
            notebook.localPath,
          );
        }

        if (skippedDirtyNotebook) {
          toast.warning("部分本地文件夹仍有未保存内容，已暂缓刷新隐藏目录");
        }
      } catch (error) {
        console.error("[settings] 刷新本地文件夹隐藏目录失败", error);
        toast.error("刷新隐藏目录失败", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };

  useEffect(() => {
    let cancelled = false;

    const applyAvailableApps = (
      fileManagers: LocalFolderOpenAppCandidate[],
      editors: LocalFolderOpenAppCandidate[],
      terminals: LocalFolderOpenAppCandidate[],
    ) => {
      setFileManagerOptions(
        fileManagers.filter((item) => item.id !== "finder"),
      );
      setEditorOptions(editors);
      setTerminalOptions(terminals.filter((item) => item.id !== "terminal"));
    };

    const cachedFileManagers = getCachedAvailableOpenApps(
      LOCAL_FOLDER_FILE_MANAGER_CANDIDATES,
    );
    const cachedEditors = getCachedAvailableOpenApps(LOCAL_FOLDER_EDITOR_CANDIDATES);
    const cachedTerminals = getCachedAvailableOpenApps(
      LOCAL_FOLDER_TERMINAL_CANDIDATES,
    );

    if (cachedFileManagers && cachedEditors && cachedTerminals) {
      applyAvailableApps(cachedFileManagers, cachedEditors, cachedTerminals);
      return () => {
        cancelled = true;
      };
    }

    const loadAvailableApps = async () => {
      const [fileManagers, editors, terminals] = await Promise.all([
        shell.listAvailableOpenApps(LOCAL_FOLDER_FILE_MANAGER_CANDIDATES),
        shell.listAvailableOpenApps(LOCAL_FOLDER_EDITOR_CANDIDATES),
        shell.listAvailableOpenApps(LOCAL_FOLDER_TERMINAL_CANDIDATES),
      ]);

      if (cancelled) return;
      applyAvailableApps(fileManagers, editors, terminals);
    };

    void loadAvailableApps();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">
          本地文件夹
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          仅对本地文件夹类型的记事本生效。
        </p>
      </div>

      <SettingsSectionCard title="打开方式">
        <div className="space-y-3">
          <OpenAppField
            id="local-folder-file-manager"
            title="文件管理器"
            description="右键打开或显示本地文件时使用。"
            icon={LucideIcons.FolderOpen}
            value={localFolderFileManager}
            onChange={setLocalFolderFileManager}
            defaultLabel={systemDefaultLabels.fileManager}
            customPlaceholder="如：Path Finder"
            options={fileManagerOptions}
          />
          <OpenAppField
            id="local-folder-editor"
            title="编辑器"
            description="右键用外部应用打开文件或文件夹时使用。"
            icon={LucideIcons.SquarePen}
            value={localFolderExternalEditor}
            onChange={setLocalFolderExternalEditor}
            defaultLabel="系统默认"
            customPlaceholder="如：Cursor、Zed、code -r"
            options={editorOptions}
          />
          <OpenAppField
            id="local-folder-terminal"
            title="终端"
            description="右键在终端中打开目录时使用。"
            icon={LucideIcons.Terminal}
            value={localFolderTerminal}
            onChange={setLocalFolderTerminal}
            defaultLabel={systemDefaultLabels.terminal}
            customPlaceholder="如：Ghostty、iTerm、wezterm"
            options={terminalOptions}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="显示">
        <HiddenFoldersField
          folders={localFolderHiddenFolders}
          onChange={handleHiddenFoldersChange}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title="存储维护">
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.Trash2
                className="h-4 w-4 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label>清理未引用静态资源</Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              扫描页面同级 assets 目录及根 assets 兼容目录。
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            onClick={() => void scanUnreferencedAssets()}
          >
            扫描资源
          </Button>
        </div>
      </SettingsSectionCard>

      <LocalAssetMaintenanceDialog
        open={maintenanceOpen}
        onOpenChange={setMaintenanceOpen}
        assets={unreferencedAssets}
        loading={maintenanceLoading}
        onDelete={deleteUnreferencedAssets}
      />
    </div>
  );
}
