import { cn, formatShortcut } from "@/lib/utils";

interface KbdProps {
  shortcut: string;
  className?: string;
}

export function Kbd({ shortcut, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center rounded-md border border-border/85 bg-muted/80 px-1.5 font-mono text-[10px] font-medium text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.35)]",
        className,
      )}
    >
      {formatShortcut(shortcut)}
    </kbd>
  );
}
