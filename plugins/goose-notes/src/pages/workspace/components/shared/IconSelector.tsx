import * as LucideIcons from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { focusIconSelectorOnOpen } from "./iconSelectorFocus";

interface IconSelectorProps<T extends HTMLElement = HTMLElement> {
  value?: string;
  onChange: (icon: string | undefined) => void;
  children: React.ReactNode;
  portalContainerRef?: React.RefObject<T | null>;
  onFirstOpen?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 编辑器内弹出时，给弹层补上 goose-editor-context-ui，避免被编辑器裁切/层级压住 */
  editorContext?: boolean;
}

interface CuratedIcon {
  name: string;
  label: string;
}

interface IconNavigationState {
  activeCategory: IconCategoryId;
  rovingIconName?: string;
  previousOpen: boolean;
  previousValue?: string;
}

const ICON_CATEGORIES: ReadonlyArray<{
  id: "documents" | "symbols" | "things";
  label: string;
  icons: ReadonlyArray<CuratedIcon>;
}> = [
  {
    id: "documents",
    label: "文档",
    icons: [
      { name: "BookOpen", label: "打开的书" },
      { name: "Book", label: "书籍" },
      { name: "BookMarked", label: "标记书籍" },
      { name: "NotebookPen", label: "笔记本与笔" },
      { name: "Notebook", label: "手册" },
      { name: "Library", label: "图书馆" },
      { name: "FileText", label: "文档" },
      { name: "Files", label: "文档集" },
      { name: "ClipboardList", label: "清单" },
      { name: "Clipboard", label: "剪贴板" },
      { name: "BookText", label: "文本书籍" },
      { name: "NotebookTabs", label: "分页笔记本" },
      { name: "ListTodo", label: "待办清单" },
      { name: "StickyNote", label: "便签" },
      { name: "FileCode", label: "代码文件" },
      { name: "Terminal", label: "命令行" },
      { name: "Database", label: "数据库" },
      { name: "ChartNoAxesCombined", label: "图表" },
      { name: "Newspaper", label: "新闻" },
      { name: "FileCheck", label: "已检查文件" },
      { name: "FolderOpen", label: "打开文件夹" },
      { name: "Folder", label: "文件夹" },
      { name: "Archive", label: "归档" },
      { name: "Inbox", label: "收件箱" },
      { name: "FileSpreadsheet", label: "电子表格" },
      { name: "Mail", label: "邮件" },
      { name: "CalendarDays", label: "日程" },
      { name: "Calendar", label: "日历" },
      { name: "Kanban", label: "看板" },
      { name: "ChartGantt", label: "甘特图" },
      { name: "Presentation", label: "演示文稿" },
      { name: "ReceiptText", label: "票据" },
    ],
  },
  {
    id: "symbols",
    label: "符号",
    icons: [
      { name: "Bookmark", label: "书签" },
      { name: "Tag", label: "标签" },
      { name: "Sparkles", label: "闪光" },
      { name: "Atom", label: "原子符号" },
      { name: "Dna", label: "DNA" },
      { name: "Sigma", label: "求和符号" },
      { name: "Pi", label: "圆周率符号" },
      { name: "Binary", label: "二进制" },
      { name: "Target", label: "靶心" },
      { name: "Flag", label: "旗帜" },
      { name: "Milestone", label: "里程碑" },
      { name: "CircleCheckBig", label: "完成标记" },
      { name: "MapPin", label: "定位标记" },
      { name: "Heart", label: "爱心" },
      { name: "Star", label: "星标" },
      { name: "Footprints", label: "足迹" },
      { name: "Waves", label: "波纹" },
      { name: "BadgeDollarSign", label: "金额徽章" },
      { name: "Music", label: "音符" },
      { name: "PawPrint", label: "爪印" },
      { name: "CircleAlert", label: "警告" },
      { name: "CircleHelp", label: "帮助" },
      { name: "Info", label: "信息" },
      { name: "CircleX", label: "关闭标记" },
      { name: "Ban", label: "禁止" },
      { name: "Plus", label: "加号" },
      { name: "Minus", label: "减号" },
      { name: "Check", label: "对勾" },
      { name: "X", label: "叉号" },
      { name: "Hash", label: "井号" },
      { name: "AtSign", label: "艾特符号" },
      { name: "Percent", label: "百分号" },
      { name: "ArrowUp", label: "上箭头" },
      { name: "ArrowDown", label: "下箭头" },
      { name: "ArrowLeft", label: "左箭头" },
      { name: "ArrowRight", label: "右箭头" },
      { name: "Circle", label: "圆形" },
      { name: "Square", label: "方形" },
      { name: "Triangle", label: "三角形" },
      { name: "Diamond", label: "菱形" },
    ],
  },
  {
    id: "things",
    label: "事物",
    icons: [
      { name: "GraduationCap", label: "学士帽" },
      { name: "Brain", label: "大脑" },
      { name: "Lightbulb", label: "灯泡" },
      { name: "Calculator", label: "计算器" },
      { name: "Clock", label: "时钟" },
      { name: "Timer", label: "计时器" },
      { name: "AlarmClock", label: "闹钟" },
      { name: "Compass", label: "指南针" },
      { name: "Puzzle", label: "拼图" },
      { name: "BriefcaseBusiness", label: "商务公文包" },
      { name: "Briefcase", label: "公文包" },
      { name: "ShoppingCart", label: "购物车" },
      { name: "WalletCards", label: "卡包" },
      { name: "PartyPopper", label: "礼花" },
      { name: "Highlighter", label: "荧光笔" },
      { name: "Pencil", label: "铅笔" },
      { name: "Printer", label: "打印机" },
      { name: "Settings", label: "齿轮" },
      { name: "Handshake", label: "握手" },
      { name: "Microscope", label: "显微镜" },
      { name: "FlaskConical", label: "烧瓶" },
      { name: "School", label: "学校" },
      { name: "Ruler", label: "直尺" },
      { name: "DraftingCompass", label: "圆规" },
      { name: "Telescope", label: "望远镜" },
      { name: "Users", label: "用户群" },
      { name: "UserRound", label: "用户" },
      { name: "Laptop", label: "笔记本电脑" },
      { name: "Wrench", label: "扳手" },
      { name: "Hammer", label: "锤子" },
      { name: "Package", label: "包裹" },
      { name: "Truck", label: "卡车" },
      { name: "Landmark", label: "地标建筑" },
      { name: "Factory", label: "工厂" },
      { name: "Building2", label: "建筑" },
      { name: "Store", label: "门店" },
      { name: "Home", label: "住宅" },
      { name: "Coffee", label: "咖啡杯" },
      { name: "Utensils", label: "餐具" },
      { name: "CookingPot", label: "炊具" },
      { name: "CakeSlice", label: "蛋糕" },
      { name: "Dumbbell", label: "哑铃" },
      { name: "Bike", label: "自行车" },
      { name: "Plane", label: "飞机" },
      { name: "TrainFront", label: "火车" },
      { name: "Car", label: "汽车" },
      { name: "Ship", label: "船舶" },
      { name: "Camera", label: "相机" },
      { name: "Headphones", label: "耳机" },
      { name: "Film", label: "胶片" },
      { name: "Gamepad2", label: "游戏手柄" },
      { name: "Palette", label: "调色板" },
      { name: "Flower2", label: "花卉" },
      { name: "Gift", label: "礼物" },
      { name: "Baby", label: "婴儿" },
      { name: "TentTree", label: "帐篷" },
      { name: "Mountain", label: "山峰" },
      { name: "Earth", label: "地球" },
      { name: "BedDouble", label: "床铺" },
      { name: "Shirt", label: "服装" },
      { name: "ShoppingBag", label: "购物袋" },
      { name: "MicVocal", label: "麦克风" },
      { name: "Volleyball", label: "排球" },
      { name: "Fish", label: "鱼" },
      { name: "Bird", label: "鸟" },
    ],
  },
];

type IconCategoryId = (typeof ICON_CATEGORIES)[number]["id"];

const ICON_COMPONENTS = LucideIcons as unknown as Record<
  string,
  LucideIcons.LucideIcon
>;

function findCategoryForIcon(iconName?: string): IconCategoryId {
  return (
    ICON_CATEGORIES.find((category) =>
      category.icons.some((icon) => icon.name === iconName),
    )?.id ?? ICON_CATEGORIES[0].id
  );
}

function getAvailableIcons(categoryId: IconCategoryId): ReadonlyArray<CuratedIcon> {
  const category =
    ICON_CATEGORIES.find((candidate) => candidate.id === categoryId) ??
    ICON_CATEGORIES[0];
  return category.icons.filter((icon) => Boolean(ICON_COMPONENTS[icon.name]));
}

function getRovingIconName(
  categoryId: IconCategoryId,
  preferredIconName?: string,
): string | undefined {
  const icons = getAvailableIcons(categoryId);
  return icons.some((icon) => icon.name === preferredIconName)
    ? preferredIconName
    : icons[0]?.name;
}

export function IconSelector<T extends HTMLElement = HTMLElement>({
  value,
  onChange,
  children,
  portalContainerRef,
  onFirstOpen,
  open: controlledOpen,
  onOpenChange,
  editorContext = false,
}: IconSelectorProps<T>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const [navigation, setNavigation] = useState<IconNavigationState>(() => {
    const initialCategory = findCategoryForIcon(value);
    return {
      activeCategory: initialCategory,
      rovingIconName: getRovingIconName(initialCategory, value),
      previousOpen: open,
      previousValue: value,
    };
  });
  const [portalContainer, setPortalContainer] = useState<T | null>(null);
  const categoryButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const iconButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectorId = useId();
  const panelId = `${selectorId}-panel`;

  if (
    navigation.previousOpen !== open ||
    navigation.previousValue !== value
  ) {
    const shouldSyncSelection =
      open &&
      (!navigation.previousOpen || navigation.previousValue !== value);

    if (shouldSyncSelection) {
      const nextCategory = findCategoryForIcon(value);
      setNavigation({
        activeCategory: nextCategory,
        rovingIconName: getRovingIconName(nextCategory, value),
        previousOpen: open,
        previousValue: value,
      });
    } else {
      setNavigation({
        ...navigation,
        previousOpen: open,
        previousValue: value,
      });
    }
  }

  const activeCategory = navigation.activeCategory;
  const rovingIconName = navigation.rovingIconName;
  const setOpen = (next: boolean) => {
    if (next) {
      const nextCategory = findCategoryForIcon(value);
      setPortalContainer(portalContainerRef?.current ?? null);
      setNavigation({
        activeCategory: nextCategory,
        rovingIconName: getRovingIconName(nextCategory, value),
        previousOpen: true,
        previousValue: value,
      });
    }
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const hasOpenedRef = useRef(false);

  const allIcons = useMemo(
    () =>
      ICON_CATEGORIES.flatMap((category) => category.icons).filter(
        (icon) => Boolean(ICON_COMPONENTS[icon.name]),
      ),
    [],
  );
  const currentCategory =
    ICON_CATEGORIES.find((category) => category.id === activeCategory) ??
    ICON_CATEGORIES[0];
  const visibleIcons = getAvailableIcons(currentCategory.id);

  useEffect(() => {
    if (open && !hasOpenedRef.current && onFirstOpen) {
      hasOpenedRef.current = true;
      onFirstOpen();
    }
  }, [open, onFirstOpen]);

  const handleRandomIcon = () => {
    if (allIcons.length === 0) return;
    const nextIcon = allIcons[Math.floor(Math.random() * allIcons.length)];
    const nextCategory = findCategoryForIcon(nextIcon.name);
    setNavigation((current) => ({
      ...current,
      activeCategory: nextCategory,
      rovingIconName: nextIcon.name,
    }));
    onChange(nextIcon.name);
  };

  const selectCategory = (categoryId: IconCategoryId) => {
    setNavigation((current) => ({
      ...current,
      activeCategory: categoryId,
      rovingIconName: getRovingIconName(categoryId, value),
    }));
  };

  const handleCategoryKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    categoryIndex: number,
  ) => {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (categoryIndex + 1) % ICON_CATEGORIES.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (categoryIndex - 1 + ICON_CATEGORIES.length) % ICON_CATEGORIES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = ICON_CATEGORIES.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    selectCategory(ICON_CATEGORIES[nextIndex].id);
    categoryButtonRefs.current[nextIndex]?.focus();
  };

  const handleIconKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    iconIndex: number,
  ) => {
    const columns = window.matchMedia("(min-width: 336px)").matches
      ? 6
      : window.matchMedia("(min-width: 288px)").matches
        ? 5
        : 4;
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = iconIndex + 1;
    } else if (event.key === "ArrowLeft") {
      nextIndex = iconIndex - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = iconIndex + columns;
    } else if (event.key === "ArrowUp") {
      nextIndex = iconIndex - columns;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visibleIcons.length - 1;
    }

    if (
      nextIndex === undefined ||
      nextIndex < 0 ||
      nextIndex >= visibleIcons.length
    ) {
      return;
    }

    event.preventDefault();
    setNavigation((current) => ({
      ...current,
      rovingIconName: visibleIcons[nextIndex].name,
    }));
    iconButtonRefs.current[nextIndex]?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {isControlled ? (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent
        className={cn(
          "w-[324px] min-w-[220px] max-w-[calc(100vw-20px)] overflow-hidden rounded-[14px] border border-border/40 bg-popover p-0 text-foreground shadow-[0_16px_36px_rgba(15,23,42,0.12),0_2px_8px_rgba(15,23,42,0.06)]",
          editorContext && "goose-editor-context-ui",
        )}
        align="start"
        side="bottom"
        collisionPadding={10}
        container={portalContainer ?? undefined}
        onOpenAutoFocus={(event) => {
          const activeCategoryIndex = ICON_CATEGORIES.findIndex(
            (category) => category.id === activeCategory,
          );
          focusIconSelectorOnOpen(
            event,
            categoryButtonRefs.current[activeCategoryIndex] ?? null,
          );
        }}
      >
        <style>{`
          .goose-icon-selector-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          @media (min-width: 288px) {
            .goose-icon-selector-grid {
              grid-template-columns: repeat(5, minmax(0, 1fr));
            }
          }
          @media (min-width: 336px) {
            .goose-icon-selector-grid {
              grid-template-columns: repeat(6, minmax(0, 1fr));
            }
          }
        `}</style>
        <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1">
          <div
            className="flex min-w-0 items-center gap-0.5"
            role="tablist"
            aria-label="图标分类"
          >
            {ICON_CATEGORIES.map((category, index) => {
              const selected = category.id === activeCategory;
              return (
                <button
                  key={category.id}
                  ref={(element) => {
                    categoryButtonRefs.current[index] = element;
                  }}
                  id={`${selectorId}-category-${category.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  className={cn(
                    "inline-flex h-9 min-w-10 items-center justify-center rounded-[8px] px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-popover",
                    selected
                      ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                      : "text-muted-foreground hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
                  )}
                  onClick={() => selectCategory(category.id)}
                  onKeyDown={(event) => handleCategoryKeyDown(event, index)}
                >
                  {category.label}
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-popover"
                    aria-label="随机选择图标"
                    onClick={handleRandomIcon}
                  >
                    <LucideIcons.Shuffle className="h-4 w-4 stroke-[1.6]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">随机选择图标</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <button
              type="button"
              className="inline-flex h-9 min-w-10 items-center justify-center rounded-[8px] px-2 text-xs text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-popover"
              aria-label="移除当前图标"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              移除
            </button>
          </div>
        </div>

        <div className="px-2 pb-2">
          <ScrollArea
            key={activeCategory}
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${selectorId}-category-${activeCategory}`}
            className="h-[198px] bg-popover"
          >
            <div className="goose-icon-selector-grid grid auto-rows-[38px] gap-0.5 pr-2">
              {visibleIcons.map(({ name, label }, index) => {
                const Icon = ICON_COMPONENTS[name];
                const selected = value === name;
                return (
                  <button
                    key={name}
                    ref={(element) => {
                      iconButtonRefs.current[index] = element;
                    }}
                    type="button"
                    title={label}
                    tabIndex={rovingIconName === name ? 0 : -1}
                    className={cn(
                      "group/icon inline-flex h-[38px] w-full items-center justify-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      selected
                        ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                        : "text-muted-foreground hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
                    )}
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                    onFocus={() =>
                      setNavigation((current) => ({
                        ...current,
                        rovingIconName: name,
                      }))
                    }
                    onKeyDown={(event) => handleIconKeyDown(event, index)}
                    aria-label={label}
                    aria-pressed={selected}
                  >
                    <Icon className="h-[18px] w-[18px] stroke-[1.6]" />
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}
