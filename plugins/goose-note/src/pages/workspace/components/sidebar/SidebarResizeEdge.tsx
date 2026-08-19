interface SidebarResizeEdgeProps {
  isResizing: boolean;
  onMouseDown: (event: React.MouseEvent) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function SidebarResizeEdge({
  isResizing,
  onMouseDown,
  onPointerDown,
}: SidebarResizeEdgeProps) {
  return (
    <div
      className="absolute top-0 h-full z-[60] cursor-col-resize group/resize"
      style={{ right: "-18px", width: "16px" }}
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      role="separator"
    >
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-150",
          isResizing ? "opacity-100" : "opacity-0 group-hover/resize:opacity-100",
        )}
        style={{
          width: "2px",
          height: "100%",
          marginLeft: "-1px",
          borderRadius: 0,
          background: isResizing
            ? "var(--workspace-resize-line-active)"
            : "var(--workspace-resize-line)",
        }}
      />
    </div>
  );
}
