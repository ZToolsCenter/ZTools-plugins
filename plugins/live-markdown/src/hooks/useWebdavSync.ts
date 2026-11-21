import { useCallback, useEffect, useState } from "react";
import {
  LoadedDocument,
  PreferencesTab,
  TyporaBridgeApi,
  WebdavConfig,
  WebdavRemoteFile,
  WorkspaceScanResult
} from "../types/typora";

export const DEFAULT_WEBDAV_CONFIG: WebdavConfig = {
  enabled: false,
  serverUrl: "",
  remotePath: "/LiveMarkdownNotes/",
  username: "",
  password: "",
  autoSyncOnSave: true,
  syncDirection: "bidirectional"
};

interface UseWebdavSyncOptions {
  bridge: TyporaBridgeApi | null;
  doc: LoadedDocument;
  workspace: WorkspaceScanResult | null;
  preferencesOpen: boolean;
  sidebarVisible: boolean;
  refreshWorkspace: (folderPath: string, options?: { shallow?: boolean }) => void;
  openLocalFile: (filePath: string, jumpToLine?: number) => void;
  onAdoptPulledDocument: (nextDoc: LoadedDocument) => void | boolean | Promise<void | boolean>;
  onOpenPreferencesTab: (tab: PreferencesTab) => void;
  showToast: (msg: string) => void;
}

export function useWebdavSync({
  bridge,
  doc,
  workspace,
  preferencesOpen,
  sidebarVisible,
  refreshWorkspace,
  openLocalFile,
  onAdoptPulledDocument,
  onOpenPreferencesTab,
  showToast
}: UseWebdavSyncOptions) {
  const [webdavConfig, setWebdavConfig] = useState<WebdavConfig>(() => {
    try {
      const saved = bridge?.loadPersistedState?.();
      if (saved && typeof saved.webdavConfig === "object" && saved.webdavConfig) {
        return {
          ...DEFAULT_WEBDAV_CONFIG,
          ...(saved.webdavConfig as Partial<WebdavConfig>)
        };
      }
    } catch {
      // ignore
    }
    return DEFAULT_WEBDAV_CONFIG;
  });

  const [webdavSyncState, setWebdavSyncState] = useState<
    "idle" | "testing" | "syncing" | "success" | "error"
  >("idle");
  const [webdavStatusMessage, setWebdavStatusMessage] = useState<string | null>(
    null
  );
  const [webdavLastSyncAt, setWebdavLastSyncAt] = useState<number | null>(null);
  const [webdavRemoteFiles, setWebdavRemoteFiles] = useState<WebdavRemoteFile[]>(
    []
  );

  const handleUpdateWebdavConfig = useCallback(
    (patch: Partial<WebdavConfig>) => {
      setWebdavConfig((prev) => {
        const next = { ...prev, ...patch };
        try {
          bridge?.savePersistedState?.({ webdavConfig: next });
        } catch {
          // ignore
        }
        return next;
      });
    },
    [bridge]
  );

  const handleOpenWebdavSettings = useCallback(() => {
    onOpenPreferencesTab("webdav");
  }, [onOpenPreferencesTab]);

  const handleRefreshWebdavFiles = useCallback(
    async (configOverride?: WebdavConfig) => {
      const cfg = configOverride || webdavConfig;
      if (!bridge?.listWebdavFiles || !cfg.serverUrl.trim()) return;
      try {
        const res = await bridge.listWebdavFiles(cfg);
        if (res.ok) {
          setWebdavRemoteFiles(res.files || []);
        }
      } catch {
        // ignore background list error
      }
    },
    [bridge, webdavConfig]
  );

  const handleTestWebdavConnection = useCallback(async () => {
    if (!bridge?.testWebdavConnection) {
      setWebdavSyncState("error");
      setWebdavStatusMessage("当前运行环境不支持 WebDAV 桥接服务");
      return;
    }
    setWebdavSyncState("testing");
    setWebdavStatusMessage("正在连接并校验 WebDAV 服务器...");
    try {
      const res = await bridge.testWebdavConnection(webdavConfig);
      if (res.ok) {
        setWebdavSyncState("success");
        setWebdavStatusMessage(res.message);
        showToast(res.message);
        await handleRefreshWebdavFiles(webdavConfig);
      } else {
        setWebdavSyncState("error");
        setWebdavStatusMessage(res.message || "WebDAV 连接失败");
        showToast(res.message || "WebDAV 连接失败");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWebdavSyncState("error");
      setWebdavStatusMessage(`WebDAV 连接异常: ${msg}`);
    }
  }, [bridge, handleRefreshWebdavFiles, showToast, webdavConfig]);

  const handlePushCurrentDocToWebdav = useCallback(
    async (silent = false) => {
      if (!bridge?.pushWebdavDocument) return;
      if (!webdavConfig.serverUrl.trim()) {
        if (!silent) handleOpenWebdavSettings();
        return;
      }
      setWebdavSyncState("syncing");
      if (!silent) {
        setWebdavStatusMessage(`正在上传《${doc.name}》到 WebDAV...`);
      }
      try {
        const res = await bridge.pushWebdavDocument(
          webdavConfig,
          doc.name || "Untitled.md",
          doc.content
        );
        if (res.ok) {
          setWebdavSyncState("success");
          setWebdavLastSyncAt(res.syncedAt);
          const msg = `已上传《${res.name}》至 WebDAV`;
          setWebdavStatusMessage(msg);
          showToast(silent ? `已保存并同步至 WebDAV (${res.name})` : msg);
          await handleRefreshWebdavFiles(webdavConfig);
        } else {
          setWebdavSyncState("error");
          const errMsg = res.error || "WebDAV 上传失败";
          setWebdavStatusMessage(errMsg);
          if (!silent) showToast(errMsg);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setWebdavSyncState("error");
        setWebdavStatusMessage(`上传失败: ${msg}`);
        if (!silent) showToast(`WebDAV 上传失败: ${msg}`);
      }
    },
    [
      bridge,
      doc.content,
      doc.name,
      handleOpenWebdavSettings,
      handleRefreshWebdavFiles,
      showToast,
      webdavConfig
    ]
  );

  const handlePullWebdavFile = useCallback(
    async (remoteFileName: string) => {
      if (!bridge?.pullWebdavDocument) return;
      setWebdavSyncState("syncing");
      setWebdavStatusMessage(`正在从云端拉取 ${remoteFileName}...`);
      try {
        const targetLocalDir = workspace?.rootDir || doc.dir || undefined;
        const res = await bridge.pullWebdavDocument(
          webdavConfig,
          remoteFileName,
          targetLocalDir
        );
        if (res.ok) {
          const adopted = await onAdoptPulledDocument({
            path: res.path,
            name: res.name,
            dir: res.dir || targetLocalDir || doc.dir,
            content: res.content,
            isDirty: false,
            mtimeMs: res.mtimeMs || Date.now()
          });
          if (adopted === false) {
            if (workspace?.rootDir) refreshWorkspace(workspace.rootDir);
            setWebdavSyncState("idle");
            const msg = `已下载 ${res.name}，当前文档未切换`;
            setWebdavStatusMessage(msg);
            showToast(msg);
            return;
          }
          if (workspace?.rootDir) {
            refreshWorkspace(workspace.rootDir);
          }
          setWebdavSyncState("success");
          setWebdavLastSyncAt(res.syncedAt);
          const msg = `已从 WebDAV 拉取并打开 ${res.name}`;
          setWebdavStatusMessage(msg);
          showToast(msg);
        } else {
          setWebdavSyncState("error");
          const errMsg = res.error || "WebDAV 拉取失败";
          setWebdavStatusMessage(errMsg);
          showToast(errMsg);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setWebdavSyncState("error");
        setWebdavStatusMessage(`拉取失败: ${msg}`);
        showToast(`拉取失败: ${msg}`);
      }
    },
    [
      bridge,
      doc.dir,
      onAdoptPulledDocument,
      refreshWorkspace,
      showToast,
      webdavConfig,
      workspace?.rootDir
    ]
  );

  const handleDeleteWebdavFile = useCallback(
    async (remoteFileName: string) => {
      if (!bridge?.deleteWebdavDocument) return;
      try {
        const res = await bridge.deleteWebdavDocument(
          webdavConfig,
          remoteFileName
        );
        if (res.ok) {
          const msg = `已从云端删除 ${res.name}`;
          setWebdavStatusMessage(msg);
          showToast(msg);
          await handleRefreshWebdavFiles(webdavConfig);
        } else {
          const errMsg = res.error || "云端删除失败";
          setWebdavStatusMessage(errMsg);
          showToast(errMsg);
        }
      } catch (err) {
        showToast(
          `删除失败: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [bridge, handleRefreshWebdavFiles, showToast, webdavConfig]
  );

  const handleSyncWebdavNow = useCallback(async () => {
    if (!bridge?.syncWorkspaceWithWebdav) return;
    if (!webdavConfig.serverUrl.trim()) {
      handleOpenWebdavSettings();
      return;
    }
    setWebdavSyncState("syncing");
    setWebdavStatusMessage("正在执行 WebDAV 云端同步...");
    try {
      const res = await bridge.syncWorkspaceWithWebdav(webdavConfig, {
        localDir: workspace?.rootDir || doc.dir || null,
        activeDoc: {
          name: doc.name,
          content: doc.content,
          path: doc.path,
          mtimeMs: doc.mtimeMs
        },
        direction: webdavConfig.syncDirection
      });
      if (res.ok) {
        setWebdavSyncState("success");
        setWebdavStatusMessage(res.message);
        setWebdavRemoteFiles(res.remoteFiles || []);
        setWebdavLastSyncAt(res.syncedAt);
        if (workspace?.rootDir) {
          refreshWorkspace(workspace.rootDir);
        }

        // Reload currently open document if it was updated by remote pull
        const currentDocPulled =
          Boolean(
            doc.path &&
              Array.isArray(res.downloadedPaths) &&
              res.downloadedPaths.includes(doc.path)
          ) ||
          Boolean(doc.path && res.downloaded.includes(doc.name));

        if (currentDocPulled && doc.path) {
          if (!doc.isDirty) {
            openLocalFile(doc.path);
          } else {
            showToast(
              `云端已拉取《${doc.name}》到磁盘，当前编辑器有未保存修改，请注意核对`
            );
            return;
          }
        }

        showToast(res.message);
      } else {
        setWebdavSyncState("error");
        const errMsg = res.message || res.error || "WebDAV 同步失败";
        setWebdavStatusMessage(errMsg);
        showToast(errMsg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWebdavSyncState("error");
      setWebdavStatusMessage(`WebDAV 同步异常: ${msg}`);
      showToast(`WebDAV 同步异常: ${msg}`);
    }
  }, [
    bridge,
    doc.content,
    doc.dir,
    doc.isDirty,
    doc.mtimeMs,
    doc.name,
    doc.path,
    handleOpenWebdavSettings,
    openLocalFile,
    refreshWorkspace,
    showToast,
    webdavConfig,
    workspace?.rootDir
  ]);

  useEffect(() => {
    if (
      webdavConfig.enabled &&
      webdavConfig.serverUrl.trim() &&
      (preferencesOpen || sidebarVisible)
    ) {
      void handleRefreshWebdavFiles(webdavConfig);
    }
  }, [
    handleRefreshWebdavFiles,
    preferencesOpen,
    sidebarVisible,
    webdavConfig,
    webdavConfig.enabled,
    webdavConfig.serverUrl
  ]);

  return {
    webdavConfig,
    webdavSyncState,
    webdavStatusMessage,
    webdavLastSyncAt,
    webdavRemoteFiles,
    handleUpdateWebdavConfig,
    handleOpenWebdavSettings,
    handleRefreshWebdavFiles,
    handleTestWebdavConnection,
    handlePushCurrentDocToWebdav,
    handlePullWebdavFile,
    handleDeleteWebdavFile,
    handleSyncWebdavNow
  };
}
