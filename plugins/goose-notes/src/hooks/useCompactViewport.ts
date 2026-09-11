import { useEffect, useState } from "react";

/**
 * 视口"紧凑"状态：当窗口高度低于阈值（典型 utools 吸附/subInput 模式）
 * 时返回 true。用于在小高度下切换 AI 页面 composer 的固定底部布局，
 * 避免布局被吞掉。
 */
export function useCompactViewport(threshold = 520): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerHeight < threshold;
  });

  useEffect(() => {
    const update = () => setCompact(window.innerHeight < threshold);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [threshold]);

  return compact;
}
