import * as React from "react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
interface DialogShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  layout?: "center" | "fullscreen"
  title?: React.ReactNode
  description?: React.ReactNode
  hideClose?: boolean
  contentClassName?: string
  overlayClassName?: string
  bodyClassName?: string
  footer?: React.ReactNode
  children: React.ReactNode
}

export function DialogShell({
  open,
  onOpenChange,
  layout = "center",
  title,
  description,
  hideClose = false,
  contentClassName,
  overlayClassName,
  bodyClassName,
  footer,
  children,
}: DialogShellProps) {
  const isFullscreen = layout === "fullscreen"
  const resolvedOverlayClassName =
    overlayClassName ??
    (isFullscreen ? "bg-transparent backdrop-blur-0" : undefined)
  const hasTitle = Boolean(title)
  const hasDescription = Boolean(description)
  const accessibleTitle = hasTitle ? title : "对话框"
  const accessibleDescription = hasDescription ? description : "对话框内容"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        overlayClassName={resolvedOverlayClassName}
        className={cn(
          "origin-center data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-right-0 data-[state=closed]:slide-out-to-top-0 data-[state=closed]:slide-out-to-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-right-0 data-[state=open]:slide-in-from-top-0 data-[state=open]:slide-in-from-bottom-0",
          isFullscreen
            ? "left-0 top-[var(--goose-top-safe-area,0px)] h-[calc(100dvh-var(--goose-top-safe-area,0px))] w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 shadow-none"
            : "sm:max-w-lg",
          contentClassName
        )}
      >
        {!hideClose && (
          <DialogClose asChild>
            <button
              type="button"
              className={cn(
                "absolute z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
                isFullscreen ? "top-4 right-4" : "top-4 right-4"
              )}
              aria-label="关闭"
              onPointerDown={(e) => { e.preventDefault(); onOpenChange(false); }}
            >
              <LucideIcons.X className="h-7 w-7" />
            </button>
          </DialogClose>
        )}

        <DialogHeader className={cn(hasTitle || hasDescription ? "p-6 pb-0" : "sr-only")}>
          <DialogTitle className={hasTitle ? undefined : "sr-only"}>
            {accessibleTitle}
          </DialogTitle>
          <DialogDescription className={hasDescription ? undefined : "sr-only"}>
            {accessibleDescription}
          </DialogDescription>
        </DialogHeader>

        <div className={cn("min-h-0", bodyClassName)}>{children}</div>

        {footer ? <DialogFooter className="px-6 pb-6 pt-0">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}
