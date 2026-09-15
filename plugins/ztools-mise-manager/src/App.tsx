import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/lib/theme";
import { Progress } from "@/components/ui/progress";
import { Download, FileText, FolderGit2, LayoutDashboard, Package, Puzzle, RefreshCw, Wrench } from "lucide-react";
import Dashboard from "./components/Dashboard";
import ToolManager from "./components/ToolManager";
import Market from "./components/Market";
import Projects from "./components/Projects";
import type { InstalledTool, OutdatedItem, SystemInfo } from "./types";

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

      {updating && (
        <div className="border-b bg-card/40 px-5 py-2 flex-shrink-0">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Download className="h-3.5 w-3.5 animate-bounce" />
            <span className="font-medium text-foreground">正在更新 mise 本体…</span>
            <span className="mono text-foreground">当前版本 v{sysInfo?.version}</span>
            <span className="mono">{updatePercent}%</span>
          </div>
          <Progress value={updatePercent} className="h-1.5" />
          {updateLogs.length > 0 && (
            <div className="log-box mt-2">{updateLogs.join("")}</div>
          )}
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

      <main className="content-area fade-in">
        {sysInfo?.missing ? (
          <div className="mb-4 rounded-lg border border-chart-4/40 bg-chart-4/10 px-4 py-3 text-sm text-chart-4">
            <strong>未检测到 mise。</strong> 请先安装 mise：
            {isMac ? (
              <>
                <code className="mx-1 rounded bg-card px-1.5 py-0.5 font-mono">brew install mise</code>
                {" "}或使用{" "}
                <code className="mx-1 rounded bg-card px-1.5 py-0.5 font-mono">curl https://mise.jdx.dev/install.sh | sh</code>
              </>
            ) : (
              <code className="mx-1 rounded bg-card px-1.5 py-0.5 font-mono">winget install jdx.mise</code>
            )}
            {" "}或访问{" "}
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

        {tab === "dashboard" && (
          <Dashboard tools={tools} outdatedMap={outdatedMap} loading={loading} onOpenTool={openTool} />
        )}
        {tab === "tools" && (
          <ToolManager tools={tools} selectedTool={selectedTool} onSelectTool={setSelectedTool} onChanged={refresh} />
        )}
        {tab === "market" && <Market onChanged={refresh} />}
        {tab === "projects" && <Projects onChanged={refresh} />}
      </main>
    </div>
  );
}
