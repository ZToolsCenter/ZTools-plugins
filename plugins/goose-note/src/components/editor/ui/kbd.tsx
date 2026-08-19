import { cn } from "../utils/cn";

function isMacPlatform() {
  if (typeof window === "undefined") return false;
  const platform = navigator.platform || "";
  return /Mac|iPod|iPhone|iPad/.test(platform);
}

function formatShortcut(shortcut: string) {
  const isMac = isMacPlatform();

  return shortcut
    .split("+")
    .map((part) => {
      const p = part.trim().toLowerCase();
      if (
        p === "mod" ||
        p === "cmdorctrl" ||
        p === "cmdorcontrol" ||
        p === "commandorcontrol" ||
        p === "command" ||
        p === "meta"
      ) {
        return isMac ? "⌘" : "Ctrl";
      }
      if (p === "ctrl" || p === "control") return isMac ? "⌃" : "Ctrl";
      if (p === "alt" || p === "option") return isMac ? "⌥" : "Alt";
      if (p === "shift") return isMac ? "⇧" : "Shift";
      if (p === "enter") return "↵";
      if (p === "backspace") return "⌫";
      if (p === "tab") return "⇥";
      if (p === "esc" || p === "escape") return isMac ? "⎋" : "Esc";
      if (p === "up") return "↑";
      if (p === "down") return "↓";
      if (p === "left") return "←";
      if (p === "right") return "→";
      return part.trim();
    })
    .join(isMac ? "" : " + ");
}

interface KbdProps {
  shortcut: string;
  className?: string;
}

export function Kbd({ shortcut, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center rounded-md border border-[var(--goose-block-subtle-border)] bg-[var(--goose-block-subtle-bg)] px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      {formatShortcut(shortcut)}
    </kbd>
  );
}
