import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Flame,
  Info,
  Lightbulb,
  Plus,
  Sparkles,
  Trash2
} from "lucide-react";
import {
  SUPPORTED_CODE_LANGUAGES,
  SyntaxHighlightedCode
} from "../core/codeSyntaxHighlighter";
import { EmojiEntry, searchEmojiShortcodes } from "../core/emojiDictionary";
import {
  InlineRenderContext,
  renderInlineMarkdown
} from "../core/inlineRenderer";
import {
  htmlToMarkdownSmartPaste,
  prettifyMarkdownTable,
  serializeBlockToRaw,
  slugifyHeading
} from "../core/markdownParser";
import {
  handleListBackspace,
  handleListEnter,
  handleListTab
} from "../core/listAutoIndent";
import { EditHistoryManager } from "../core/editHistory";
import {
  isImeCompositionKeyDown,
  isCaretAtVisualEdge,
  shouldNavigateAcrossVisualEdge
} from "../core/textareaVisualNavigation";
import { usePendingVisualCursorIntent } from "../hooks/usePendingVisualCursorIntent";
import {
  MathFormulaView,
  MermaidDiagramView
} from "../core/mathAndDiagramRenderer";
import {
  SlashCommandItem,
  SlashCommandMenu,
  getGroupedSlashCommands
} from "./SlashCommandMenu";
import {
  AlertKind,
  MarkdownBlock,
  OutlineItem,
  TableAlign,
  TyporaPreferences
} from "../types/typora";

export interface LivePreviewEditorProps {
  markdown: string;
  blocks: MarkdownBlock[];
  outline: OutlineItem[];
  yamlMeta: Record<string, string>;
  refLinks: Record<string, { url: string; title?: string }>;
  footnotes: Record<string, string>;
  focusedBlockId: string | null;
  sourceMode: boolean;
  readingMode?: boolean;
  typewriterMode: boolean;
  searchHighlight: string;
  docPath: string | null;
  preferences: TyporaPreferences;
  onFocusBlock: (blockId: string | null) => void;
  onUpdateBlock: (blockId: string, updatedBlock: MarkdownBlock) => void;
  onReplaceBlockWithRaw: (blockId: string, newRawMarkdown: string) => void;
  onInsertBlockAfter: (
    afterBlockId: string,
    rawMarkdown?: string,
    focusNewBlock?: boolean
  ) => void;
  onExitListAndInsertBlockAfter?: (
    blockId: string,
    trimmedListRaw: string
  ) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDeleteBlock: (blockId: string) => void;
  onChangeFullMarkdown: (nextMarkdown: string) => void;
  onOpenLink: (url: string) => void;
  onJumpToHeading: (blockId: string) => void;
  onContextMenuRequest: (e: React.MouseEvent, blockId: string | null) => void;
  onPasteImageDataUrl?: (dataUrl: string) => string | null;
  selectedBlockIds?: string[];
  onSelectBlocks?: (blockIds: string[]) => void;
  onTriggerAiAction?: (actionName: string, selectedText?: string) => void;
}

const ALERT_ICONS: Record<AlertKind, React.ReactNode> = {
  NOTE: <Info size={15} />,
  TIP: <Lightbulb size={15} />,
  IMPORTANT: <Sparkles size={15} />,
  WARNING: <AlertTriangle size={15} />,
  CAUTION: <Flame size={15} />
};

function computeRawOffsetFromDOM(
  containerEl: HTMLElement,
  range: Range,
  maxRawLen: number
): number | null {
  const targetNode = range.startContainer;
  const targetOffset = range.startOffset;

  const rawCarrier = (
    targetNode instanceof HTMLElement
      ? targetNode.closest("[data-raw-start]")
      : targetNode.parentElement?.closest("[data-raw-start]")
  ) as HTMLElement | null;

  if (rawCarrier && containerEl.contains(rawCarrier)) {
    const rawStart = parseInt(rawCarrier.getAttribute("data-raw-start") || "0", 10);
    const markerLen = parseInt(rawCarrier.getAttribute("data-marker-len") || "0", 10);
    return Math.min(maxRawLen, Math.max(0, rawStart + markerLen + targetOffset));
  }
  return null;
}

function getCharacterOffsetWithinElement(
  container: Node,
  targetNode: Node,
  targetOffset: number
): number {
  let charCount = 0;
  const walk = (current: Node): boolean => {
    if (current === targetNode) {
      charCount += targetOffset;
      return true;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      charCount += current.textContent ? current.textContent.length : 0;
    } else {
      for (let i = 0; i < current.childNodes.length; i++) {
        if (walk(current.childNodes[i])) return true;
      }
    }
    return false;
  };
  walk(container);
  return charCount;
}

/**
 * 100% Typora-aligned point-to-character exact cursor positioning engine
 * Given mouse click coordinates (clientX, clientY):
 * - Exactly resolves character offset via data-raw-start tokens
 * - Preserves heading prefix and aligns cursor to exact clicked letter
 * - Clicking right white space hits line end; clicking left margin hits line start
 */
function computeBlockCursorOffset(
  block: MarkdownBlock,
  blockEl: HTMLElement | null,
  clientX: number,
  clientY: number
): number {
  const raw = block.raw || "";
  if (!blockEl || !raw) return 0;
  const rect = blockEl.getBoundingClientRect();

  // 1. Heading Block
  if (block.type === "heading") {
    const prefixLen = (block.headingLevel || 1) + 1; // e.g. "## "
    if (clientX <= rect.left + 24) {
      return prefixLen;
    }
    if (clientX >= rect.right - 15) {
      return raw.length;
    }

    if (typeof document !== "undefined" && document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (range && blockEl.contains(range.startContainer)) {
        const exact = computeRawOffsetFromDOM(blockEl, range, raw.length - prefixLen);
        if (exact !== null) {
          return Math.min(raw.length, prefixLen + exact);
        }
        const charOffset = getCharacterOffsetWithinElement(
          blockEl,
          range.startContainer,
          range.startOffset
        );
        return Math.min(raw.length, prefixLen + charOffset);
      }
    }
    return prefixLen;
  }

  // 2. List Block
  if (block.type === "list") {
    const rawLines = raw.split("\n");
    const liElements = Array.from(blockEl.querySelectorAll("li")) as HTMLLIElement[];
    let targetLi: HTMLLIElement | null = null;

    for (const li of liElements) {
      const r = li.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        targetLi = li;
        break;
      }
    }
    if (!targetLi && liElements.length > 0) {
      let minDist = Infinity;
      for (const li of liElements) {
        const r = li.getBoundingClientRect();
        const dist = Math.abs(clientY - (r.top + r.height / 2));
        if (dist < minDist) {
          minDist = dist;
          targetLi = li;
        }
      }
    }

    let itemIdx = 0;
    if (targetLi) {
      const dataIdx = targetLi.getAttribute("data-item-idx");
      if (dataIdx !== null) {
        itemIdx = parseInt(dataIdx, 10);
      } else {
        const idxInList = liElements.indexOf(targetLi);
        itemIdx = idxInList >= 0 ? idxInList : 0;
      }
    }

    let totalOffset = 0;
    for (let k = 0; k < itemIdx && k < rawLines.length; k++) {
      totalOffset += rawLines[k].length + 1;
    }
    const currentLine = rawLines[itemIdx] || "";
    const prefixMatch = currentLine.match(/^(\s*)([-*+]|\d+[\.)])\s+/);
    const prefixLen = prefixMatch ? prefixMatch[0].length : 0;

    if (targetLi) {
      const liRect = targetLi.getBoundingClientRect();
      if (clientX >= liRect.right - 10) {
        return totalOffset + currentLine.length;
      }
      if (clientX <= liRect.left + 5) {
        return totalOffset + prefixLen;
      }
      if (typeof document !== "undefined" && document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(clientX, clientY);
        if (range && targetLi.contains(range.startContainer)) {
          const exact = computeRawOffsetFromDOM(targetLi, range, currentLine.length - prefixLen);
          if (exact !== null) {
            return totalOffset + prefixLen + exact;
          }
          const charInLi = getCharacterOffsetWithinElement(
            targetLi,
            range.startContainer,
            range.startOffset
          );
          return totalOffset + Math.min(currentLine.length, Math.max(prefixLen, charInLi));
        }
      }
    }
    return totalOffset + currentLine.length;
  }

  // 3. Paragraph, Blockquote, Code, Table, or other block
  if (clientX <= rect.left + 10) {
    return 0;
  }
  if (clientX >= rect.right - 10) {
    return raw.length;
  }

  if (typeof document !== "undefined" && document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (range && blockEl.contains(range.startContainer)) {
      const exact = computeRawOffsetFromDOM(blockEl, range, raw.length);
      if (exact !== null) {
        return exact;
      }
      const charOffset = getCharacterOffsetWithinElement(
        blockEl,
        range.startContainer,
        range.startOffset
      );
      return Math.min(raw.length, Math.max(0, charOffset));
    }
  }

  return raw.length;
}

/**
 * Global smart spatial projection engine for click-to-focus (Typora Alignment):
 * Given clientX/clientY anywhere in the editor viewport (including wide margins,
 * left/right container paddings, inter-block vertical gaps):
 * - If vertically in line with a block, directly hits that block (even 500px away on the margin);
 * - If in the vertical gap between blocks, snaps to the closest block;
 * - If above the first block, snaps to the beginning of the first block;
 * - If below the last block, snaps to tailDraft.
 */
function findSmartTargetBlockAndOffset(
  clientX: number,
  clientY: number,
  blocks: MarkdownBlock[],
  hiddenBlockIds: Set<string>
): {
  type: "block" | "tailDraft" | "emptyDoc";
  blockId?: string;
  offset?: number;
} {
  const visibleBlocks = blocks.filter((b) => !hiddenBlockIds.has(b.id));
  if (visibleBlocks.length === 0) {
    return { type: "emptyDoc" };
  }

  interface BlockGeometry {
    block: MarkdownBlock;
    el: HTMLElement;
    rect: DOMRect;
  }
  const geometries: BlockGeometry[] = [];
  for (const b of visibleBlocks) {
    const el = document.getElementById(b.id);
    if (el) {
      geometries.push({
        block: b,
        el,
        rect: el.getBoundingClientRect()
      });
    }
  }

  if (geometries.length === 0) {
    return { type: "tailDraft" };
  }

  const first = geometries[0];
  const last = geometries[geometries.length - 1];

  // 1. Clicked above the first block
  if (clientY < first.rect.top) {
    const prefixLen =
      first.block.type === "heading" ? (first.block.headingLevel || 1) + 1 : 0;
    return {
      type: "block",
      blockId: first.block.id,
      offset: prefixLen
    };
  }

  // 2. Clicked below the last block
  if (clientY > last.rect.bottom + 4) {
    return { type: "tailDraft" };
  }

  // 3. Scan through all blocks: direct vertical row hit or gap hit
  for (let i = 0; i < geometries.length; i++) {
    const curr = geometries[i];

    // Case A: Vertically directly inside this block's height range
    if (clientY >= curr.rect.top && clientY <= curr.rect.bottom) {
      const offset = computeBlockCursorOffset(
        curr.block,
        curr.el,
        clientX,
        clientY
      );
      return {
        type: "block",
        blockId: curr.block.id,
        offset
      };
    }

    // Case B: Vertically inside the gap between curr and next
    if (i + 1 < geometries.length) {
      const next = geometries[i + 1];
      if (clientY > curr.rect.bottom && clientY < next.rect.top) {
        const distToPrev = clientY - curr.rect.bottom;
        const distToNext = next.rect.top - clientY;
        if (distToPrev <= distToNext) {
          return {
            type: "block",
            blockId: curr.block.id,
            offset: curr.block.raw.length
          };
        } else {
          const nextPrefix =
            next.block.type === "heading"
              ? (next.block.headingLevel || 1) + 1
              : 0;
          return {
            type: "block",
            blockId: next.block.id,
            offset: nextPrefix
          };
        }
      }
    }
  }

  // Fallback: closest by vertical center
  let closest = geometries[0];
  let minDiff = Infinity;
  for (const g of geometries) {
    const center = (g.rect.top + g.rect.bottom) / 2;
    const diff = Math.abs(clientY - center);
    if (diff < minDiff) {
      minDiff = diff;
      closest = g;
    }
  }

  return {
    type: "block",
    blockId: closest.block.id,
    offset: computeBlockCursorOffset(
      closest.block,
      closest.el,
      clientX,
      clientY
    )
  };
}

export const LivePreviewEditor: React.FC<LivePreviewEditorProps> = ({
  markdown,
  blocks,
  outline,
  yamlMeta,
  refLinks,
  footnotes,
  focusedBlockId,
  sourceMode,
  readingMode = false,
  typewriterMode,
  searchHighlight,
  docPath,
  preferences,
  onFocusBlock,
  onUpdateBlock,
  onReplaceBlockWithRaw,
  onInsertBlockAfter,
  onExitListAndInsertBlockAfter: _onExitListAndInsertBlockAfter,
  onUndo,
  onRedo,
  onDeleteBlock,
  onChangeFullMarkdown,
  onOpenLink,
  onJumpToHeading,
  onContextMenuRequest,
  onPasteImageDataUrl,
  selectedBlockIds = [],
  onSelectBlocks,
  onTriggerAiAction
}) => {
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [collapsedHeadingIds, setCollapsedHeadingIds] = useState<Set<string>>(
    () => new Set()
  );
  const [activeTableCell, setActiveTableCell] = useState<{
    blockId: string;
    rowIdx: number; // -1 for header
    colIdx: number;
  } | null>(null);
  const [emojiPopup, setEmojiPopup] = useState<{
    blockId: string;
    prefix: string;
    items: EmojiEntry[];
  } | null>(null);

  // Feishu/Notion style Slash command dropdown menu state
  const [slashMenu, setSlashMenu] = useState<{
    blockId: string;
    query: string;
    slashPrefix: string;
    selectedIndex: number;
  } | null>(null);

  const { orderedItems: filteredSlashCommands } = useMemo(() => {
    if (!slashMenu) return { orderedItems: [] };
    return getGroupedSlashCommands(slashMenu.query);
  }, [slashMenu?.query]);

  const focusedWrapperRef = useRef<HTMLDivElement | null>(null);
  const preferredCursorPosRef = useRef<number | null>(null);
  const { applyToTextarea: applyPendingVisualCursorIntent, focusAtVisualEdge } =
    usePendingVisualCursorIntent(preferredCursorPosRef, onFocusBlock);
  const [emptyDocDraft, setEmptyDocDraft] = useState<string | null>(null);
  const emptyDocDraftRef = useRef<string | null>(null);
  emptyDocDraftRef.current = emptyDocDraft;
  const emptyDocHistoryRef = useRef<EditHistoryManager>(
    new EditHistoryManager("", 0)
  );
  const [tailDraft, setTailDraft] = useState<string | null>(null);
  const tailDraftRef = useRef<string | null>(null);
  tailDraftRef.current = tailDraft;
  const tailHistoryRef = useRef<EditHistoryManager>(
    new EditHistoryManager("", 0)
  );
  const [midDraft, setMidDraft] = useState<{
    afterBlockId: string;
    content: string;
  } | null>(null);
  const midDraftRef = useRef<{
    afterBlockId: string;
    content: string;
  } | null>(null);
  midDraftRef.current = midDraft;
  const midHistoryRef = useRef<EditHistoryManager>(
    new EditHistoryManager("", 0)
  );
  const blockHistoryRef = useRef<{
    blockId: string;
    history: EditHistoryManager;
  } | null>(null);
  const justCommittedTimeRef = useRef<number>(0);

  // Commit and persist any pending mid draft content into real document markdown
  const commitMidDraft = useCallback(
    (focusNewBlock = false) => {
      const current = midDraftRef.current;
      if (current !== null) {
        const hasContent = current.content.trim().length > 0;
        if (hasContent) {
          onInsertBlockAfter(
            current.afterBlockId,
            current.content.trimEnd(),
            focusNewBlock
          );
        }
        midDraftRef.current = null;
        setMidDraft(null);
        justCommittedTimeRef.current = Date.now();
      }
    },
    [onInsertBlockAfter]
  );

  // Commit and persist any pending tail draft content into real document markdown
  const commitTailDraft = useCallback(
    (focusNewBlock = false) => {
      const current = tailDraftRef.current;
      if (current !== null) {
        const hasContent = current.trim().length > 0;
        if (hasContent && blocks.length > 0) {
          const contentToInsert = current.trimEnd();
          onInsertBlockAfter(
            blocks[blocks.length - 1].id,
            contentToInsert,
            focusNewBlock
          );
        }
        tailDraftRef.current = null;
        setTailDraft(null);
        justCommittedTimeRef.current = Date.now();
      }
    },
    [blocks, onInsertBlockAfter]
  );

  // Handle click on a block wrapper (supporting Shift multi-select, Cmd/Ctrl toggle, or normal click)
  const handleBlockClick = useCallback(
    (blockId: string, e: React.MouseEvent) => {
      if (readingMode) return;
      e.stopPropagation();

      // If user typed in tail draft or mid draft, commit safely before switching blocks
      commitTailDraft();
      commitMidDraft();

      // 1. Shift + Click: Range multi-selection
      if (e.shiftKey) {
        e.preventDefault();
        const anchorId =
          selectedBlockIds[0] || focusedBlockId || blocks[0]?.id;
        const anchorIdx = blocks.findIndex((b) => b.id === anchorId);
        const targetIdx = blocks.findIndex((b) => b.id === blockId);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const start = Math.min(anchorIdx, targetIdx);
          const end = Math.max(anchorIdx, targetIdx);
          const rangeIds = blocks.slice(start, end + 1).map((b) => b.id);
          onSelectBlocks?.(rangeIds);
          onFocusBlock(null);
        }
        return;
      }

      // 2. Cmd/Ctrl + Click: Discrete toggle multi-selection
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const next = selectedBlockIds.includes(blockId)
          ? selectedBlockIds.filter((id) => id !== blockId)
          : [...selectedBlockIds, blockId];
        onSelectBlocks?.(next);
        onFocusBlock(null);
        return;
      }

      // 3. Normal Click: Clear multi-selection and focus the clicked block
      if (selectedBlockIds.length > 0) {
        onSelectBlocks?.([]);
      }

      // Accurately compute cursor position from click location (point-to-char)
      let targetOffset: number | null = null;
      const targetBlock = blocks.find((b) => b.id === blockId);

      if (targetBlock) {
        const blockEl =
          (e.currentTarget as HTMLElement) || document.getElementById(blockId);
        targetOffset = computeBlockCursorOffset(
          targetBlock,
          blockEl,
          e.clientX,
          e.clientY
        );
      }

      preferredCursorPosRef.current = targetOffset;
      if (focusedBlockId === blockId && targetOffset !== null) {
        const activeTa = focusedWrapperRef.current?.querySelector<HTMLTextAreaElement>(
          "textarea.ty-live-textarea"
        );
        if (activeTa) {
          try {
            activeTa.setSelectionRange(targetOffset, targetOffset);
          } catch {}
        }
      }
      onFocusBlock(blockId);
    },
    [blocks, focusedBlockId, onFocusBlock, onSelectBlocks, readingMode, selectedBlockIds]
  );

  const toggleHeadingCollapse = (headingBlockId: string) => {
    setCollapsedHeadingIds((prev) => {
      const next = new Set(prev);
      if (next.has(headingBlockId)) {
        next.delete(headingBlockId);
      } else {
        next.add(headingBlockId);
      }
      return next;
    });
  };

  // Compute hidden block IDs and folded section counts for each collapsed heading
  const { hiddenBlockIds, foldedCountsByHeadingId } = useMemo(() => {
    const hidden = new Set<string>();
    const counts = new Map<string, number>();

    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i];
      if (b.type === "heading" && collapsedHeadingIds.has(b.id)) {
        const currentLevel = b.headingLevel || 1;
        let count = 0;
        for (let j = i + 1; j < blocks.length; j += 1) {
          const child = blocks[j];
          if (
            child.type === "heading" &&
            (child.headingLevel || 1) <= currentLevel
          ) {
            break;
          }
          hidden.add(child.id);
          count += 1;
        }
        counts.set(b.id, count);
      }
    }

    return { hiddenBlockIds: hidden, foldedCountsByHeadingId: counts };
  }, [blocks, collapsedHeadingIds]);

  useEffect(() => {
    if (typewriterMode && focusedWrapperRef.current) {
      focusedWrapperRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }, [focusedBlockId, typewriterMode]);

  // Handle clicking the document bottom area to focus or append paragraph
  const handleFocusOrAppendEnd = useCallback(() => {
    if (readingMode) return;
    if (blocks.length === 0) {
      setEmptyDocDraft("");
      setTailDraft(null);
      tailDraftRef.current = null;
      onFocusBlock(null);
      return;
    }

    // A. If user is currently typing in tail draft, keep it focused
    if (tailDraftRef.current !== null) {
      return;
    }

    // B. If user is currently in mid draft, commit safely
    if (midDraftRef.current !== null) {
      commitMidDraft(false);
    }

    // C. If an existing block is currently focused, commit its content
    if (focusedBlockId) {
      const activeEl = focusedWrapperRef.current?.querySelector<HTMLTextAreaElement>(
        "textarea.ty-live-textarea"
      );
      if (activeEl && activeEl.value !== undefined) {
        const targetBlock = blocks.find((b) => b.id === focusedBlockId);
        if (targetBlock && targetBlock.raw !== activeEl.value) {
          onReplaceBlockWithRaw(focusedBlockId, activeEl.value);
        }
      }
    }

    const lastBlock = blocks[blocks.length - 1];
    // D. If the last block is already an empty paragraph, focus it directly
    if (lastBlock.type === "paragraph" && !lastBlock.raw.trim()) {
      setTailDraft(null);
      tailDraftRef.current = null;
      onFocusBlock(lastBlock.id);
      return;
    }

    // E. Otherwise, seamlessly open tail draft at document end for typing!
    onFocusBlock(null);
    tailDraftRef.current = "";
    setTailDraft("");
  }, [blocks, commitMidDraft, commitTailDraft, focusedBlockId, onFocusBlock, onReplaceBlockWithRaw, readingMode]);

  // Click outside the active block (menus, sidebars, footer) exits live edit mode
  useEffect(() => {
    if (!focusedBlockId && emptyDocDraft === null && tailDraft === null && midDraft === null) return;

    const handlePointerDownOutside = (e: MouseEvent | PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 1. Keep focus if clicking inside currently active block
      if (
        focusedWrapperRef.current &&
        focusedWrapperRef.current.contains(target)
      ) {
        return;
      }

      // 2. Keep focus if clicking active block auxiliary dropdowns or modal overlays
      if (
        target.closest(
          ".ty-table-toolbar, .ty-menu-dropdown, .ty-slash-menu-popup, .ty-context-menu, .ty-modal-overlay"
        )
      ) {
        return;
      }

      setSlashMenu(null);

      // 3. Keep focus / let the canvas handle clicks inside editor scroll and write container
      if (target.closest(".ty-editor-scroll, #write, .ty-editor-bottom-pad")) {
        return;
      }

      // 4. Any other click outside (top menu bar, sidebar, footer, empty window chrome) exits block editing
      onFocusBlock(null);
      if (emptyDocDraft !== null) {
        const trimmed = emptyDocDraft.trim();
        if (trimmed) {
          onChangeFullMarkdown(trimmed);
        }
        setEmptyDocDraft(null);
      }
      commitTailDraft();
      commitMidDraft();
    };

    window.addEventListener("pointerdown", handlePointerDownOutside);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, [
    focusedBlockId,
    emptyDocDraft,
    tailDraft,
    midDraft,
    blocks,
    onChangeFullMarkdown,
    onFocusBlock,
    commitTailDraft,
    commitMidDraft
  ]);

  const inlineCtx: InlineRenderContext = useMemo(
    () => ({
      docPath,
      rootUrlFromYaml: yamlMeta["typora-root-url"] || "",
      refLinks,
      footnotes,
      searchHighlight,
      enableInlineMath: preferences.enableInlineMath,
      enableHighlight: preferences.enableHighlight,
      enableSubSup: preferences.enableSubscriptSuperscript,
      onOpenLink
    }),
    [
      docPath,
      yamlMeta,
      refLinks,
      footnotes,
      searchHighlight,
      preferences.enableInlineMath,
      preferences.enableHighlight,
      preferences.enableSubscriptSuperscript,
      onOpenLink
    ]
  );

  const handleLiveRawChange = useCallback(
    (block: MarkdownBlock, nextRaw: string) => {
      // Check if user is typing an :emoji shortcode at the end of line
      const emojiMatch = nextRaw.match(/:([a-zA-Z0-9_+-]{2,18})$/);
      if (emojiMatch) {
        const matches = searchEmojiShortcodes(emojiMatch[1], 6);
        if (matches.length > 0) {
          setEmojiPopup({
            blockId: block.id,
            prefix: emojiMatch[0],
            items: matches
          });
        } else {
          setEmojiPopup(null);
        }
      } else {
        setEmojiPopup(null);
      }

      // Check if user is typing a Feishu-style slash command (e.g. "/" or "/h1" or "/table")
      const slashMatch = nextRaw.match(/(?:^|\s)\/([a-zA-Z0-9_\u4e00-\u9fa5]*)$/);
      if (slashMatch) {
        setSlashMenu({
          blockId: block.id,
          query: slashMatch[1] || "",
          slashPrefix: slashMatch[0].trim(),
          selectedIndex: 0
        });
      } else {
        setSlashMenu((prev) => (prev?.blockId === block.id ? null : prev));
      }

      onReplaceBlockWithRaw(block.id, nextRaw);
    },
    [onReplaceBlockWithRaw]
  );

  const handleExecuteSlashCommand = useCallback(
    (targetBlockId: string, item: SlashCommandItem) => {
      if (item.action) {
        if (targetBlockId === "empty") {
          const current = emptyDocDraftRef.current || "";
          const stripped = current.replace(/(?:^|\s)\/[a-zA-Z0-9_\u4e00-\u9fa5-]*$/, "").trim();
          emptyDocDraftRef.current = stripped;
          setEmptyDocDraft(stripped);
        } else if (targetBlockId === "tail") {
          const current = tailDraftRef.current || "";
          const stripped = current.replace(/(?:^|\s)\/[a-zA-Z0-9_\u4e00-\u9fa5-]*$/, "").trim();
          tailDraftRef.current = stripped;
          setTailDraft(stripped);
        } else {
          const targetBlock = blocks.find((b) => b.id === targetBlockId);
          if (targetBlock) {
            const stripped = targetBlock.raw.replace(/(?:^|\s)\/[a-zA-Z0-9_\u4e00-\u9fa5-]*$/, "").trim();
            onReplaceBlockWithRaw(targetBlock.id, stripped);
          }
        }
        setSlashMenu(null);

        const actionMap: Record<string, string> = {
          ai_chat: "ai_chat",
          ai_continue: "continue",
          ai_polish: "polish",
          ai_proofread: "proofread",
          ai_diagram: "diagram",
          ai_summary: "summarize",
          skill_academic: "academic-polish",
          skill_spec: "tech-spec"
        };
        const mapped = actionMap[item.action] || "continue";
        onTriggerAiAction?.(mapped);
        return;
      }
      if (targetBlockId === "empty") {
        const current = emptyDocDraftRef.current || "";
        const replaced = current.replace(
          /(?:^|\s)\/[a-zA-Z0-9_\u4e00-\u9fa5]*$/,
          (match) => (match.startsWith(" ") ? ` ${item.template}` : item.template)
        );
        emptyDocDraftRef.current = replaced;
        setEmptyDocDraft(replaced);
        setSlashMenu(null);

        window.requestAnimationFrame(() => {
          const activeTextarea = focusedWrapperRef.current?.querySelector<HTMLTextAreaElement>(
            "textarea.ty-live-textarea"
          );
          if (activeTextarea) {
            const pos = typeof item.cursorOffset === "number" ? item.cursorOffset : replaced.length;
            activeTextarea.focus();
            try {
              activeTextarea.setSelectionRange(pos, pos);
            } catch {
              // ignore
            }
          }
        });
        return;
      }

      if (targetBlockId === "tail") {
        const current = tailDraftRef.current || "";
        const replaced = current.replace(
          /(?:^|\s)\/[a-zA-Z0-9_\u4e00-\u9fa5]*$/,
          (match) => (match.startsWith(" ") ? ` ${item.template}` : item.template)
        );
        tailDraftRef.current = replaced;
        setTailDraft(replaced);
        setSlashMenu(null);

        window.requestAnimationFrame(() => {
          const activeTextarea = focusedWrapperRef.current?.querySelector<HTMLTextAreaElement>(
            "textarea.ty-live-textarea"
          );
          if (activeTextarea) {
            const pos = typeof item.cursorOffset === "number" ? item.cursorOffset : replaced.length;
            activeTextarea.focus();
            try {
              activeTextarea.setSelectionRange(pos, pos);
            } catch {
              // ignore
            }
          }
        });
        return;
      }

      const targetBlock = blocks.find((b) => b.id === targetBlockId);
      if (!targetBlock) {
        setSlashMenu(null);
        return;
      }

      const activeEl = focusedWrapperRef.current?.querySelector<HTMLTextAreaElement>(
        "textarea.ty-live-textarea"
      );
      const currentRaw = (activeEl && typeof activeEl.value === "string") ? activeEl.value : (targetBlock.raw || "");
      const replaced = currentRaw.replace(
        /(?:^|\s)\/[a-zA-Z0-9_\u4e00-\u9fa5]*$/,
        (match) => (match.startsWith(" ") ? ` ${item.template}` : item.template)
      );

      setSlashMenu(null);
      handleLiveRawChange(targetBlock, replaced);

      if (typeof item.cursorOffset === "number") {
        preferredCursorPosRef.current = item.cursorOffset;
      }

      window.requestAnimationFrame(() => {
        const activeTextarea = focusedWrapperRef.current?.querySelector<HTMLTextAreaElement>(
          "textarea.ty-live-textarea"
        );
        if (activeTextarea) {
          const pos = typeof item.cursorOffset === "number" ? item.cursorOffset : replaced.length;
          activeTextarea.focus();
          try {
            activeTextarea.setSelectionRange(pos, pos);
          } catch {
            // ignore
          }
        }
      });
    },
    [blocks, handleLiveRawChange]
  );

  // Source Code Mode (#typora-source)
  if (sourceMode) {
    const lineCount = Math.max(1, markdown.split("\n").length);
    return (
      <div
        id="typora-source"
        onContextMenu={(e) => onContextMenuRequest(e, null)}
      >
        <div className="ty-source-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </div>
        <textarea
          className="ty-source-textarea"
          value={markdown}
          spellCheck={preferences.spellcheck}
          onChange={(e) => onChangeFullMarkdown(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
              e.preventDefault();
              if (e.shiftKey) {
                onRedo?.();
              } else {
                onUndo?.();
              }
              return;
            }
            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "y") {
              e.preventDefault();
              onRedo?.();
              return;
            }

            if (e.key === "Tab") {
              e.preventDefault();
              const target = e.currentTarget;
              const res = handleListTab(
                target.value,
                target.selectionStart ?? 0,
                target.selectionEnd ?? 0,
                e.shiftKey
              );
              if (res.handled) {
                onChangeFullMarkdown(res.newText);
                window.requestAnimationFrame(() => {
                  try {
                    target.setSelectionRange(res.newCursorPos, res.newCursorPos);
                  } catch {}
                });
              }
              return;
            }

            if (e.key === "Enter" && !e.shiftKey) {
              const target = e.currentTarget;
              const res = handleListEnter(
                target.value,
                target.selectionStart ?? 0,
                target.selectionEnd ?? 0
              );
              if (res.handled) {
                e.preventDefault();
                onChangeFullMarkdown(res.newText);
                window.requestAnimationFrame(() => {
                  try {
                    target.setSelectionRange(res.newCursorPos, res.newCursorPos);
                  } catch {
                    // ignore
                  }
                });
                return;
              }
            }

            if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
              const target = e.currentTarget;
              const res = handleListBackspace(
                target.value,
                target.selectionStart ?? 0,
                target.selectionEnd ?? 0
              );
              if (res && res.handled) {
                e.preventDefault();
                onChangeFullMarkdown(res.newText);
                window.requestAnimationFrame(() => {
                  try {
                    target.setSelectionRange(res.newCursorPos, res.newCursorPos);
                  } catch {
                    // ignore
                  }
                });
                return;
              }
            }
          }}
          placeholder="在此输入 Markdown 源码..."
        />
      </div>
    );
  }

  const handleCopyCode = (blockId: string, code: string) => {
    if (window.typoraBridge?.copyTextToClipboard) {
      window.typoraBridge.copyTextToClipboard(code);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopiedCodeId(blockId);
    setTimeout(() => {
      setCopiedCodeId((prev) => (prev === blockId ? null : prev));
    }, 1500);
  };

  // Table manipulation helpers
  const updateTableStructure = (
    block: MarkdownBlock,
    nextHeaders: string[],
    nextAligns: TableAlign[],
    nextRows: string[][]
  ) => {
    const raw = prettifyMarkdownTable(nextHeaders, nextAligns, nextRows);
    onUpdateBlock(block.id, {
      ...block,
      headers: nextHeaders,
      alignments: nextAligns,
      rows: nextRows,
      raw
    });
  };

  const handleTableCellChange = (
    block: MarkdownBlock,
    rowIdx: number,
    colIdx: number,
    value: string
  ) => {
    const headers = [...(block.headers || [])];
    const aligns = [...(block.alignments || [])];
    const rows = (block.rows || []).map((r) => [...r]);

    if (rowIdx === -1) {
      headers[colIdx] = value;
    } else if (rows[rowIdx]) {
      rows[rowIdx][colIdx] = value;
    }
    updateTableStructure(block, headers, aligns, rows);
  };

  const handleInsertTableRow = (block: MarkdownBlock, belowCurrent: boolean) => {
    const headers = [...(block.headers || ["Column 1", "Column 2"])];
    const aligns = [...(block.alignments || [null, null])];
    const rows = (block.rows || []).map((r) => [...r]);
    const currentRow =
      activeTableCell?.blockId === block.id && activeTableCell.rowIdx >= 0
        ? activeTableCell.rowIdx
        : rows.length - 1;
    const insertIdx = Math.max(0, belowCurrent ? currentRow + 1 : currentRow);
    const blankRow = Array.from({ length: headers.length }, () => "");
    rows.splice(insertIdx, 0, blankRow);
    updateTableStructure(block, headers, aligns, rows);
  };

  const handleDeleteTableRow = (block: MarkdownBlock) => {
    const headers = [...(block.headers || [])];
    const aligns = [...(block.alignments || [])];
    const rows = (block.rows || []).map((r) => [...r]);
    if (rows.length <= 1) return;
    const targetRow =
      activeTableCell?.blockId === block.id && activeTableCell.rowIdx >= 0
        ? activeTableCell.rowIdx
        : rows.length - 1;
    rows.splice(targetRow, 1);
    updateTableStructure(block, headers, aligns, rows);
  };

  const handleMoveTableRow = (block: MarkdownBlock, delta: -1 | 1) => {
    const headers = [...(block.headers || [])];
    const aligns = [...(block.alignments || [])];
    const rows = (block.rows || []).map((r) => [...r]);
    const rIdx =
      activeTableCell?.blockId === block.id && activeTableCell.rowIdx >= 0
        ? activeTableCell.rowIdx
        : 0;
    const targetIdx = rIdx + delta;
    if (targetIdx < 0 || targetIdx >= rows.length) return;
    const temp = rows[rIdx];
    rows[rIdx] = rows[targetIdx];
    rows[targetIdx] = temp;
    updateTableStructure(block, headers, aligns, rows);
    setActiveTableCell({
      blockId: block.id,
      rowIdx: targetIdx,
      colIdx: activeTableCell?.colIdx || 0
    });
  };

  const handleInsertTableCol = (block: MarkdownBlock, rightOfCurrent: boolean) => {
    const headers = [...(block.headers || [])];
    const aligns = [...(block.alignments || [])];
    const rows = (block.rows || []).map((r) => [...r]);
    const cIdx =
      activeTableCell?.blockId === block.id ? activeTableCell.colIdx : headers.length - 1;
    const insertIdx = Math.max(0, rightOfCurrent ? cIdx + 1 : cIdx);
    headers.splice(insertIdx, 0, `Column ${headers.length + 1}`);
    aligns.splice(insertIdx, 0, null);
    for (const row of rows) {
      row.splice(insertIdx, 0, "");
    }
    updateTableStructure(block, headers, aligns, rows);
  };

  const handleDeleteTableCol = (block: MarkdownBlock) => {
    const headers = [...(block.headers || [])];
    const aligns = [...(block.alignments || [])];
    const rows = (block.rows || []).map((r) => [...r]);
    if (headers.length <= 1) return;
    const cIdx =
      activeTableCell?.blockId === block.id ? activeTableCell.colIdx : headers.length - 1;
    headers.splice(cIdx, 1);
    aligns.splice(cIdx, 1);
    for (const row of rows) {
      row.splice(cIdx, 1);
    }
    updateTableStructure(block, headers, aligns, rows);
  };

  const handleMoveTableCol = (block: MarkdownBlock, delta: -1 | 1) => {
    const headers = [...(block.headers || [])];
    const aligns = [...(block.alignments || [])];
    const rows = (block.rows || []).map((r) => [...r]);
    const cIdx =
      activeTableCell?.blockId === block.id ? activeTableCell.colIdx : 0;
    const targetIdx = cIdx + delta;
    if (targetIdx < 0 || targetIdx >= headers.length) return;

    [headers[cIdx], headers[targetIdx]] = [headers[targetIdx], headers[cIdx]];
    [aligns[cIdx], aligns[targetIdx]] = [aligns[targetIdx], aligns[cIdx]];
    for (const row of rows) {
      [row[cIdx], row[targetIdx]] = [row[targetIdx], row[cIdx]];
    }
    updateTableStructure(block, headers, aligns, rows);
    setActiveTableCell({
      blockId: block.id,
      rowIdx: activeTableCell?.rowIdx ?? -1,
      colIdx: targetIdx
    });
  };

  const handleSetColAlign = (block: MarkdownBlock, align: TableAlign) => {
    const headers = [...(block.headers || [])];
    const aligns = [...(block.alignments || [])];
    const rows = (block.rows || []).map((r) => [...r]);
    const cIdx =
      activeTableCell?.blockId === block.id ? activeTableCell.colIdx : 0;
    aligns[cIdx] = align;
    updateTableStructure(block, headers, aligns, rows);
  };

  const renderBlock = (block: MarkdownBlock, idx: number) => {
    if (hiddenBlockIds.has(block.id)) {
      return null;
    }

    const isFocused = !readingMode && focusedBlockId === block.id;
    const isMultiSelected = selectedBlockIds.includes(block.id);
    const multiSelClass = isMultiSelected ? "is-multi-selected" : "";

    // 1. Table Block (always interactive WYSIWYG grid + toolbar on focus)
    if (block.type === "table") {
      const headers = block.headers || ["Column 1", "Column 2"];
      const aligns = block.alignments || [null, null];
      const rows = block.rows || [["", ""]];
      const activeColAlign =
        activeTableCell?.blockId === block.id
          ? aligns[activeTableCell.colIdx] ?? null
          : aligns[0] ?? null;

      return (
        <div
          key={block.id}
          id={block.id}
          ref={isFocused ? focusedWrapperRef : undefined}
          className={`ty-block-wrapper ty-table-figure ${
            isFocused ? "md-focus" : ""
          } ${multiSelClass}`}
          onClick={(e) => handleBlockClick(block.id, e)}
          onContextMenu={(e) => onContextMenuRequest(e, block.id)}
        >
          {isFocused && (
            <div
              className="ty-table-toolbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ty-table-toolbar-group">
                <button
                  type="button"
                  className={`ty-icon-btn ${
                    activeColAlign === "left" ? "is-active" : ""
                  }`}
                  onClick={() => handleSetColAlign(block, "left")}
                  title="左对齐当前列"
                >
                  <AlignLeft size={13} />
                </button>
                <button
                  type="button"
                  className={`ty-icon-btn ${
                    activeColAlign === "center" ? "is-active" : ""
                  }`}
                  onClick={() => handleSetColAlign(block, "center")}
                  title="居中对齐当前列"
                >
                  <AlignCenter size={13} />
                </button>
                <button
                  type="button"
                  className={`ty-icon-btn ${
                    activeColAlign === "right" ? "is-active" : ""
                  }`}
                  onClick={() => handleSetColAlign(block, "right")}
                  title="右对齐当前列"
                >
                  <AlignRight size={13} />
                </button>
              </div>

              <div className="ty-table-toolbar-group">
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => handleInsertTableRow(block, true)}
                  title="在下方插入行"
                >
                  <Plus size={12} />
                  <span>加行</span>
                </button>
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => handleMoveTableRow(block, -1)}
                  title="上移当前行 (Alt+Up)"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => handleMoveTableRow(block, 1)}
                  title="下移当前行 (Alt+Down)"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => handleDeleteTableRow(block)}
                  title="删除当前行"
                >
                  <span>删行</span>
                </button>
              </div>

              <div className="ty-table-toolbar-group">
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => handleInsertTableCol(block, true)}
                  title="在右侧插入列"
                >
                  <Plus size={12} />
                  <span>加列</span>
                </button>
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => handleMoveTableCol(block, -1)}
                  title="左移当前列 (Alt+Left)"
                >
                  <ArrowLeft size={12} />
                </button>
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => handleMoveTableCol(block, 1)}
                  title="右移当前列 (Alt+Right)"
                >
                  <ArrowRight size={12} />
                </button>
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => handleDeleteTableCol(block)}
                  title="删除当前列"
                >
                  <span>删列</span>
                </button>
              </div>

              <div className="ty-table-toolbar-group">
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() =>
                    updateTableStructure(block, headers, aligns, rows)
                  }
                  title="格式化对齐 Markdown 表格源码"
                >
                  <Sparkles size={12} />
                  <span>美化源码</span>
                </button>
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => onDeleteBlock(block.id)}
                  title="删除整张表格"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )}

          <table>
            <thead>
              <tr>
                {headers.map((headerText, cIdx) => (
                  <th
                    key={cIdx}
                    style={{ textAlign: aligns[cIdx] || "left" }}
                    onClick={() =>
                      setActiveTableCell({
                        blockId: block.id,
                        rowIdx: -1,
                        colIdx: cIdx
                      })
                    }
                  >
                    {isFocused ? (
                      <input
                        type="text"
                        className="ty-table-cell-input"
                        style={{
                          textAlign: aligns[cIdx] || "left",
                          fontWeight: 700
                        }}
                        value={headerText}
                        onFocus={() =>
                          setActiveTableCell({
                            blockId: block.id,
                            rowIdx: -1,
                            colIdx: cIdx
                          })
                        }
                        onChange={(e) =>
                          handleTableCellChange(block, -1, cIdx, e.target.value)
                        }
                      />
                    ) : (
                      renderInlineMarkdown(
                        headerText,
                        inlineCtx,
                        `${block.id}-th-${cIdx}`
                      )
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {headers.map((_, cIdx) => {
                    const cellVal = row[cIdx] ?? "";
                    return (
                      <td
                        key={cIdx}
                        style={{ textAlign: aligns[cIdx] || "left" }}
                        onClick={() =>
                          setActiveTableCell({
                            blockId: block.id,
                            rowIdx: rIdx,
                            colIdx: cIdx
                          })
                        }
                      >
                        {isFocused ? (
                          <input
                            type="text"
                            className="ty-table-cell-input"
                            style={{ textAlign: aligns[cIdx] || "left" }}
                            value={cellVal}
                            onFocus={() =>
                              setActiveTableCell({
                                blockId: block.id,
                                rowIdx: rIdx,
                                colIdx: cIdx
                              })
                            }
                            onChange={(e) =>
                              handleTableCellChange(
                                block,
                                rIdx,
                                cIdx,
                                e.target.value
                              )
                            }
                          />
                        ) : (
                          renderInlineMarkdown(
                            cellVal,
                            inlineCtx,
                            `${block.id}-td-${rIdx}-${cIdx}`
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // 2. Code Fence Block
    if (block.type === "code") {
      const codeStr = block.code ?? "";
      const lang = block.language || "";
      return (
        <div
          key={block.id}
          id={block.id}
          ref={isFocused ? focusedWrapperRef : undefined}
          className={`ty-block-wrapper md-fences ${
            isFocused ? "md-focus" : ""
          } ${multiSelClass}`}
          onClick={(e) => handleBlockClick(block.id, e)}
          onContextMenu={(e) => onContextMenuRequest(e, block.id)}
        >
          <div
            className="md-fences-header"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="text"
                list="typora-code-langs"
                className="ty-code-lang-input"
                placeholder="选择语言 (如 typescript)"
                value={lang}
                onChange={(e) => {
                  const nextLang = e.target.value;
                  const nextBlock: MarkdownBlock = {
                    ...block,
                    language: nextLang
                  };
                  nextBlock.raw = serializeBlockToRaw(nextBlock);
                  onUpdateBlock(block.id, nextBlock);
                }}
              />
              <datalist id="typora-code-langs">
                {SUPPORTED_CODE_LANGUAGES.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                className="ty-icon-btn"
                onClick={() => handleCopyCode(block.id, codeStr)}
                title="复制代码"
              >
                {copiedCodeId === block.id ? (
                  <>
                    <Check size={12} />
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    <span>复制</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {isFocused ? (
            <textarea
              className="ty-live-textarea"
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenuRequest(e, block.id);
              }}
              style={{
                fontFamily: "var(--font-monospace)",
                fontSize: 13,
                border: "none",
                borderRadius: 0
              }}
              rows={Math.max(3, codeStr.split("\n").length)}
              value={codeStr}
              spellCheck={false}
              onChange={(e) => {
                const nextCode = e.target.value;
                const nextBlock: MarkdownBlock = {
                  ...block,
                  code: nextCode
                };
                nextBlock.raw = serializeBlockToRaw(nextBlock);
                onUpdateBlock(block.id, nextBlock);
              }}
            />
          ) : (
            <SyntaxHighlightedCode
              code={codeStr}
              language={lang}
              showLineNumbers={preferences.showLineNumbersInCode}
              wrapLines={preferences.wrapCodeBlocks}
            />
          )}
        </div>
      );
    }

    // 3. TOC Block ([TOC])
    if (block.type === "toc") {
      return (
        <div
          key={block.id}
          id={block.id}
          ref={isFocused ? focusedWrapperRef : undefined}
          className={`ty-block-wrapper md-toc ${
            isFocused ? "md-focus" : ""
          } ${multiSelClass}`}
          onClick={(e) => handleBlockClick(block.id, e)}
          onContextMenu={(e) => onContextMenuRequest(e, block.id)}
        >
          <div className="md-toc-title" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>目录 (Table of Contents)</span>
            {isFocused && (
              <button
                type="button"
                className="ty-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteBlock(block.id);
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          {outline.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--muted-text-color)" }}>
              （文档中添加 `# 标题` 后将在此自动生成目录）
            </div>
          ) : (
            outline.map((item) => (
              <div
                key={item.id}
                className="md-toc-item"
                title={item.text}
                data-full-title={item.text}
                style={{ paddingLeft: `${(item.level - 1) * 16}px` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpToHeading(item.blockId);
                }}
              >
                {item.text}
              </div>
            ))
          )}
        </div>
      );
    }

    // 4. Focused Live-Source Mode for Headings, Paragraphs, Lists, Quotes, Alerts, Math, Diagrams, FrontMatter
    if (isFocused) {
      const focusedHeadingTitle =
        block.type === "heading"
          ? (block.text || block.raw.replace(/^#{1,6}\s+/, "")).trim()
          : undefined;
      const estimatedLines = Math.max(1, (block.raw || "").split("\n").length);

      return (
        <div
          key={block.id}
          id={block.id}
          ref={focusedWrapperRef}
          title={focusedHeadingTitle}
          data-full-title={focusedHeadingTitle}
          data-heading-tag={
            block.type === "heading" ? `h${block.headingLevel || 1}` : undefined
          }
          data-block-type={block.type}
          className={`ty-block-wrapper ${
            block.type === "heading"
              ? "ty-heading-block"
              : block.type === "paragraph"
              ? "ty-paragraph-block"
              : block.type === "list"
              ? "ty-list-block"
              : ""
          } md-focus ${multiSelClass}`}
          onContextMenu={(e) => onContextMenuRequest(e, block.id)}
        >
          {(block.type === "math" || block.type === "diagram") && (
            <div className="ty-live-syntax-badge">
              <span>
                {block.type === "math"
                  ? "$$ LaTeX 数学公式源码 (按 Esc 完成)"
                  : `Mermaid (${block.diagramType}) 图表源码`}
              </span>
            </div>
          )}
          <textarea
            className="ty-live-textarea"
            rows={estimatedLines}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenuRequest(e, block.id);
            }}
            style={{
              minHeight: `${estimatedLines * 1.75}em`
            }}
            value={block.raw}
            ref={(el) => {
              if (el) {
                el.style.height = "auto";
                const targetH = Math.max(el.scrollHeight, estimatedLines * 28);
                el.style.height = `${targetH}px`;
                if (document.activeElement !== el) {
                  el.focus({ preventScroll: true });
                }
                const appliedVisualIntent = applyPendingVisualCursorIntent(el, block.id);
                if (!appliedVisualIntent && preferredCursorPosRef.current !== null) {
                  const targetPos = preferredCursorPosRef.current;
                  preferredCursorPosRef.current = null;
                  const clamped = Math.min(el.value.length, Math.max(0, targetPos));
                  try {
                    el.setSelectionRange(clamped, clamped);
                  } catch {}
                  window.requestAnimationFrame(() => {
                    try {
                      el.setSelectionRange(clamped, clamped);
                    } catch {}
                  });
                }
                // Initialize fine-grained edit history for focused block
                if (
                  !blockHistoryRef.current ||
                  blockHistoryRef.current.blockId !== block.id
                ) {
                  blockHistoryRef.current = {
                    blockId: block.id,
                    history: new EditHistoryManager(
                      block.raw,
                      el.selectionStart ?? block.raw.length
                    )
                  };
                }
              }
            }}
            onFocus={(e) => {
              const el = e.currentTarget;
              if (preferredCursorPosRef.current !== null) {
                const targetPos = preferredCursorPosRef.current;
                preferredCursorPosRef.current = null;
                const clamped = Math.min(el.value.length, Math.max(0, targetPos));
                try {
                  el.setSelectionRange(clamped, clamped);
                } catch {}
              }
            }}
            spellCheck={preferences.spellcheck}
            onChange={(e) => {
              const nextVal = e.target.value;
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
              blockHistoryRef.current?.history.push(
                nextVal,
                e.target.selectionStart ?? nextVal.length,
                e.target.selectionEnd ?? nextVal.length
              );
              handleLiveRawChange(block, nextVal);
            }}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (items && onPasteImageDataUrl) {
                for (let i = 0; i < items.length; i += 1) {
                  const item = items[i];
                  if (item.type.startsWith("image/")) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === "string") {
                        const mdImg = onPasteImageDataUrl(reader.result);
                        if (mdImg) {
                          handleLiveRawChange(
                            block,
                            `${block.raw}\n${mdImg}`
                          );
                        }
                      }
                    };
                    reader.readAsDataURL(file);
                    return;
                  }
                }
              }
              const htmlData = e.clipboardData?.getData("text/html");
              const textData = e.clipboardData?.getData("text/plain") || "";
              if (htmlData && /<(strong|em|h[1-6]|a|code|ul|ol|li)/i.test(htmlData)) {
                e.preventDefault();
                const converted = htmlToMarkdownSmartPaste(htmlData, textData);
                const target = e.currentTarget;
                const start = target.selectionStart ?? block.raw.length;
                const end = target.selectionEnd ?? block.raw.length;
                const nextRaw = `${block.raw.slice(0, start)}${converted}${block.raw.slice(end)}`;
                handleLiveRawChange(block, nextRaw);
              }
            }}
            onBlur={(e) => {
              const currentVal = e.target.value;
              if (currentVal !== block.raw) {
                onReplaceBlockWithRaw(block.id, currentVal);
              }
            }}
            onKeyDown={(e) => {
              if (isImeCompositionKeyDown(e.nativeEvent)) return;

              // 1. Feishu-style Slash Command Keyboard Navigation (ArrowUp / ArrowDown / Enter / Tab / Escape)
              if (slashMenu && slashMenu.blockId === block.id) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashMenu((prev) => {
                    if (!prev || filteredSlashCommands.length === 0) return prev;
                    return {
                      ...prev,
                      selectedIndex: Math.min(
                        filteredSlashCommands.length - 1,
                        prev.selectedIndex + 1
                      )
                    };
                  });
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashMenu((prev) => {
                    if (!prev || filteredSlashCommands.length === 0) return prev;
                    return {
                      ...prev,
                      selectedIndex: Math.max(0, prev.selectedIndex - 1)
                    };
                  });
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  if (filteredSlashCommands.length > 0) {
                    e.preventDefault();
                    const safeIdx = Math.min(
                      Math.max(0, slashMenu.selectedIndex),
                      filteredSlashCommands.length - 1
                    );
                    const chosen =
                      filteredSlashCommands[safeIdx] ||
                      filteredSlashCommands[0];
                    handleExecuteSlashCommand(block.id, chosen);
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSlashMenu(null);
                  return;
                }
              }

              // Undo / Redo inside block textarea (Fine-Grained Transactional History)
              if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
                e.preventDefault();
                const target = e.currentTarget;
                if (e.shiftKey) {
                  if (blockHistoryRef.current?.history.canRedo()) {
                    const step = blockHistoryRef.current.history.redo();
                    if (step) {
                      target.value = step.value;
                      target.style.height = "auto";
                      target.style.height = `${target.scrollHeight}px`;
                      handleLiveRawChange(block, step.value);
                      window.requestAnimationFrame(() => {
                        try {
                          target.setSelectionRange(
                            step.selectionStart,
                            step.selectionEnd
                          );
                        } catch {}
                      });
                      return;
                    }
                  }
                  onRedo?.();
                } else {
                  if (blockHistoryRef.current?.history.canUndo()) {
                    const step = blockHistoryRef.current.history.undo();
                    if (step) {
                      target.value = step.value;
                      target.style.height = "auto";
                      target.style.height = `${target.scrollHeight}px`;
                      handleLiveRawChange(block, step.value);
                      window.requestAnimationFrame(() => {
                        try {
                          target.setSelectionRange(
                            step.selectionStart,
                            step.selectionEnd
                          );
                        } catch {}
                      });
                      return;
                    }
                  }
                  onUndo?.();
                }
                return;
              }
              if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "y") {
                e.preventDefault();
                const target = e.currentTarget;
                if (blockHistoryRef.current?.history.canRedo()) {
                  const step = blockHistoryRef.current.history.redo();
                  if (step) {
                    target.value = step.value;
                    target.style.height = "auto";
                    target.style.height = `${target.scrollHeight}px`;
                    handleLiveRawChange(block, step.value);
                    window.requestAnimationFrame(() => {
                      try {
                        target.setSelectionRange(
                          step.selectionStart,
                          step.selectionEnd
                        );
                      } catch {}
                    });
                    return;
                  }
                }
                onRedo?.();
                return;
              }

              // Typora 2-stage Cmd+A: if already all selected in this textarea, expand to select entire document
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
                const target = e.currentTarget;
                if (
                  target.selectionStart === 0 &&
                  target.selectionEnd === target.value.length
                ) {
                  e.preventDefault();
                  onFocusBlock(null);
                  onSelectBlocks?.(blocks.map((b) => b.id));
                  window.requestAnimationFrame(() => {
                    const writeEl = document.getElementById("write");
                    if (writeEl) {
                      const range = document.createRange();
                      range.selectNodeContents(writeEl);
                      const sel = window.getSelection();
                      sel?.removeAllRanges();
                      sel?.addRange(range);
                    }
                  });
                  return;
                }
              }

              if (e.key === "Escape") {
                e.preventDefault();
                setEmojiPopup(null);
                onFocusBlock(null);
                return;
              }

              // Typora Native Navigation: Arrow keys cross-block cursor roaming (Up, Down, Left, Right)
              if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const target = e.currentTarget;
                const start = target.selectionStart ?? 0;
                const end = target.selectionEnd ?? 0;
                const val = target.value;
                const visibleBlocks = blocks.filter((b) => !hiddenBlockIds.has(b.id));
                const vIdx = visibleBlocks.findIndex((b) => b.id === block.id);
                const prevBlock = vIdx > 0 ? visibleBlocks[vIdx - 1] : null;
                const nextBlock =
                  vIdx >= 0 && vIdx < visibleBlocks.length - 1
                    ? visibleBlocks[vIdx + 1]
                    : null;

                // 1. ArrowLeft at block start: navigate to previous block end
                if (e.key === "ArrowLeft" && start === 0 && end === 0) {
                  if (prevBlock) {
                    e.preventDefault();
                    if (val !== block.raw) {
                      onReplaceBlockWithRaw(block.id, val);
                    }
                    preferredCursorPosRef.current = prevBlock.raw.length;
                    onFocusBlock(prevBlock.id);
                    return;
                  }
                }

                // 2. ArrowRight at block end: navigate to next block start
                if (e.key === "ArrowRight" && start === val.length && end === val.length) {
                  if (nextBlock) {
                    e.preventDefault();
                    if (val !== block.raw) {
                      onReplaceBlockWithRaw(block.id, val);
                    }
                    preferredCursorPosRef.current = 0;
                    onFocusBlock(nextBlock.id);
                    return;
                  }
                }

                // 3. ArrowUp at first line: navigate to previous block last line (preserving column)
                if (e.key === "ArrowUp") {
                  const atVisualEdge = isCaretAtVisualEdge(target, "up", start);
                  if (shouldNavigateAcrossVisualEdge({
                    direction: "up",
                    hasSelection: start !== end,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey,
                    ctrlKey: e.ctrlKey,
                    altKey: e.altKey,
                    caretAtVisualEdge: atVisualEdge
                  })) {
                    if (prevBlock) {
                      e.preventDefault();
                      if (val !== block.raw) {
                        onReplaceBlockWithRaw(block.id, val);
                      }
                      focusAtVisualEdge(prevBlock.id, "last", target, start);
                      return;
                    }
                  }
                }

                // 4. ArrowDown at last line: navigate to next block first line (preserving column)
                if (e.key === "ArrowDown") {
                  const atVisualEdge = isCaretAtVisualEdge(target, "down", end);
                  if (shouldNavigateAcrossVisualEdge({
                    direction: "down",
                    hasSelection: start !== end,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey,
                    ctrlKey: e.ctrlKey,
                    altKey: e.altKey,
                    caretAtVisualEdge: atVisualEdge
                  })) {
                    if (nextBlock) {
                      e.preventDefault();
                      if (val !== block.raw) {
                        onReplaceBlockWithRaw(block.id, val);
                      }
                      focusAtVisualEdge(nextBlock.id, "first", target, end);
                      return;
                    } else if (vIdx === visibleBlocks.length - 1) {
                      e.preventDefault();
                      if (val !== block.raw) {
                        onReplaceBlockWithRaw(block.id, val);
                      }
                      onFocusBlock(null);
                      tailDraftRef.current = "";
                      setTailDraft("");
                      return;
                    }
                  }
                }
              }

              if (e.key === "Tab") {
                e.preventDefault();
                const target = e.currentTarget;
                const tabRes = handleListTab(
                  target.value,
                  target.selectionStart ?? 0,
                  target.selectionEnd ?? 0,
                  e.shiftKey
                );
                if (tabRes.handled) {
                  handleLiveRawChange(block, tabRes.newText);
                  window.requestAnimationFrame(() => {
                    try {
                      target.setSelectionRange(
                        tabRes.newCursorPos,
                        tabRes.newCursorPos
                      );
                    } catch {}
                  });
                }
                return;
              }

              if (e.key === "Enter" && !e.shiftKey) {
                const target = e.currentTarget;
                const start = target.selectionStart ?? 0;
                const end = target.selectionEnd ?? 0;
                const listRes = handleListEnter(target.value, start, end);
                if (listRes.handled) {
                  e.preventDefault();
                  if (listRes.isListExit) {
                    // Typora Alignment: When hitting Enter on an empty list item (e.g. "2. "):
                    // 1. Trim trailing empty newline/marker from this block
                    // 2. Commit this block and seamlessly focus a new empty paragraph right after it!
                    const trimmed = listRes.newText.trimEnd();
                    const currentIdx = blocks.findIndex((b) => b.id === block.id);
                    const isLastBlock =
                      currentIdx === -1 ||
                      currentIdx === blocks.length - 1 ||
                      (blocks.length > 0 && blocks[blocks.length - 1].id === block.id);

                    if (trimmed) {
                      onReplaceBlockWithRaw(block.id, trimmed);
                    } else {
                      onReplaceBlockWithRaw(block.id, "");
                    }
                    onFocusBlock(null);

                    if (isLastBlock) {
                      tailDraftRef.current = "";
                      setTailDraft("");
                    } else {
                      const nextDraft = { afterBlockId: block.id, content: "" };
                      midDraftRef.current = nextDraft;
                      setMidDraft(nextDraft);
                    }
                  } else {
                    blockHistoryRef.current?.history.push(
                      listRes.newText,
                      listRes.newCursorPos,
                      listRes.newCursorPos,
                      { force: true, actionTag: "list-enter" }
                    );
                    handleLiveRawChange(block, listRes.newText);
                    window.requestAnimationFrame(() => {
                      try {
                        target.setSelectionRange(listRes.newCursorPos, listRes.newCursorPos);
                      } catch {
                        // ignore
                      }
                    });
                  }
                  return;
                }

                const trimmedRaw = block.raw.trim();
                if (/^(`{3,}|~{3,})[A-Za-z0-9_-]+$/.test(trimmedRaw)) {
                  e.preventDefault();
                  const fencePrefix = (trimmedRaw.match(/^(`{3,}|~{3,})/) || [
                    "```"
                  ])[0];
                  const nextRaw = `${trimmedRaw}\n\n${fencePrefix}`;
                  handleLiveRawChange(block, nextRaw);
                  const cursorPos = trimmedRaw.length + 1;
                  window.requestAnimationFrame(() => {
                    try {
                      target.setSelectionRange(cursorPos, cursorPos);
                    } catch {
                      // ignore
                    }
                  });
                  return;
                }
                if (block.type === "heading" || block.type === "hr") {
                  e.preventDefault();
                  onInsertBlockAfter(block.id, "");
                  return;
                }

                // 4. Paragraph / general text block: 1:1 Typora Enter Behavior!
                // Pressing Enter splits or appends paragraph, seamlessly focusing next line.
                e.preventDefault();
                const before = target.value.slice(0, start);
                const after = target.value.slice(end);

                const currentIdx = blocks.findIndex((b) => b.id === block.id);
                const isLastBlock =
                  currentIdx === -1 ||
                  currentIdx === blocks.length - 1 ||
                  (blocks.length > 0 && blocks[blocks.length - 1].id === block.id);

                if (!after.trim()) {
                  // Cursor at the end: finalize current paragraph, seamlessly focus new line draft below
                  const currentContent = before.trimEnd();
                  onReplaceBlockWithRaw(block.id, currentContent);
                  onFocusBlock(null);

                  if (isLastBlock) {
                    tailDraftRef.current = "";
                    setTailDraft("");
                  } else {
                    const nextDraft = { afterBlockId: block.id, content: "" };
                    midDraftRef.current = nextDraft;
                    setMidDraft(nextDraft);
                  }
                } else if (!before.trim()) {
                  // Cursor at the beginning: insert empty paragraph before current block
                  onReplaceBlockWithRaw(block.id, after.trimStart());
                  const prevBlockId = currentIdx > 0 ? blocks[currentIdx - 1].id : block.id;
                  onInsertBlockAfter(prevBlockId, "", false);
                } else {
                  // Cursor in the middle: split paragraph into two blocks cleanly
                  const firstPart = before.trimEnd();
                  const secondPart = after.trimStart();
                  onReplaceBlockWithRaw(block.id, firstPart);
                  onFocusBlock(null);

                  if (isLastBlock) {
                    tailDraftRef.current = secondPart;
                    setTailDraft(secondPart);
                  } else {
                    const nextDraft = { afterBlockId: block.id, content: secondPart };
                    midDraftRef.current = nextDraft;
                    setMidDraft(nextDraft);
                  }
                }
                return;
              }

              if (e.key === "Enter" && e.shiftKey) {
                // Shift+Enter: also soft break within the same paragraph block
                e.preventDefault();
                const target = e.currentTarget;
                const start = target.selectionStart ?? 0;
                const end = target.selectionEnd ?? 0;
                const nextVal = `${target.value.slice(0, start)}\n${target.value.slice(end)}`;
                handleLiveRawChange(block, nextVal);
                window.requestAnimationFrame(() => {
                  try {
                    target.setSelectionRange(start + 1, start + 1);
                    target.style.height = "auto";
                    target.style.height = `${target.scrollHeight}px`;
                  } catch {}
                });
                return;
              }
              if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const target = e.currentTarget;
                const start = target.selectionStart ?? 0;
                const end = target.selectionEnd ?? 0;
                const backRes = handleListBackspace(target.value, start, end);
                if (backRes && backRes.handled) {
                  e.preventDefault();
                  blockHistoryRef.current?.history.push(
                    backRes.newText,
                    backRes.newCursorPos,
                    backRes.newCursorPos,
                    { force: true, actionTag: "list-backspace" }
                  );
                  handleLiveRawChange(block, backRes.newText);
                  window.requestAnimationFrame(() => {
                    try {
                      target.setSelectionRange(
                        backRes.newCursorPos,
                        backRes.newCursorPos
                      );
                    } catch {
                      // ignore
                    }
                  });
                  return;
                }
              }

              if (
                e.key === "Backspace" &&
                !block.raw.trim() &&
                blocks.length > 1
              ) {
                e.preventDefault();
                onDeleteBlock(block.id);
                if (idx > 0) {
                  onFocusBlock(blocks[idx - 1].id);
                }
              }
            }}
          />

          {/* Emoji Autocomplete Popup */}
          {emojiPopup && emojiPopup.blockId === block.id && (
            <div
              className="ty-menu-dropdown"
              style={{ position: "relative", top: 4, maxWidth: 280 }}
            >
              {emojiPopup.items.map((item) => (
                <button
                  key={item.shortcode}
                  type="button"
                  className="ty-menu-option"
                  onClick={() => {
                    const replaced = block.raw.replace(
                      new RegExp(`${emojiPopup.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
                      `:${item.shortcode}: `
                    );
                    setEmojiPopup(null);
                    onReplaceBlockWithRaw(block.id, replaced);
                  }}
                >
                  <span>
                    {item.emoji} :{item.shortcode}:
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Feishu-style Slash Command Dropdown Menu */}
          {slashMenu && slashMenu.blockId === block.id && (
            <SlashCommandMenu
              filterText={slashMenu.query}
              selectedIndex={slashMenu.selectedIndex}
              onSelect={(item) => handleExecuteSlashCommand(block.id, item)}
              onClose={() => setSlashMenu(null)}
              onHoverIndex={(idx) =>
                setSlashMenu((prev) =>
                  prev ? { ...prev, selectedIndex: idx } : null
                )
              }
            />
          )}

          {/* Live Math Preview Tooltip while editing a Math Block */}
          {block.type === "math" && (
            <div className="md-math-block" style={{ marginTop: 6 }}>
              <MathFormulaView
                tex={
                  block.raw
                    .replace(/^\s*\$\$|\$\$\s*$/g, "")
                    .trim()
                }
                displayMode={true}
              />
            </div>
          )}

          {/* Live Diagram Preview while editing a Mermaid Block */}
          {block.type === "diagram" && (
            <div className="ty-diagram-block" style={{ marginTop: 6 }}>
              <MermaidDiagramView
                code={block.raw}
                diagramType={block.diagramType}
              />
            </div>
          )}
        </div>
      );
    }

    // 5. Unfocused Clean Live-Preview Rendering
    switch (block.type) {
      case "frontmatter":
        return (
          <div
            key={block.id}
            id={block.id}
            className={`ty-block-wrapper md-front-matter ${multiSelClass}`}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              YAML Front Matter
            </div>
            <div>{block.text}</div>
          </div>
        );

      case "heading": {
        const level = block.headingLevel || 1;
        const HeadingTag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        const headingText = block.text ?? "";
        const displayHeadingText =
          headingText
            .replace(/(\*\*|__|~~|==|\*|_|\^|~|`)/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .trim() || headingText;
        const isCollapsed = collapsedHeadingIds.has(block.id);
        const foldedCount = foldedCountsByHeadingId.get(block.id) || 0;
        return (
          <div
            key={block.id}
            id={block.id}
            title={displayHeadingText}
            data-full-title={displayHeadingText}
            data-slug={block.slug || slugifyHeading(headingText)}
            data-heading-tag={`h${level}`}
            className={`ty-block-wrapper ty-heading-block ${
              isCollapsed ? "is-collapsed" : ""
            } ${multiSelClass}`}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            <div className="ty-heading-row">
              <button
                type="button"
                className={`ty-heading-fold-btn ${
                  isCollapsed ? "is-collapsed" : ""
                }`}
                title={
                  isCollapsed
                    ? `展开此章节: ${displayHeadingText}`
                    : `折叠此章节: ${displayHeadingText}`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHeadingCollapse(block.id);
                }}
              >
                {isCollapsed ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>
              <HeadingTag
                title={displayHeadingText}
                data-full-title={displayHeadingText}
                style={{ flex: 1, minWidth: 0 }}
              >
                {renderInlineMarkdown(headingText, inlineCtx, block.id)}
              </HeadingTag>
              <span
                className="ty-heading-gutter-tag"
                title={`H${level} · ${displayHeadingText}`}
              >
                H{level}
              </span>
            </div>
            {isCollapsed && (
              <button
                type="button"
                className="ty-heading-collapsed-pill"
                title={`展开章节: ${displayHeadingText}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHeadingCollapse(block.id);
                }}
              >
                <ChevronRight size={12} />
                <span>已折叠 {foldedCount} 个段落块 · 点击展开</span>
              </button>
            )}
          </div>
        );
      }

      case "math":
        return (
          <div
            key={block.id}
            id={block.id}
            className={`ty-block-wrapper md-math-block ${multiSelClass}`}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            <MathFormulaView tex={block.mathTex || ""} displayMode={true} />
          </div>
        );

      case "diagram":
        return (
          <div
            key={block.id}
            id={block.id}
            className={`ty-block-wrapper ty-diagram-block ${multiSelClass}`}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            <MermaidDiagramView
              code={block.code || block.raw}
              diagramType={block.diagramType}
            />
          </div>
        );

      case "alert": {
        const kind = block.alertKind || "NOTE";
        return (
          <div
            key={block.id}
            id={block.id}
            className={`ty-block-wrapper md-alert md-alert-${kind} ${multiSelClass}`}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            <div className="md-alert-title">
              {ALERT_ICONS[kind] || <AlertCircle size={15} />}
              <span>{kind}</span>
            </div>
            <div>
              {renderInlineMarkdown(block.text || "", inlineCtx, block.id)}
            </div>
          </div>
        );
      }

      case "blockquote":
        return (
          <blockquote
            key={block.id}
            id={block.id}
            className={`ty-block-wrapper ${multiSelClass}`}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            {(block.text || "").split("\n").map((line, lIdx) => (
              <p key={lIdx} style={{ margin: "0.25em 0" }}>
                {renderInlineMarkdown(
                  line,
                  inlineCtx,
                  `${block.id}-q-${lIdx}`
                )}
              </p>
            ))}
          </blockquote>
        );

      case "list": {
        const items = block.items || [];
        if (block.listType === "task") {
          return (
            <ul
              key={block.id}
              id={block.id}
              className={`ty-block-wrapper ty-task-list ${multiSelClass}`}
              onClick={(e) => handleBlockClick(block.id, e)}
              onContextMenu={(e) => onContextMenuRequest(e, block.id)}
            >
              {items.map((item, itemIdx) => (
                <li
                  key={item.id}
                  className="ty-task-list-item"
                  style={{ paddingLeft: `${item.indent * 10}px` }}
                >
                  <input
                    type="checkbox"
                    className="ty-task-checkbox"
                    disabled={readingMode}
                    checked={Boolean(item.checked)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      if (readingMode) return;
                      const nextItems = items.map((it, i) =>
                        i === itemIdx
                          ? { ...it, checked: e.target.checked }
                          : it
                      );
                      const nextBlock: MarkdownBlock = {
                        ...block,
                        items: nextItems
                      };
                      nextBlock.raw = serializeBlockToRaw(nextBlock);
                      onUpdateBlock(block.id, nextBlock);
                    }}
                  />
                  <span
                    className={`ty-task-text ${
                      item.checked ? "is-checked" : ""
                    }`}
                  >
                    {renderInlineMarkdown(
                      item.text,
                      inlineCtx,
                      `${block.id}-t-${itemIdx}`
                    )}
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        const isOrdered = block.listType === "ol";
        const ListTag = isOrdered ? "ol" : "ul";
        return (
          <ListTag
            key={block.id}
            id={block.id}
            start={isOrdered ? block.listStart : undefined}
            className={`ty-block-wrapper ${
              isOrdered ? "ty-ordered-list" : "ty-unordered-list"
            } ${multiSelClass}`}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            {items.map((item, itemIdx) => {
              const markerText = isOrdered
                ? `${
                    item.marker ||
                    `${
                      block.listStart ? block.listStart + itemIdx : itemIdx + 1
                    }.`
                  } `
                : "";
              const indentLevel = Math.min(2, Math.floor((item.indent || 0) / 2));
              return (
                <li
                  key={item.id}
                  data-item-idx={itemIdx}
                  data-indent-level={indentLevel}
                  className={`ty-list-item ty-list-level-${indentLevel}`}
                  style={{ paddingLeft: `${item.indent * 14}px` }}
                >
                  {isOrdered ? (
                    <span className="ty-list-marker ty-list-number">
                      {markerText}
                    </span>
                  ) : (
                    <span
                      className="ty-list-marker ty-list-bullet"
                      aria-hidden="true"
                    />
                  )}
                  <span className="ty-list-text">
                    {renderInlineMarkdown(
                      item.text,
                      inlineCtx,
                      `${block.id}-li-${itemIdx}`
                    )}
                  </span>
                </li>
              );
            })}
          </ListTag>
        );
      }

      case "hr":
        return (
          <div
            key={block.id}
            id={block.id}
            className={`ty-block-wrapper ${multiSelClass}`}
            style={{ padding: "8px 0", cursor: "pointer" }}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            <hr
              style={{
                border: "none",
                borderTop: "2px solid var(--heading-border-color)"
              }}
            />
          </div>
        );

      case "footnote_def":
        return (
          <div
            key={block.id}
            id={block.id}
            className={`ty-block-wrapper ${multiSelClass}`}
            style={{
              fontSize: "0.88em",
              color: "var(--muted-text-color)",
              borderTop: "1px dashed var(--side-bar-border-color)",
              paddingTop: 6,
              marginTop: 8
            }}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            <strong>[^{block.footnoteId}]: </strong>
            {renderInlineMarkdown(
              block.footnoteContent || "",
              inlineCtx,
              block.id
            )}
          </div>
        );

      case "paragraph":
      default:
        return (
          <div
            key={block.id}
            id={block.id}
            className={`ty-block-wrapper ty-paragraph-block ${multiSelClass}`}
            onClick={(e) => handleBlockClick(block.id, e)}
            onContextMenu={(e) => onContextMenuRequest(e, block.id)}
          >
            {renderInlineMarkdown(block.text || block.raw, inlineCtx, block.id)}
          </div>
        );
    }
  };

  const lineWidthClass =
    preferences.lineWidth === "wide"
      ? "line-width-wide"
      : preferences.lineWidth === "full"
      ? "line-width-full"
      : "";

  const handleContainerClick = (e: React.MouseEvent) => {
    if (readingMode) return;
    const target = e.target as HTMLElement;
    // If target was already detached during re-render, do nothing
    if (!target.isConnected) return;
    // If clicked on an interactive control, let it handle directly
    if (target.closest("button, input, a, textarea, .ty-table-toolbar, .ty-menu-dropdown, .ty-slash-menu-popup")) {
      return;
    }

    // 1. If clicked directly inside an existing block wrapper, let handleBlockClick handle or fallback here
    const clickedBlockWrapper = target.closest(".ty-block-wrapper") as HTMLElement | null;
    if (clickedBlockWrapper && clickedBlockWrapper.id) {
      // It's handled by block wrapper's onClick, stop here
      return;
    }

    // 2. High-precision smart spatial projection (Typora Alignment):
    // Regardless of whether clicking in wide margin, left/right container padding,
    // or vertical gaps between blocks, smartly snap to the closest block and character!
    const hit = findSmartTargetBlockAndOffset(
      e.clientX,
      e.clientY,
      blocks,
      hiddenBlockIds
    );

    if (hit.type === "tailDraft") {
      if (selectedBlockIds.length > 0) {
        onSelectBlocks?.([]);
      }
      handleFocusOrAppendEnd();
      return;
    }

    if (hit.type === "emptyDoc") {
      setEmptyDocDraft("");
      setTailDraft(null);
      tailDraftRef.current = null;
      onFocusBlock(null);
      return;
    }

    if (hit.type === "block" && hit.blockId) {
      commitTailDraft();
      commitMidDraft();
      if (selectedBlockIds.length > 0) {
        onSelectBlocks?.([]);
      }
      const targetPos = hit.offset ?? 0;
      preferredCursorPosRef.current = targetPos;
      if (focusedBlockId === hit.blockId) {
        const activeTa = focusedWrapperRef.current?.querySelector<HTMLTextAreaElement>(
          "textarea.ty-live-textarea"
        );
        if (activeTa) {
          try {
            activeTa.setSelectionRange(targetPos, targetPos);
          } catch {}
        }
      }
      onFocusBlock(hit.blockId);
      return;
    }
  };

  const handleContainerPointerDown = (_e: React.PointerEvent) => {
    // Keep edit session stable; no premature dismiss
  };

  return (
    <div
      className="ty-editor-scroll"
      onPointerDown={handleContainerPointerDown}
      onClick={handleContainerClick}
    >
      <div
        id="write"
        className={`is-node ${lineWidthClass}`}
        style={{ fontSize: `${preferences.fontSize}px` }}
        onPointerDown={handleContainerPointerDown}
        onClick={handleContainerClick}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            onContextMenuRequest(e, null);
          }
        }}
      >
        {blocks.length === 0 ? (
          readingMode ? (
            <p
              className="ty-block-wrapper"
              style={{
                color: "var(--muted-text-color)",
                cursor: "default",
                margin: "4px 0",
                fontSize: `${preferences.fontSize}px`
              }}
            >
              （当前文档为空，处于只读阅读模式）
            </p>
          ) : emptyDocDraft !== null ? (
            <div
              className="ty-block-wrapper md-focus"
              ref={focusedWrapperRef}
              style={{ margin: "4px 0" }}
            >
              <textarea
                autoFocus
                className="ty-live-textarea"
                rows={1}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContextMenuRequest(e, "empty");
                }}
                placeholder="在此处输入正文，支持 Markdown 语法..."
                value={emptyDocDraft}
                ref={(el) => {
                  if (el) {
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                spellCheck={preferences.spellcheck}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                  emptyDocDraftRef.current = nextVal;
                  setEmptyDocDraft(nextVal);
                  emptyDocHistoryRef.current.push(
                    nextVal,
                    e.target.selectionStart ?? nextVal.length,
                    e.target.selectionEnd ?? nextVal.length
                  );

                  const slashMatch = nextVal.match(/(?:^|\s)\/([a-zA-Z0-9_\u4e00-\u9fa5]*)$/);
                  if (slashMatch) {
                    setSlashMenu({
                      blockId: "empty",
                      query: slashMatch[1] || "",
                      slashPrefix: slashMatch[0].trim(),
                      selectedIndex: 0
                    });
                  } else {
                    setSlashMenu((prev) => (prev?.blockId === "empty" ? null : prev));
                  }
                }}
                onBlur={() => {
                  const val = emptyDocDraft.trim();
                  if (val) {
                    onChangeFullMarkdown(val);
                  }
                  setEmptyDocDraft(null);
                }}
                onKeyDown={(e) => {
                  if (isImeCompositionKeyDown(e.nativeEvent)) return;

                  // Feishu-style Slash Command Keyboard Navigation for empty doc draft
                  if (slashMenu && slashMenu.blockId === "empty") {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSlashMenu((prev) => {
                        if (!prev || filteredSlashCommands.length === 0) return prev;
                        return {
                          ...prev,
                          selectedIndex: Math.min(
                            filteredSlashCommands.length - 1,
                            prev.selectedIndex + 1
                          )
                        };
                      });
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashMenu((prev) => {
                        if (!prev || filteredSlashCommands.length === 0) return prev;
                        return {
                          ...prev,
                          selectedIndex: Math.max(0, prev.selectedIndex - 1)
                        };
                      });
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      if (filteredSlashCommands.length > 0) {
                        e.preventDefault();
                        const safeIdx = Math.min(
                          Math.max(0, slashMenu.selectedIndex),
                          filteredSlashCommands.length - 1
                        );
                        const chosen =
                          filteredSlashCommands[safeIdx] ||
                          filteredSlashCommands[0];
                        handleExecuteSlashCommand("empty", chosen);
                        return;
                      }
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setSlashMenu(null);
                      return;
                    }
                  }

                  // Undo / Redo inside empty doc draft (Fine-Grained Transactional History)
                  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
                    e.preventDefault();
                    const target = e.currentTarget;
                    if (e.shiftKey) {
                      if (emptyDocHistoryRef.current.canRedo()) {
                        const step = emptyDocHistoryRef.current.redo();
                        if (step) {
                          emptyDocDraftRef.current = step.value;
                          setEmptyDocDraft(step.value);
                          target.style.height = "auto";
                          target.style.height = `${target.scrollHeight}px`;
                          window.requestAnimationFrame(() => {
                            try {
                              target.setSelectionRange(
                                step.selectionStart,
                                step.selectionEnd
                              );
                            } catch {}
                          });
                          return;
                        }
                      }
                      onRedo?.();
                    } else {
                      if (emptyDocHistoryRef.current.canUndo()) {
                        const step = emptyDocHistoryRef.current.undo();
                        if (step) {
                          emptyDocDraftRef.current = step.value;
                          setEmptyDocDraft(step.value);
                          target.style.height = "auto";
                          target.style.height = `${target.scrollHeight}px`;
                          window.requestAnimationFrame(() => {
                            try {
                              target.setSelectionRange(
                                step.selectionStart,
                                step.selectionEnd
                              );
                            } catch {}
                          });
                          return;
                        }
                      }
                      onUndo?.();
                    }
                    return;
                  }
                  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "y") {
                    e.preventDefault();
                    const target = e.currentTarget;
                    if (emptyDocHistoryRef.current.canRedo()) {
                      const step = emptyDocHistoryRef.current.redo();
                      if (step) {
                        emptyDocDraftRef.current = step.value;
                        setEmptyDocDraft(step.value);
                        target.style.height = "auto";
                        target.style.height = `${target.scrollHeight}px`;
                        window.requestAnimationFrame(() => {
                          try {
                            target.setSelectionRange(
                              step.selectionStart,
                              step.selectionEnd
                            );
                          } catch {}
                        });
                        return;
                      }
                    }
                    onRedo?.();
                    return;
                  }

                  if (e.key === "Tab") {
                    e.preventDefault();
                    const target = e.currentTarget;
                    const tabRes = handleListTab(
                      target.value,
                      target.selectionStart ?? 0,
                      target.selectionEnd ?? 0,
                      e.shiftKey
                    );
                    if (tabRes.handled) {
                      emptyDocDraftRef.current = tabRes.newText;
                      setEmptyDocDraft(tabRes.newText);
                      window.requestAnimationFrame(() => {
                        try {
                          target.setSelectionRange(
                            tabRes.newCursorPos,
                            tabRes.newCursorPos
                          );
                        } catch {}
                      });
                    }
                    return;
                  }
                  if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    const target = e.currentTarget;
                    const start = target.selectionStart ?? 0;
                    const end = target.selectionEnd ?? 0;
                    const backRes = handleListBackspace(target.value, start, end);
                    if (backRes && backRes.handled) {
                      e.preventDefault();
                      emptyDocDraftRef.current = backRes.newText;
                      setEmptyDocDraft(backRes.newText);
                      window.requestAnimationFrame(() => {
                        try {
                          target.setSelectionRange(
                            backRes.newCursorPos,
                            backRes.newCursorPos
                          );
                        } catch {}
                      });
                      return;
                    }
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEmptyDocDraft(null);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    const target = e.currentTarget;
                    const listRes = handleListEnter(
                      target.value,
                      target.selectionStart ?? 0,
                      target.selectionEnd ?? 0
                    );
                    if (listRes.handled) {
                      e.preventDefault();
                      if (listRes.isListExit) {
                        const val = listRes.newText.trim();
                        if (val) {
                          onChangeFullMarkdown(`${val}\n\n`);
                        }
                        setEmptyDocDraft(null);
                      } else {
                        emptyDocDraftRef.current = listRes.newText;
                        setEmptyDocDraft(listRes.newText);
                        window.requestAnimationFrame(() => {
                          try {
                            target.setSelectionRange(
                              listRes.newCursorPos,
                              listRes.newCursorPos
                            );
                          } catch {
                            // ignore
                          }
                        });
                      }
                      return;
                    }

                    const val = emptyDocDraft.trim();
                    if (val) {
                      e.preventDefault();
                      onChangeFullMarkdown(`${val}\n\n`);
                      setEmptyDocDraft(null);
                    }
                  }
                }}
              />

              {/* Feishu-style Slash Command Menu for empty document draft */}
              {slashMenu && slashMenu.blockId === "empty" && (
                <SlashCommandMenu
                  filterText={slashMenu.query}
                  selectedIndex={slashMenu.selectedIndex}
                  onSelect={(item) => handleExecuteSlashCommand("empty", item)}
                  onClose={() => setSlashMenu(null)}
                  onHoverIndex={(idx) =>
                    setSlashMenu((prev) =>
                      prev ? { ...prev, selectedIndex: idx } : null
                    )
                  }
                />
              )}
            </div>
          ) : (
            <p
              className="ty-block-wrapper"
              style={{
                color: "var(--muted-text-color)",
                cursor: "text",
                margin: "4px 0"
              }}
              onClick={() => setEmptyDocDraft("")}
            >
              在此处输入正文，支持 Markdown 语法...
            </p>
          )
        ) : (
          <>
            {blocks.map((block, idx) => (
              <React.Fragment key={block.id}>
                {renderBlock(block, idx)}
                {midDraft && midDraft.afterBlockId === block.id && (
                  <div
                    className="ty-block-wrapper ty-paragraph-block md-focus"
                    ref={focusedWrapperRef}
                    style={{ margin: "0.65em 0" }}
                  >
                    <textarea
                      className="ty-live-textarea"
                      rows={1}
                      value={midDraft.content}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onContextMenuRequest(e, midDraft.afterBlockId);
                      }}
                      placeholder="在此处继续输入新段落..."
                      ref={(el) => {
                        if (el) {
                          el.style.height = "auto";
                          el.style.height = `${el.scrollHeight}px`;
                          if (document.activeElement !== el) {
                            el.focus({ preventScroll: true });
                            window.requestAnimationFrame(() => {
                              try {
                                el.focus({ preventScroll: true });
                              } catch {}
                            });
                          }
                        }
                      }}
                      spellCheck={preferences.spellcheck}
                      onChange={(e) => {
                        const nextVal = e.target.value;
                        e.currentTarget.style.height = "auto";
                        e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                        midDraftRef.current = {
                          afterBlockId: block.id,
                          content: nextVal
                        };
                        setMidDraft({
                          afterBlockId: block.id,
                          content: nextVal
                        });
                        midHistoryRef.current.push(
                          nextVal,
                          e.target.selectionStart ?? nextVal.length,
                          e.target.selectionEnd ?? nextVal.length
                        );
                      }}
                      onBlur={() => {
                        commitMidDraft(false);
                      }}
                      onKeyDown={(e) => {
                        if (isImeCompositionKeyDown(e.nativeEvent)) return;

                        if (e.key === "Tab") {
                          e.preventDefault();
                          const target = e.currentTarget;
                          const tabRes = handleListTab(
                            target.value,
                            target.selectionStart ?? 0,
                            target.selectionEnd ?? 0,
                            e.shiftKey
                          );
                          if (tabRes.handled) {
                            midDraftRef.current = {
                              afterBlockId: block.id,
                              content: tabRes.newText
                            };
                            setMidDraft({
                              afterBlockId: block.id,
                              content: tabRes.newText
                            });
                            window.requestAnimationFrame(() => {
                              try {
                                target.setSelectionRange(
                                  tabRes.newCursorPos,
                                  tabRes.newCursorPos
                                );
                              } catch {}
                            });
                          }
                          return;
                        }
                        if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                          const target = e.currentTarget;
                          const start = target.selectionStart ?? 0;
                          const end = target.selectionEnd ?? 0;
                          const backRes = handleListBackspace(target.value, start, end);
                          if (backRes && backRes.handled) {
                            e.preventDefault();
                            midDraftRef.current = {
                              afterBlockId: block.id,
                              content: backRes.newText
                            };
                            setMidDraft({
                              afterBlockId: block.id,
                              content: backRes.newText
                            });
                            window.requestAnimationFrame(() => {
                              try {
                                target.setSelectionRange(
                                  backRes.newCursorPos,
                                  backRes.newCursorPos
                                );
                              } catch {}
                            });
                            return;
                          }
                        }
                        // Arrow keys roaming from midDraft back to neighboring blocks
                        if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                          const target = e.currentTarget;
                          const start = target.selectionStart ?? 0;
                          const end = target.selectionEnd ?? 0;
                          const val = target.value;
                          const visibleBlocks = blocks.filter((b) => !hiddenBlockIds.has(b.id));
                          const currentBlockIdx = visibleBlocks.findIndex((b) => b.id === block.id);
                          const nextBlock =
                            currentBlockIdx >= 0 && currentBlockIdx < visibleBlocks.length - 1
                              ? visibleBlocks[currentBlockIdx + 1]
                              : null;

                          if (
                            (e.key === "ArrowLeft" && start === 0 && end === 0) ||
                            (e.key === "ArrowUp" && start === end && isCaretAtVisualEdge(target, "up", start))
                          ) {
                            e.preventDefault();
                            commitMidDraft(false);
                            const prevRaw = block.raw;
                            if (e.key === "ArrowLeft") {
                              preferredCursorPosRef.current = prevRaw.length;
                              onFocusBlock(block.id);
                            } else {
                              focusAtVisualEdge(block.id, "last", target, start);
                            }
                            return;
                          }

                          if (
                            (e.key === "ArrowRight" && start === val.length && end === val.length) ||
                            (e.key === "ArrowDown" && start === end && isCaretAtVisualEdge(target, "down", end))
                          ) {
                            if (nextBlock) {
                              e.preventDefault();
                              commitMidDraft(false);
                              if (e.key === "ArrowRight") {
                                preferredCursorPosRef.current = 0;
                                onFocusBlock(nextBlock.id);
                              } else {
                                focusAtVisualEdge(nextBlock.id, "first", target, end);
                              }
                              return;
                            }
                          }
                        }

                        // Undo / Redo inside midDraft (Fine-Grained Transactional History)
                        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
                          e.preventDefault();
                          const target = e.currentTarget;
                          if (e.shiftKey) {
                            if (midHistoryRef.current.canRedo()) {
                              const step = midHistoryRef.current.redo();
                              if (step) {
                                midDraftRef.current = {
                                  afterBlockId: block.id,
                                  content: step.value
                                };
                                setMidDraft({
                                  afterBlockId: block.id,
                                  content: step.value
                                });
                                target.style.height = "auto";
                                target.style.height = `${target.scrollHeight}px`;
                                window.requestAnimationFrame(() => {
                                  try {
                                    target.setSelectionRange(
                                      step.selectionStart,
                                      step.selectionEnd
                                    );
                                  } catch {}
                                });
                                return;
                              }
                            }
                            onRedo?.();
                          } else {
                            if (midHistoryRef.current.canUndo()) {
                              const step = midHistoryRef.current.undo();
                              if (step) {
                                midDraftRef.current = {
                                  afterBlockId: block.id,
                                  content: step.value
                                };
                                setMidDraft({
                                  afterBlockId: block.id,
                                  content: step.value
                                });
                                target.style.height = "auto";
                                target.style.height = `${target.scrollHeight}px`;
                                window.requestAnimationFrame(() => {
                                  try {
                                    target.setSelectionRange(
                                      step.selectionStart,
                                      step.selectionEnd
                                    );
                                  } catch {}
                                });
                                return;
                              }
                            }
                            onUndo?.();
                          }
                          return;
                        }
                        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "y") {
                          e.preventDefault();
                          const target = e.currentTarget;
                          if (midHistoryRef.current.canRedo()) {
                            const step = midHistoryRef.current.redo();
                            if (step) {
                              midDraftRef.current = {
                                afterBlockId: block.id,
                                content: step.value
                              };
                              setMidDraft({
                                afterBlockId: block.id,
                                content: step.value
                              });
                              target.style.height = "auto";
                              target.style.height = `${target.scrollHeight}px`;
                              window.requestAnimationFrame(() => {
                                try {
                                  target.setSelectionRange(
                                    step.selectionStart,
                                    step.selectionEnd
                                  );
                                } catch {}
                              });
                              return;
                            }
                          }
                          onRedo?.();
                          return;
                        }
                        if (e.key === "Enter" && !e.shiftKey) {
                          const target = e.currentTarget;
                          const listRes = handleListEnter(
                            target.value,
                            target.selectionStart ?? 0,
                            target.selectionEnd ?? 0
                          );
                          if (listRes.handled) {
                            e.preventDefault();
                            if (listRes.isListExit) {
                              const val = listRes.newText.trim();
                              if (val) {
                                onInsertBlockAfter(block.id, val, false);
                              }
                              midDraftRef.current = null;
                              setMidDraft(null);
                            } else {
                              midHistoryRef.current.push(
                                listRes.newText,
                                listRes.newCursorPos,
                                listRes.newCursorPos,
                                { force: true, actionTag: "list-enter" }
                              );
                              midDraftRef.current = {
                                afterBlockId: block.id,
                                content: listRes.newText
                              };
                              setMidDraft({
                                afterBlockId: block.id,
                                content: listRes.newText
                              });
                              window.requestAnimationFrame(() => {
                                try {
                                  target.setSelectionRange(
                                    listRes.newCursorPos,
                                    listRes.newCursorPos
                                  );
                                } catch {}
                              });
                            }
                            return;
                          }

                          e.preventDefault();
                          const val = midDraftRef.current?.content.trim();
                          if (val) {
                            onInsertBlockAfter(block.id, val, true);
                            midDraftRef.current = null;
                            setMidDraft(null);
                          }
                        } else if (
                          e.key === "Backspace" &&
                          !midDraftRef.current?.content
                        ) {
                          e.preventDefault();
                          midDraftRef.current = null;
                          setMidDraft(null);
                          onFocusBlock(block.id);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          commitMidDraft(false);
                        }
                      }}
                    />
                  </div>
                )}
              </React.Fragment>
            ))}

            {/* In-Place Tail Paragraph Typing (when clicking anywhere below blocks) */}
            {tailDraft !== null && (
              <div
                className="ty-block-wrapper md-focus"
                ref={focusedWrapperRef}
                style={{ margin: "0.65em 0" }}
              >
                <textarea
                  className="ty-live-textarea"
                  rows={1}
                  value={tailDraft}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenuRequest(e, "tail");
                  }}
                  placeholder="在此处继续输入新段落..."
                  ref={(el) => {
                    if (el) {
                      el.style.height = "auto";
                      el.style.height = `${el.scrollHeight}px`;
                      if (document.activeElement !== el) {
                        el.focus({ preventScroll: true });
                        window.requestAnimationFrame(() => {
                          try {
                            el.focus({ preventScroll: true });
                          } catch {}
                        });
                      }
                    }
                  }}
                  spellCheck={preferences.spellcheck}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    e.currentTarget.style.height = "auto";
                    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                    tailDraftRef.current = nextVal;
                    setTailDraft(nextVal);
                    tailHistoryRef.current.push(
                      nextVal,
                      e.target.selectionStart ?? nextVal.length,
                      e.target.selectionEnd ?? nextVal.length
                    );

                    // Check slash command trigger in tail draft
                    const slashMatch = nextVal.match(/(?:^|\s)\/([a-zA-Z0-9_\u4e00-\u9fa5]*)$/);
                    if (slashMatch) {
                      setSlashMenu({
                        blockId: "tail",
                        query: slashMatch[1] || "",
                        slashPrefix: slashMatch[0].trim(),
                        selectedIndex: 0
                      });
                    } else {
                      setSlashMenu((prev) => (prev?.blockId === "tail" ? null : prev));
                    }
                  }}
                  onBlur={() => {
                    commitTailDraft(false);
                  }}
                  onKeyDown={(e) => {
                    if (isImeCompositionKeyDown(e.nativeEvent)) return;

                    // Feishu-style Slash Command Keyboard Navigation for tail draft
                    if (slashMenu && slashMenu.blockId === "tail") {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSlashMenu((prev) => {
                          if (!prev || filteredSlashCommands.length === 0) return prev;
                          return {
                            ...prev,
                            selectedIndex: Math.min(
                              filteredSlashCommands.length - 1,
                              prev.selectedIndex + 1
                            )
                          };
                        });
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSlashMenu((prev) => {
                          if (!prev || filteredSlashCommands.length === 0) return prev;
                          return {
                            ...prev,
                            selectedIndex: Math.max(0, prev.selectedIndex - 1)
                          };
                        });
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        if (filteredSlashCommands.length > 0) {
                          e.preventDefault();
                          const safeIdx = Math.min(
                            Math.max(0, slashMenu.selectedIndex),
                            filteredSlashCommands.length - 1
                          );
                          const chosen =
                            filteredSlashCommands[safeIdx] ||
                            filteredSlashCommands[0];
                          handleExecuteSlashCommand("tail", chosen);
                          return;
                        }
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setSlashMenu(null);
                        return;
                      }
                    }

                    if (e.key === "Tab") {
                      e.preventDefault();
                      const target = e.currentTarget;
                      const tabRes = handleListTab(
                        target.value,
                        target.selectionStart ?? 0,
                        target.selectionEnd ?? 0,
                        e.shiftKey
                      );
                      if (tabRes.handled) {
                        tailDraftRef.current = tabRes.newText;
                        setTailDraft(tabRes.newText);
                        window.requestAnimationFrame(() => {
                          try {
                            target.setSelectionRange(
                              tabRes.newCursorPos,
                              tabRes.newCursorPos
                            );
                          } catch {}
                        });
                      }
                      return;
                    }
                    if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                      const target = e.currentTarget;
                      const start = target.selectionStart ?? 0;
                      const end = target.selectionEnd ?? 0;
                      const backRes = handleListBackspace(target.value, start, end);
                      if (backRes && backRes.handled) {
                        e.preventDefault();
                        tailHistoryRef.current.push(
                          backRes.newText,
                          backRes.newCursorPos,
                          backRes.newCursorPos,
                          { force: true, actionTag: "list-backspace" }
                        );
                        tailDraftRef.current = backRes.newText;
                        setTailDraft(backRes.newText);
                        window.requestAnimationFrame(() => {
                          try {
                            target.setSelectionRange(
                              backRes.newCursorPos,
                              backRes.newCursorPos
                            );
                          } catch {}
                        });
                        return;
                      }
                    }

                    // Arrow keys roaming from tailDraft back to last block
                    if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                      const target = e.currentTarget;
                      const start = target.selectionStart ?? 0;
                      const end = target.selectionEnd ?? 0;
                      const visibleBlocks = blocks.filter((b) => !hiddenBlockIds.has(b.id));

                      if (
                        (e.key === "ArrowLeft" && start === 0 && end === 0) ||
                        (e.key === "ArrowUp" && start === end && isCaretAtVisualEdge(target, "up", start))
                      ) {
                        if (visibleBlocks.length > 0) {
                          e.preventDefault();
                          commitTailDraft(false);
                          const lastBlock = visibleBlocks[visibleBlocks.length - 1];
                          const lastRaw = lastBlock.raw;
                          if (e.key === "ArrowLeft") {
                            preferredCursorPosRef.current = lastRaw.length;
                            onFocusBlock(lastBlock.id);
                          } else {
                            focusAtVisualEdge(lastBlock.id, "last", target, start);
                          }
                          return;
                        }
                      }
                    }

                    // Undo / Redo inside tailDraft (Fine-Grained Transactional History)
                    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
                      e.preventDefault();
                      const target = e.currentTarget;
                      if (e.shiftKey) {
                        if (tailHistoryRef.current.canRedo()) {
                          const step = tailHistoryRef.current.redo();
                          if (step) {
                            tailDraftRef.current = step.value;
                            setTailDraft(step.value);
                            target.style.height = "auto";
                            target.style.height = `${target.scrollHeight}px`;
                            window.requestAnimationFrame(() => {
                              try {
                                target.setSelectionRange(
                                  step.selectionStart,
                                  step.selectionEnd
                                );
                              } catch {}
                            });
                            return;
                          }
                        }
                        onRedo?.();
                      } else {
                        if (tailHistoryRef.current.canUndo()) {
                          const step = tailHistoryRef.current.undo();
                          if (step) {
                            tailDraftRef.current = step.value;
                            setTailDraft(step.value);
                            target.style.height = "auto";
                            target.style.height = `${target.scrollHeight}px`;
                            window.requestAnimationFrame(() => {
                              try {
                                target.setSelectionRange(
                                  step.selectionStart,
                                  step.selectionEnd
                                );
                              } catch {}
                            });
                            return;
                          }
                        }
                        onUndo?.();
                      }
                      return;
                    }
                    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "y") {
                      e.preventDefault();
                      const target = e.currentTarget;
                      if (tailHistoryRef.current.canRedo()) {
                        const step = tailHistoryRef.current.redo();
                        if (step) {
                          tailDraftRef.current = step.value;
                          setTailDraft(step.value);
                          target.style.height = "auto";
                          target.style.height = `${target.scrollHeight}px`;
                          window.requestAnimationFrame(() => {
                            try {
                              target.setSelectionRange(
                                step.selectionStart,
                                step.selectionEnd
                              );
                            } catch {}
                          });
                          return;
                        }
                      }
                      onRedo?.();
                      return;
                    }

                    if (e.key === "Escape") {
                      e.preventDefault();
                      commitTailDraft(false);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      const target = e.currentTarget;
                      const listRes = handleListEnter(
                        target.value,
                        target.selectionStart ?? 0,
                        target.selectionEnd ?? 0
                      );
                      if (listRes.handled) {
                        e.preventDefault();
                        if (listRes.isListExit) {
                          // Double Enter on empty list item -> commit the list to blocks!
                          const val = listRes.newText.trim();
                          if (val && blocks.length > 0) {
                            onInsertBlockAfter(blocks[blocks.length - 1].id, val, false);
                          }
                          tailDraftRef.current = "";
                          setTailDraft("");
                        } else {
                          // Auto-incremented -> continue editing in tailDraft
                          tailHistoryRef.current.push(
                            listRes.newText,
                            listRes.newCursorPos,
                            listRes.newCursorPos,
                            { force: true, actionTag: "list-enter" }
                          );
                          tailDraftRef.current = listRes.newText;
                          setTailDraft(listRes.newText);
                          window.requestAnimationFrame(() => {
                            try {
                              target.setSelectionRange(
                                listRes.newCursorPos,
                                listRes.newCursorPos
                              );
                            } catch {
                              // ignore
                            }
                          });
                        }
                        return;
                      }

                      e.preventDefault();
                      const val = tailDraftRef.current?.trim();
                      if (val && blocks.length > 0) {
                        onInsertBlockAfter(blocks[blocks.length - 1].id, val, false);
                      }
                      tailDraftRef.current = "";
                      setTailDraft("");
                    } else if (e.key === "Backspace" && !tailDraftRef.current) {
                      e.preventDefault();
                      tailDraftRef.current = null;
                      setTailDraft(null);
                      if (blocks.length > 0) {
                        onFocusBlock(blocks[blocks.length - 1].id);
                      }
                    }
                  }}
                />

                {/* Feishu-style Slash Command Menu for tail draft */}
                {slashMenu && slashMenu.blockId === "tail" && (
                  <SlashCommandMenu
                    filterText={slashMenu.query}
                    selectedIndex={slashMenu.selectedIndex}
                    onSelect={(item) => handleExecuteSlashCommand("tail", item)}
                    onClose={() => setSlashMenu(null)}
                    onHoverIndex={(idx) =>
                      setSlashMenu((prev) =>
                        prev ? { ...prev, selectedIndex: idx } : null
                      )
                    }
                  />
                )}
              </div>
            )}
          </>
        )}

        {/* Clickable Bottom Writing Pad: Clicking anywhere below document immediately appends and focuses inline typing */}
        <div
          className="ty-editor-bottom-pad"
          style={{
            minHeight: "360px",
            flex: "1 1 auto",
            cursor: "text",
            width: "100%",
            display: "flex",
            alignItems: "flex-start",
            paddingTop: "14px",
            userSelect: "none"
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (selectedBlockIds.length > 0) {
              onSelectBlocks?.([]);
            }
            handleFocusOrAppendEnd();
          }}
        />
      </div>
    </div>
  );
};
