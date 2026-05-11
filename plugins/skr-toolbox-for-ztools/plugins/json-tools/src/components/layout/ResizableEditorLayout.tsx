import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@heroui/react";

interface ResizableEditorLayoutProps {
  leftPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
  initialLeftWidth?: number; // 初始左侧宽度百分比 (0-100)
  minLeftWidth?: number; // 最小左侧宽度百分比
  maxLeftWidth?: number; // 最大左侧宽度百分比
  className?: string;
  onResize?: (leftWidth: number) => void; // 调整大小时的回调
  onResizeComplete?: (leftWidth: number) => void; // 调整完成后的回调
  resizeHandle?: React.ReactNode; // 自定义拖动手柄
  children?: React.ReactNode; // 允许通过children传递面板
}

const ResizableEditorLayout: React.FC<ResizableEditorLayoutProps> = ({
  leftPanel,
  rightPanel,
  children,
  initialLeftWidth = 50,
  minLeftWidth = 20,
  maxLeftWidth = 80,
  className,
  onResize,
  onResizeComplete,
  resizeHandle,
}) => {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // 处理拖动开始
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartX.current = e.clientX;
      dragStartWidth.current = leftWidth;
      setIsDragging(true);
    },
    [leftWidth],
  );

  // 处理鼠标移动
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      requestAnimationFrame(() => {
        if (!containerRef.current) return;

        const containerWidth = containerRef.current.offsetWidth;
        const deltaX = e.clientX - dragStartX.current;
        const deltaPercentage = (deltaX / containerWidth) * 100;
        let newWidth = dragStartWidth.current + deltaPercentage;

        // 限制在最小和最大宽度之间
        newWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newWidth));

        setLeftWidth(newWidth);
        onResize?.(newWidth);
      });
    },
    [isDragging, minLeftWidth, maxLeftWidth, onResize],
  );

  // 处理鼠标抬起
  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      // 调用调整完成回调
      onResizeComplete?.(leftWidth);
    }
  }, [isDragging, leftWidth, onResizeComplete]);

  // 添加/移除鼠标事件监听器
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // 响应窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      // 可以在这里添加响应式逻辑
      if (containerRef.current) {
        containerRef.current.style.width = "100%";
      }
    };

    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 默认的拖动手柄样式
  const defaultResizeHandle = (
    <div
      className={cn(
        "w-2 h-full cursor-ew-resize flex items-center justify-center transition-all duration-200",
      )}
      role="button"
      style={{ touchAction: "none" }}
      onMouseDown={handleDragStart}
    >
      <div className="h-24 w-1 bg-gray-300 dark:bg-gray-600 rounded-full transition-all duration-200" />
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={cn("flex w-full h-full overflow-hidden", className)}
    >
      {/* 处理children作为面板内容 */}
      {children && (
        <>
          {/* 左侧面板 */}
          <div
            className="h-full overflow-hidden"
            style={{ width: `${leftWidth}%` }}
          >
            {Array.isArray(children) ? children[0] : children}
          </div>

          {/* 拖动手柄 - 只有当有多个子元素时才显示 */}
          {Array.isArray(children) &&
            children.length > 1 &&
            (resizeHandle || defaultResizeHandle)}

          {/* 右侧面板 */}
          {Array.isArray(children) && children.length > 1 && (
            <div
              className="h-full overflow-hidden flex-1"
              style={{
                width: `${100 - leftWidth}%`,
                minWidth: `${100 - maxLeftWidth}%`,
              }}
            >
              {children[1]}
            </div>
          )}
        </>
      )}

      {/* 处理props方式的面板 */}
      {!children && (
        <>
          {/* 左侧面板 */}
          {leftPanel && (
            <div
              className="h-full overflow-hidden"
              style={{ width: `${leftWidth}%` }}
            >
              {leftPanel}
            </div>
          )}

          {/* 拖动手柄 */}
          {leftPanel && rightPanel && (resizeHandle || defaultResizeHandle)}

          {/* 右侧面板 */}
          {rightPanel && (
            <div
              className="h-full overflow-hidden flex-1"
              style={{
                width: leftPanel ? `${100 - leftWidth}%` : "100%",
                minWidth:
                  rightPanel && leftPanel
                    ? `${100 - maxLeftWidth}%`
                    : undefined,
              }}
            >
              {rightPanel}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ResizableEditorLayout;
