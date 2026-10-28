import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Anchor<T> = { item: T; x: number; y: number; trigger: HTMLElement };
export function useContextMenu<T>() {
  const [anchor, setAnchor] = useState<Anchor<T> | null>(null);
  function open(
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    item: T,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const trigger =
      event.currentTarget.querySelector<HTMLElement>("button") ||
      event.currentTarget;
    const rect = trigger.getBoundingClientRect();
    const pointer =
      "clientX" in event && (event.clientX !== 0 || event.clientY !== 0);
    setAnchor({
      item,
      trigger,
      x: pointer ? event.clientX : rect.left + 12,
      y: pointer ? event.clientY : rect.bottom,
    });
  }
  return {
    anchor,
    close: () => setAnchor(null),
    bind: (item: T, disabled: boolean) => ({
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (!disabled) open(event, item);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (
          !disabled &&
          (event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10"))
        )
          open(event, item);
      },
    }),
  };
}

export function ContextMenu({
  anchor,
  label,
  actions,
  close,
}: {
  anchor: Anchor<unknown>;
  label: string;
  actions: {
    label: string;
    icon?: ReactNode;
    danger?: boolean;
    action: () => void;
  }[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    const menu = ref.current!;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: Event) => {
      if (!menu.contains(event.target as Node)) closeRef.current();
    };
    const dismiss = () => closeRef.current();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("contextmenu", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    const scroll = (event: Event) => {
      if (!menu.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("contextmenu", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="context-menu"
      style={{ left: anchor.x, top: anchor.y }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(event) => {
        const buttons = [
          ...ref.current!.querySelectorAll<HTMLButtonElement>("button"),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        let next: number | undefined;
        if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
        if (event.key === "ArrowUp")
          next = (index - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next !== undefined) {
          event.preventDefault();
          buttons[next].focus();
        }
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          anchor.trigger.focus();
          close();
        }
      }}
    >
      {actions.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger ? "danger-quiet" : ""}
          onClick={() => {
            anchor.trigger.focus();
            close();
            item.action();
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
