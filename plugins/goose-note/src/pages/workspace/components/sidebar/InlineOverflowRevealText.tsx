import type { HTMLAttributes } from "react";

interface InlineOverflowRevealTextProps extends HTMLAttributes<HTMLDivElement> {
  text: string;
  expandedText?: string;
  active?: boolean;
  disabled?: boolean;
  resetSignal?: number;
  onExpandedChange?: (expanded: boolean) => void;
}

function canUseHoverReveal() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function InlineOverflowRevealText({
  text,
  expandedText,
  active = false,
  disabled = false,
  resetSignal = 0,
  onExpandedChange,
  className,
  ...props
}: InlineOverflowRevealTextProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  const [isOverflow, setIsOverflow] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoverEnabled, setHoverEnabled] = useState(false);

  const revealText = expandedText?.trim() ? expandedText : text;

  useEffect(() => {
    setHoverEnabled(canUseHoverReveal());
  }, []);

  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) return;

    const measureOverflow = () => {
      const nextOverflow = node.scrollWidth > node.clientWidth;
      setIsOverflow(nextOverflow);
      if (!nextOverflow) {
        setIsExpanded(false);
      }
    };

    measureOverflow();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      measureOverflow();
    });

    observer.observe(node);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [text, expandedText]);

  useEffect(() => {
    if (disabled) {
      setIsExpanded(false);
    }
  }, [disabled]);

  useEffect(() => {
    setIsExpanded(false);
  }, [resetSignal]);

  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  useEffect(() => {
    if (!isExpanded) return;

    const closeReveal = () => {
      setIsExpanded(false);
    };

    const handleWindowBlur = () => closeReveal();
    const handleScroll = () => closeReveal();

    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [isExpanded]);

  const handleMouseEnter = () => {
    if (!hoverEnabled || disabled || !isOverflow) return;
    setIsExpanded(true);
  };

  const handleMouseLeave = () => {
    setIsExpanded(false);
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative min-w-0 flex-1 select-none", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <span ref={textRef} className="block truncate">
        {text}
      </span>

      {isExpanded && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 top-0 z-40 whitespace-nowrap",
            active
              ? "text-[var(--goose-interactive-selected-fg)]"
              : "text-foreground dark:text-foreground/92",
          )}
        >
          {revealText}
        </span>
      )}
    </div>
  );
}
