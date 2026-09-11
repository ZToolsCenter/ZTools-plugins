import { useState, useEffect, useMemo } from "react";
import { Download, FileText, Globe, RotateCcw, Upload, Cloud, CloudOff, RefreshCw, ChevronRight, Trash2 } from "lucide-react";
import type { ExportOptions } from "@/lib/export";
import { SelectableCard } from "@/components/ui/selectable-card";
import { SettingsSectionCard } from "./SettingsSectionCard";
import { renderNotebookIcon } from "../notebookUtils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSettings } from "@/stores/settings";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { generateExportZip } from "@/lib/export";
import {
  testWebdavConnection,
  listWebdavBackups,
  uploadWebdavBackup,
  downloadWebdavBackup,
  deleteWebdavBackup,
  normalizeBaseUrl,
  normalizeRemoteDir,
  type WebdavBackupFile
} from "@/lib/webdavSync";
import { toast } from "@/components/ui/sonner";

interface NotebookOption {
  id: string;
  name: string;
  icon?: string;
}

interface SettingsDataPanelProps {
  importing: boolean;
  onImport: () => void;
  selectedIds: string[];
  notebookList: NotebookOption[];
  onToggleNotebook: (id: string) => void;
  onSelectAll: () => void;
  format: ExportOptions["format"];
  onFormatChange: (format: ExportOptions["format"]) => void;
  exporting: boolean;
  onExport: () => void;
  onOpenResetDialog: () => void;
  onResetAndImport?: (blob: Blob) => Promise<void>;
}

const DATA_BADGE_CLASS =
  "rounded-full bg-[hsl(var(--goose-selected-bg)/0.9)] px-2 py-0.5 text-[11px] text-foreground/75 dark:bg-[hsl(var(--foreground)/0.1)]";

const DATA_UNSELECTED_CARD_CLASS =
  "border-transparent bg-[hsl(var(--goose-selected-bg)/0.58)] hover:bg-[var(--goose-interactive-hover)] dark:bg-[hsl(var(--foreground)/0.08)]";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRemoteTime(value: string | null | undefined): string {
  if (!value) return "未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString();
}

export function SettingsDataPanel({
  importing,
  onImport,
  selectedIds,
  notebookList,
  onToggleNotebook,
  onSelectAll,
  format,
  onFormatChange,
  exporting,
  onExport,
  onOpenResetDialog,
  onResetAndImport,
}: SettingsDataPanelProps) {
  const selectedCount = selectedIds.length;
  const totalCount = notebookList.length;

  const { notebooks } = useNotebooks();
  const { pages } = usePages();

  const {
    webdavUrl,
    webdavUsername,
    webdavPassword,
    webdavRemoteDir,
    webdavRetentionDays,
    webdavAutoBackupEnabled,
    webdavLastUploadAt,
    webdavLastUploadFilename,
    webdavLastDownloadAt,
    webdavLastDownloadFilename,
    updateWebdavSettings,
  } = useSettings();

  const [tempUrl, setTempUrl] = useState(webdavUrl);
  const [tempUsername, setTempUsername] = useState(webdavUsername);
  const [tempPassword, setTempPassword] = useState("");
  const [tempRemoteDir, setTempRemoteDir] = useState(webdavRemoteDir);
  const [tempRetentionDays, setTempRetentionDays] = useState(webdavRetentionDays);
  const [tempAutoBackupEnabled, setTempAutoBackupEnabled] = useState(webdavAutoBackupEnabled);

  const [testing, setTesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [syncingLatest, setSyncingLatest] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [isRemoteListOpen, setIsRemoteListOpen] = useState(false);
  const [showAllRemote, setShowAllRemote] = useState(false);
  const [remoteFiles, setRemoteFiles] = useState<WebdavBackupFile[]>([]);
  const [restoringFile, setRestoringFile] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  const [confirmConfig, setConfirmConfig] = useState<{
    open: boolean;
    title: string;
    description: string;
    isDestructive?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  } | null>(null);

  useEffect(() => {
    setTempUrl(webdavUrl);
    setTempUsername(webdavUsername);
    setTempRemoteDir(webdavRemoteDir);
    setTempRetentionDays(webdavRetentionDays);
    setTempAutoBackupEnabled(webdavAutoBackupEnabled);
  }, [webdavUrl, webdavUsername, webdavRemoteDir, webdavRetentionDays, webdavAutoBackupEnabled]);

  const busy = testing || uploading || syncingLatest || remoteLoading || restoringFile !== null || deletingFile !== null;
  const hasSavedConfig = Boolean(webdavUrl && webdavUsername && webdavPassword);

  const lastUploadText = useMemo(() => {
    const time = formatRemoteTime(webdavLastUploadAt);
    return webdavLastUploadFilename ? `${time} (${webdavLastUploadFilename})` : "尚未同步";
  }, [webdavLastUploadAt, webdavLastUploadFilename]);

  const lastDownloadText = useMemo(() => {
    const time = formatRemoteTime(webdavLastDownloadAt);
    return webdavLastDownloadFilename ? `${time} (${webdavLastDownloadFilename})` : "尚未同步";
  }, [webdavLastDownloadAt, webdavLastDownloadFilename]);

  const fetchRemoteList = async () => {
    if (!hasSavedConfig) return;
    setRemoteLoading(true);
    try {
      const list = await listWebdavBackups(webdavUrl, webdavUsername, webdavPassword, webdavRemoteDir);
      setRemoteFiles(list);
    } catch (err) {
      console.error(err);
      toast.error("加载远端列表失败");
    } finally {
      setRemoteLoading(false);
    }
  };

  const handleSaveAndTest = async () => {
    setTesting(true);
    const pwdToUse = tempPassword ? tempPassword : webdavPassword;

    let cleanUrl: string;
    let cleanDir: string;
    try {
      cleanUrl = normalizeBaseUrl(tempUrl);
    } catch (err: any) {
      toast.error("保存失败", { description: err.message || "服务地址格式不正确" });
      setTesting(false);
      return;
    }

    try {
      cleanDir = normalizeRemoteDir(tempRemoteDir);
    } catch (err: any) {
      toast.error("保存失败", { description: err.message || "远端目录格式不正确" });
      setTesting(false);
      return;
    }

    let cleanDays = tempRetentionDays;
    if (!Number.isInteger(cleanDays) || cleanDays < 1 || cleanDays > 365) {
      cleanDays = Math.max(1, Math.min(365, cleanDays || 365));
    }

    setTempUrl(cleanUrl);
    setTempRemoteDir(cleanDir);
    setTempRetentionDays(cleanDays);

    try {
      const result = await testWebdavConnection(cleanUrl, tempUsername, pwdToUse, cleanDir);
      if (result.ok) {
        updateWebdavSettings({
          webdavUrl: cleanUrl,
          webdavUsername: tempUsername,
          webdavPassword: pwdToUse,
          webdavRemoteDir: cleanDir,
          webdavRetentionDays: cleanDays,
          webdavAutoBackupEnabled: tempAutoBackupEnabled,
        });
        setTempPassword("");
        toast.success("配置已保存，连接测试成功");
        if (isRemoteListOpen) {
          const list = await listWebdavBackups(cleanUrl, tempUsername, pwdToUse, cleanDir);
          setRemoteFiles(list);
        }
      } else {
        toast.error("连接测试失败", { description: result.message });
      }
    } catch (err: any) {
      toast.error("操作失败", { description: err.message || String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleUploadNow = async () => {
    setUploading(true);
    try {
      const notebookIds = notebookList.map((n) => n.id);
      if (notebookIds.length === 0) {
        toast.error("无可导出的笔记本数据");
        setUploading(false);
        return;
      }
      const zipBlob = await generateExportZip({ format: "md", notebookIds }, notebooks, Object.values(pages));
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const fileName = `goose-note-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.zip`;

      const result = await uploadWebdavBackup(
        webdavUrl,
        webdavUsername,
        webdavPassword,
        webdavRemoteDir,
        webdavRetentionDays,
        zipBlob,
        fileName
      );

      if (result.success) {
        updateWebdavSettings({
          webdavLastUploadAt: now.toISOString(),
          webdavLastUploadFilename: fileName,
        });
        toast.success("同步备份成功", { description: `已清理 ${result.cleanedCount} 个云端过期备份` });
        if (isRemoteListOpen) {
          const list = await listWebdavBackups(webdavUrl, webdavUsername, webdavPassword, webdavRemoteDir);
          setRemoteFiles(list);
        }
      }
    } catch (err: any) {
      console.error(err);
      toast.error("备份上传失败", { description: err.message || String(err) });
    } finally {
      setUploading(false);
    }
  };

  const handleSyncLatest = async () => {
    setSyncingLatest(true);
    try {
      const list = await listWebdavBackups(webdavUrl, webdavUsername, webdavPassword, webdavRemoteDir);
      setRemoteFiles(list);
      if (list.length === 0) {
        toast.error("云端未发现可用的备份文件");
        setSyncingLatest(false);
        return;
      }
      const latest = list[0];
      setConfirmConfig({
        open: true,
        title: "同步最新备份",
        description: `确认拉取最新的远端备份 ${latest.basename} 并同步到本地？恢复前会先校验备份，失败时自动回滚覆盖前的数据。`,
        isDestructive: true,
        onConfirm: async () => {
          setSyncingLatest(true);
          try {
            const blob = await downloadWebdavBackup(webdavUrl, webdavUsername, webdavPassword, webdavRemoteDir, latest.basename);
            if (onResetAndImport) {
              await onResetAndImport(blob);
              updateWebdavSettings({
                webdavLastDownloadAt: new Date().toISOString(),
                webdavLastDownloadFilename: latest.basename,
              });
            }
          } catch (err: any) {
            console.error(err);
            toast.error("同步失败", { description: err.message || String(err) });
          } finally {
            setSyncingLatest(false);
          }
        },
        onCancel: () => {
          setSyncingLatest(false);
        }
      });
    } catch (err: any) {
      console.error(err);
      toast.error("同步失败", { description: err.message || String(err) });
      setSyncingLatest(false);
    }
  };

  const toggleRemoteList = () => {
    const next = !isRemoteListOpen;
    setIsRemoteListOpen(next);
    if (next && hasSavedConfig) {
      void fetchRemoteList();
    }
  };

  const handleRestore = async (file: WebdavBackupFile) => {
    setConfirmConfig({
      open: true,
      title: "恢复备份",
      description: `确认从远端备份 ${file.basename} 恢复数据？恢复前会先校验备份，失败时自动回滚覆盖前的数据。`,
      isDestructive: true,
      onConfirm: async () => {
        setRestoringFile(file.basename);
        try {
          const blob = await downloadWebdavBackup(webdavUrl, webdavUsername, webdavPassword, webdavRemoteDir, file.basename);
          if (onResetAndImport) {
            await onResetAndImport(blob);
            updateWebdavSettings({
              webdavLastDownloadAt: new Date().toISOString(),
              webdavLastDownloadFilename: file.basename,
            });
          }
        } catch (err: any) {
          console.error(err);
          toast.error("恢复备份失败", { description: err.message || String(err) });
        } finally {
          setRestoringFile(null);
        }
      }
    });
  };

  const handleDelete = async (file: WebdavBackupFile) => {
    setConfirmConfig({
      open: true,
      title: "删除备份",
      description: `确认删除远端备份 ${file.basename}？该操作无法撤销。`,
      isDestructive: true,
      onConfirm: async () => {
        setDeletingFile(file.basename);
        try {
          await deleteWebdavBackup(webdavUrl, webdavUsername, webdavPassword, webdavRemoteDir, file.basename);
          toast.success("远端备份已删除");
          const list = await listWebdavBackups(webdavUrl, webdavUsername, webdavPassword, webdavRemoteDir);
          setRemoteFiles(list);
        } catch (err: any) {
          console.error(err);
          toast.error("删除备份失败", { description: err.message || String(err) });
        } finally {
          setDeletingFile(null);
        }
      }
    });
  };

  const visibleRemoteFiles = showAllRemote ? remoteFiles : remoteFiles.slice(0, 3);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">
          数据管理
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          配置并管理应用数据的本地备份与云端同步。
        </p>
      </div>

      <Tabs defaultValue="webdav" className="w-full">
        <TabsList className="flex w-full mb-2 bg-muted/60 p-1 rounded-[12px]">
          <TabsTrigger value="webdav" className="flex-1 rounded-[10px] py-1.5 text-sm font-medium">WebDAV备份</TabsTrigger>
          <TabsTrigger value="local" className="flex-1 rounded-[10px] py-1.5 text-sm font-medium">本地备份</TabsTrigger>
        </TabsList>

        <TabsContent value="local" className="space-y-2 outline-none">
          <SettingsSectionCard
            title={<span className="flex items-center gap-2"><Download className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />导入与导出</span>}
            description="导入选 ZIP 文件；导出时会弹出系统保存对话框让你选路径。"
            className="pb-3"
            actions={
              <Button variant="secondary" size="sm" onClick={onImport} disabled={importing}>
                {importing ? "导入中..." : "导入 ZIP"}
                {!importing && <Upload className="ml-2 h-4 w-4" />}
              </Button>
            }
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-foreground/80">
                  选择记事本 ({selectedCount})
                </Label>
                <div className="flex items-center gap-2">
                  <span className={DATA_BADGE_CLASS}>
                    已选 {selectedCount}/{totalCount}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onSelectAll}
                    className="h-8 rounded-[10px] px-2 text-xs text-foreground/75 transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
                  >
                    {selectedCount === totalCount ? "取消全选" : "全选"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {notebookList.map((notebook) => {
                  const isSelected = selectedIds.includes(notebook.id);
                  return (
                    <button
                      key={notebook.id}
                      type="button"
                      onClick={() => onToggleNotebook(notebook.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-[12px] border px-3 py-2.5 text-left transition-all duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isSelected
                          ? "border-transparent bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                          : DATA_UNSELECTED_CARD_CLASS,
                      )}
                    >
                      <span className="shrink-0 inline-flex items-center justify-center w-5 h-5">
                        {renderNotebookIcon(notebook.icon || "BookOpen", "h-4 w-4 stroke-[1.6]")}
                      </span>
                      <span className="truncate text-sm">{notebook.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground/80">导出格式</Label>
              <div className="grid grid-cols-2 gap-2">
                <SelectableCard
                  selected={format === "md"}
                  onClick={() => onFormatChange("md")}
                  className={cn(
                    "flex h-16 items-center gap-3 rounded-[12px] border px-3 py-2 transition-all duration-200",
                    format === "md"
                      ? "border-transparent bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                      : DATA_UNSELECTED_CARD_CLASS,
                  )}
                >
                  <FileText className="h-5 w-5 shrink-0" />
                  <div className="text-left">
                    <div className="text-sm font-medium">Markdown</div>
                    <div className="text-xs text-foreground/70">.md 文件</div>
                  </div>
                </SelectableCard>
                <SelectableCard
                  selected={format === "html"}
                  onClick={() => onFormatChange("html")}
                  className={cn(
                    "flex h-16 items-center gap-3 rounded-[12px] border px-3 py-2 transition-all duration-200",
                    format === "html"
                      ? "border-transparent bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                      : DATA_UNSELECTED_CARD_CLASS,
                  )}
                >
                  <Globe className="h-5 w-5 shrink-0" />
                  <div className="text-left">
                    <div className="text-sm font-medium">HTML</div>
                    <div className="text-xs text-foreground/70">网页文件</div>
                  </div>
                </SelectableCard>
              </div>
            </div>

            <Button
              className="w-full rounded-[12px]"
              onClick={onExport}
              disabled={selectedCount === 0 || exporting}
            >
              {exporting ? "导出中..." : "开始导出"}
              {!exporting && <Download className="ml-2 h-4 w-4" />}
            </Button>
            <p className="text-xs text-foreground/70">
              建议在重置前先导出备份，避免误删造成数据丢失。
            </p>
          </SettingsSectionCard>

          <SettingsSectionCard
            tone="danger"
            className="pt-3"
            title={<span className="flex items-center gap-2"><RotateCcw className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />重置所有数据</span>}
            description="会清空内部记事本、页面、历史、AI 会话、标签与应用设置；不会删除本地文件夹中的磁盘文件。操作前建议先导出备份。"
            actions={
              <Button variant="destructive" size="sm" onClick={onOpenResetDialog}>
                重置所有数据
              </Button>
            }
          />
        </TabsContent>

        <TabsContent value="webdav" className="space-y-2 outline-none">
          <SettingsSectionCard
            title={<span className="flex items-center gap-2"><Cloud className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />WebDAV 配置</span>}
            description="配置 WebDAV 服务以同步并自动管理云端备份。"
            className="pb-3"
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground/80">服务地址</Label>
                <input
                  className="flex h-9 w-full rounded-[12px] border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={tempUrl}
                  disabled={busy}
                  onChange={(e) => setTempUrl(e.target.value)}
                  placeholder="例如 https://example.com/dav/"
                />
                <p className="text-[11px] text-muted-foreground">
                  示例地址：https://example.com/dav/
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground/80">账号</Label>
                  <input
                    className="flex h-9 w-full rounded-[12px] border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={tempUsername}
                    disabled={busy}
                    onChange={(e) => setTempUsername(e.target.value)}
                    placeholder="邮箱或用户名"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground/80">远端目录</Label>
                  <input
                    className="flex h-9 w-full rounded-[12px] border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={tempRemoteDir}
                    disabled={busy}
                    onChange={(e) => setTempRemoteDir(e.target.value)}
                    placeholder="备份目录"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground/80">应用密码</Label>
                  <input
                    type="password"
                    className="flex h-9 w-full rounded-[12px] border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={tempPassword}
                    disabled={busy}
                    onChange={(e) => setTempPassword(e.target.value)}
                    placeholder={webdavPassword ? "已保存，留空保持不变" : "第三方应用密码"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground/80">云端保留天数</Label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="flex h-9 w-full rounded-[12px] border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={tempRetentionDays}
                    disabled={busy}
                    onChange={(e) => setTempRetentionDays(parseInt(e.target.value) || 30)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-[12px] border border-muted/20 p-3 bg-muted/10">
                <div className="space-y-0.5 pr-4">
                  <Label className="text-xs font-medium text-foreground/80">自动云备份</Label>
                  <p className="text-[11px] text-muted-foreground">
                    应用启动空闲时，若距离上次同步超过24小时，自动静默生成并上传备份
                  </p>
                </div>
                <Switch
                  checked={tempAutoBackupEnabled}
                  onCheckedChange={setTempAutoBackupEnabled}
                  disabled={busy}
                />
              </div>

              <div className="rounded-[12px] border border-transparent bg-[hsl(var(--goose-selected-bg)/0.58)] p-3 text-xs text-foreground/80 dark:bg-[hsl(var(--foreground)/0.08)]">
                <div className="flex flex-col gap-1.5">
                  <div>
                    <strong>最近上传：</strong>
                    <span>{lastUploadText}</span>
                  </div>
                  <div>
                    <strong>最近恢复：</strong>
                    <span>{lastDownloadText}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 w-full pt-2">
                <Button
                  className="w-full flex items-center justify-center gap-1.5 rounded-[12px]"
                  disabled={busy}
                  onClick={handleSaveAndTest}
                >
                  {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                  测试/保存配置
                </Button>
                <Button
                  variant="secondary"
                  className="w-full flex items-center justify-center gap-1.5 rounded-[12px]"
                  disabled={busy || !hasSavedConfig}
                  onClick={handleUploadNow}
                >
                  {uploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  生成并上传
                </Button>
                <Button
                  variant="secondary"
                  className="w-full flex items-center justify-center gap-1.5 rounded-[12px]"
                  disabled={busy || !hasSavedConfig}
                  onClick={handleSyncLatest}
                >
                  {syncingLatest ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  同步最新配置
                </Button>
              </div>
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard
            className="pt-3"
            title={
              <button
                type="button"
                className="flex items-center gap-2 text-left focus:outline-none"
                onClick={toggleRemoteList}
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    isRemoteListOpen && "rotate-90"
                  )}
                />
                <span>远端备份</span>
              </button>
            }
            description="管理云盘中的打包备份文件。"
            actions={
              isRemoteListOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !hasSavedConfig}
                  onClick={fetchRemoteList}
                  className="h-8 rounded-[10px] px-2 text-xs hover:bg-[var(--goose-interactive-hover)]"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", remoteLoading && "animate-spin")} />
                </Button>
              )
            }
          >
            {isRemoteListOpen && (
              <div className="space-y-3 pt-2">
                {remoteLoading ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>正在加载远端备份</span>
                  </div>
                ) : remoteFiles.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 border border-dashed rounded-[12px] border-muted py-6 text-center">
                    <CloudOff className="h-6 w-6 text-muted-foreground" strokeWidth={1.75} />
                    <p className="text-xs font-medium text-foreground">暂无远端备份</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      保存连接配置后，点击“生成并上传”创建您的第一份云端备份
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {visibleRemoteFiles.map((file) => {
                      const isRestoring = restoringFile === file.basename;
                      const isDeleting = deletingFile === file.basename;
                      return (
                        <div
                          key={file.basename}
                          className="flex flex-col gap-2 rounded-[12px] border p-3 bg-[hsl(var(--goose-selected-bg)/0.38)] dark:bg-[hsl(var(--foreground)/0.04)] sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="space-y-1">
                            <p className="text-sm font-medium truncate max-w-[280px] sm:max-w-[400px]" title={file.basename}>
                              {file.basename}
                            </p>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>时间: {formatRemoteTime(file.lastmod)}</span>
                              <span>大小: {formatFileSize(file.size)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-center">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-8 rounded-[10px] text-xs flex items-center gap-1"
                              disabled={busy}
                              onClick={() => handleRestore(file)}
                            >
                              {isRestoring ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              恢复
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-8 rounded-[10px] text-xs flex items-center gap-1"
                              disabled={busy}
                              onClick={() => handleDelete(file)}
                            >
                              {isDeleting ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                              删除
                            </Button>
                          </div>
                        </div>
                      );
                    })}

                    {remoteFiles.length > 3 && (
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAllRemote((prev) => !prev)}
                          className="text-xs hover:bg-[var(--goose-interactive-hover)]"
                        >
                          {showAllRemote ? "收起备份" : `展开全部远端备份 (还有 ${remoteFiles.length - 3} 个)`}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </SettingsSectionCard>
        </TabsContent>
      </Tabs>

      <DialogShell
        open={confirmConfig?.open || false}
        onOpenChange={(open) => {
          if (!open) {
            confirmConfig?.onCancel?.();
            setConfirmConfig(null);
          }
        }}
        title={confirmConfig?.title}
      >
        <div className="px-6 pb-6 pt-4 space-y-4">
          <p className="text-sm text-muted-foreground break-all">
            {confirmConfig?.description}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="rounded-[10px]"
              onClick={() => {
                confirmConfig?.onCancel?.();
                setConfirmConfig(null);
              }}
            >
              取消
            </Button>
            <Button
              variant={confirmConfig?.isDestructive ? "destructive" : "default"}
              className="rounded-[10px]"
              onClick={async () => {
                const onConfirm = confirmConfig?.onConfirm;
                setConfirmConfig(null);
                if (onConfirm) {
                  await onConfirm();
                }
              }}
            >
              确定
            </Button>
          </div>
        </div>
      </DialogShell>
    </div>
  );
}
