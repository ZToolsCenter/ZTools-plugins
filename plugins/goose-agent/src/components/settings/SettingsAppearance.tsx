import { Check } from "lucide-react";
import { Input, Label, Slider } from "@/lib/heroui";
import {
  CODE_FONT_PRESETS,
  FONT_SIZE_PRESETS,
  UI_FONT_PRESETS,
  resolveCodeFontStack,
  resolveUiFontStack,
  type CodeFontId,
  type FontSizeId,
  type UiFontId,
} from "@/lib/appearance/fonts";
import { applyAppearanceFonts } from "@/lib/appearance/applyAppearance";
import { clampUiZoom } from "@/lib/appearance/uiZoom";
import {
  WINDOW_HEIGHT_MAX,
  WINDOW_HEIGHT_MIN,
  applyWindowHeight,
  canSetWindowHeight,
} from "@/lib/platform/windowHeight";
import { useSettings } from "@/stores/settings";
import { SettingsSectionCard } from "./SettingsSectionCard";
import { cn } from "@/lib/utils";

const ROW_CLASS = "rounded-[12px] border border-border-soft bg-bg";
const PREVIEW_SAMPLE = "中英混排 AaBb 0123 src/app.ts";

/**
 * 外观 Tab：界面字体 / 等宽字体 / 字号 / 界面缩放 / 窗口高度；变更后立即 apply。
 * KEEP：字体/字号预设为结构化选中卡片（预览 + 勾选），不强制 RadioGroup 以免改版。
 */
export function SettingsAppearance() {
  const appearance = useSettings((s) => s.appearance);
  const setUiFont = useSettings((s) => s.setUiFont);
  const setCodeFont = useSettings((s) => s.setCodeFont);
  const setCustomCodeFont = useSettings((s) => s.setCustomCodeFont);
  const setFontSize = useSettings((s) => s.setFontSize);
  const setWindowHeight = useSettings((s) => s.setWindowHeight);
  const heightAdjustable = canSetWindowHeight();

  const applyNext = (
    patch: Partial<typeof appearance>,
  ) => {
    applyAppearanceFonts({ ...appearance, ...patch });
  };

  const handleUiFont = (id: UiFontId) => {
    setUiFont(id);
    applyNext({ uiFont: id });
  };

  const handleCodeFont = (id: CodeFontId) => {
    setCodeFont(id);
    applyNext({ codeFont: id });
  };

  const handleCustomCodeFont = (value: string) => {
    setCustomCodeFont(value);
    applyNext({ customCodeFont: value });
  };

  const handleFontSize = (id: FontSizeId) => {
    setFontSize(id);
    applyNext({ fontSize: id });
  };

  const handleWindowHeight = (raw: number | number[]) => {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    setWindowHeight(value);
    applyWindowHeight(value);
  };

  const uiPreviewStack = resolveUiFontStack(appearance.uiFont);
  const codePreviewStack = resolveCodeFontStack(
    appearance.codeFont,
    appearance.customCodeFont,
  );

  return (
    <div className="min-w-0 space-y-3.5">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">
          外观
        </h3>
        <p className="mt-0.5 text-[11.5px] leading-snug text-fg-faint">
          调整界面字体与等宽字体；字号作用于对话与输入区
        </p>
      </div>

      <SettingsSectionCard title="界面字体">
        <div className="space-y-1.5">
          {UI_FONT_PRESETS.map((preset) => {
            const selected = preset.id === appearance.uiFont;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleUiFont(preset.id)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left",
                  ROW_CLASS,
                  selected && "border-border bg-accent-subtle",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                  {preset.label}
                </span>
                {selected ? (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-fg"
                    strokeWidth={2}
                    aria-label="已选中"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <p
          className="mt-2 rounded-[10px] border border-border-soft bg-bg px-3 py-2 text-[13px] leading-relaxed text-fg"
          style={{ fontFamily: uiPreviewStack }}
        >
          {PREVIEW_SAMPLE}
        </p>
      </SettingsSectionCard>

      <SettingsSectionCard title="等宽字体">
        <div className="space-y-1.5">
          {CODE_FONT_PRESETS.map((preset) => {
            const selected = preset.id === appearance.codeFont;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleCodeFont(preset.id)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left",
                  ROW_CLASS,
                  selected && "border-border bg-accent-subtle",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                  {preset.label}
                </span>
                {selected ? (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-fg"
                    strokeWidth={2}
                    aria-label="已选中"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {appearance.codeFont === "custom" ? (
          <div className="mt-2 space-y-1.5">
            <Label
              htmlFor="custom-code-font"
              className="text-[12.5px] font-medium text-fg"
            >
              字体族名称
            </Label>
            <Input
              id="custom-code-font"
              fullWidth
              value={appearance.customCodeFont}
              onChange={(e) => handleCustomCodeFont(e.target.value)}
              placeholder="Maple Mono"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}

        <p
          className="mt-2 rounded-[10px] border border-border-soft bg-bg px-3 py-2 text-[13px] leading-relaxed text-fg"
          style={{ fontFamily: codePreviewStack }}
        >
          {PREVIEW_SAMPLE}
        </p>
      </SettingsSectionCard>

      <SettingsSectionCard title="字号">
        <div className="space-y-1.5">
          {FONT_SIZE_PRESETS.map((preset) => {
            const selected = preset.id === appearance.fontSize;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleFontSize(preset.id)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left",
                  ROW_CLASS,
                  selected && "border-border bg-accent-subtle",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                  {preset.label}
                </span>
                {selected ? (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-fg"
                    strokeWidth={2}
                    aria-label="已选中"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title="界面缩放"
        description="快捷键 ⌘/Ctrl + = / - / 0 调整；范围 80%–140%"
      >
        <p className="text-[13px] tabular-nums text-fg">
          当前 {Math.round(clampUiZoom(appearance.uiZoom) * 100)}%
        </p>
      </SettingsSectionCard>

      <SettingsSectionCard
        title="窗口高度"
        description={
          heightAdjustable
            ? "插件主窗口高度（像素）"
            : "插件主窗口高度（像素）；仅 uTools 环境生效"
        }
      >
        <Slider
          minValue={WINDOW_HEIGHT_MIN}
          maxValue={WINDOW_HEIGHT_MAX}
          step={10}
          value={appearance.windowHeight}
          onChange={handleWindowHeight}
          isDisabled={!heightAdjustable}
          aria-label="窗口高度"
        >
          <Label className="text-[12.5px] font-medium text-fg">高度</Label>
          <Slider.Output className="text-[12.5px] tabular-nums text-fg">
            {({ state }) => `${state.getThumbValueLabel(0)} px`}
          </Slider.Output>
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <p className="text-[11.5px] leading-snug text-fg-faint">
          {WINDOW_HEIGHT_MIN} – {WINDOW_HEIGHT_MAX} px
        </p>
      </SettingsSectionCard>
    </div>
  );
}
