import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Download, RefreshCw } from "lucide-react";
import { toolIcon } from "@/lib/toolIcons";
import type { RegistryTool, TaskProgress } from "../types";

interface Props {
  onChanged: (silent?: boolean) => void;
}

export default function Market({ onChanged }: Props) {
  const [registry, setRegistry] = useState<RegistryTool[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<TaskProgress | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const logRef = useRef<(t: string) => void>(() => {});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.miseManager.getRegistry();
      if (res.ok) setRegistry(res.tools);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return registry;
    return registry.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.aliases || []).some((a) => a.toLowerCase().includes(q)) ||
        (t.backends || []).some((b) => b.toLowerCase().includes(q))
    );
  }, [registry, query]);

  logRef.current = (t) => {
    setTask((prev) => (prev ? { ...prev, logs: [...prev.logs.slice(-200), t] } : prev));
  };

  const runInstall = async (name: string) => {
    if (task?.running) return;
    setTask({ tool: name, version: "latest", percent: 0, logs: [], running: true });
    setBusyName(name);
    try {
      await window.miseManager.install(name, undefined, {
        onLog: logRef.current,
        onProgress: (p) => setTask((prev) => (prev ? { ...prev, percent: p } : prev)),
      });
      window.miseManager.notify("mise", `安装成功: ${name} (latest)`);
      onChanged();
      setTimeout(() => setTask(null), 800);
    } catch (e) {
      setTask((prev) => (prev ? { ...prev, running: false, error: String(e) } : prev));
      window.miseManager.notify("mise 安装失败", String(e).slice(0, 200));
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-md"
          placeholder="搜索工具市场… (如 node, python, ripgrep)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </Button>
        <span className="status-chip">{loading ? "加载中…" : `${filtered.length} / ${registry.length} 个工具`}</span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">🔄 正在加载工具市场…</div>
      ) : (
        <Card className="overflow-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="sticky top-0 bg-card px-4 py-2.5 font-semibold">名称</th>
                <th className="sticky top-0 bg-card px-4 py-2.5 font-semibold">描述</th>
                <th className="sticky top-0 hidden bg-card px-4 py-2.5 font-semibold md:table-cell">后端</th>
                <th className="sticky top-0 bg-card px-4 py-2.5 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const Icon = toolIcon(t.name);
                return (
                  <tr key={t.name} className="border-b last:border-b-0 hover:bg-accent/50">
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <span className="tool-icon-sm">
                          <Icon strokeWidth={2} />
                        </span>
                        <span className="mono font-semibold">{t.name}</span>
                      </span>
                    </td>
                    <td className="max-w-[380px] px-4 py-2 text-xs text-muted-foreground">
                      {t.description || "—"}
                    </td>
                    <td className="mono hidden px-4 py-2 text-[11px] text-muted-foreground md:table-cell">
                      {t.backends[0] || "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" disabled={!!busyName} onClick={() => runInstall(t.name)}>
                        <Download className="h-3.5 w-3.5" /> 安装
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">无匹配工具</div>
          )}
        </Card>
      )}

          {task && (
            <div className="mt-4 fade-in rounded-md border p-3">
              <Progress value={task.percent} />
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className={task.error ? "text-destructive" : "text-muted-foreground"}>
                  {task.running ? "⏳ 正在安装" : task.error ? "❌ 失败" : "✅ 完成"}: {task.tool} (latest)
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
  );
}
