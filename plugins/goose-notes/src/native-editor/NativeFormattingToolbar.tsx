import {
  useBlockNoteEditor,
  useEditorState,
  useSelectedBlocks,
} from "@blocknote/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { TooltipProvider } from "@/components/editor/ui/tooltip";
import { Separator } from "@/components/editor/ui/separator";
import { cn } from "@/components/editor/utils/cn";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";
import { useContextMenu } from "@/components/editor/state/contextMenu";
import { useGlobalScrollActivity } from "@/components/editor/hooks/useGlobalScrollActivity";
import { FormattingToolbarColorPicker } from "@/components/editor/toolbars/formatting/ColorPicker";
import {
  selectionDisallowsFormattingToolbar,
  selectionIsInsideFirstTitleBlock,
  selectionIsInsideHeadingBlock,
  shouldRenderFormattingToolbar,
  useSelectionMarkStates,
} from "@/components/editor/toolbars/formatting/helpers";
import type { BindTooltip } from "@/components/editor/toolbars/formatting/ToolbarTooltip";
import { MarkGroup } from "@/components/editor/toolbars/formatting/groups/MarkGroup";
import { InlineGroup } from "@/components/editor/toolbars/formatting/groups/InlineGroup";
import { LinkButton } from "@/components/editor/toolbars/formatting/groups/LinkButton";
import { AlignGroup } from "@/components/editor/toolbars/formatting/groups/AlignGroup";
import { ClearFormatButton } from "@/components/editor/toolbars/formatting/groups/ClearFormatButton";
import { canRequestAISelection, requestAISelection } from "./aiSelectionBridge";

export { shouldRenderFormattingToolbar };

/** 原生目标的格式工具栏；选区 AI 只经版本化桥接请求原生面板。 */
export function EditorFormattingToolbar() {
  const editor = useBlockNoteEditor();
  const { contentMode } = useEditorPageContext();
  const markStates = useSelectionMarkStates(editor);
  const selectedBlocks = useSelectedBlocks();
  const selectionState = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { selection, doc } = editor.prosemirrorState;
      const selectedText = doc
        .textBetween(selection.from, selection.to, "\n", "\n")
        .trim();
      return {
        hasTextSelection: !selection.empty && selectedText.length > 0,
        disallowsFormattingToolbar: selectionDisallowsFormattingToolbar(editor),
      };
    },
  });
  const isInTitleOne = useEditorState({
    editor,
    selector: ({ editor }) =>
      contentMode === "normalized" && selectionIsInsideFirstTitleBlock(editor),
  });
  const isInHeading = useEditorState({
    editor,
    selector: ({ editor }) => selectionIsInsideHeadingBlock(editor),
  });
  const isContextMenuOpen = Boolean(
    useContextMenu((state) => state.openMenuId),
  );
  const isScrolling = useGlobalScrollActivity({ idleMs: 120 }).isScrolling;
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const bindTooltip = useCallback<BindTooltip>(
    (id) => ({
      delayDuration: 400,
      open: activeTooltip === id,
      onOpenChange: (open) =>
        setActiveTooltip((previous) =>
          open ? id : previous === id ? null : previous,
        ),
    }),
    [activeTooltip],
  );

  useEffect(() => {
    if (menuRef.current) menuRef.current.style.zIndex = "20000";
  }, []);
  useEffect(() => {
    if (isScrolling || isContextMenuOpen) setActiveTooltip(null);
  }, [isContextMenuOpen, isScrolling]);

  const firstBlock = selectedBlocks[0];
  const textAlignment =
    (firstBlock?.props as { textAlignment?: string } | undefined)
      ?.textAlignment ?? "left";
  const linkUrl = editor.getSelectedLinkUrl();
  const canUseAISelection = canRequestAISelection();
  const setTextAlignment = useCallback(
    (alignment: "left" | "center" | "right") => {
      editor.transact(() => {
        for (const block of selectedBlocks) {
          editor.updateBlock(block, { props: { textAlignment: alignment } });
        }
      });
    },
    [editor, selectedBlocks],
  );
  const clearFormatting = useCallback(() => {
    editor.transact(() => {
      editor.removeStyles({
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        code: true,
        textColor: true,
        backgroundColor: true,
      } as any);
      for (const block of selectedBlocks) {
        editor.updateBlock(block, { props: { textAlignment: "left" } });
      }
    });
  }, [editor, selectedBlocks]);

  if (
    !selectionState.hasTextSelection ||
    selectionState.disallowsFormattingToolbar ||
    isInTitleOne
  )
    return null;
  const shouldHide = isScrolling || isContextMenuOpen;

  return (
    <TooltipProvider
      delayDuration={400}
      skipDelayDuration={0}
      disableHoverableContent
    >
      <div
        ref={menuRef}
        data-formatting-toolbar
        data-goose-floating-toolbar="true"
        role="toolbar"
        aria-label="文字格式"
        onMouseDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (
            !target ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "INPUT"
          )
            return;
          if (!target.isContentEditable) event.preventDefault();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className="goose-editor-context-ui z-[20000] w-auto transition-[opacity,transform] duration-150 ease-out"
        style={{
          opacity: shouldHide ? 0 : 1,
          transform: shouldHide ? "scale(0.96)" : "scale(1)",
          pointerEvents: shouldHide ? "none" : "auto",
        }}
      >
        <div className="goose-formatting-toolbar-row">
          <MarkGroup
            isBold={markStates.bold}
            isItalic={markStates.italic}
            isStrike={markStates.strike}
            bindTooltip={bindTooltip}
            hideMarks={isInHeading}
          />
          <InlineGroup
            isUnderline={markStates.underline}
            isCode={markStates.code}
            bindTooltip={bindTooltip}
            hideMarks={isInHeading}
          />
          <FormattingToolbarColorPicker />
          {!isInHeading && (
            <Separator
              orientation="vertical"
              className="goose-formatting-toolbar-separator"
            />
          )}
          <LinkButton
            isLinkActive={Boolean(linkUrl)}
            linkUrl={linkUrl}
            bindTooltip={bindTooltip}
          />
          <Separator
            orientation="vertical"
            className="goose-formatting-toolbar-separator"
          />
          <AlignGroup
            textAlignment={textAlignment}
            setTextAlignment={setTextAlignment}
            bindTooltip={bindTooltip}
          />
          <Separator
            orientation="vertical"
            className="goose-formatting-toolbar-separator"
          />
          <ClearFormatButton
            onClear={clearFormatting}
            bindTooltip={bindTooltip}
          />
          <Separator
            orientation="vertical"
            className="goose-formatting-toolbar-separator"
          />
          <button
            type="button"
            disabled={!canUseAISelection}
            aria-label="AI 改写或转换选区"
            title={
              canUseAISelection
                ? "AI 改写或转换选区"
                : "仅可在原生应用中使用 AI 选区建议"
            }
            className={cn(
              "goose-formatting-toolbar-control",
              canUseAISelection
                ? "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                : "cursor-not-allowed text-muted-foreground/55",
            )}
            onClick={() => {
              requestAISelection(editor);
            }}
          >
            <Sparkles aria-hidden="true" size={15} />
          </button>
        </div>
      </div>
    </TooltipProvider>
  );
}
