import { useCallback, useEffect, useRef, useState } from "react";
import * as LucideIcons from "lucide-react";
import { Tooltip, TooltipTrigger } from "@/components/editor/ui/tooltip";
import { Toggle } from "@/components/editor/ui/toggle";
import { Button } from "@/components/editor/ui/button";
import { Input } from "@/components/editor/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/editor/ui/popover";
import { useBlockNoteEditor } from "@blocknote/react";
import { ToolbarTooltip, type BindTooltip } from "../ToolbarTooltip";

const ITEM_CLASS = "goose-formatting-toolbar-control";

export function LinkButton({
  isLinkActive,
  linkUrl,
  bindTooltip,
}: {
  isLinkActive: boolean;
  linkUrl: string | undefined;
  bindTooltip: BindTooltip;
}) {
  const editor = useBlockNoteEditor();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUrl(linkUrl || "");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, linkUrl]);

  const handleSubmit = useCallback(() => {
    const trimmed = url.trim();
    if (trimmed) {
      editor.createLink(trimmed);
    }
    setOpen(false);
    setUrl("");
  }, [url, editor]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [handleSubmit],
  );

  if (isLinkActive) {
    return (
      <Tooltip {...bindTooltip("link")}>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={true}
            onPressedChange={() => editor.deleteLink()}
            aria-label="移除链接"
            className={ITEM_CLASS}
          >
            <LucideIcons.Link className="h-[15px] w-[15px]" />
          </Toggle>
        </TooltipTrigger>
        <ToolbarTooltip label="移除链接" />
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip {...bindTooltip("link")}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Toggle
              size="sm"
              pressed={false}
              aria-label="添加链接"
              className={ITEM_CLASS}
            >
              <LucideIcons.Link className="h-[15px] w-[15px]" />
            </Toggle>
          </PopoverTrigger>
        </TooltipTrigger>
        <ToolbarTooltip label="添加链接" shortcut="Mod+K" />
      </Tooltip>
      <PopoverContent
        align="center"
        side="top"
        editorContext
        className="w-72 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-2">
          <Input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://..."
            className="h-8 text-sm"
          />
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleSubmit}
            >
              确认
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
