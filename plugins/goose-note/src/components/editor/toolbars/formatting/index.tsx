import {
  useBlockNoteEditor,
  useEditorState,
  useExtension,
} from "@blocknote/react";
import { AIExtension } from "@blocknote/xl-ai";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TooltipProvider } from "@/components/editor/ui/tooltip";
import { Separator } from "@/components/editor/ui/separator";
import { cn } from "@/components/editor/utils/cn";
import {
  useEditorPageContext,
  useEditorSettings,
} from "@/components/editor/platform/hostContext";
import { useContextMenu } from "@/components/editor/state/contextMenu";
import { useGlobalScrollActivity } from "@/components/editor/hooks/useGlobalScrollActivity";
import { useFormattingToolbarAi } from "@/components/editor/state/formattingToolbarAi";
import { FormattingToolbarColorPicker } from "@/components/editor/toolbars/formatting/ColorPicker";
import { setFakeSelection } from "@/components/editor/extensions/fakeSelectionExtension";
import {
  applySelectionTextAlignment,
  clearSelectionFormatting,
  getFormattingToolbarCapabilities,
  resolveFormattingToolbarAiBlockId,
  selectionDisallowsFormattingToolbar,
  selectionIsInsideFirstTitleBlock,
  selectionIsInsideHeadingBlock,
  shouldRenderFormattingToolbar,
  useSelectionMarkStates,
} from "@/components/editor/toolbars/formatting/helpers";
import type { BindTooltip } from "@/components/editor/toolbars/formatting/ToolbarTooltip";
import { AiButton } from "@/components/editor/toolbars/formatting/groups/AiButton";
import { toast } from "@/components/ui/sonner";
import { getCustomAIApiKey } from "@/lib/ai-provider";
import { MarkGroup } from "@/components/editor/toolbars/formatting/groups/MarkGroup";
import { InlineGroup } from "@/components/editor/toolbars/formatting/groups/InlineGroup";
import { LinkButton } from "@/components/editor/toolbars/formatting/groups/LinkButton";
import { AlignGroup } from "@/components/editor/toolbars/formatting/groups/AlignGroup";
import { ClearFormatButton } from "@/components/editor/toolbars/formatting/groups/ClearFormatButton";

export { shouldRenderFormattingToolbar };

function ToolbarSectionSeparator() {
  return (
    <Separator
      orientation="vertical"
      className="goose-formatting-toolbar-separator"
    />
  );
}

export function EditorFormattingToolbar() {
  const editor = useBlockNoteEditor();
  // 未启用 AI 的构建跳过 useExtension；编译期分支在同一构建内保持稳定。
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const aiExtension = __GOOSE_EDITOR_AI__
    ? useExtension(AIExtension)
    : undefined;
  const { ai: aiSettings } = useEditorSettings();
  const { contentMode } = useEditorPageContext();
  const protectsFirstTitle = contentMode === "normalized";
  const markStates = useSelectionMarkStates(editor);

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

  // 仅 normalized 文档把物理首块 H1 视为受保护的页面标题。
  const isInTitleOne = useEditorState({
    editor,
    selector: ({ editor }) =>
      protectsFirstTitle && selectionIsInsideFirstTitleBlock(editor),
  });

  const caps = useEditorState({
    editor,
    selector: ({ editor }) =>
      getFormattingToolbarCapabilities(editor, {
        isInHeading: selectionIsInsideHeadingBlock(editor),
      }),
  });

  const aiActive = useFormattingToolbarAi((s) => s.active);
  const activateFormattingToolbarAi = useFormattingToolbarAi(
    (state) => state.activate,
  );
  const resetFormattingToolbarAi = useFormattingToolbarAi(
    (state) => state.reset,
  );

  const openMenuId = useContextMenu((state) => state.openMenuId);
  const isContextMenuOpen = Boolean(openMenuId);
  const scrollActivity = useGlobalScrollActivity({ idleMs: 120 });
  const isScrolling = scrollActivity.isScrolling;

  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const bindTooltip = useCallback<BindTooltip>(
    (id) => ({
      delayDuration: 400,
      open: activeTooltip === id,
      onOpenChange: (open) =>
        setActiveTooltip((prev) => (open ? id : prev === id ? null : prev)),
    }),
    [activeTooltip],
  );

  useEffect(() => {
    if (!menuRef.current) return;
    menuRef.current.style.zIndex = "20000";
  }, []);

  useEffect(() => {
    if (!isScrolling && !isContextMenuOpen) return;
    setActiveTooltip(null);
  }, [isScrolling, isContextMenuOpen]);

  // xl-ai 接管：旧自家 AiPanel 不再触发，AI 按钮改为打开 xl-ai 的 AIMenu。
  // 保存 selection 作为 AI 浮层锚点，并在菜单生命周期内隐藏格式工具栏。
  const handleAiActivate = useCallback(() => {
    try {
      const { selection } = editor.prosemirrorState;
      if (selection.empty) return;

      if (!aiSettings.enabled) {
        toast.error("AI 助手尚未开启，请先到设置中打开");
        return;
      }
      const apiKey = getCustomAIApiKey(aiSettings);
      if (!apiKey) {
        toast.error(
          '未填写 API Key。请前往"设置 → AI 助手 → AI 服务"检查配置。',
        );
        return;
      }
      const hasModel =
        aiSettings.selectedModelId?.trim() ||
        aiSettings.customModelOptions[0]?.id;
      if (!hasModel) {
        toast.error("请先保存 AI 服务配置并获取模型列表");
        return;
      }

      const saved = { from: selection.from, to: selection.to };
      setFakeSelection(editor, saved);
      activateFormattingToolbarAi(saved);

      const blockId = resolveFormattingToolbarAiBlockId(editor);
      if (!blockId) {
        setFakeSelection(editor, null);
        resetFormattingToolbarAi();
        toast.error("无法定位当前选区，请重新选中表格或文字后再试");
        return;
      }
      setActiveTooltip(null);
      aiExtension?.openAIMenuAtBlock(blockId);
    } catch {
      try {
        setFakeSelection(editor, null);
      } catch {
        /* ignore */
      }
      resetFormattingToolbarAi();
    }
  }, [
    activateFormattingToolbarAi,
    aiExtension,
    aiSettings,
    editor,
    resetFormattingToolbarAi,
  ]);

  const isBold = markStates.bold;
  const isItalic = markStates.italic;
  const isStrike = markStates.strike;
  const isUnderline = markStates.underline;
  const isCode = markStates.code;

  const textAlignment = caps.textAlignment;

  const linkUrl = caps.showLink ? editor.getSelectedLinkUrl() : undefined;
  const isLinkActive = !!linkUrl;

  const setTextAlignment = useCallback(
    (alignment: "left" | "center" | "right") => {
      applySelectionTextAlignment(editor, alignment);
    },
    [editor],
  );

  const clearFormatting = useCallback(() => {
    clearSelectionFormatting(editor);
  }, [editor]);

  // 小窗的格式栏是固定底栏，滚动不会遮挡选区，也不应闪烁隐藏；
  // 常规笔记本的浮动栏仍在滚动时收起，避免与正文一起漂移。
  const shouldHideForScroll =
    (!__GOOSE_EDITOR_COMPACT__ && isScrolling) || isContextMenuOpen;
  // While AI is active we keep the toolbar visible regardless of scroll/menu.
  const shouldHide = !aiActive && shouldHideForScroll;

  // Selection-based gating only matters when AI mode isn't already active.
  if (
    !aiActive &&
    (!selectionState.hasTextSelection ||
      selectionState.disallowsFormattingToolbar ||
      isInTitleOne)
  ) {
    return null;
  }

  const showAiButton =
    __GOOSE_EDITOR_AI__ && aiSettings.enabled && caps.showAi;

  // 分节渲染：仅在「相邻两节都可见」时插入 Separator，避免双分隔线 / 尾随分隔线。
  const sections: ReactNode[] = [];

  if (showAiButton) {
    sections.push(
      <AiButton
        key="ai"
        onActivate={handleAiActivate}
        bindTooltip={bindTooltip}
      />,
    );
  }

  if (caps.showMarks || caps.showColors) {
    sections.push(
      <Fragment key="styles">
        {caps.showMarks && (
          <MarkGroup
            isBold={isBold}
            isItalic={isItalic}
            isStrike={isStrike}
            bindTooltip={bindTooltip}
          />
        )}
        {caps.showMarks && (
          <InlineGroup
            isUnderline={isUnderline}
            isCode={isCode}
            bindTooltip={bindTooltip}
          />
        )}
        {caps.showColors && <FormattingToolbarColorPicker />}
      </Fragment>,
    );
  }

  if (caps.showLink) {
    sections.push(
      <LinkButton
        key="link"
        isLinkActive={isLinkActive}
        linkUrl={linkUrl}
        bindTooltip={bindTooltip}
      />,
    );
  }

  if (caps.showAlign) {
    sections.push(
      <AlignGroup
        key="align"
        textAlignment={textAlignment}
        setTextAlignment={setTextAlignment}
        bindTooltip={bindTooltip}
      />,
    );
  }

  if (caps.showClear) {
    sections.push(
      <ClearFormatButton
        key="clear"
        onClear={clearFormatting}
        bindTooltip={bindTooltip}
      />,
    );
  }

  const selectionModeClass =
    caps.mode === "cellText" || caps.mode === "cellGrid"
      ? "goose-formatting-toolbar--cell"
      : caps.mode === "multiBlock"
        ? "goose-formatting-toolbar--multi"
        : undefined;

  return (
    <TooltipProvider
      delayDuration={400}
      skipDelayDuration={0}
      disableHoverableContent
    >
      <div
        ref={menuRef}
        data-formatting-toolbar
        data-selection-mode={caps.mode}
        data-goose-floating-toolbar={
          !__GOOSE_EDITOR_COMPACT__ ? "true" : undefined
        }
        onMouseDown={(e) => {
          // Allow native focus on the AI textarea; everything else uses onClick.
          const target = e.target as HTMLElement | null;
          if (!target) return;
          if (target.tagName === "TEXTAREA" || target.tagName === "INPUT")
            return;
          if (target.isContentEditable) return;
          e.preventDefault();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        role="toolbar"
        aria-label="文字格式"
        className={cn(
          // 小窗底栏已用固定 px 尺寸，禁止再套 CSS zoom：
          // uTools 旧内核会放大 zoom 祖先的 getBoundingClientRect，
          // 导致 Portal 色板 / tooltip 错位（只露出「文本颜色」标题）。
          !__GOOSE_EDITOR_COMPACT__ && "goose-formatting-toolbar-scaled",
          selectionModeClass,
          "z-[20000] transition-[opacity,transform,width] duration-150 ease-out",
          aiActive ? "w-[520px] max-w-[calc(100vw-24px)]" : "w-auto",
        )}
        style={{
          opacity: shouldHide ? 0 : 1,
          transform: shouldHide ? "scale(0.96)" : "scale(1)",
          pointerEvents: shouldHide ? "none" : "auto",
        }}
      >
        <div className="goose-formatting-toolbar-row">
          {sections.map((section, index) => (
            <Fragment key={index}>
              {index > 0 && <ToolbarSectionSeparator />}
              {section}
            </Fragment>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
