import {
  autoPlacement,
  offset,
  shift,
  size,
  type Middleware,
} from "@floating-ui/react";
import type { FloatingUIOptions } from "@blocknote/react";

const COMPACT_SLASH_VIEWPORT_PADDING = 18;

/** 紧凑编辑器让斜杠菜单避开视口边缘，并按可用高度裁切。 */
export function getCompactSlashMenuFloatingOptions(): FloatingUIOptions {
  const middleware: Middleware[] = [
    offset(6),
    autoPlacement({
      allowedPlacements: ["bottom-start", "top-start"],
      padding: COMPACT_SLASH_VIEWPORT_PADDING,
    }),
    shift({ padding: COMPACT_SLASH_VIEWPORT_PADDING }),
    size({
      apply({ elements, availableHeight }) {
        elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        elements.floating.style.overflow = "hidden";
      },
      padding: COMPACT_SLASH_VIEWPORT_PADDING,
    }),
  ];

  return {
    useFloatingOptions: {
      placement: "bottom-start",
      middleware,
    },
    elementProps: {
      style: { zIndex: 200 },
      onMouseDownCapture: (event: React.MouseEvent) => event.preventDefault(),
    },
  };
}
