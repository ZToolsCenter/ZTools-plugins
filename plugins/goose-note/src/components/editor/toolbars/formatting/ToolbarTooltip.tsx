import { TooltipContent } from "@/components/editor/ui/tooltip";
import { Kbd } from "@/components/editor/ui/kbd";
import { getScaledEditorUiPx } from "@/components/editor/utils/editorContextUi";

export function ToolbarTooltip({
  label,
  shortcut,
}: {
  label: string;
  shortcut?: string;
}) {
  return (
    <TooltipContent side="top" sideOffset={getScaledEditorUiPx(8)}>
      <div className="goose-toolbar-tooltip-content inline-flex items-center leading-none whitespace-nowrap">
        <span className="font-medium text-foreground">{label}</span>
        {shortcut ? <Kbd shortcut={shortcut} /> : null}
      </div>
    </TooltipContent>
  );
}

export type BindTooltip = (id: string) => {
  delayDuration: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
