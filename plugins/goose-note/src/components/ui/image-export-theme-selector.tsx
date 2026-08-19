import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  CARD_THEMES,
  normalizeCardThemeId,
  type CardThemeId,
  type CardTheme,
  type WatermarkConfig,
  normalizeWatermarkConfig,
} from "@/lib/imageExport";
import { useSettings } from "@/stores/settings";

interface ImageExportThemeSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (themeId: CardThemeId, watermarkConfig: WatermarkConfig) => void;
  mode: "page" | "selection";
}

const PINNED_FIRST: Record<"light" | "dark", string> = {
  light: "github-light",
  dark: "github-dark",
};

function orderThemesForGroup(themes: CardTheme[]): CardTheme[] {
  const pinId = themes.length > 0 ? PINNED_FIRST[themes[0].mode] : undefined;
  if (!pinId) return themes;
  const pinned = themes.find((t) => t.id === pinId);
  if (!pinned) return themes;
  return [pinned, ...themes.filter((t) => t.id !== pinId)];
}

export function ImageExportThemeSelector({
  open,
  onOpenChange,
  onConfirm,
  mode,
}: ImageExportThemeSelectorProps) {
  const selectedId = normalizeCardThemeId(
    useSettings((s) => s.imageExportThemeId),
  );
  const setSelectedId = useSettings((s) => s.setImageExportThemeId);
  const storedWatermark = useSettings((s) => s.imageExportWatermark);
  const setWatermarkConfig = useSettings((s) => s.setImageExportWatermark);
  const wm = normalizeWatermarkConfig(storedWatermark);
  const [configOpen, setConfigOpen] = useState(false);

  const handleConfirm = () => {
    onConfirm(selectedId, wm);
    onOpenChange(false);
  };

  const modeText = mode === "page" ? "整页" : "选中内容";

  const toggleConfig = (key: keyof WatermarkConfig) => {
    setWatermarkConfig({ ...wm, [key]: !wm[key] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] p-0 overflow-hidden gap-0 flex flex-col max-h-[88vh]">
        <div className="px-6 pt-6 pb-4 shrink-0">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-[15px] font-semibold tracking-tight">选择卡片主题</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              为「{modeText}」选择一种视觉风格，共 {CARD_THEMES.length} 种主题可选
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-3 flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
          {(["light", "dark"] as const).map((mode) => {
            const themes = orderThemesForGroup(CARD_THEMES.filter((t) => t.mode === mode));
            if (themes.length === 0) return null;
            return (
              <section key={mode} className="mb-5 last:mb-1">
                <header className="flex items-center gap-2 mb-2.5 px-0.5">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${mode === "light" ? "bg-foreground/40" : "bg-foreground"}`} />
                  <span className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
                    {mode === "light" ? "浅色" : "深色"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">{themes.length}</span>
                  <span className="ml-1 flex-1 h-px bg-border/70" />
                </header>
                <div className="grid grid-cols-3 gap-4">
                  {themes.map((theme) => (
                    <ThemePreviewCard
                      key={theme.id}
                      theme={theme}
                      selected={selectedId === theme.id}
                      onClick={() =>
                        setSelectedId(normalizeCardThemeId(theme.id))
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* Watermark Config Panel */}
        <div className="px-6 py-3 border-t bg-muted/20 shrink-0 max-h-[40vh] overflow-y-auto [scrollbar-width:thin]">
          <button
            type="button"
            onClick={() => setConfigOpen((v) => !v)}
            className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <LucideIcons.Settings className="h-3 w-3" />
              生成选项
            </span>
            <LucideIcons.ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${configOpen ? "rotate-180" : ""}`}
            />
          </button>
          {configOpen && (
            <div className="mt-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground/80">显示标题</span>
                <Switch
                  checked={wm.showTitle}
                  onCheckedChange={() => toggleConfig("showTitle")}
                  className="scale-75 origin-right"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground/80">显示底部信息栏</span>
                <Switch
                  checked={wm.showWatermark}
                  onCheckedChange={() => toggleConfig("showWatermark")}
                  className="scale-75 origin-right"
                />
              </div>
              <div className="flex items-center justify-between pl-3">
                <span className="text-xs text-muted-foreground">显示品牌名</span>
                <Switch
                  checked={wm.showBrand}
                  onCheckedChange={() => toggleConfig("showBrand")}
                  disabled={!wm.showWatermark}
                  className="scale-75 origin-right"
                />
              </div>
              <div className="flex items-center justify-between pl-3">
                <span className="text-xs text-muted-foreground">显示日期</span>
                <Switch
                  checked={wm.showDate}
                  onCheckedChange={() => toggleConfig("showDate")}
                  disabled={!wm.showWatermark}
                  className="scale-75 origin-right"
                />
              </div>
              <div className="flex items-center justify-between pl-3">
                <span className="text-xs text-muted-foreground">追加时分秒</span>
                <Switch
                  checked={wm.showTime}
                  onCheckedChange={() => toggleConfig("showTime")}
                  disabled={!wm.showWatermark || !wm.showDate}
                  className="scale-75 origin-right"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 pt-3 shrink-0 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs"
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            className="h-8 text-xs"
          >
            <LucideIcons.Image className="mr-1.5 h-3.5 w-3.5" />
            生成图片
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ThemePreviewCard({
  theme,
  selected,
  onClick,
}: {
  theme: CardTheme;
  selected: boolean;
  onClick: () => void;
}) {
  const previewTitle = "设计即生活";
  const previewBody = "好的排版让阅读成为一种享受，每个细节都藏着设计师的用心。";

  const cardStyle: React.CSSProperties = {
    background: theme.background,
    borderRadius: 10,
    padding: 14,
    position: "relative",
    transition: "transform 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1)",
    boxShadow: selected
      ? "0 0 0 2px hsl(var(--primary)), 0 10px 22px rgba(15,23,42,0.12)"
      : "0 1px 2px rgba(15,23,42,0.04), inset 0 0 0 1px rgba(15,23,42,0.06)",
    minHeight: 152,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  };

  const innerCardStyle: React.CSSProperties = {
    background: theme.cardBg.includes("rgba")
      ? theme.cardBg
      : theme.cardBg === "transparent"
        ? "transparent"
        : theme.cardBg,
    borderRadius: Math.max(theme.cardRadius * 0.35, 4),
    padding: `${Math.max(theme.cardPaddingY * 0.28, 10)}px ${Math.max(theme.cardPaddingX * 0.28, 12)}px`,
    border: theme.cardBorder === "none" ? "none" : "1px solid rgba(0,0,0,0.06)",
    boxShadow: theme.cardShadow.includes("none") ? "none" : "0 1px 4px rgba(0,0,0,0.04)",
  };

  const titleStyle: React.CSSProperties = {
    fontFamily: theme.titleFont.split(",")[0].replace(/['"]/g, ""),
    fontSize: Math.max(theme.titleFontSize * 0.35, 11),
    fontWeight: theme.titleFontWeight,
    lineHeight: 1.3,
    letterSpacing: theme.titleLetterSpacing,
    color: theme.textColor,
    textAlign: theme.titleAlign,
    marginBottom: 4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const bodyStyle: React.CSSProperties = {
    fontFamily: theme.bodyFont.split(",")[0].replace(/['"]/g, ""),
    fontSize: Math.max(theme.bodyFontSize * 0.35, 9),
    lineHeight: 1.5,
    color: theme.secondaryText,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    letterSpacing: theme.bodyLetterSpacing,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-2.5 text-left outline-none focus-visible:outline-none"
    >
      <div style={cardStyle} className="cursor-pointer group-hover:-translate-y-0.5">
        <div style={innerCardStyle}>
          <div style={titleStyle}>{previewTitle}</div>
          <div style={bodyStyle}>{previewBody}</div>
        </div>
        {selected && (
          <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary shadow-[0_2px_6px_rgba(15,23,42,0.18)]">
            <LucideIcons.Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2 px-0.5">
        <span className={`text-[12px] font-medium leading-tight ${selected ? "text-foreground" : "text-foreground/85"}`}>
          {theme.name}
        </span>
        <span className="text-[10px] text-muted-foreground/80 leading-tight tracking-wide">
          {theme.nameEn}
        </span>
      </div>
    </button>
  );
}
