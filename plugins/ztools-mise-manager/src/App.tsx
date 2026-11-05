import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/lib/theme";
import { Progress } from "@/components/ui/progress";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  FolderGit2,
  LayoutDashboard,
  Package,
  Puzzle,
  RefreshCw,
  Wrench,
  X,
} from "lucide-react";
import Dashboard from "./components/Dashboard";
import ToolManager from "./components/ToolManager";
import Market from "./components/Market";
import Projects from "./components/Projects";
import NodeMigrationDialog from "./components/NodeMigrationDialog";
import type { GlobalTask, InstalledTool, NodeMigrationInfo, OutdatedItem, SystemInfo } from "./types";

type TabKey = "dashboard" | "tools" | "market" | "projects";

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: "dashboard", label: "仪表盘", icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: "tools", label: "工具管理", icon: <Wrench className="h-4 w-4" /> },
  { key: "market", label: "工具市场", icon: <Puzzle className="h-4 w-4" /> },
  { key: "projects", label: "项目配置", icon: <FolderGit2 className="h-4 w-4" /> },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [tools, setTools] = useState<InstalledTool[]>([]);
  const [outdated, setOutdated] = useState<OutdatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [updatePercent, setUpdatePercent] = useState(0);
  const loadingRef = useRef(false);

  // 全局安装/迁移任务状态
  const [globalTask, setGlobalTask] = useState<GlobalTask | null>(null);
  const [taskLogsExpanded, setTaskLogsExpanded] = useState(false);

  // Node.js 迁移弹窗状态
  const [migrationInfo, setMigrationInfo] = useState<NodeMigrationInfo | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const [info, ls] = await Promise.all([
        window.miseManager.getSystemInfo(),
        window.miseManager.getInstalledTools(),
      ]);
      setSysInfo(info);
      if (ls.ok) setTools(ls.tools);
      const od = await window.miseManager.getOutdated();
      if (od.ok) setOutdated(od.list);
    } catch (e) {
      console.error("refresh failed", e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(true), 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openTool = (tool: string) => {
    setSelectedTool(tool);
    setTab("tools");
  };

  const outdatedMap = new Map(outdated.map((o) => [o.tool, o]));

  const isMac = window.miseManager.platform === "darwin";

  const runSelfUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    setUpdateLogs([]);
    setUpdatePercent(0);
    window.miseManager.notify("mise 更新", "开始更新 mise 本体…");
    try {
      await window.miseManager.selfUpdate({
        onLog: (t) => setUpdateLogs((prev) => [...prev.slice(-200), t]),
        onProgress: (p) => setUpdatePercent((prev) => Math.max(prev, p)),
      });
      window.miseManager.notify("mise 更新", "mise 已更新到最新版本");
      setUpdatePercent(100);
      refresh();
    } catch (e) {
      window.miseManager.notify("mise 更新失败", String(e).slice(0, 200));
    } finally {
      // 稍作停留展示完成进度，再收起面板
      setTimeout(() => setUpdating(false), 1200);
    }
  };

  // 顶层全局安装执行器
  const startInstallTask = useCallback(
    async (tool: string, version?: string, displayLabel?: string) => {
      const ver = version || "latest";
      const label = displayLabel || `安装 ${tool}@${ver}`;
      setGlobalTask({
        displayLabel: label,
        tool,
        version: ver,
        percent: 0,
        logs: [],
        running: true,
      });
      setTaskLogsExpanded(false);
      try {
        await window.miseManager.install(tool, version === "latest" ? undefined : version, {
          onLog: (text) => {
            setGlobalTask((prev) =>
              prev ? { ...prev, logs: [...prev.logs.slice(-200), text] } : prev
            );
          },
          onProgress: (percent) => {
            setGlobalTask((prev) =>
              prev ? { ...prev, percent: Math.max(prev.percent, percent) } : prev
            );
          },
        });
        setGlobalTask((prev) => (prev ? { ...prev, percent: 100, running: false } : prev));
        window.miseManager.notify("mise", `安装成功: ${tool}@${ver}`);
        refresh();
      } catch (err) {
        const errorMsg = String(err);
        setGlobalTask((prev) => (prev ? { ...prev, running: false, error: errorMsg } : prev));
        window.miseManager.notify("mise 安装失败", errorMsg.slice(0, 200));
        throw err;
      }
    },
    [refresh]
  );

  // 执行 Node 全局包与 corepack 迁移
  const handleNodeMigrationConfirm = async (
    selectedPackages: string[],
    enableCorepack: boolean
  ) => {
    if (!migrationInfo) return;
    const { newVersion } = migrationInfo;
    setMigrationInfo(null);

    setGlobalTask({
      displayLabel: `迁移全局包到 node@${newVersion}`,
      tool: "node",
      version: newVersion,
      percent: 0,
      logs: [],
      running: true,
    });
    setTaskLogsExpanded(true);

    try {
      if (enableCorepack) {
        setGlobalTask((prev) =>
          prev
            ? {
                ...prev,
                logs: [...prev.logs, `正在新版本 node@${newVersion} 中启用 corepack...\n`],
              }
            : prev
        );
        await window.miseManager.enableCorepack(newVersion);
        setGlobalTask((prev) =>
          prev
            ? {
                ...prev,
                logs: [...prev.logs, `corepack 启用成功。\n`],
              }
            : prev
        );
      }

      if (selectedPackages.length > 0) {
        setGlobalTask((prev) =>
          prev
            ? {
                ...prev,
                logs: [...prev.logs, `开始安装全局包: ${selectedPackages.join(", ")}...\n`],
              }
            : prev
        );
        await window.miseManager.installGlobalPackages(newVersion, selectedPackages, {
          onLog: (text) => {
            setGlobalTask((prev) =>
              prev ? { ...prev, logs: [...prev.logs.slice(-200), text] } : prev
            );
          },
          onProgress: (percent) => {
            setGlobalTask((prev) =>
              prev ? { ...prev, percent: Math.max(prev.percent, percent) } : prev
            );
          },
        });
        setGlobalTask((prev) =>
          prev
            ? {
                ...prev,
                logs: [...prev.logs, `\n全局包迁移安装成功！\n`],
              }
            : prev
        );
      }

      setGlobalTask((prev) => (prev ? { ...prev, percent: 100, running: false } : prev));
      window.miseManager.notify("mise", `Node.js@${newVersion} 全局包迁移完成`);
      refresh();
    } catch (err) {
      const errorMsg = String(err);
      setGlobalTask((prev) => (prev ? { ...prev, running: false, error: errorMsg } : prev));
      window.miseManager.notify("迁移失败", errorMsg.slice(0, 200));
    }
  };

  return (
    <div className="app-shell">
      <header className="flex items-center gap-3 border-b px-5 py-3 flex-shrink-0 bg-card/50">
        <img src="./logo.png" alt="logo" className="logo-img h-9 w-9 shrink-0" />
        <div className="shrink-0 whitespace-nowrap leading-tight">
          <div className="whitespace-nowrap text-[17px] font-bold tracking-wide">Mise 控制台</div>
          <div className="whitespace-nowrap text-xs text-muted-foreground">开发工具版本管理</div>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2 flex-wrap">
          {sysInfo?.missing ? (
            <span className="status-chip">
              <span className="dot err" /> mise 未检测到
            </span>
          ) : (
            <>
              <span className="status-chip" title="mise 版本">
                <span className="dot" /> mise v{sysInfo?.version || "…"}
              </span>
              <span className="status-chip" title="已装工具数量">
                <Package className="h-3.5 w-3.5" /> {tools.length} 个工具
              </span>
              <span className="status-chip" title="可升级工具">
                <span className={`dot ${outdated.length ? "warn" : ""}`} /> 升级 {outdated.length}
              </span>
              <span className="status-chip hidden md:inline-flex" title="配置文件路径">
                <FileText className="h-3.5 w-3.5" /> {sysInfo?.configPath || "…"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={runSelfUpdate}
                disabled={updating}
                title="更新 mise 本体到最新版本"
                className="h-7 gap-1 px-2 text-xs"
              >
                <Download className={`h-3.5 w-3.5 ${updating ? "animate-bounce" : ""}`} />
                {updating ? "更新中" : "更新"}
              </Button>
            </>
          )}
          <Button variant="outline" size="icon" onClick={() => refresh()} title="刷新">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* 全局安装 / 迁移任务 Banner（跨 Tab 始终可见） */}
      {globalTask && (
        <div className="border-b bg-card/90 px-5 py-2.5 flex-shrink-0 backdrop-blur-sm transition-all shadow-xs">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {globalTask.running ? (
                <Download className="h-4 w-4 animate-bounce text-primary shrink-0" />
              ) : globalTask.error ? (
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              )}
              <span className="font-semibold text-foreground truncate">
                {globalTask.displayLabel ||
                  `${globalTask.running ? "正在安装" : "已完成"} ${globalTask.tool}@${globalTask.version}`}
              </span>
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                  globalTask.running
                    ? "bg-primary/10 text-primary"
                    : globalTask.error
                    ? "bg-destructive/10 text-destructive"
                    : "bg-emerald-500/10 text-emerald-500"
                }`}
              >
                {globalTask.running ? "执行中" : globalTask.error ? "失败" : "已完成"}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <span className="mono font-medium text-muted-foreground">{globalTask.percent}%</span>
              {globalTask.logs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setTaskLogsExpanded(!taskLogsExpanded)}
                >
                  {taskLogsExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3 mr-1" /> 收起日志
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3 mr-1" /> 展开日志
                    </>
                  )}
                </Button>
              )}
              {!globalTask.running && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setGlobalTask(null)}
                  title="关闭任务条"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <Progress value={globalTask.percent} className="h-1.5 mt-2" />
          {globalTask.error && (
            <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              {globalTask.error}
            </div>
          )}
          {taskLogsExpanded && globalTask.logs.length > 0 && (
            <div className="log-box mt-2 max-h-40 overflow-y-auto">{globalTask.logs.join("")}</div>
          )}
        </div>
      )}

      {/* mise 本体更新进度 */}
      {updating && (
        <div className="border-b bg-card/40 px-5 py-2 flex-shrink-0">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Download className="h-3.5 w-3.5 animate-bounce" />
            <span className="font-medium text-foreground">正在更新 mise 本体…</span>
            <span className="mono text-foreground">当前版本 v{sysInfo?.version}</span>
            <span className="mono">{updatePercent}%</span>
          </div>
          <Progress value={updatePercent} className="h-1.5" />
          {updateLogs.length > 0 && <div className="log-box mt-2">{updateLogs.join("")}</div>}
        </div>
      )}

      <div className="px-5 pt-2 flex-shrink-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="cursor-pointer">
                {t.icon} {t.label}
                {t.key === "dashboard" && outdated.length > 0 && (
                  <span className="ml-1 rounded-full bg-chart-4 px-1.5 text-[10px] font-semibold text-white dark:text-black">
                    {outdated.length}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Tab 内容区 hidden 模式，保持各页面状态与滚动位置 */}
      <main className="content-area fade-in">
        {sysInfo?.missing ? (
          <div className="mb-4 rounded-lg border border-chart-4/40 bg-chart-4/10 px-4 py-3 text-sm text-chart-4">
            <strong>未检测到 mise。</strong> 请先安装 mise：
            {isMac ? (
              <>
                <code className="mx-1 rounded bg-card px-1.5 py-0.5 font-mono">
                  brew install mise
                </code>{" "}
                或使用{" "}
                <code className="mx-1 rounded bg-card px-1.5 py-0.5 font-mono">
                  curl https://mise.jdx.dev/install.sh | sh
                </code>
              </>
            ) : (
              <code className="mx-1 rounded bg-card px-1.5 py-0.5 font-mono">
                winget install jdx.mise
              </code>
            )}{" "}
            或访问{" "}
            <a
              href="#"
              className="underline underline-offset-2"
              onClick={(e) => {
                e.preventDefault();
                window.miseManager.openExternal("https://mise.jdx.dev");
              }}
            >
              https://mise.jdx.dev
            </a>
          </div>
        ) : null}

        <div hidden={tab !== "dashboard"} className="h-full">
          <Dashboard
            tools={tools}
            outdatedMap={outdatedMap}
            loading={loading}
            onOpenTool={openTool}
          />
        </div>
        <div hidden={tab !== "tools"} className="h-full">
          <ToolManager
            tools={tools}
            selectedTool={selectedTool}
            onSelectTool={setSelectedTool}
            onChanged={refresh}
            globalTask={globalTask}
            onStartInstall={startInstallTask}
            onNodeMigration={setMigrationInfo}
          />
        </div>
        <div hidden={tab !== "market"} className="h-full">
          <Market
            onChanged={refresh}
            globalTask={globalTask}
            onStartInstall={startInstallTask}
          />
        </div>
        <div hidden={tab !== "projects"} className="h-full">
          <Projects onChanged={refresh} />
        </div>
      </main>

      {/* Node.js 迁移弹窗 */}
      {migrationInfo && (
        <NodeMigrationDialog
          info={migrationInfo}
          onConfirm={handleNodeMigrationConfirm}
          onCancel={() => setMigrationInfo(null)}
        />
      )}
    </div>
  );
}
