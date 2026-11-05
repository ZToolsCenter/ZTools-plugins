import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowRightLeft, CheckSquare, FileText, Info, Package, X } from "lucide-react";
import type { NodeMigrationInfo } from "../types";

interface Props {
  info: NodeMigrationInfo;
  onConfirm: (selectedPackages: string[], enableCorepack: boolean) => void;
  onCancel: () => void;
}

export default function NodeMigrationDialog({ info, onConfirm, onCancel }: Props) {
  const [selectedPackages, setSelectedPackages] = useState<Set<string>>(
    () => new Set(info.packages)
  );
  const [enableCorepack, setEnableCorepack] = useState<boolean>(info.hasCorepack);
  const [showNpmrcDetails, setShowNpmrcDetails] = useState<boolean>(false);

  const registry = useMemo(() => {
    if (!info.npmrcSummary) return null;
    const match = info.npmrcSummary.match(/registry\s*=\s*([^\r\n]+)/i);
    return match ? match[1].trim() : null;
  }, [info.npmrcSummary]);

  const handleToggle = (pkg: string) => {
    setSelectedPackages((prev) => {
      const next = new Set(prev);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedPackages(new Set(info.packages));
  };

  const handleDeselectAll = () => {
    setSelectedPackages(new Set());
  };

  const handleInvertSelection = () => {
    setSelectedPackages((prev) => {
      const next = new Set<string>();
      for (const p of info.packages) {
        if (!prev.has(p)) next.add(p);
      }
      return next;
    });
  };

  const canMigrate = selectedPackages.size > 0 || enableCorepack;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 fade-in">
      <div className="w-full max-w-lg rounded-xl border bg-card p-5 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
        {/* 头部标题与版本指引 */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="tool-icon-sm">
                <ArrowRightLeft className="h-4 w-4" />
              </span>
              <h3 className="text-base font-bold text-foreground">Node.js 全局包与配置迁移</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
              <span>原版本</span>
              <Badge variant="outline" className="mono text-xs">
                node@{info.oldVersion}
              </Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>新版本</span>
              <Badge variant="default" className="mono text-xs">
                node@{info.newVersion}
              </Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 弹窗主体内容 */}
        <div className="space-y-3.5 overflow-y-auto flex-1 pr-1">
          {/* 原版本全局包列表 */}
          <div className="rounded-lg border bg-secondary/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-primary" />
                检测到原版本全局包 ({selectedPackages.size}/{info.packages.length})
              </span>
              {info.packages.length > 0 && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px] text-muted-foreground"
                    onClick={handleSelectAll}
                  >
                    全选
                  </Button>
                  <span className="text-muted-foreground/40 text-xs">|</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px] text-muted-foreground"
                    onClick={handleDeselectAll}
                  >
                    全不选
                  </Button>
                  <span className="text-muted-foreground/40 text-xs">|</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px] text-muted-foreground"
                    onClick={handleInvertSelection}
                  >
                    反选
                  </Button>
                </div>
              )}
            </div>

            {info.packages.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                原版本未检测到需要迁移的第三方全局包
              </div>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded border bg-card p-1 space-y-0.5">
                {info.packages.map((pkg) => (
                  <label
                    key={pkg}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 rounded hover:bg-accent/60 cursor-pointer text-xs transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPackages.has(pkg)}
                      onChange={() => handleToggle(pkg)}
                      className="rounded accent-primary"
                    />
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="mono font-medium truncate flex-1">{pkg}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Corepack 选项 */}
          {info.hasCorepack && (
            <label className="flex items-start gap-2.5 p-3 rounded-lg border bg-accent/20 cursor-pointer text-xs select-none hover:bg-accent/30 transition-colors">
              <input
                type="checkbox"
                checked={enableCorepack}
                onChange={(e) => setEnableCorepack(e.target.checked)}
                className="rounded mt-0.5 accent-primary"
              />
              <div className="space-y-0.5">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                  在新版本中执行 corepack enable
                </div>
                <div className="text-muted-foreground text-[11px]">
                  原版本已启用 Corepack。勾选后将自动激活新版本的 yarn 与 pnpm 命令包装。
                </div>
              </div>
            </label>
          )}

          {/* .npmrc 配置信息与提示 */}
          <div className="rounded-lg border bg-secondary/20 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span>npm 配置 (~/.npmrc)</span>
              </div>
              {info.npmrcSummary && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1 text-[11px] text-muted-foreground"
                  onClick={() => setShowNpmrcDetails(!showNpmrcDetails)}
                >
                  {showNpmrcDetails ? "收起详情" : "查看详情"}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1.5 rounded bg-chart-2/10 border border-chart-2/30 px-2.5 py-1.5 text-xs text-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 text-chart-2" />
              <span>用户级 .npmrc 已自动生效，无需迁移</span>
            </div>

            <div className="text-[11px] text-muted-foreground pt-0.5">
              <span>当前镜像源: </span>
              <span className="mono font-medium text-foreground">{registry || "官方默认源 (https://registry.npmjs.org/)"}</span>
            </div>

            {showNpmrcDetails && info.npmrcSummary && (
              <pre className="mt-1 p-2 rounded bg-card border mono text-[11px] max-h-24 overflow-y-auto text-muted-foreground whitespace-pre-wrap">
                {info.npmrcSummary.trim()}
              </pre>
            )}
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消 / 跳过
          </Button>
          <Button
            size="sm"
            disabled={!canMigrate}
            onClick={() => onConfirm(Array.from(selectedPackages), enableCorepack)}
          >
            一键迁移{selectedPackages.size > 0 ? ` (${selectedPackages.size} 个包)` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}
