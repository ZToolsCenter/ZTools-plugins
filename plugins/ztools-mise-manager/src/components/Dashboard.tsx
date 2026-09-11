import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FolderOpen, Wrench } from "lucide-react";
import { toolIcon } from "@/lib/toolIcons";
import type { InstalledTool, OutdatedItem } from "../types";

interface Props {
  tools: InstalledTool[];
  outdatedMap: Map<string, OutdatedItem>;
  loading: boolean;
  onOpenTool: (tool: string) => void;
}

export default function Dashboard({ tools, outdatedMap, loading, onOpenTool }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.activeVersion || "").toLowerCase().includes(q)
    );
  }, [tools, query]);

  const totalVersions = tools.reduce((s, t) => s + t.installCount, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-md"
          placeholder="搜索工具或版本… (如 node, 22)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="status-chip">
          {loading ? "加载中…" : `共 ${tools.length} 个工具 / ${totalVersions} 个版本`}
        </span>
      </div>

      {loading && tools.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">🔄 正在读取 mise 环境…</div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">没有匹配的工具</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((tool) => {
            const od = outdatedMap.get(tool.name);
            const active = tool.versions.find((v) => v.active);
            const requested = tool.versions.find((v) => v.requested && v.requested !== v.version);
            const Icon = toolIcon(tool.name);
            return (
              <Card key={tool.name} className="tool-card-body">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="tool-icon">
                      <Icon strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold">{tool.name}</div>
                      <div className="mono truncate text-xs text-muted-foreground">
                        {tool.activeVersion || "未激活"} · {tool.installCount} 版本
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tool.activeVersion ? (
                      <Badge variant="default">● 激活</Badge>
                    ) : (
                      <Badge variant="secondary">未激活</Badge>
                    )}
                    {od && (
                      <Badge variant="warn" title={`${od.current} → ${od.latest}`}>
                        ⬆ {od.latest}
                      </Badge>
                    )}
                    {requested && (
                      <Badge variant="outline" title="配置文件中的请求版本">
                        配置: {requested.requested}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTool(tool.name);
                      }}
                    >
                      <Wrench /> 管理
                    </Button>
                    {active?.installPath && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.miseManager.openInstallDir(tool.name, active.version);
                        }}
                      >
                        <FolderOpen /> 目录
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
