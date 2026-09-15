const SIDEBAR_MIN_WIDTH = 170;

interface UseSidebarResizeOptions {
  disableResize?: boolean;
  defaultWidth?: number;
}

export function useSidebarResize({
  disableResize = false,
  defaultWidth = 180,
}: UseSidebarResizeOptions = {}) {
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("sidebar-width");
    return saved
      ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(480, Number(saved)))
      : defaultWidth;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem("sidebar-width", String(width));
    }, 300);
    return () => clearTimeout(timer);
  }, [width]);

  const startResizing = (startX: number) => {
    if (disableResize) return;
    setIsResizing(true);

    const startWidth = width;

    const updateWidth = (nextClientX: number) => {
      const newWidth = startWidth + nextClientX - startX;
      setWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(480, newWidth)));
    };

    const onMouseMove = (event: MouseEvent) => {
      updateWidth(event.clientX);
    };

    const onPointerMove = (event: PointerEvent) => {
      updateWidth(event.clientX);
    };

    const stopResizing = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", stopResizing);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stopResizing);
      document.removeEventListener("pointercancel", stopResizing);
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", stopResizing);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopResizing);
    document.addEventListener("pointercancel", stopResizing);
    document.body.style.cursor = "col-resize";
  };

  const handleResizeMouseDown = (event: React.MouseEvent) => {
    if (disableResize) return;
    event.preventDefault();
    startResizing(event.clientX);
  };

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disableResize || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    startResizing(event.clientX);
  };

  return {
    width,
    isResizing,
    handleResizeMouseDown,
    handleResizePointerDown,
  };
}
