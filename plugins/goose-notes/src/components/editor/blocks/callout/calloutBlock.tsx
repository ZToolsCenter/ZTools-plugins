import { useCallback } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps, type BlockNoteEditor } from "@blocknote/core";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { IconSelector } from "@/pages/workspace/components/shared/IconSelector";
import { cn } from "@/components/editor/utils/cn";
import {
  DEFAULT_CALLOUT_ICON,
  LUCIDE_ICON_TO_EMOJI,
  normalizeCalloutIcon,
} from "./calloutIcons";

export { DEFAULT_CALLOUT_ICON, LUCIDE_ICON_TO_EMOJI, normalizeCalloutIcon };

const LUCIDE_ICON_COMPONENTS = LucideIcons as unknown as Record<
  string,
  LucideIcon
>;

/** 将 Lucide 名（新存）或 emoji（存量）统一渲染为 React 元素 */
function renderCalloutIcon(iconStr: string, className?: string) {
  const resolved = normalizeCalloutIcon(iconStr);
  const IconComp = LUCIDE_ICON_COMPONENTS[resolved];
  if (IconComp) {
    return (
      <IconComp className={cn("h-[1em] w-[1em] stroke-[1.75]", className)} />
    );
  }
  return (
    <span className={cn("text-[1em] leading-none", className)}>{resolved}</span>
  );
}

function stopEditorMouseDown(e: React.MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function CalloutIconPicker({
  icon,
  onPick,
}: {
  icon: string;
  onPick: (iconName: string) => void;
}) {
  const normalizedIcon = normalizeCalloutIcon(icon);

  return (
    <div contentEditable={false} onMouseDown={stopEditorMouseDown}>
      <IconSelector
        value={normalizedIcon}
        onChange={(nextIcon) => onPick(nextIcon || DEFAULT_CALLOUT_ICON)}
        editorContext
      >
        <button
          type="button"
          className="callout-icon-slot shrink-0 rounded transition-colors hover:bg-[var(--goose-interactive-hover)]"
          onMouseDown={stopEditorMouseDown}
          data-callout-icon-trigger
        >
          {renderCalloutIcon(normalizedIcon)}
        </button>
      </IconSelector>
    </div>
  );
}

function CalloutBlockView({
  block,
  contentRef,
  editor,
}: {
  block: any;
  contentRef: (node: HTMLElement | null) => void;
  editor: BlockNoteEditor<any, any, any>;
}) {
  const icon = (block.props.icon as string) || DEFAULT_CALLOUT_ICON;

  const handleIconPick = useCallback(
    (iconName: string) => {
      editor.updateBlock(block.id, {
        props: { icon: iconName },
      });
    },
    [editor, block.id],
  );

  return (
    <div
      className="callout-block group flex w-full items-start gap-3 rounded-lg border border-[var(--goose-callout-border)] bg-[var(--goose-callout-bg)] px-3 py-2 text-[length:var(--editor-module-sm-font-size)] leading-[1.5]"
      data-callout="true"
    >
      <CalloutIconPicker icon={icon} onPick={handleIconPick} />
      <div
        ref={contentRef}
        className="callout-content min-w-0 flex-1"
      />
    </div>
  );
}

export const calloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      ...defaultProps,
      icon: {
        default: DEFAULT_CALLOUT_ICON,
      },
    },
    content: "inline",
  },
  {
    render: (props) => (
      <CalloutBlockView
        block={props.block}
        contentRef={props.contentRef}
        editor={props.editor as BlockNoteEditor<any, any, any>}
      />
    ),
    toExternalHTML: ({ block, contentRef }) => {
      return (
        <div
          className="flex items-start gap-3 rounded-lg border border-[var(--goose-callout-border)] bg-[var(--goose-callout-bg)] px-3 py-2 text-[length:var(--editor-module-sm-font-size)] leading-[1.5]"
          data-callout="true"
        >
          <span className="callout-icon-slot shrink-0">
            {renderCalloutIcon(
              (block.props.icon as string) || DEFAULT_CALLOUT_ICON,
            )}
          </span>
          <div
            ref={contentRef}
            className="callout-content min-w-0 flex-1"
          />
        </div>
      );
    },
  },
)();
