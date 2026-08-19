import { type FC, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import {
  useBlockNoteEditor,
  useExtension,
  type FormattingToolbarProps,
} from "@blocknote/react";

type FixedFormattingToolbarControllerProps = {
  formattingToolbar: FC<FormattingToolbarProps>;
  open: boolean;
};

/**
 * 紧凑布局格式工具栏：固定在视口底部并横向铺满，不跟随选区浮动。
 * open 由选区 / AI 状态驱动；鼠标仍在工具栏上时短暂保持，便于点按按钮。
 */
export function FixedFormattingToolbarController({
  formattingToolbar: Component,
  open,
}: FixedFormattingToolbarControllerProps) {
  const editor = useBlockNoteEditor();
  const formattingToolbar = useExtension(FormattingToolbarExtension, {
    editor,
  });
  const [hovered, setHovered] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!open && !hovered) return;
      formattingToolbar.store.setState(false);
      editor.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editor, formattingToolbar.store, open, hovered]);

  useEffect(() => {
    const vk = (
      navigator as Navigator & {
        virtualKeyboard?: {
          overlaysContent: boolean;
          boundingRect: { height: number };
          addEventListener: (type: string, listener: () => void) => void;
          removeEventListener: (type: string, listener: () => void) => void;
        };
      }
    ).virtualKeyboard;

    if (vk) {
      vk.overlaysContent = true;
      const onGeometryChange = () => {
        setKeyboardOffset(vk.boundingRect.height || 0);
      };
      vk.addEventListener("geometrychange", onGeometryChange);
      onGeometryChange();
      return () => vk.removeEventListener("geometrychange", onGeometryChange);
    }

    const vp = window.visualViewport;
    if (!vp) return;

    const update = () => {
      const layoutHeight = document.documentElement.clientHeight;
      const height = Math.max(0, layoutHeight - vp.height - vp.offsetTop);
      setKeyboardOffset(height > 50 ? height : 0);
    };

    vp.addEventListener("resize", update);
    vp.addEventListener("scroll", update);
    update();
    return () => {
      vp.removeEventListener("resize", update);
      vp.removeEventListener("scroll", update);
    };
  }, []);

  const visible = open || hovered;
  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-goose-formatting-toolbar-dock
      className="goose-formatting-toolbar-dock pointer-events-none fixed inset-x-0 z-[20000] flex transition-[opacity,transform,bottom] duration-150 ease-out"
      style={{
        bottom: `calc(${keyboardOffset}px + env(safe-area-inset-bottom, 0px))`,
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className="pointer-events-auto w-full min-w-0">
        <Component />
      </div>
    </div>,
    document.body,
  );
}
