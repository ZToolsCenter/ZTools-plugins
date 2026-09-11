import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { useCreateBlockNote } from "@blocknote/react";
import { AIExtension } from "@blocknote/xl-ai";
import {
  goosePrivateSelectionDocumentStateBuilder,
  gooseSelectionScopedStreamToolsProvider,
} from "@/components/editor/ai/selectionPrivacy";
import { zh as aiZh } from "@blocknote/xl-ai/locales";
import { createGooseAITransport } from "@/components/editor/ai/transport/blocknoteAITransport";
import { zh } from "@blocknote/core/locales";
import "@blocknote/react/style.css";
import { createDebounce } from "@/components/editor/utils/debounce";
import { commitPendingEditorChange } from "./editorPendingCommit";
import {
  useEditorSettings,
  useEditorPageContext,
} from "@/components/editor/platform/hostContext";
import { useEditorPlatform } from "@/components/editor/platform/context";
import {
  clonePageContent,
  createEditorSafeContent,
  getContentSignature,
  needsBodyParagraphAfterTitle,
  normalizePageContent,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { markUserInteraction } from "@/lib/editor-interaction-signal";
import { normalizeExternalUrl } from "@/lib/openExternalUrl";
import {
  completePageTitleFocus,
  isPageTitleFocusRequested,
} from "@/lib/page-title-focus";

/**
 * 原始文档内容 → 编辑器可用块数组（不做任何页面级规范化改写）。
 * BlockNote 的 initialContent / replaceBlocks 不接受空数组，
 * 空文件 / 解析失败时兜底为单个空段落（仅编辑器呈现层，不回写 store）。
 */
function toEditorBlocks(content: unknown): BlockNoteContent {
  const blocks = Array.isArray(content) ? (content as BlockNoteContent) : [];
  if (blocks.length > 0) return blocks;
  return [{ type: "paragraph", content: "" }] as BlockNoteContent;
}

const contentSigCache = new WeakMap<object, string>();
function getCachedContentSignature(content: unknown): string {
  if (content && typeof content === "object") {
    const key = content as object;
    const hit = contentSigCache.get(key);
    if (hit) return hit;
    const sig = getContentSignature(content);
    contentSigCache.set(key, sig);
    return sig;
  }
  return getContentSignature(content);
}
import {
  getBlockNoteSlashMenuItems,
  filterSlashMenuItems,
} from "./blocknoteSlashItems";
import { gooseSelectAllExtension } from "@/components/editor/extensions/selectAllExtension";
import { gooseCopyCurrentBlockExtension } from "@/components/editor/extensions/copyCurrentBlockExtension";
import { gooseMoveBlockExtension } from "@/components/editor/extensions/moveBlockExtension";
import { createGooseLinkKeyboardExtension } from "@/components/editor/extensions/linkKeyboardExtension";
import { gooseTabBehaviorExtension } from "@/components/editor/extensions/tabBehaviorExtension";
import { gooseBlockDragNestExtension } from "@/components/editor/extensions/blockDragNestExtension";
import { gooseCodeBlockKeyboardExtension } from "@/components/editor/extensions/codeBlockKeyboardExtension";
import { gooseCodeBlockLinkStripExtension } from "@/components/editor/extensions/codeBlockLinkStripExtension";
import { gooseCalloutKeyboardExtension } from "@/components/editor/extensions/calloutKeyboardExtension";
import { gooseFirstTitleEnterExtension } from "@/components/editor/extensions/firstTitleEnterExtension";
import { gooseMediaBlockEnterExtension } from "@/components/editor/extensions/mediaBlockEnterExtension";
import { gooseEmptyNestedListEnterExtension } from "@/components/editor/extensions/emptyNestedListEnterExtension";
import { gooseCollapsedToggleEnterExtension } from "@/components/editor/extensions/collapsedToggleEnterExtension";
import { gooseToggleHeadingAutoCollectExtension } from "@/components/editor/extensions/toggleHeadingAutoCollectExtension";
import { gooseCrossBlockDeleteExtension } from "@/components/editor/extensions/crossBlockDeleteExtension";
import { gooseEmptyBlockBackspaceExtension } from "@/components/editor/extensions/emptyBlockBackspaceExtension";
import { createGooseNumberedListStartNormalizationExtension } from "@/components/editor/extensions/numberedListStartNormalizationExtension";
import { createGooseBodyParagraphGuardExtension } from "@/components/editor/extensions/bodyParagraphGuardExtension";
import { createGooseFirstTitleGuardExtension } from "@/components/editor/inputrules/firstTitleGuard";
import { gooseMarkdownInputRulesExtension } from "@/components/editor/inputrules/markdownInputRules";
import { gooseDividerInputRuleExtension } from "@/components/editor/inputrules/dividerInputRule";
import { gooseSuppressMarkdownInSpecialBlocksExtension } from "@/components/editor/inputrules/suppressMarkdownInSpecialBlocks";
import { gooseHeadingMarkSuppressExtension } from "@/components/editor/extensions/headingMarkSuppressExtension";
import { gooseInlineCodeCaretExtension } from "@/components/editor/extensions/inlineCodeCaretExtension";
import { gooseInlineCodeBacktickWrapExtension } from "@/components/editor/extensions/inlineCodeBacktickWrapExtension";
import { gooseActiveListMarkerExtension } from "@/components/editor/extensions/activeListMarkerExtension";
import { gooseFakeSelectionExtension } from "@/components/editor/extensions/fakeSelectionExtension";
import { ArrowInputRuleExtension } from "@/components/editor/inputrules/arrowInputRule";
import { gooseFindInPageExtension } from "@/components/editor/find/findInPagePlugin";
import { createGooseSlashMenuReconcileExtension } from "@/components/editor/extensions/gooseSlashMenuReconcileExtension";
import { reconcileSlashSuggestionMenu } from "@/components/editor/utils/slashMenuPolicy";
import {
  EditorComposer,
  editorSchema,
  getSelectedCellPlainText,
  getSelectedImageUrl,
  getSelectedPlainTextContext,
  isBottomEditorBlankClick,
  normalizeClipboardLineEndings,
  shouldPreferVisibleSelectionText,
  stripMarkdownHardBreaks,
} from "./EditorComposer";
import { isLinkworthyText } from "@/components/editor/utils/clipboard";
import { useEditorShortcuts } from "@/components/editor/hooks/useEditorShortcuts";
import { useEditorPaste } from "@/components/editor/hooks/useEditorPaste";
import { pasteClipboardFilesFromClipboard } from "@/components/editor/utils/pasteClipboardFilesFromClipboard";
import {
  clipboardHasPasteableImage,
  clipboardHasPasteableMedia,
} from "@/components/editor/utils/pasteClipboardImage";
import { uploadEditorFile } from "@/components/editor/utils/uploadEditorFile";
import { fileStorage } from "@/lib/fileStorage";
import { getFileUploadAvailability } from "@/lib/fileUploadAvailability";
import { copyImageSrcToClipboard } from "@/components/editor/image/imageUtils";

export interface EditorRef {
  editor: ReturnType<typeof useCreateBlockNote> | null;
}

interface EditorProps {
  editable?: boolean;
  /** 是否启用当前运行环境提供的拼写检查。 */
  spellCheck?: boolean;
  /**
   * 需从斜杠菜单隐藏的项标题列表（按 title 精确匹配）。
   * 紧凑宿主可用它隐藏表格、图片、AI 等重型项；不传则保持全量。
   */
  hiddenSlashItemTitles?: string[];
  /**
   * 是否显示块侧边菜单（+ / ⋮⋮）。默认 true（主编辑器）。
   * 窄布局可传 false，避免浮动菜单与块 hover 判定互相干扰。
   */
  showSideMenu?: boolean;
}

export const Editor = forwardRef<EditorRef, EditorProps>(function Editor(
  {
    editable = true,
    spellCheck = false,
    hiddenSlashItemTitles,
    showSideMenu = true,
  },
  ref,
) {
  const settings = useEditorSettings();
  const {
    theme,
    searchProviders,
    customActions,
    tableEvenColumnWidth,
    ai: aiSettings,
    openLinksInHost,
  } = settings;
  const {
    page,
    contentMode,
    isEditorFullWidth,
    onContentChange,
    getActivePageLocalFilePath,
    getLatestPage,
  } = useEditorPageContext();
  const platform = useEditorPlatform();
  const activePageId = page?.id ?? null;

  const pageIdForUpdateRef = useRef<string | null>(null);
  const syncedContentSignatureRef = useRef<string | null>(null);
  // 只有 BlockNote 真正触发了待提交的 onChange 才需要在切页时克隆整篇文档。
  // 只读浏览后切到文件夹主页时直接跳过，避免大文件产生同步长任务。
  const pendingEditorChangeRef = useRef(false);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const shiftPressedRef = useRef(false);
  pageIdForUpdateRef.current = page?.id ?? null;

  // 点击编辑器空白区域消闪：mousedown 时短暂抑制格式化工具栏（prosemirror 会先短暂
  // 出现非空选区再被 focusEditorEnd 塌缩），mouseup 时恢复。
  const [suppressFormattingToolbar, setSuppressFormattingToolbar] =
    useState(false);
  const suppressFormattingToolbarRef = useRef(false);

  // 注入回调/数据的最新引用：供 useCreateBlockNote（deps=[]）的闭包与各 effect 读取，
  // 避免把 settings/pageContext 直接进依赖数组导致编辑器重建（行为不变）。
  const aiSettingsRef = useRef(aiSettings);
  aiSettingsRef.current = aiSettings;
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const getActivePageLocalFilePathRef = useRef(getActivePageLocalFilePath);
  getActivePageLocalFilePathRef.current = getActivePageLocalFilePath;
  const pageRef = useRef(page);
  pageRef.current = page;
  const contentModeRef = useRef(contentMode);
  contentModeRef.current = contentMode;
  // platformRef 供 useCreateBlockNote 闭包（deps=[]）调用平台能力，
  // 同 aiSettingsRef 模式，避免闭包捕获旧 platform 引用。
  const platformRef = useRef(platform);
  platformRef.current = platform;
  const openLinksInHostRef = useRef(openLinksInHost);
  openLinksInHostRef.current = openLinksInHost;
  // settingsRef 供 useCreateBlockNote 闭包（deps=[]）调用平台设置，避免闭包捕获旧配置
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** uploadFile 与同 tick 粘贴需 getBlock；每 render 同步 */
  const editorInstanceRef = useRef<ReturnType<
    typeof useCreateBlockNote
  > | null>(null);

  // raw 文档保持宿主传入的块结构，不施加页面级标题和空正文规范；
  // normalized 文档沿用完整页面规范化规则。
  const usesRawEditorContent = contentMode === "raw";
  const usesRawEditorContentRef = useRef(usesRawEditorContent);
  usesRawEditorContentRef.current = usesRawEditorContent;
  const normalizeContent = (c: unknown): BlockNoteContent =>
    usesRawEditorContent
      ? toEditorBlocks(c)
      : normalizePageContent(c as Parameters<typeof normalizePageContent>[0]);

  // 用户意图门控（仅 raw 文档消费）：BlockNote 对部分块（折叠块/视频/带
  // 属性图片等）会在初始化后异步补全 props，触发与基线签名不一致的 onChange——
  // 这不是用户编辑，不应入保存队列。这里记录「自上次程序化同步以来用户是否真实
  // 交互过」：pointerdown/keydown/paste/cut/drop 任一发生即视为有交互（覆盖打字、
  // IME、点勾选框/工具栏/菜单、拖拽块、表格操作等全部真实编辑入口；误报无害——
  // 内容未变签名相等不会入队，变了还有写盘前 diff 兜底）。切页/外部重载后重置。
  const userInteractedRef = useRef(false);
  useEffect(() => {
    const markInteracted = () => {
      userInteractedRef.current = true;
      markUserInteraction();
    };
    const events = ["pointerdown", "keydown", "paste", "cut", "drop"] as const;
    events.forEach((name) =>
      document.addEventListener(name, markInteracted, true),
    );
    return () =>
      events.forEach((name) =>
        document.removeEventListener(name, markInteracted, true),
      );
  }, []);

  // 程序化同步路径（非 silent 入队以外的 store 同步）：供 onChange 在「无用户交互」
  // 时把编辑器自动补全后的内容静默同步进 store（不标脏、不入保存队列、不刷 updatedAt）。
  const silentContentSync = useCallback((content: BlockNoteContent) => {
    onContentChangeRef.current(content, { silent: true });
  }, []);

  const initialContentRef = useRef(
    createEditorSafeContent(normalizeContent(page?.content), editorSchema),
  );
  // 初次 mount 时给 syncedContentSignatureRef 设置基线，
  // 否则切走时 flush 会把"只读打开"误判成编辑、刷新 updatedAt。
  if (syncedContentSignatureRef.current === null) {
    syncedContentSignatureRef.current = getCachedContentSignature(
      initialContentRef.current,
    );
  }
  const editor = useCreateBlockNote(
    {
      initialContent: initialContentRef.current as any,
      schema: editorSchema,
      // `> ` 原本用于引用及相关快捷键。这里把 `>` 让给统一 markdown 触发器的折叠功能，
      // 引用改用 `| `/`｜ `；斜杠菜单插入引用不受影响。
      // 同时禁用 toggle-list-item-shortcuts:它的 Enter handler 对非空 toggleListItem
      // 无条件接管分裂(收起态也照分,把收起的 children 挤给新块,再也收不回去),且注册
      // 顺序先于自定义扩展、无法被 collapsedToggleEnterExtension 拦截。其全部行为
      // (空块降级 / 非空分裂 / Mod-Shift-6 转折叠列表)已在 collapsedToggleEnterExtension
      // 中按收起态感知重新实现。
      disableExtensions: [
        "quote-block-shortcuts",
        "toggle-list-item-shortcuts",
        "divider-block-shortcuts",
      ],
      extensions: [
        createGooseFirstTitleGuardExtension(usesRawEditorContentRef),
        createGooseBodyParagraphGuardExtension(usesRawEditorContentRef),
        gooseSuppressMarkdownInSpecialBlocksExtension,
        gooseHeadingMarkSuppressExtension,
        gooseInlineCodeCaretExtension,
        gooseInlineCodeBacktickWrapExtension,
        gooseActiveListMarkerExtension,
        gooseTabBehaviorExtension,
        gooseBlockDragNestExtension(),
        gooseSelectAllExtension,
        gooseCopyCurrentBlockExtension,
        gooseMoveBlockExtension,
        createGooseLinkKeyboardExtension(settingsRef),
        gooseCodeBlockKeyboardExtension,
        gooseCodeBlockLinkStripExtension,
        gooseCalloutKeyboardExtension,
        gooseFirstTitleEnterExtension,
        gooseMediaBlockEnterExtension,
        gooseEmptyNestedListEnterExtension,
        gooseCollapsedToggleEnterExtension,
        gooseToggleHeadingAutoCollectExtension(),
        gooseCrossBlockDeleteExtension,
        gooseEmptyBlockBackspaceExtension,
        createGooseNumberedListStartNormalizationExtension(
          usesRawEditorContentRef,
        ),
        createGooseSlashMenuReconcileExtension(
          usesRawEditorContentRef,
          editorInstanceRef,
        ),
        gooseMarkdownInputRulesExtension(),
        gooseFakeSelectionExtension,
        ArrowInputRuleExtension,
        gooseFindInPageExtension,
        gooseDividerInputRuleExtension(),
        // 紧凑编辑器构建不挂 AI 扩展，避免加载不需要的模型依赖。
        ...(!__GOOSE_EDITOR_AI__
          ? []
          : [
              AIExtension({
                transport: createGooseAITransport({
                  getSettings: () => aiSettingsRef.current,
                  getModelId: () => {
                    const ai = aiSettingsRef.current;
                    const ws = ai.workspaceSelectedModelId?.trim();
                    const wsOk =
                      !!ws && ai.customModelOptions.some((o) => o.id === ws);
                    return (
                      (wsOk ? ws : null) ||
                      ai.selectedModelId?.trim() ||
                      ai.customModelOptions[0]?.id ||
                      ""
                    );
                  },
                  getCustomFetch: () => platformRef.current.ai.customFetch,
                }),
                documentStateBuilder:
                  goosePrivateSelectionDocumentStateBuilder,
                streamToolsProvider: gooseSelectionScopedStreamToolsProvider,
              }),
            ]),
      ],
      dictionary: {
        ...zh,
        placeholders: {
          ...zh.placeholders,
          // 速记小窗打开即可输入，不用长提示抢占空白草稿的视觉焦点。
          // 常规笔记本仍保留菜单入口提示。
          default: __GOOSE_LITE__ ? "" : "输入 / 或 、来展开菜单...",
          toggleListItem: "",
        },
        // 空折叠块展开后的提示行（默认「空的切换区。点击添加区块。」太生硬）
        toggle_blocks: { add_block_button: "空的折叠块，点击添加内容" },
        // 小窗无 AI，aiZh 在 lite 下是空壳，不并入字典。
        ...(__GOOSE_EDITOR_AI__ ? { ai: aiZh } : {}),
      },
      domAttributes: {
        editor: {
          class: "goose-blocknote-editor",
          // 关闭浏览器/系统拼写检查：行内代码里的 hash、标识符、类名会被标红点
          // 下划线，看起来像链接。链接下划线走 CSS，不依赖 spellcheck。
          spellcheck: spellCheck ? "true" : "false",
        },
      },
      uploadFile: async (file, blockId) => {
        return uploadEditorFile(file, blockId, {
          getBlock: (id) => editorInstanceRef.current?.getBlock(id),
          imageStorage: platformRef.current.imageStorage,
          fileStorage,
          getFileUploadAvailability,
        });
      },
      pasteHandler: ({ event, editor: ed, defaultPasteHandler }) => {
        if (
          clipboardHasPasteableImage(event.clipboardData) ||
          (!__GOOSE_EDITOR_COMPACT__ &&
            clipboardHasPasteableMedia(event.clipboardData))
        ) {
          void pasteClipboardFilesFromClipboard(event, ed);
          return true;
        }
        return defaultPasteHandler();
      },
      resolveFileUrl: async (url) => {
        return platformRef.current.imageStorage.resolveRefToUrl(
          url,
          getActivePageLocalFilePathRef.current(),
        );
      },
      links: {
        onClick: (event) => {
          if (!event.metaKey && !event.ctrlKey) {
            return false;
          }
          const target = event.target as HTMLElement | null;
          const link = target?.closest<HTMLAnchorElement>(
            'a[data-inline-content-type="link"]',
          );
          if (link) {
            const href = link.getAttribute("href");
            if (href) {
              const normalizedHref = normalizeExternalUrl(href);
              if (normalizedHref) {
                platformRef.current.shell.openUrl(
                  normalizedHref,
                  openLinksInHostRef.current,
                );
              }
            }
          }
          return true;
        },
        // autolink/粘贴/HTML 导入的统一闸口：linkifyjs 认全量 TLD 表，
        // `AppClient.java`(.java 是真实 gTLD)这类类名/文件名会被误转链接，
        // 这里收紧为「协议白名单 + 裸域名常用 TLD 白名单」，见 isLinkworthyText。
        isValidLink: isLinkworthyText,
      },
    },
    [],
  );
  editorInstanceRef.current = editor;

  const readCurrentEditorContent = useCallback(() => {
    const rawContent = clonePageContent(editor.document as BlockNoteContent);
    const isLocalPage = contentModeRef.current === "raw";
    const content = isLocalPage ? rawContent : normalizePageContent(rawContent);
    return {
      content,
      signature: getCachedContentSignature(content),
    };
  }, [editor]);

  const debouncedUpdate = useMemo(() => {
    return createDebounce(
      (targetPageId: string) => {
        if (targetPageId !== pageIdForUpdateRef.current) return;
        const { content, signature } = readCurrentEditorContent();
        pendingEditorChangeRef.current = false;
        if (signature === syncedContentSignatureRef.current) return;
        syncedContentSignatureRef.current = signature;
        onContentChangeRef.current(content);
      },
      800,
      { maxWait: 3000 },
    );
  }, [readCurrentEditorContent]);

  const prevPageIdRef = useRef<string | null>(activePageId);
  useEffect(() => {
    if (activePageId === prevPageIdRef.current) return;
    prevPageIdRef.current = activePageId;

    // 切页起点即重置：侧栏点击等切页前的 pointerdown 不应算进新页面的用户编辑。
    userInteractedRef.current = false;
    pendingEditorChangeRef.current = false;

    debouncedUpdate.cancel();

    const p = pageRef.current;
    pageIdForUpdateRef.current = p?.id ?? null;

    // raw 文档跳过 normalizePageContent（不触发 ensureFirstTitleHeading）。
    // 须与 EditorComposer.onChange 的 contentMode 判断一致：
    // raw 文档同样豁免，否则切页/重开时会把首块强转 H1 并刷新签名基线。
    const isLocalPage = contentModeRef.current === "raw";
    const nextContent = isLocalPage
      ? toEditorBlocks(p?.content)
      : normalizePageContent(p?.content);
    const nextEditorContent = createEditorSafeContent(
      nextContent,
      editor.schema,
    );
    const nextSig = getCachedContentSignature(nextEditorContent);

    syncedContentSignatureRef.current = nextSig;

    try {
      editor.replaceBlocks(editor.document, nextEditorContent as any);
    } catch (error) {
      console.error(
        "[goose-note] replace editor blocks failed during page switch",
        {
          pageId: p?.id,
          error,
        },
      );
      const fallbackContent = createEditorSafeContent(undefined, editor.schema);
      editor.replaceBlocks(editor.document, fallbackContent as any);
    }

    // replaceBlocks 后 appendTransaction（firstTitleGuard 等）可能已修改文档。
    // 用编辑器实际文档的签名更新基线，防止初始化触发的 onChange 误判为真实编辑。
    // 基线计算必须与 EditorComposer.onChange 完全一致（local 用 raw 文档，
    // 内部页面经 normalizePageContent），否则签名比较永不相等、打开即触发保存。
    const postReplaceRaw = clonePageContent(
      editor.document as BlockNoteContent,
    );
    syncedContentSignatureRef.current = getCachedContentSignature(
      isLocalPage ? postReplaceRaw : normalizePageContent(postReplaceRaw),
    );

    // Reset undo history so edits from the previous page don't leak
    const view = editor.prosemirrorView;
    if (view) {
      const newState = EditorState.create({
        doc: view.state.doc,
        plugins: view.state.plugins,
      });
      view.updateState(newState);
    }

    // normalize 改写了结构才回写（silent 路径：只同步内存，不触发写盘/标脏）。
    // local 页面不回写：内容未经 normalize，store 保持磁盘解析原样
    // （空文件的编辑器兜底空段落只是呈现层，不应进 store）。
    const normalizedSig = getCachedContentSignature(nextContent);
    if (
      p &&
      !isLocalPage &&
      getCachedContentSignature(p.content) !== normalizedSig
    ) {
      onContentChangeRef.current(nextContent, { silent: true });
    }

    // 切页完成 = 新一轮程序化同步起点，重置用户交互标记：
    // 切页后 BlockNote 的异步 props 补全（折叠块/视频等）不应被算作用户编辑。
    userInteractedRef.current = false;
  }, [activePageId, debouncedUpdate, editor]);

  const getSlashItems = useCallback(
    async (query: string) => {
      let items = getBlockNoteSlashMenuItems(
        editor,
        aiSettingsRef.current.enabled &&
          (contentModeRef.current === "normalized" || __HOST_TARGET__ === "native-editor"),
        settingsRef.current.features,
      );
      if (hiddenSlashItemTitles && hiddenSlashItemTitles.length > 0) {
        const hidden = new Set(hiddenSlashItemTitles);
        const isDivider = (it: (typeof items)[number]) =>
          (it as { type?: string }).type === "divider";
        const kept = items.filter((item) => !hidden.has(item.title));
        // 砍项后清理冗余分隔线：折叠连续/首部 divider，再去尾部 divider。
        const collapsed: typeof items = [];
        for (const it of kept) {
          if (
            isDivider(it) &&
            (collapsed.length === 0 ||
              isDivider(collapsed[collapsed.length - 1]))
          ) {
            continue;
          }
          collapsed.push(it);
        }
        while (
          collapsed.length > 0 &&
          isDivider(collapsed[collapsed.length - 1])
        ) {
          collapsed.pop();
        }
        items = collapsed;
      }
      return filterSlashMenuItems(items, query);
    },
    [editor, hiddenSlashItemTitles],
  );

  const { handleEditorPasteCapture } = useEditorPaste({
    editor,
    editable,
    shiftPressedRef,
  });

  // 冷加载时 BlockNoteView 尚未完全挂定，editor.focus() 会落到 view.dom，
  // 但此时 contentEditable 还未稳定，焦点会「漏」到侧栏页面重命名输入框等
  // 下一个可聚焦元素。guard：view 存在、dom 已连入文档且 doc 非空才聚焦；
  // 否则用 rAF 延后到下一帧（挂载完成）再试，避免冷加载点编辑器丢焦点。
  const focusEditorSafely = useCallback(() => {
    const tryFocus = () => {
      const view = editor.prosemirrorView;
      const dom = view?.dom as HTMLElement | undefined;
      if (view && dom && dom.isConnected && view.state.doc.content.size > 0) {
        editor.focus();
        return true;
      }
      return false;
    };
    if (!tryFocus()) {
      requestAnimationFrame(() => {
        tryFocus();
      });
    }
  }, [editor]);

  const focusEditorEnd = useCallback(() => {
    // 标题一独占文档时（删光正文后）：补空正文并聚焦它，而不是把光标钉回标题末尾。
    // 守卫 extension 也会补，这里主动插入保证点击当帧光标就落到正文。
    if (
      !usesRawEditorContentRef.current &&
      needsBodyParagraphAfterTitle(editor.document)
    ) {
      const titleBlock = editor.document[0];
      if (titleBlock) {
        const [inserted] = editor.insertBlocks(
          [{ type: "paragraph", content: [] }],
          titleBlock,
          "after",
        );
        if (inserted) {
          editor.setTextCursorPosition(inserted, "start");
          focusEditorSafely();
          return;
        }
      }
    }

    const lastBlock = editor.document.at(-1);
    if (lastBlock) {
      // 末块 content 为 "none"（image / divider / video / file 等无光标控件）时，
      // 无法直接聚焦末块末尾，在文档末尾插入一个空 paragraph 再聚焦它。
      const blockSpecs = editor.schema.blockSpecs as
        | Record<string, { config?: { content?: string } }>
        | undefined;
      const contentType = blockSpecs?.[lastBlock.type]?.config?.content;
      if (contentType === "none") {
        editor.insertBlocks(
          [{ type: "paragraph", content: [] }],
          lastBlock,
          "after",
        );
        const newLast = editor.document.at(-1);
        if (newLast) {
          editor.setTextCursorPosition(newLast, "end");
        }
      } else {
        editor.setTextCursorPosition(lastBlock, "end");
      }
    }
    focusEditorSafely();
  }, [editor, focusEditorSafely]);

  const handleEditorBlankMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editable || event.button !== 0) return;
      const container = editorContainerRef.current;
      if (!container || !isBottomEditorBlankClick(event, container)) return;

      suppressFormattingToolbarRef.current = true;
      setSuppressFormattingToolbar(true);
      event.preventDefault();
      focusEditorEnd();
    },
    [editable, focusEditorEnd],
  );

  // 补丁：EditorContextMenu 容器高度 = 内容高度（flex-1 min-h-0），
  // 点击编辑器内容下方的空白时，event.target 落在外层 page-scroll-container 的背景上，
  // onMouseDown 不会冒泡到 workspace-editor-surface，所以需要在更上层监听。
  useEffect(() => {
    if (!editable) return;

    const handleDocMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const container = editorContainerRef.current;
      if (!container) return;

      // 只处理点击落在 page-scroll-container 内但不在 workspace-editor-surface 内的情况
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (container.contains(target)) return; // 已由 onMouseDown 处理
      const scrollContainer = target.closest(".page-scroll-container");
      if (!scrollContainer) return;

      // 检查 Y 坐标是否在末尾块之下（与 isBottomEditorBlankClick 逻辑一致）
      const blocks = container.querySelectorAll<HTMLElement>(".bn-block-outer");
      const lastBlock = blocks[blocks.length - 1];
      if (!lastBlock) return;
      if (event.clientY < lastBlock.getBoundingClientRect().bottom) return;

      // 点击确实在末块之下，阻止默认行为并聚焦末尾
      suppressFormattingToolbarRef.current = true;
      setSuppressFormattingToolbar(true);
      event.preventDefault();
      focusEditorEnd();
    };

    document.addEventListener("mousedown", handleDocMouseDown, true);
    return () => {
      document.removeEventListener("mousedown", handleDocMouseDown, true);
    };
  }, [editable, focusEditorEnd]);

  // 消闪 mouseup 清理：空白区域 mousedown 后抑制格式化工具栏，mouseup 时恢复。
  // 兜底 blur：鼠标拖出窗口松开时 document mouseup 不触发，window blur 覆盖此场景。
  useEffect(() => {
    const clearSuppress = () => {
      if (!suppressFormattingToolbarRef.current) return;
      suppressFormattingToolbarRef.current = false;
      setSuppressFormattingToolbar(false);
    };
    document.addEventListener("mouseup", clearSuppress, true);
    window.addEventListener("blur", clearSuppress);
    return () => {
      document.removeEventListener("mouseup", clearSuppress, true);
      window.removeEventListener("blur", clearSuppress);
    };
  }, []);

  useEditorShortcuts({ shiftPressedRef });

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const patchClipboardPlainText = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      // BlockNote 默认会把 NodeSelection 图片块复制成 Markdown：
      // ![name](att:...)。复制操作应给系统剪贴板写入真正的图片数据。
      if (event.type === "copy") {
        const selectedImageUrl = getSelectedImageUrl(editor.prosemirrorState);
        if (selectedImageUrl) {
          event.preventDefault();
          void copyImageSrcToClipboard(
            selectedImageUrl,
            platformRef.current,
            getActivePageLocalFilePathRef.current(),
          ).catch((error) => {
            console.error("[editor] Failed to copy selected image", error);
          });
          return;
        }
      }

      const cellText = getSelectedCellPlainText(editor.prosemirrorState);
      if (cellText != null) {
        event.preventDefault();
        clipboardData.setData("text/plain", cellText);
        clipboardData.setData("text/html", "");
        return;
      }

      const clipboardText = normalizeClipboardLineEndings(
        clipboardData.getData("text/plain"),
      );
      // cut 时 PM 已写入剪贴板后才删选区；不拿 DOM 可见字覆盖 plain/html，
      // 否则行内 code 会被拆成两段（复制正常、剪切异常）。只清理 markdown 软换行反斜杠。
      const cleaned = stripMarkdownHardBreaks(clipboardText);
      if (cleaned !== clipboardText) {
        clipboardData.setData("text/plain", cleaned);
        return;
      }

      const selectionContext = getSelectedPlainTextContext(container);
      if (!selectionContext) return;

      if (
        shouldPreferVisibleSelectionText(
          clipboardText,
          selectionContext.selectedText,
          selectionContext.withinCodeBlock,
        )
      ) {
        clipboardData.setData("text/plain", selectionContext.selectedText);
      }
    };

    container.addEventListener("copy", patchClipboardPlainText);
    container.addEventListener("cut", patchClipboardPlainText);

    return () => {
      container.removeEventListener("copy", patchClipboardPlainText);
      container.removeEventListener("cut", patchClipboardPlainText);
    };
  }, []);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const onCompositionEnd = () =>
      queueMicrotask(() =>
        reconcileSlashSuggestionMenu(editor, {
          allowSlashMenuOnFirstBlock: usesRawEditorContentRef.current,
        }),
      );
    container.addEventListener("compositionend", onCompositionEnd);
    return () =>
      container.removeEventListener("compositionend", onCompositionEnd);
  }, [editor]);

  const commitEditorContent = useCallback(
    (targetPageId?: string) => {
      const safePageId = targetPageId ?? pageIdForUpdateRef.current;
      if (!safePageId) return;
      debouncedUpdate.cancel();
      const { content, signature } = readCurrentEditorContent();
      const result = commitPendingEditorChange({
        targetPageId: safePageId,
        currentPageId: pageIdForUpdateRef.current,
        pending: pendingEditorChangeRef.current,
        content,
        signature,
        syncedSignature: syncedContentSignatureRef.current,
        commit: (nextContent) => onContentChangeRef.current(nextContent),
      });
      if (result === "committed" || result === "unchanged") {
        pendingEditorChangeRef.current = false;
      }
      if (result === "committed") syncedContentSignatureRef.current = signature;
    },
    [debouncedUpdate, readCurrentEditorContent],
  );

  useEffect(() => {
    return () => {
      // React 卸载仍处于同步阶段；先把最后一帧送入 store/journal，再取消定时器。
      commitEditorContent(pageIdForUpdateRef.current ?? undefined);
    };
  }, [commitEditorContent]);

  useEffect(() => {
    const handleFlush = (event: Event) => {
      const customEvent = event as CustomEvent<{ immediate?: boolean }>;
      if (customEvent.detail?.immediate) {
        commitEditorContent();
        return;
      }
      commitEditorContent();
    };

    const handleFocusStart = () => {
      const pageId = pageRef.current?.id;
      // 本地文件标题由 LocalFileTitle 承担；新建页标题聚焦请求未完成时不抢焦到正文。
      if (
        pageId &&
        isPageTitleFocusRequested(pageId) &&
        usesRawEditorContentRef.current
      ) {
        return;
      }

      // 多标签新建内部页：光标落到首块 H1 标题末尾（与截图中的标题位置一致）。
      const focusTitleEnd = () => {
        const blocks = editor.document;
        if (blocks.length === 0) return false;
        try {
          editor.setTextCursorPosition(blocks[0], "end");
          editor.focus();
          if (pageId && isPageTitleFocusRequested(pageId)) {
            completePageTitleFocus(pageId);
          }
          return true;
        } catch {
          return false;
        }
      };
      if (!focusTitleEnd()) {
        requestAnimationFrame(() => {
          if (!focusTitleEnd()) focusEditorSafely();
        });
      }
    };

    const handleFocusBody = () => {
      const focusBody = () => {
        const blocks = editor.document;
        if (blocks.length === 0) return false;
        const target = usesRawEditorContentRef.current
          ? blocks[0]
          : blocks[1] ?? blocks[0];
        try {
          if (!usesRawEditorContentRef.current && blocks.length === 1) {
            const [inserted] = editor.insertBlocks(
              [{ type: "paragraph", content: "" }],
              blocks[0],
              "after",
            );
            if (inserted) editor.setTextCursorPosition(inserted, "start");
          } else {
            editor.setTextCursorPosition(target, "start");
          }
          editor.focus();
          return true;
        } catch {
          return false;
        }
      };
      if (!focusBody()) requestAnimationFrame(() => focusBody());
    };

    const handlePluginEnter = () => {
      window.setTimeout(() => {
        focusEditorSafely();
      }, 0);
    };

    // 文件被外部修改后由宿主派发：把当前激活页最新内容刷进编辑器。
    const handleReloadActiveEditor = (event: Event) => {
      const detail = (event as CustomEvent<{ pageId?: string }>).detail;
      const activePage = pageRef.current;
      const activeId = activePage?.id ?? null;
      const targetId = detail?.pageId ?? activeId;
      if (!targetId || targetId !== activeId) return;
      if (targetId !== pageIdForUpdateRef.current) return;
      // 从 store 实时读内容（pageRef.current 可能是陈旧闭包值）
      const livePage = getLatestPage?.(targetId) ?? pageRef.current;
      if (!livePage) return;
      // raw 文档外部重载同样跳过页面级规范化
      const isLocalPage = contentModeRef.current === "raw";
      const nextContent = isLocalPage
        ? toEditorBlocks(livePage.content)
        : normalizePageContent(livePage.content);
      const nextEditorContent = createEditorSafeContent(
        nextContent,
        editor.schema,
      );
      const currentRaw = clonePageContent(editor.document as BlockNoteContent);
      const currentSignature = getContentSignature(
        isLocalPage ? currentRaw : normalizePageContent(currentRaw),
      );
      const nextSignature = getContentSignature(nextEditorContent);

      // 本地文件自动保存的 watch 回声即使穿过了文件监听层，也不能重建编辑器。
      // replaceBlocks 会使 ProseMirror 的失效选区落到视频等原子块上，并把该块
      // 滚入视野。磁盘读回内容与当前编辑器语义一致时只更新同步基线，保留原选区。
      if (nextSignature === currentSignature) {
        syncedContentSignatureRef.current = currentSignature;
        return;
      }
      // 文件监听触发的内容重载不等于页面导航。replaceBlocks 会让浏览器把外层
      // 滚动容器拉回顶部，因此先记录当前位置，并在 DOM 更新后恢复，避免自动保存
      // 的 watch 回声或真正的外部文件更新打断当前阅读/编辑视角。
      const scrollContainer = editorContainerRef.current?.closest<HTMLElement>(
        ".page-scroll-container",
      );
      const scrollTop = scrollContainer?.scrollTop;
      debouncedUpdate.cancel();
      pendingEditorChangeRef.current = false;
      try {
        editor.replaceBlocks(editor.document, nextEditorContent as any);
      } catch (error) {
        console.error(
          "[goose-note] replace editor blocks failed during reload",
          {
            pageId: livePage.id,
            error,
          },
        );
        const fallbackContent = createEditorSafeContent(
          undefined,
          editor.schema,
        );
        editor.replaceBlocks(editor.document, fallbackContent as any);
      }
      // 基线与 EditorComposer.onChange 的计算方式保持一致（见切页 effect 注释）
      const reloadedRaw = clonePageContent(editor.document as BlockNoteContent);
      syncedContentSignatureRef.current = getContentSignature(
        isLocalPage ? reloadedRaw : normalizePageContent(reloadedRaw),
      );
      // 外部重载 = 程序化同步，重置用户交互标记（同切页 effect）。
      userInteractedRef.current = false;
      if (scrollContainer && typeof scrollTop === "number") {
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTop;
        });
      }
    };

    window.addEventListener("goose-note:flush-editor", handleFlush);
    window.addEventListener("goose-note:focus-editor-start", handleFocusStart);
    window.addEventListener("goose-note:focus-editor-body", handleFocusBody);
    window.addEventListener("goose-note:plugin-enter", handlePluginEnter);
    window.addEventListener(
      "goose-note:reload-active-editor",
      handleReloadActiveEditor,
    );

    return () => {
      window.removeEventListener("goose-note:flush-editor", handleFlush);
      window.removeEventListener(
        "goose-note:focus-editor-start",
        handleFocusStart,
      );
      window.removeEventListener("goose-note:focus-editor-body", handleFocusBody);
      window.removeEventListener("goose-note:plugin-enter", handlePluginEnter);
      window.removeEventListener(
        "goose-note:reload-active-editor",
        handleReloadActiveEditor,
      );
    };
  }, [commitEditorContent, debouncedUpdate, editor, getLatestPage]);

  useImperativeHandle(
    ref,
    () => ({
      editor,
    }),
    [editor],
  );

  useEffect(() => {
    (window as any).__gooseNoteEditor = editor;
    return () => {
      if ((window as any).__gooseNoteEditor === editor) {
        (window as any).__gooseNoteEditor = null;
      }
    };
  }, [editor]);

  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(
    "light",
  );

  useEffect(() => {
    const resolve = () => {
      if (theme === "dark") {
        setEffectiveTheme("dark");
        return;
      }
      if (theme === "system") {
        setEffectiveTheme(
          window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light",
        );
        return;
      }
      setEffectiveTheme("light");
    };
    resolve();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => resolve();
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  if (!page) return null;

  return (
    <EditorComposer
      editor={editor}
      editable={editable}
      page={page}
      editorContainerRef={editorContainerRef}
      handleEditorBlankMouseDown={handleEditorBlankMouseDown}
      handleEditorPasteCapture={handleEditorPasteCapture}
      getSlashItems={getSlashItems}
      pageIdForUpdateRef={pageIdForUpdateRef}
      syncedContentSignatureRef={syncedContentSignatureRef}
      pendingEditorChangeRef={pendingEditorChangeRef}
      debouncedUpdate={debouncedUpdate}
      userInteractedRef={userInteractedRef}
      silentContentSync={silentContentSync}
      isEditorFullWidth={isEditorFullWidth}
      effectiveTheme={effectiveTheme}
      tableEvenColumnWidth={tableEvenColumnWidth}
      searchProviders={searchProviders}
      customActions={customActions}
      showSideMenu={showSideMenu}
      suppressFormattingToolbar={suppressFormattingToolbar}
      usesRawEditorContent={usesRawEditorContent}
    />
  );
});
