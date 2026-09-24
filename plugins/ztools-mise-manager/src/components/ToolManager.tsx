import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Download, FolderOpen, RefreshCw, Star, Trash2 } from "lucide-react";
import { toolIcon } from "@/lib/toolIcons";
import type { InstalledTool, TaskProgress } from "../types";

interface Props {
  tools: InstalledTool[];
  selectedTool: string | null;
  onSelectTool: (t: string) => void;
  onChanged: (silent?: boolean) => void;
}

export default function ToolManager({ tools, selectedTool, onSelectTool, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [remoteVersions, setRemoteVersions] = useState<string[]>([]);
  const [remoteQuery, setRemoteQuery] = useState("");
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [toolInfo, setToolInfo] = useState("");
  const [task, setTask] = useState<TaskProgress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const taskRef = useRef<{ tool: string; version: string } | null>(null);

  const tool = tools.find((t) => t.name === selectedTool) || null;

  const loadRemote = useCallback(async (name: string) => {
    if (!name) return;
    setLoadingRemote(true);
    setToolInfo("");
    try {
      const [res, info] = await Promise.all([
        window.miseManager.getRemoteVersions(name),
        window.miseManager.getToolInfo(name),
      ]);
      setRemoteVersions(res.ok ? res.versions : []);
      setToolInfo(info.text);
    } finally {
      setLoadingRemote(false);
    }
  }, []);

  useEffect(() => {
    if (tool) {
      setRemoteVersions([]);
      setRemoteQuery("");
      loadRemote(tool.name);
    }
  }, [tool?.name, loadRemote]);

  const filteredRemote = useMemo(() => {
    const q = remoteQuery.trim().toLowerCase();
    if (!q) return remoteVersions;
    return remoteVersions.filter((v) => v.toLowerCase().includes(q));
  }, [remoteVersions, remoteQuery]);

  const onProgressRef = useRef<(p: number) => void>(() => {});
  const onLogRef = useRef<(t: string) => void>(() => {});
  onProgressRef.current = (p) => {
    setTask((prev) => (prev ? { ...prev, percent: p } : prev));
  };
  onLogRef.current = (t) => {
    setTask((prev) => (prev ? { ...prev, logs: [...prev.logs.slice(-200), t] } : prev));
  };

  const runInstall = async (version: string, projectMode = false) => {
    if (!tool || task?.running) return;
    taskRef.current = { tool: tool.name, version };
    setTask({ tool: tool.name, version, percent: 0, logs: [], running: true });
    setBusy(`install:${version}`);
    try {
      if (projectMode) {
        const projPath = await window.miseManager.selectFolder();
        if (!projPath) {
          setTask(null);
          return;
        }
        await window.miseManager.setProject(tool.name, version, projPath);
        window.miseManager.notify("mise", `已写入 ${projPath} 的 .mise.toml: ${tool.name}@${version}`);
      } else {
        await window.miseManager.install(tool.name, version, {
          onProgress: onProgressRef.current,
          onLog: onLogRef.current,
        });
        window.miseManager.notify("mise", `安装成功: ${tool.name}@${version}`);
      }
      onChanged();
      setTimeout(() => setTask(null), 800);
    } catch (e) {
      setTask((prev) => (prev ? { ...prev, running: false, error: String(e) } : prev));
      window.miseManager.notify("mise 安装失败", String(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const runSetGlobal = async (version: string) => {
    if (!tool || busy) return;
    setBusy(`global:${version}`);
    try {
      await window.miseManager.setGlobal(tool.name, version);
      window.miseManager.notify("mise", `全局切换: ${tool.name}@${version}`);
      onChanged();
    } catch (e) {
      window.miseManager.notify("切换失败", String(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const runUninstall = async (version: string) => {
    if (!tool) return;
    if (!window.confirm(`确认卸载 ${tool.name}@${version}？`)) return;
    setBusy(`uninstall:${version}`);
    try {
      await window.miseManager.uninstall(tool.name, version);
      window.miseManager.notify("mise", `已卸载: ${tool.name}@${version}`);
      onChanged();
    } catch (e) {
      window.miseManager.notify("卸载失败", String(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const filteredTools = tools.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const installedVersions =
    tool?.versions.slice().sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })) || [];

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 190px)", minHeight: 380 }}>
      {/* 左侧工具列表 */}
      <Card className="flex w-56 shrink-0 flex-col overflow-hidden">
        <div className="p-3">
          <Input
            placeholder="过滤工具…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredTools.map((t) => {
            const Icon = toolIcon(t.name);
            return (
              <button
                key={t.name}
                onClick={() => onSelectTool(t.name)}
                className={`flex w-full items-center justify-between gap-2 border-b px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/60 ${
                  t.name === selectedTool ? "border-l-2 border-l-primary bg-accent text-accent-foreground" : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="tool-icon-sm">
                    <Icon strokeWidth={2} />
                  </span>
                  <span className="truncate font-semibold">{t.name}</span>
                </span>
                <span className="mono text-[11px] text-muted-foreground">{t.activeVersion || "—"}</span>
              </button>
            );
          })}
          {filteredTools.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">无匹配工具</div>
          )}
        </div>
      </Card>

      {/* 右侧详情 */}
      <Card className="flex-1 overflow-y-auto p-5">
        {!tool ? (
          <div className="py-16 text-center text-sm text-muted-foreground">← 从左侧选择一个工具</div>
        ) : (
          <div className="fade-in">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-lg font-bold">{tool.name}</h2>
              <span className="mono text-sm text-muted-foreground">{tool.activeVersion || "未激活"}</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => loadRemote(tool.name)}
                disabled={loadingRemote}
              >
                <RefreshCw className="h-3.5 w-3.5" /> 刷新
              </Button>
            </div>

            {toolInfo && (
              <>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">工具信息</div>
                <pre className="detail-pre">{toolInfo}</pre>
              </>
            )}

            <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              已安装版本
            </div>
            {installedVersions.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">暂无已安装版本</div>
            )}
            {installedVersions.map((v) => (
              <div key={v.version} className={`version-row ${v.active ? "active-row" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="mono text-sm font-semibold">
                    {v.version}
                    {v.active && (
                      <Badge variant="default" className="ml-2">
                        ● 激活
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {v.requested && v.requested !== v.version ? `配置请求: ${v.requested}` : ""}
                    {v.source ? ` · ${v.source}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {!v.active && (
                    <Button size="sm" disabled={!!busy} onClick={() => runSetGlobal(v.version)}>
                      <Star className="h-3.5 w-3.5" /> 设为全局
                    </Button>
                  )}
                  {v.installPath && (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title="打开安装目录"
                      onClick={() => window.miseManager.openInstallDir(tool.name, v.version)}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8"
                    title="卸载"
                    disabled={!!busy}
                    onClick={() => runUninstall(v.version)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              远程可装版本
              {!loadingRemote && remoteVersions.length > 0 && (
                <span className="ml-2 text-[11px] normal-case text-muted-foreground/70">
                  {remoteVersions.length} 个版本
                </span>
              )}
            </div>
            <Input
              className="mb-3 w-full"
              placeholder="过滤版本… 输入完整版本号精确安装，如 22.11.0"
              value={remoteQuery}
              onChange={(e) => setRemoteQuery(e.target.value)}
            />

            {loadingRemote ? (
              <div className="py-8 text-center text-sm text-muted-foreground">🔄 正在获取远程版本列表…</div>
            ) : remoteVersions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">无远程版本信息</div>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <div className="max-h-[300px] overflow-y-auto">
                  {filteredRemote
                    .slice()
                    .reverse()
                    .slice(0, 40)
                    .map((v) => (
                      <RemoteRow
                        key={v}
                        v={v}
                        installed={installedVersions.some((i) => i.version === v)}
                        busy={!!busy || !!task?.running}
                        onInstall={() => runInstall(v)}
                      />
                    ))}
                </div>
                {filteredRemote.length > 40 && (
                  <div className="border-t px-3 py-2 text-center text-[11px] text-muted-foreground">
                    仅显示最新 40 个版本，输入关键词可精确过滤
                  </div>
                )}
              </div>
            )}

            {task && (
              <div className="mt-4 fade-in rounded-md border p-3">
                <Progress value={task.percent} />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className={task.error ? "text-destructive" : "text-muted-foreground"}>
                    {task.running ? "⏳ 正在安装" : task.error ? "❌ 失败" : "✅ 完成"}: {task.tool}@{task.version}
                  </span>
                  <span className="mono text-muted-foreground">{task.percent}%</span>
                </div>
                {task.logs.length > 0 && <div className="log-box">{task.logs.join("")}</div>}
                {task.error && (
                  <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {task.error}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function RemoteRow({ v, installed, busy, onInstall }: { v: string; installed: boolean; busy: boolean; onInstall: () => void }) {
  return (
    <div className="flex items-center justify-between border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-accent/50">
      <span className="mono min-w-0 truncate">
        {v}
        {installed && (
          <Badge variant="secondary" className="ml-2">
            已装
          </Badge>
        )}
      </span>
      <Button size="sm" className="ml-2 shrink-0" disabled={installed || busy} onClick={onInstall}>
        <Download className="h-3.5 w-3.5" /> 安装
      </Button>
    </div>
  );
}
