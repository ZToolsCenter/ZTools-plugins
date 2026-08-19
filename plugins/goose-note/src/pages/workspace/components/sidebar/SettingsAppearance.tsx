import type { CSSProperties, KeyboardEvent } from "react";
import type { AccentColor, CodeStyle } from "@/stores/useSettings";
import { SelectableCard } from "@/components/ui/selectable-card";
import { SettingsSectionCard } from "./settings/SettingsSectionCard";
import { DEFAULT_FONT_NAMES } from "@/lib/fontLoader";
import { formatShortcut } from "@/lib/utils";

interface SettingsAppearanceProps {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  accentColor: AccentColor;
  setAccentColor: (accentColor: AccentColor) => void;
  codeStyle: CodeStyle;
  setCodeStyle: (style: CodeStyle) => void;
  tableEvenColumnWidth: boolean;
  setTableEvenColumnWidth: (enabled: boolean) => void;
  customFonts: Record<
    "default" | "serif" | "mono",
    { label: string | null; font: string | null }
  >;
  setCustomLabel: (
    type: "default" | "serif" | "mono",
    label: string | null,
  ) => void;
  setCustomFont: (
    type: "default" | "serif" | "mono",
    font: string | null,
  ) => void;
  uiFontSize: "small" | "normal";
  setUIFontSize: (size: "small" | "normal") => void;
  hideExpandArrows: boolean;
  setHideExpandArrows: (hidden: boolean) => void;
}

type AccentOption = {
  value: AccentColor;
  label: string;
  previewLight: string;
  previewDark: string;
  lightSurface: string;
  lightForeground: string;
  darkSurface: string;
  darkForeground: string;
};

const accentOptions: AccentOption[] = [
  {
    value: "mono",
    label: "黑白",
    previewLight: "#171717",
    previewDark: "#f5f5f5",
    lightSurface: "#e5e5e5",
    lightForeground: "#171717",
    darkSurface: "rgba(255, 255, 255, 0.16)",
    darkForeground: "#f5f5f5",
  },
  {
    value: "iris",
    label: "鸢尾",
    previewLight: "#6366f1",
    previewDark: "#a5b4fc",
    lightSurface: "#e0e7ff",
    lightForeground: "#4f46e5",
    darkSurface: "rgba(99, 102, 241, 0.2)",
    darkForeground: "#a5b4fc",
  },
  {
    value: "ocean",
    label: "海蓝",
    previewLight: "#3b82f6",
    previewDark: "#93c5fd",
    lightSurface: "#dbeafe",
    lightForeground: "#2563eb",
    darkSurface: "rgba(59, 130, 246, 0.2)",
    darkForeground: "#93c5fd",
  },
  {
    value: "pine",
    label: "松绿",
    previewLight: "#15803d",
    previewDark: "#86efac",
    lightSurface: "#dcfce7",
    lightForeground: "#15803d",
    darkSurface: "rgba(34, 197, 94, 0.2)",
    darkForeground: "#86efac",
  },
  {
    value: "amber",
    label: "琥珀",
    previewLight: "#b45309",
    previewDark: "#fbbf24",
    lightSurface: "#fef3c7",
    lightForeground: "#b45309",
    darkSurface: "rgba(245, 158, 11, 0.2)",
    darkForeground: "#fbbf24",
  },
  {
    value: "coral",
    label: "朱砂",
    previewLight: "#c2410c",
    previewDark: "#fdba74",
    lightSurface: "#ffedd5",
    lightForeground: "#c2410c",
    darkSurface: "rgba(249, 115, 22, 0.2)",
    darkForeground: "#fdba74",
  },
  {
    value: "rose",
    label: "莓红",
    previewLight: "#be123c",
    previewDark: "#fda4af",
    lightSurface: "#ffe4e6",
    lightForeground: "#be123c",
    darkSurface: "rgba(244, 63, 94, 0.2)",
    darkForeground: "#fda4af",
  },
  {
    value: "grape",
    label: "葡萄",
    previewLight: "#7e22ce",
    previewDark: "#d8b4fe",
    lightSurface: "#f3e8ff",
    lightForeground: "#7e22ce",
    darkSurface: "rgba(168, 85, 247, 0.2)",
    darkForeground: "#d8b4fe",
  },
];

type AccentOptionStyle = CSSProperties & {
  "--goose-accent-option-light-surface": string;
  "--goose-accent-option-light-fg": string;
  "--goose-accent-option-dark-surface": string;
  "--goose-accent-option-dark-fg": string;
};

const codeStyles: { value: CodeStyle; label: string; description: string }[] = [
  {
    value: "github",
    label: "GitHub",
    description: "GitHub 官方深浅配色",
  },
  {
    value: "catppuccin",
    label: "Catppuccin",
    description: "浅色 Latte，深色 Mocha",
  },
  {
    value: "modern",
    label: "One Dark Pro",
    description: "流行的暗色开发者风格，浅色自动配对",
  },
  {
    value: "dracula",
    label: "Dracula",
    description: "暗色使用 Dracula，浅色搭配柔和亮色",
  },
  {
    value: "night",
    label: "Tokyo Night",
    description: "东京夜系风格，自动适配日夜",
  },
  { value: "nord", label: "Nord", description: "兼容旧版 Nord，深浅自动配对" },
];

const LEGACY_CODE_STYLE_DISPLAY_MAP: Partial<Record<CodeStyle, CodeStyle>> = {
  default: "github",
  "nord-light": "nord",
};

const defaultLabels = { default: "默认", serif: "衬线体", mono: "等宽体" };
const fontPlaceholders = {
  default: "例：PingFang SC",
  serif: "例：Songti SC",
  mono: "例：JetBrains Mono",
};
const fontPreviewText = {
  default:
    "字体预览 Font Preview：Project Notes v2.1, Weekly Plan, Design Review, Alpha Beta Gamma 0123456789",
  serif:
    "衬线预览 Serif Sample：山高水长，风物有信；Reading Journal, Chapter 08, Classic Typography 0123456789",
  mono: "Monospace Preview: const releaseTag = 'build_2026_Q1_rc07'; function renderPreview(){ return 'AaBbCc 0123456789'; }",
};

const APPEARANCE_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]";

const APPEARANCE_SWITCH_CLASS =
  "data-[state=unchecked]:bg-[hsl(var(--foreground)/0.12)]";

export function SettingsAppearance({
  theme,
  setTheme,
  accentColor,
  setAccentColor,
  codeStyle,
  setCodeStyle,
  tableEvenColumnWidth,
  setTableEvenColumnWidth,
  customFonts,
  setCustomLabel,
  setCustomFont,
  uiFontSize,
  setUIFontSize,
  hideExpandArrows,
  setHideExpandArrows,
}: SettingsAppearanceProps) {
  const getFontPreview = (type: "default" | "serif" | "mono") =>
    customFonts[type].font || DEFAULT_FONT_NAMES[type];
  const displayedCodeStyle =
    LEGACY_CODE_STYLE_DISPLAY_MAP[codeStyle] ?? codeStyle;
  const accentRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedAccentIndex, setFocusedAccentIndex] = useState(() =>
    Math.max(
      0,
      accentOptions.findIndex((option) => option.value === accentColor),
    ),
  );

  const focusAccentOption = (index: number) => {
    const nextIndex = (index + accentOptions.length) % accentOptions.length;
    setFocusedAccentIndex(nextIndex);
    accentRefs.current[nextIndex]?.focus();
  };

  const handleAccentKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusAccentOption(index + 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusAccentOption(index - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusAccentOption(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusAccentOption(accentOptions.length - 1);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setAccentColor(accentOptions[index].value);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">
          外观
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          自定义界面的外观和感觉。
        </p>
      </div>

      <SettingsSectionCard
        title="主题设置"
        description="选择深浅模式，并调整界面字体大小。"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LucideIcons.SunMoon
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            <Label htmlFor="dark-mode">深色模式</Label>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[hsl(var(--goose-selected-bg)/0.76)] p-1">
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="跟随系统"
                    className={cn(
                      "h-7 w-7 rounded-full transition-all duration-200",
                      theme === "system" &&
                        "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] shadow-sm",
                    )}
                    onClick={() => setTheme("system")}
                  >
                    <LucideIcons.Laptop className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">跟随系统</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="浅色模式"
                    className={cn(
                      "h-7 w-7 rounded-full transition-all duration-200",
                      theme === "light" &&
                        "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] shadow-sm",
                    )}
                    onClick={() => setTheme("light")}
                  >
                    <LucideIcons.Sun className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">浅色模式</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="深色模式"
                    className={cn(
                      "h-7 w-7 rounded-full transition-all duration-200",
                      theme === "dark" &&
                        "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] shadow-sm",
                    )}
                    onClick={() => setTheme("dark")}
                  >
                    <LucideIcons.Moon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">深色模式</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className={`p-4 ${APPEARANCE_OPTION_ROW_CLASS}`}>
          <div className="mb-3 flex items-start gap-3">
            <LucideIcons.Palette
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            <div>
              <div
                id="appearance-accent-color-label"
                className="text-sm font-medium text-foreground"
              >
                强调色
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                用于按钮、链接、选中项和焦点状态
              </p>
            </div>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="appearance-accent-color-label"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {accentOptions.map((option, index) => {
              const selected = accentColor === option.value;
              const style: AccentOptionStyle = {
                "--goose-accent-option-light-surface": option.lightSurface,
                "--goose-accent-option-light-fg": option.lightForeground,
                "--goose-accent-option-dark-surface": option.darkSurface,
                "--goose-accent-option-dark-fg": option.darkForeground,
              };

              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    accentRefs.current[index] = node;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  data-state={selected ? "checked" : "unchecked"}
                  tabIndex={focusedAccentIndex === index ? 0 : -1}
                  style={style}
                  onFocus={() => setFocusedAccentIndex(index)}
                  onKeyDown={(event) => handleAccentKeyDown(event, index)}
                  onClick={() => {
                    setFocusedAccentIndex(index);
                    setAccentColor(option.value);
                  }}
                  className="goose-accent-option flex h-11 min-w-0 items-center gap-2 rounded-[10px] px-2.5 text-left text-xs font-medium text-foreground transition-[background-color,color,box-shadow,transform]"
                >
                  <span
                    aria-hidden="true"
                    className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)]"
                  >
                    <span
                      className="absolute inset-y-0 left-0 w-1/2"
                      style={{ backgroundColor: option.previewLight }}
                    />
                    <span
                      className="absolute inset-y-0 right-0 w-1/2"
                      style={{ backgroundColor: option.previewDark }}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  <LucideIcons.Check
                    aria-hidden="true"
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={`flex items-center justify-between gap-4 p-4 ${APPEARANCE_OPTION_ROW_CLASS}`}
        >
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.ALargeSmall
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label>界面字体大小</Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              调整整体界面的文字大小；{formatShortcut("Mod+Plus")} /{" "}
              {formatShortcut("Mod+-")} / {formatShortcut("Mod+0")}
              会调整并保存编辑器字号。
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[hsl(var(--goose-selected-bg)/0.76)] p-1">
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 rounded-full px-3 text-xs transition-all duration-200",
                uiFontSize === "small" &&
                  "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] shadow-sm",
              )}
              onClick={() => setUIFontSize("small")}
            >
              标准
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 rounded-full px-3 text-xs transition-all duration-200",
                uiFontSize === "normal" &&
                  "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] shadow-sm",
              )}
              onClick={() => setUIFontSize("normal")}
            >
              放大
            </Button>
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title="编辑器布局"
        description="调整表格、折叠标题等编辑器显示方式。"
      >
        <div
          className={`flex items-center justify-between gap-4 p-4 ${APPEARANCE_OPTION_ROW_CLASS}`}
        >
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.Table2
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label
                htmlFor="table-even-column-width"
                className="cursor-pointer"
              >
                表格两端对齐
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              让表格撑满可用宽度，并按列数均分每列宽度，像 Notion 表格那样整齐。
            </p>
          </div>
          <Switch
            id="table-even-column-width"
            checked={tableEvenColumnWidth}
            onCheckedChange={setTableEvenColumnWidth}
            className={APPEARANCE_SWITCH_CLASS}
          />
        </div>
        <div
          className={`mt-3 flex items-center justify-between gap-4 p-4 ${APPEARANCE_OPTION_ROW_CLASS}`}
        >
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.ChevronsDownUp
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Label htmlFor="hide-expand-arrows" className="cursor-pointer">
                隐藏展开箭头
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              默认以图标下方短线提示可展开项；悬停该行时显示箭头，可点击展开或收起。
            </p>
          </div>
          <Switch
            id="hide-expand-arrows"
            checked={hideExpandArrows}
            onCheckedChange={setHideExpandArrows}
            className={APPEARANCE_SWITCH_CLASS}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={
          <span className="flex items-center gap-2">
            <LucideIcons.Code2
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            主题与代码风格
          </span>
        }
        description="选择代码块的配色方案，深浅模式自动适配。"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {codeStyles.map((t) => (
            <SelectableCard
              key={t.value}
              selected={displayedCodeStyle === t.value}
              onClick={() => setCodeStyle(t.value)}
              className={cn(
                "flex items-center gap-3 rounded-[12px] border px-3 py-3 transition-all duration-200",
                displayedCodeStyle === t.value
                  ? "border-transparent bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                  : "border-transparent bg-[hsl(var(--goose-selected-bg)/0.48)] hover:bg-[var(--goose-interactive-hover)] dark:bg-[hsl(var(--foreground)/0.08)]",
              )}
            >
              <LucideIcons.Code2 className="h-5 w-5 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground">
                  {t.description}
                </div>
              </div>
            </SelectableCard>
          ))}
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={
          <span className="flex items-center gap-2">
            <LucideIcons.Type
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            自定义字体
          </span>
        }
        description="填写系统已安装的字体名；留空则用默认字体。"
      >
        <div className="space-y-4">
          {(["default", "serif", "mono"] as const).map((type) => (
            <div
              key={type}
              className="grid grid-cols-1 items-center gap-3 md:grid-cols-[88px_200px_minmax(0,1fr)]"
            >
              <div className="flex items-center gap-1">
                <Input
                  value={customFonts[type].label || ""}
                  onChange={(e) => setCustomLabel(type, e.target.value || null)}
                  placeholder={defaultLabels[type]}
                  className="h-8 border-0 px-2 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <div className="flex flex-1 items-center gap-2">
                <Input
                  value={customFonts[type].font || ""}
                  onChange={(e) => setCustomFont(type, e.target.value || null)}
                  placeholder={fontPlaceholders[type]}
                  className="h-8 w-[200px] border-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <div
                className="flex h-8 min-w-0 items-center overflow-hidden rounded-md bg-[hsl(var(--goose-selected-bg)/0.58)] px-3 text-sm md:text-base"
                style={{
                  fontFamily: customFonts[type].font || getFontPreview(type),
                }}
              >
                <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {fontPreviewText[type]}
                </span>
              </div>
            </div>
          ))}
        </div>
      </SettingsSectionCard>
    </div>
  );
}
