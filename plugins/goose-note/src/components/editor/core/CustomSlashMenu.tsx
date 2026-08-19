import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useExtension } from "@blocknote/react";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { cn } from "@/components/editor/utils/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/editor/ui/tooltip";
import { Kbd } from "@/components/editor/ui/kbd";
import { Button } from "@/components/editor/ui/button";
import type { SlashMenuItem } from "./blocknoteSlashItems";
import { isSlashMenuDivider } from "./blocknoteSlashItems";

interface CustomSlashMenuProps {
  items: SlashMenuItem[];
  loadingState: "loading-initial" | "loading" | "loaded";
  selectedIndex: number | undefined;
  onItemClick?: (item: SlashMenuItem) => void;
}

const KEYBOARD_NAV_IGNORE_MOUSE_MS = 700;
const SCROLL_ANIM_MS = 180;
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function clampScrollTop(container: HTMLElement, top: number): number {
  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.max(0, Math.min(top, max));
}

function scrollTopToCenterItem(
  container: HTMLElement,
  itemEl: HTMLElement,
  movingDown: boolean,
  movingUp: boolean,
): number | null {
  const itemCenter = itemEl.offsetTop + itemEl.offsetHeight / 2;
  const viewportCenter = container.scrollTop + container.clientHeight / 2;
  if (
    (!movingDown || itemCenter < viewportCenter) &&
    (!movingUp || itemCenter > viewportCenter)
  ) {
    return null;
  }
  return clampScrollTop(container, itemCenter - container.clientHeight / 2);
}

interface ScrollTween {
  from: number;
  to: number;
  startMs: number;
  durationMs: number;
}

const CustomSlashMenu = forwardRef<HTMLDivElement, CustomSlashMenuProps>(
  ({ items, selectedIndex: externalIndex, onItemClick }, _ref) => {
    const [selectedIndex, setSelectedIndex] = useState(externalIndex ?? 0);
    const containerRef = useRef<HTMLDivElement>(null);
    const suggestionMenu = useExtension(SuggestionMenu);
    const ignoreMouseEnterUntilRef = useRef(0);
    const lastKeyboardNavAtRef = useRef(0);
    const previousSelectedIndexRef = useRef(selectedIndex);
    const scrollTweenRef = useRef<ScrollTween | null>(null);
    const scrollRafRef = useRef(0);
    const suppressHoverTimerRef = useRef<number | null>(null);
    const [suppressItemHover, setSuppressItemHover] = useState(false);

    const selectableIndexes = useMemo(
      () =>
        items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => !isSlashMenuDivider(item) && !item.disabled)
          .map(({ index }) => index),
      [items],
    );

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item && !isSlashMenuDivider(item) && !item.disabled) {
          onItemClick?.(item);
        }
      },
      [items, onItemClick],
    );

    const readAnimatedScrollTop = useCallback((): number => {
      const container = containerRef.current;
      if (!container) return 0;
      const tween = scrollTweenRef.current;
      if (!tween) return container.scrollTop;
      const elapsed = performance.now() - tween.startMs;
      const t = Math.min(1, elapsed / tween.durationMs);
      return tween.from + (tween.to - tween.from) * easeOutCubic(t);
    }, []);

    const cancelScrollAnimation = useCallback(() => {
      if (scrollRafRef.current !== 0) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
      scrollTweenRef.current = null;
    }, []);

    const startScrollTo = useCallback(
      (to: number) => {
        const container = containerRef.current;
        if (!container) return;
        const from = readAnimatedScrollTop();
        if (Math.abs(to - from) < 0.5) {
          container.scrollTop = to;
          cancelScrollAnimation();
          return;
        }
        scrollTweenRef.current = {
          from,
          to,
          startMs: performance.now(),
          durationMs: SCROLL_ANIM_MS,
        };
        const tick = () => {
          const el = containerRef.current;
          const active = scrollTweenRef.current;
          if (!el || !active) {
            scrollRafRef.current = 0;
            return;
          }
          const elapsed = performance.now() - active.startMs;
          const t = Math.min(1, elapsed / active.durationMs);
          el.scrollTop =
            active.from + (active.to - active.from) * easeOutCubic(t);
          if (t >= 1) {
            el.scrollTop = active.to;
            scrollTweenRef.current = null;
            scrollRafRef.current = 0;
            return;
          }
          scrollRafRef.current = requestAnimationFrame(tick);
        };
        if (scrollRafRef.current !== 0) {
          cancelAnimationFrame(scrollRafRef.current);
        }
        scrollRafRef.current = requestAnimationFrame(tick);
      },
      [cancelScrollAnimation, readAnimatedScrollTop],
    );

    const beginKeyboardNav = useCallback(() => {
      const now = Date.now();
      lastKeyboardNavAtRef.current = now;
      ignoreMouseEnterUntilRef.current = now + KEYBOARD_NAV_IGNORE_MOUSE_MS;
      setSuppressItemHover(true);
      if (suppressHoverTimerRef.current !== null) {
        window.clearTimeout(suppressHoverTimerRef.current);
      }
      suppressHoverTimerRef.current = window.setTimeout(() => {
        suppressHoverTimerRef.current = null;
        setSuppressItemHover(false);
      }, KEYBOARD_NAV_IGNORE_MOUSE_MS);
    }, []);

    useEffect(() => {
      if (items.length === 0) {
        const timer = setTimeout(() => suggestionMenu?.closeMenu(), 0);
        return () => clearTimeout(timer);
      }
      if (selectableIndexes.length === 0) {
        setSelectedIndex(0);
      } else if (!selectableIndexes.includes(selectedIndex)) {
        setSelectedIndex(selectableIndexes[0]);
      }
    }, [items, selectableIndexes, selectedIndex, suggestionMenu]);

    useEffect(() => {
      return () => {
        if (suppressHoverTimerRef.current !== null) {
          window.clearTimeout(suppressHoverTimerRef.current);
        }
        cancelScrollAnimation();
      };
    }, [cancelScrollAnimation]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const selectedEl = container.querySelector(
        `[data-index="${selectedIndex}"]`,
      ) as HTMLElement | null;
      if (!selectedEl) return;

      const previousIndex = previousSelectedIndexRef.current;
      previousSelectedIndexRef.current = selectedIndex;
      const fromKeyboard =
        Date.now() - lastKeyboardNavAtRef.current <
        KEYBOARD_NAV_IGNORE_MOUSE_MS;
      if (!fromKeyboard) return;

      const wrappedToStart =
        previousIndex === selectableIndexes[selectableIndexes.length - 1] &&
        selectedIndex === selectableIndexes[0];
      const wrappedToEnd =
        previousIndex === selectableIndexes[0] &&
        selectedIndex === selectableIndexes[selectableIndexes.length - 1];
      const target = wrappedToStart
        ? 0
        : wrappedToEnd
          ? container.scrollHeight - container.clientHeight
          : scrollTopToCenterItem(
              container,
              selectedEl,
              selectedIndex > previousIndex,
              selectedIndex < previousIndex,
            );
      if (target === null) return;

      startScrollTo(target);
    }, [selectedIndex, selectableIndexes, startScrollTo]);

    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (!containerRef.current || !containerRef.current.isConnected) return;
        const target = e.target as HTMLElement | null;
        const inEditorScope = !!target?.closest(
          '.bn-editor, [data-content-type="blockNote"]',
        );
        if (!inEditorScope) return;
        if (!selectableIndexes.length) return;
        if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          beginKeyboardNav();
          const pos = Math.max(selectableIndexes.indexOf(selectedIndex), 0);
          if (pos === 0) {
            setSelectedIndex(selectableIndexes[selectableIndexes.length - 1]);
          } else {
            setSelectedIndex(selectableIndexes[pos - 1]);
          }
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          beginKeyboardNav();
          const pos = Math.max(selectableIndexes.indexOf(selectedIndex), 0);
          if (pos === selectableIndexes.length - 1) {
            setSelectedIndex(selectableIndexes[0]);
          } else {
            setSelectedIndex(selectableIndexes[pos + 1]);
          }
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const validIndex = selectableIndexes.includes(selectedIndex)
            ? selectedIndex
            : selectableIndexes[0];
          selectItem(validIndex);
        }
      };
      window.addEventListener("keydown", handler, true);
      return () => window.removeEventListener("keydown", handler, true);
    }, [selectedIndex, selectItem, selectableIndexes, beginKeyboardNav]);

    if (items.length === 0) {
      return null;
    }

    const lite = __GOOSE_EDITOR_COMPACT__;

    return (
      <div
        className="inline-flex max-h-[inherit] min-h-0 flex-col overflow-visible bg-transparent"
        data-notion-slash-root="true"
        {...(lite ? { "data-goose-slash-lite": "true" } : {})}
      >
        <div
          data-notion-slash-surface="true"
          className={cn(
            "goose-editor-inline-context-ui z-50 flex h-auto min-h-0 min-w-0 flex-col overflow-hidden border border-border/75 bg-popover text-popover-foreground",
            !lite &&
              "shadow-[0_14px_34px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.08)]",
            lite
              ? "max-h-[inherit] w-[248px] rounded-xl p-1"
              : "max-h-[20rem] w-[280px] rounded-[var(--radius-notion-slash)] p-1.5",
          )}
        >
          <div
            ref={containerRef}
            data-notion-slash-scroll={lite ? "" : undefined}
            className={cn(
              "min-h-0 overflow-y-auto overscroll-contain",
              lite ? "max-h-[inherit] pb-2" : "max-h-[20rem] pb-1",
              suppressItemHover && "pointer-events-none",
            )}
          >
            <TooltipProvider delayDuration={600}>
              <div className={cn("flex flex-col", lite ? "gap-0" : "gap-0.5")}>
                {items.map((item, index) => {
                  if (isSlashMenuDivider(item)) {
                    return (
                      <div
                        key={`divider-${index}`}
                        className={cn(
                          "mx-2 h-px bg-border/60",
                          lite ? "my-0.5" : "my-1",
                        )}
                      />
                    );
                  }

                  const button = (
                    <Button
                      key={item.title ?? index}
                      variant="ghost"
                      data-index={index}
                      data-goose-slash-item={lite ? "" : undefined}
                      data-goose-slash-selected={
                        lite && index === selectedIndex ? "true" : undefined
                      }
                      className={cn(
                        "relative flex h-auto w-full items-center justify-start text-left outline-none transition-colors whitespace-normal",
                        lite
                          ? "min-h-[34px] rounded-lg px-2 py-1.5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 hover:bg-[var(--goose-interactive-hover)] hover:text-[hsl(var(--foreground))]"
                          : "min-h-[40px] rounded-[var(--radius-notion-slash-item)] px-2.5 py-2",
                        index === selectedIndex
                          ? lite
                            ? "bg-transparent text-[hsl(var(--foreground))]"
                            : "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                          : "bg-transparent",
                      )}
                      onMouseEnter={() => {
                        if (suppressItemHover) return;
                        if (Date.now() < ignoreMouseEnterUntilRef.current)
                          return;
                        setSelectedIndex(index);
                      }}
                      onClick={() => selectItem(index)}
                    >
                      <div
                        className={cn(
                          "flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-notion-slash-icon)] bg-[var(--goose-block-subtle-bg)]",
                          lite ? "mr-2 h-6 w-6" : "mr-2.5 h-7 w-7",
                        )}
                      >
                        {item.icon ? (
                          <span
                            className={cn(
                              "text-xs",
                              index === selectedIndex
                                ? lite
                                  ? "text-[hsl(var(--foreground))]"
                                  : "text-[var(--goose-interactive-selected-fg)]"
                                : "text-muted-foreground",
                            )}
                          >
                            {item.icon}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-muted-foreground">
                            T
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            "truncate font-medium",
                            lite ? "text-[11px]" : "text-[12px]",
                            item.disabled
                              ? "text-muted-foreground/55"
                              : index === selectedIndex
                                ? lite
                                  ? "text-[hsl(var(--foreground))]"
                                  : "text-[var(--goose-interactive-selected-fg)]"
                                : "text-foreground",
                          )}
                        >
                          {item.title}
                        </div>
                        {item.description && (
                          <div
                            className={cn(
                              "mt-0.5 truncate text-muted-foreground",
                              lite ? "text-[9px]" : "text-[10px]",
                            )}
                          >
                            {item.description}
                          </div>
                        )}
                      </div>

                      {item.badge && (
                        <Kbd
                          shortcut={item.badge}
                          className="ml-2 h-4 border-transparent bg-transparent px-0 text-[9px] opacity-45 shadow-none"
                        />
                      )}
                    </Button>
                  );

                  if (!item.disabled || !item.disabledReason) return button;
                  return (
                    <Tooltip key={item.title ?? index}>
                      <TooltipTrigger asChild>
                        <span className="block w-full cursor-not-allowed">
                          {button}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent editorContext side="right">
                        {item.disabledReason}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
          </div>
        </div>
      </div>
    );
  },
);

CustomSlashMenu.displayName = "CustomSlashMenu";
export { CustomSlashMenu };
