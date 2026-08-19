import * as LucideIcons from "lucide-react";
import { Tooltip, TooltipTrigger } from "@/components/editor/ui/tooltip";
import { Toggle } from "@/components/editor/ui/toggle";
import { ToolbarTooltip, type BindTooltip } from "../ToolbarTooltip";

const ITEM_CLASS = "goose-formatting-toolbar-control";

export function AlignGroup({
  textAlignment,
  setTextAlignment,
  bindTooltip,
}: {
  textAlignment: string;
  setTextAlignment: (alignment: "left" | "center" | "right") => void;
  bindTooltip: BindTooltip;
}) {
  return (
    <>
      <Tooltip {...bindTooltip("align-left")}>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={textAlignment === "left"}
            onPressedChange={() => setTextAlignment("left")}
            aria-label="左对齐"
            className={ITEM_CLASS}
          >
            <LucideIcons.AlignLeft className="h-[15px] w-[15px]" />
          </Toggle>
        </TooltipTrigger>
        <ToolbarTooltip label="左对齐" />
      </Tooltip>

      <Tooltip {...bindTooltip("align-center")}>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={textAlignment === "center"}
            onPressedChange={() => setTextAlignment("center")}
            aria-label="居中对齐"
            className={ITEM_CLASS}
          >
            <LucideIcons.AlignCenter className="h-[15px] w-[15px]" />
          </Toggle>
        </TooltipTrigger>
        <ToolbarTooltip label="居中对齐" />
      </Tooltip>

      <Tooltip {...bindTooltip("align-right")}>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={textAlignment === "right"}
            onPressedChange={() => setTextAlignment("right")}
            aria-label="右对齐"
            className={ITEM_CLASS}
          >
            <LucideIcons.AlignRight className="h-[15px] w-[15px]" />
          </Toggle>
        </TooltipTrigger>
        <ToolbarTooltip label="右对齐" />
      </Tooltip>
    </>
  );
}
