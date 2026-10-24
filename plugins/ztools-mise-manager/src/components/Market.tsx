import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, Download, RefreshCw } from "lucide-react";
import { toolIcon } from "@/lib/toolIcons";
import type { GlobalTask, RegistryTool } from "../types";

interface Props {
  onChanged: (silent?: boolean) => void;
  globalTask: GlobalTask | null;
  onStartInstall: (tool: string, version?: string) => Promise<void>;
}

export default function Market({ onChanged, globalTask, onStartInstall }: Props) {
  const [registry, setRegistry] = useState<RegistryTool[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // 展开的版本选择面板
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [versionsMap, setVersionsMap] = useState<Record<string, string[]>>({});
  const [loadingVersionsTool, setLoadingVersionsTool] = useState<string | null>(null);
  const [versionQuery, setVersionQuery] = useState("");

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

  // 加载远程版本
  const loadRemoteVersions = async (toolName: string) => {
    setLoadingVersionsTool(toolName);
    try {
      const res = await window.miseManager.getRemoteVersions(toolName);
      if (res.ok) {
        setVersionsMap((prev) => ({ ...prev, [toolName]: res.versions }));
      }
    } catch (e) {
      console.error("Failed to get remote versions", e);
    } finally {
      setLoadingVersionsTool(null);
    }
  };

  // 展开/收起面板
  const toggleExpand = (toolName: string) => {
    if (expandedTool === toolName) {
      setExpandedTool(null);
      return;
    }
    setExpandedTool(toolName);
    setVersionQuery("");
    if (!versionsMap[toolName]) {
      loadRemoteVersions(toolName);
    }
  };

  // 过滤后的版本列表（新版本排在前面）
  const filteredVersions = useMemo(() => {
    if (!expandedTool) return [];
    const list = versionsMap[expandedTool] || [];
    const reversed = [...list].reverse();
    const q = versionQuery.trim().toLowerCase();
    if (!q) return reversed;
    return reversed.filter((v) => v.toLowerCase().includes(q));
  }, [expandedTool, versionsMap, versionQuery]);

  const handleInstall = async (toolName: string, version?: string) => {
    if (globalTask?.running) return;
    try {
      await onStartInstall(toolName, version);
      onChanged();
    } catch (e) {
      // 错误由顶层 startInstallTask 捕获与提示
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
                const isExpanded = expandedTool === t.name;
                const isToolInstalling = globalTask?.running && globalTask.tool === t.name;

                return (
                  <Fragment key={t.name}>
                    <tr
                      className={`border-b hover:bg-accent/50 cursor-pointer transition-colors ${
                        isExpanded ? "bg-accent/40" : ""
                      }`}
                      onClick={() => toggleExpand(t.name)}
                    >
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="tool-icon-sm">
                            <Icon strokeWidth={2} />
                          </span>
                          <span className="mono font-semibold">{t.name}</span>
                          {isToolInstalling && (
                            <Badge variant="secondary" className="text-[10px] animate-pulse">
                              安装中…
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="max-w-[380px] px-4 py-2.5 text-xs text-muted-foreground">
                        {t.description || "—"}
                      </td>
                      <td className="mono hidden px-4 py-2.5 text-[11px] text-muted-foreground md:table-cell">
                        {t.backends[0] || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant={isExpanded ? "secondary" : "default"}
                          onClick={() => toggleExpand(t.name)}
                          className="gap-1 text-xs"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {isExpanded ? "收起" : "安装"}
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </td>
                    </tr>

                    {/* 展开的版本选择面板 */}
                    {isExpanded && (
                      <tr className="border-b bg-card/60">
                        <td colSpan={4} className="p-4 bg-muted/20">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  disabled={globalTask?.running}
                                  onClick={() => handleInstall(t.name, "latest")}
                                  className="gap-1 font-semibold"
                                >
                                  <Download className="h-3.5 w-3.5" /> 快捷安装 latest
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  {loadingVersionsTool === t.name
                                    ? "正在获取远程版本…"
                                    : `共 ${(versionsMap[t.name] || []).length} 个可用版本`}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input
                                  placeholder="搜索版本 (如 22.11.0)..."
                                  value={versionQuery}
                                  onChange={(e) => setVersionQuery(e.target.value)}
                                  className="h-8 w-48 text-xs"
                                />
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8"
                                  onClick={() => loadRemoteVersions(t.name)}
                                  disabled={loadingVersionsTool === t.name}
                                  title="刷新远程版本"
                                >
                                  <RefreshCw
                                    className={`h-3.5 w-3.5 ${
                                      loadingVersionsTool === t.name ? "animate-spin" : ""
                                    }`}
                                  />
                                </Button>
                              </div>
                            </div>

                            {loadingVersionsTool === t.name ? (
                              <div className="py-6 text-center text-xs text-muted-foreground">
                                🔄 正在获取 {t.name} 的远程版本列表…
                              </div>
                            ) : filteredVersions.length === 0 ? (
                              <div className="py-5 text-center text-xs text-muted-foreground">
                                {versionQuery ? "无匹配版本" : "暂无可用版本信息"}
                              </div>
                            ) : (
                              <div className="max-h-52 overflow-y-auto rounded-md border bg-card p-2">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                                  {filteredVersions.slice(0, 60).map((v) => {
                                    const isCurrentInstalling =
                                      globalTask?.running &&
                                      globalTask.tool === t.name &&
                                      globalTask.version === v;
                                    return (
                                      <div
                                        key={v}
                                        className="flex items-center justify-between rounded border px-2.5 py-1.5 text-xs hover:bg-accent/60 transition-colors"
                                      >
                                        <span className="mono font-medium truncate mr-1.5" title={v}>
                                          {v}
                                        </span>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-6 px-2 text-[11px] shrink-0"
                                          disabled={globalTask?.running}
                                          onClick={() => handleInstall(t.name, v)}
                                        >
                                          {isCurrentInstalling ? "安装中" : "安装"}
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                                {filteredVersions.length > 60 && (
                                  <div className="mt-2 text-center text-[11px] text-muted-foreground border-t pt-1.5">
                                    显示最新 60 个版本（共 {filteredVersions.length} 个匹配），可输入关键词精确搜索
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">无匹配工具</div>
          )}
        </Card>
      )}
    </div>
  );
}
