import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, FileText, RotateCcw } from "lucide-react";
import type { Page } from "@/types";
import { Editor, type EditorRef } from "@/components/editor/core/Editor";
import { EditorPlatformProvider } from "@/components/editor/platform/context";
import {
  EditorHostProvider,
  type EditorPageContext,
  type EditorSettings,
} from "@/components/editor/platform/hostContext";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { createRequestID, isValidEnvelope, postToHost } from "./bridge";
import {
  nativeAssetBridge,
  nativeEditorPlatform,
  nativeResourceBridge,
} from "./runtime";
import { nativeAITransportBridge } from "./aiTransportStub";
import { applyAISelection, invalidateAISelections } from "./aiSelectionBridge";
import {
  parseNativeMarkdown,
  serializeNativeMarkdown,
  type MarkdownSerializationProfile,
  type ParsedNativeMarkdown,
} from "./markdown";
import type {
  BridgeEnvelope,
  EditorCommand,
  EditorDraft,
  EditorPageInput,
  EditorPreferences,
  NativeEditorAppearance,
  NativeEditorFont,
  NativeEditorMode,
  NativeAISelectionReplacement,
  SaveAcknowledgement,
} from "./types";
import { EDITOR_UI_SCALE_CHANGE_EVENT } from "@/lib/appearance";

type SaveVisualState = "idle" | "saving" | "saved" | "failed" | "conflict";

const EDITOR_FONT_SIZE_DEFAULT = 16;
const EDITOR_FONT_SIZE_MIN = 12;
const EDITOR_FONT_SIZE_MAX = 24;

function normalizeEditorFontSize(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return EDITOR_FONT_SIZE_DEFAULT;
  return Math.min(
    EDITOR_FONT_SIZE_MAX,
    Math.max(EDITOR_FONT_SIZE_MIN, numeric),
  );
}

interface FlushedDraftSnapshot {
  requestID: string;
  markdown: string;
  dirtyVersion: number;
}

interface PendingWaiter {
  resolve(): void;
  reject(error: Error): void;
  timeout: number;
}

interface PageReadyBarrier {
  token: number;
  generation: number;
  settled: boolean;
  timeout: number;
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

interface PageIdentity {
  token: number;
  generation: number;
  pageID: string;
}

interface RepairCandidate {
  generation: number;
  input: EditorPageInput;
  blocks: BlockNoteContent;
  frontmatter: string | null;
  profile: MarkdownSerializationProfile;
  normalizedMarkdown: string;
}

const EMPTY_AI_SETTINGS = {
  // 入口始终可见；未配置原生服务时 transport 会返回可操作的配置提示，且不会联网。
  enabled: true,
  selectedModelId: null,
  workspaceSelectedModelId: null,
  workspaceReasoningLevel: "medium",
  customProtocol: "openai",
  customOpenAIResponsesBaseURL: "",
  customOpenAIBaseURL: "",
  customClaudeBaseURL: "",
  customOpenAIResponsesApiKey: "",
  customOpenAIApiKey: "",
  customClaudeApiKey: "",
  customModelOptions: [],
} as unknown as EditorSettings["ai"];

function createNativePage(
  payload: EditorPageInput,
  content: BlockNoteContent,
  font: NativeEditorFont,
): Page {
  const now = Date.now();
  return {
    id: payload.pageID,
    workspaceId: "native-macos",
    content,
    isLocked: false,
    fontSize: "default",
    fontFamily: font === "sans" ? "default" : font,
    localFilePath: payload.pageID,
    localReadState: "ready",
    createdAt: now,
    updatedAt: now,
  };
}

export function NativeEditorApp() {
  const editorRef = useRef<EditorRef>(null);
  const primaryGateActionRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [mode, setMode] = useState<NativeEditorMode>("blocks");
  const [repairDeclined, setRepairDeclined] = useState(false);
  const [appearance, setAppearance] = useState<NativeEditorAppearance>("light");
  const [font, setFont] = useState<NativeEditorFont>("sans");
  const [fontSize, setFontSize] = useState(EDITOR_FONT_SIZE_DEFAULT);
  const [fullWidth, setFullWidth] = useState(false);
  const [saveState, setSaveState] = useState<SaveVisualState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [aiUnavailableMessage, setAIUnavailableMessage] = useState("");
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [committedPageToken, setCommittedPageToken] = useState(0);

  const pageRef = useRef<Page | null>(null);
  const pageIDRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const generationRef = useRef(0);
  const titleRef = useRef("");
  const originalMarkdownRef = useRef("");
  const modeRef = useRef<NativeEditorMode>("blocks");
  const profileRef = useRef<MarkdownSerializationProfile | null>(null);
  const frontmatterRef = useRef<string | null>(null);
  const repairCandidateRef = useRef<RepairCandidate | null>(null);
  const acceptedRepairMarkdownRef = useRef("");
  const dirtyVersionRef = useRef(0);
  const lastSentDirtyVersionRef = useRef(0);
  const pendingRequestRef = useRef<string | null>(null);
  const pendingMarkdownRef = useRef("");
  const flushedDraftRef = useRef<FlushedDraftSnapshot | null>(null);
  const pendingWaitersRef = useRef<PendingWaiter[]>([]);
  const pageReadyBarrierRef = useRef<PageReadyBarrier | null>(null);
  const pageLoadTokenRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const commitDraftRef = useRef<() => Promise<void>>(async () => undefined);
  const composingRef = useRef(false);
  const compositionWaitersRef = useRef<Array<() => void>>([]);
  const applyingHostPageRef = useRef(false);
  const readyPostedRef = useRef(false);

  const setCurrentPage = useCallback((nextPage: Page | null) => {
    pageRef.current = nextPage;
    setPage(nextPage);
  }, []);

  const focusEditor = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target =
          modeRef.current === "blocks"
            ? (document.querySelector<HTMLElement>(
                '.bn-editor [contenteditable="true"]',
              ) ?? document.querySelector<HTMLElement>(".bn-editor"))
            : primaryGateActionRef.current;
        target?.focus({ preventScroll: true });
      });
    });
  }, []);

  const isPageReadinessCommitted = useCallback((target: PageReadyBarrier) => {
    const root = document.querySelector<HTMLElement>(".native-editor-root");
    const shellCommitted =
      root?.dataset.loading === "false" &&
      root.dataset.editorMode === modeRef.current &&
      root.dataset.pageLoadToken === String(target.token);
    const contentCommitted =
      modeRef.current === "blocks"
        ? Boolean(
            pageRef.current && profileRef.current && editorRef.current?.editor,
          )
        : Boolean(
            primaryGateActionRef.current &&
            document.body.contains(primaryGateActionRef.current),
          );
    return shellCommitted && contentCommitted;
  }, []);

  const beginPageReadiness = useCallback(
    (generation: number) => {
      const previous = pageReadyBarrierRef.current;
      if (previous && !previous.settled) {
        window.clearTimeout(previous.timeout);
        previous.settled = true;
        previous.reject(new Error("当前文件已切换，旧页面装载已取消。"));
      }
      let resolvePromise!: () => void;
      let rejectPromise!: (error: Error) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      // A newer page can supersede this promise before receivePage reaches its
      // await. Keep the rejection observed while still letting active callers
      // receive the original failure.
      void promise.catch(() => undefined);
      pageLoadTokenRef.current += 1;
      const barrier: PageReadyBarrier = {
        token: pageLoadTokenRef.current,
        generation,
        settled: false,
        timeout: 0,
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
      };
      pageReadyBarrierRef.current = barrier;
      barrier.timeout = window.setTimeout(() => {
        if (pageReadyBarrierRef.current !== barrier || barrier.settled) return;
        applyingHostPageRef.current = false;
        barrier.settled = true;
        if (isPageReadinessCommitted(barrier)) barrier.resolve();
        else barrier.reject(new Error("编辑器未能完成当前文件的装载。"));
      }, 5_000);
      return barrier;
    },
    [isPageReadinessCommitted],
  );

  useLayoutEffect(() => {
    const barrier = pageReadyBarrierRef.current;
    if (
      !barrier ||
      barrier.token !== pageLoadTokenRef.current ||
      barrier.settled
    )
      return;
    if (barrier.generation !== generationRef.current) {
      window.clearTimeout(barrier.timeout);
      barrier.settled = true;
      barrier.reject(new Error("当前文件已切换，旧页面装载已取消。"));
      return;
    }
    if (!isPageReadinessCommitted(barrier)) return;
    window.clearTimeout(barrier.timeout);
    applyingHostPageRef.current = false;
    barrier.settled = true;
    barrier.resolve();
  }, [committedPageToken, isLoadingPage, isPageReadinessCommitted, mode, page]);

  const currentPageIdentity = useCallback((): PageIdentity | null => {
    const pageID = pageIDRef.current;
    if (!pageID) return null;
    return {
      token: pageLoadTokenRef.current,
      generation: generationRef.current,
      pageID,
    };
  }, []);

  const matchesPageIdentity = useCallback(
    (identity: PageIdentity) =>
      identity.token === pageLoadTokenRef.current &&
      identity.generation === generationRef.current &&
      identity.pageID === pageIDRef.current,
    [],
  );

  const matchesCurrentEnvelope = useCallback((envelope: BridgeEnvelope) => {
    if (!isValidEnvelope(envelope)) return false;
    if (!pageIDRef.current)
      return envelope.pageID === "" && envelope.revision === 0;
    return (
      envelope.pageID === pageIDRef.current &&
      envelope.revision === revisionRef.current
    );
  }, []);

  const applyPreferences = useCallback(
    (preferences: EditorPreferences) => {
      if (!matchesCurrentEnvelope(preferences)) return;
      setAppearance(preferences.appearance);
      setFont(preferences.editorFont);
      const nextFontSize = normalizeEditorFontSize(preferences.editorFontSize);
      setFontSize(nextFontSize);
      setFullWidth(preferences.fullWidth);
      const root = document.documentElement;
      root.classList.toggle("dark", preferences.appearance === "dark");
      root.dataset.theme = preferences.appearance;
      root.dataset.editorFont = preferences.editorFont;
      root.dataset.editorFontSize = String(nextFontSize);
      root.dataset.fullWidth = String(preferences.fullWidth);
      root.dataset.reduceMotion = String(preferences.reduceMotion);
      root.dataset.increaseContrast = String(preferences.increaseContrast);
      root.style.setProperty("--editor-font-size", `${nextFontSize}px`);
      root.style.setProperty(
        "--editor-scale",
        (nextFontSize / EDITOR_FONT_SIZE_DEFAULT).toFixed(4),
      );
      const editorUiScale = (nextFontSize / EDITOR_FONT_SIZE_DEFAULT).toFixed(
        4,
      );
      if (root.style.getPropertyValue("--editor-ui-scale") !== editorUiScale) {
        root.style.setProperty("--editor-ui-scale", editorUiScale);
        window.dispatchEvent(
          new CustomEvent(EDITOR_UI_SCALE_CHANGE_EVENT, {
            detail: { scale: editorUiScale },
          }),
        );
      }
      root.style.colorScheme = preferences.appearance;
      const current = pageRef.current;
      if (current) {
        setCurrentPage({
          ...current,
          fontFamily:
            preferences.editorFont === "sans"
              ? "default"
              : preferences.editorFont,
        });
      }
    },
    [matchesCurrentEnvelope, setCurrentPage],
  );

  const buildDraft = useCallback(
    async (expectedIdentity?: PageIdentity): Promise<EditorDraft> => {
      const identity = expectedIdentity ?? currentPageIdentity();
      if (!identity || !matchesPageIdentity(identity)) {
        throw new Error("编辑器桥接上下文已失效。");
      }
      const revision = revisionRef.current;
      const title = titleRef.current;
      const originalMarkdown = originalMarkdownRef.current;
      const currentMode = modeRef.current;
      let markdown: string;
      if (currentMode !== "blocks") {
        markdown = originalMarkdown;
      } else {
        const editor = editorRef.current?.editor;
        const profile = profileRef.current;
        const frontmatter = frontmatterRef.current;
        const acceptedRepairMarkdown = acceptedRepairMarkdownRef.current;
        if (!editor || !profile) {
          if (acceptedRepairMarkdown) {
            markdown = acceptedRepairMarkdown;
          } else {
            throw new Error("块编辑器尚未准备好，无法提交草稿。");
          }
        } else {
          markdown = await serializeNativeMarkdown(
            editor.document as BlockNoteContent,
            frontmatter,
            profile,
          );
        }
      }
      if (!matchesPageIdentity(identity) || revisionRef.current !== revision) {
        throw new Error("编辑器桥接上下文已失效。");
      }
      const hasChanges = markdown !== originalMarkdown;
      return {
        version: 1,
        requestID: createRequestID(),
        pageID: identity.pageID,
        revision,
        baseRevision: revision,
        title,
        markdown,
        hasChanges,
      };
    },
    [currentPageIdentity, matchesPageIdentity],
  );

  const commitDraft = useCallback(async () => {
    if (!pageIDRef.current || pendingRequestRef.current || composingRef.current)
      return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const draft = await buildDraft();
    if (!draft.hasChanges) {
      setSaveState("idle");
      return;
    }
    pendingRequestRef.current = draft.requestID;
    pendingMarkdownRef.current = draft.markdown;
    lastSentDirtyVersionRef.current = dirtyVersionRef.current;
    setSaveState("saving");
    postToHost({ ...draft, type: "change" });
  }, [buildDraft]);
  commitDraftRef.current = commitDraft;

  const markDirty = useCallback(() => {
    if (!pageIDRef.current || applyingHostPageRef.current) return;
    dirtyVersionRef.current += 1;
    setSaveState("saving");
    postToHost({
      version: 1,
      type: "dirty",
      requestID: createRequestID(),
      pageID: pageIDRef.current,
      revision: revisionRef.current,
    });
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(
      () => void commitDraftRef.current(),
      360,
    );
  }, []);

  const waitForPending = useCallback(async () => {
    if (!pendingRequestRef.current) return;
    await new Promise<void>((resolve, reject) => {
      const waiter: PendingWaiter = {
        resolve: () => {
          window.clearTimeout(waiter.timeout);
          resolve();
        },
        reject: (error) => {
          window.clearTimeout(waiter.timeout);
          reject(error);
        },
        timeout: 0,
      };
      waiter.timeout = window.setTimeout(() => {
        pendingWaitersRef.current = pendingWaitersRef.current.filter(
          (candidate) => candidate !== waiter,
        );
        reject(new Error("等待保存确认超时，已停止切换以保护当前编辑。"));
      }, 10_000);
      pendingWaitersRef.current.push(waiter);
    });
  }, []);

  const finishComposition = useCallback(async () => {
    if (!composingRef.current) return;
    await new Promise<void>((resolve, reject) => {
      let timeout = 0;
      const settle = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      timeout = window.setTimeout(() => {
        compositionWaitersRef.current = compositionWaitersRef.current.filter(
          (candidate) => candidate !== settle,
        );
        reject(new Error("输入法组合尚未结束，已停止切换以保护当前输入。"));
      }, 2_000);
      compositionWaitersRef.current.push(settle);
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
      if (!composingRef.current) queueMicrotask(settle);
    });
  }, []);

  const receivePage = useCallback(
    async (input: EditorPageInput) => {
      const normalized = {
        ...input,
        requestID:
          input.requestID ??
          (window.webkit?.messageHandlers?.gooseNotes ? "" : createRequestID()),
      };
      if (
        !isValidEnvelope(normalized) ||
        !normalized.pageID ||
        normalized.generation < generationRef.current
      )
        return;
      generationRef.current = normalized.generation;
      const readiness = beginPageReadiness(normalized.generation);
      applyingHostPageRef.current = true;
      setIsLoadingPage(true);
      setCurrentPage(null);
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      nativeResourceBridge.invalidate();
      nativeAssetBridge.invalidate();
      nativeAITransportBridge.invalidate();
      invalidateAISelections();
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pageIDRef.current = normalized.pageID;
      revisionRef.current = normalized.revision;
      titleRef.current = normalized.title;
      originalMarkdownRef.current = normalized.markdown;
      repairCandidateRef.current = null;
      acceptedRepairMarkdownRef.current = "";
      dirtyVersionRef.current = 0;
      lastSentDirtyVersionRef.current = 0;
      pendingRequestRef.current = null;
      pendingMarkdownRef.current = "";
      flushedDraftRef.current = null;
      composingRef.current = false;
      compositionWaitersRef.current.splice(0).forEach((resolve) => resolve());
      pendingWaitersRef.current.splice(0).forEach((waiter) => {
        waiter.reject(new Error("当前文件已切换，旧保存请求已取消。"));
      });
      window.__gooseBridgeContext = {
        pageID: normalized.pageID,
        revision: normalized.revision,
      };
      setRepairDeclined(false);
      setSaveState("idle");
      setErrorMessage("");
      applyPreferences(normalized);

      let parsed: ParsedNativeMarkdown;
      try {
        parsed = await parseNativeMarkdown(normalized.markdown);
      } catch {
        parsed = {
          status: "unavailable",
          blocks: null,
          frontmatter: null,
          profile: null,
        };
      }
      if (
        readiness.token !== pageLoadTokenRef.current ||
        normalized.generation !== generationRef.current
      )
        return;
      // The visible shell and the editor key carry this exact load token so the
      // readiness check cannot accept an editor left over from another request.
      setCommittedPageToken(readiness.token);
      setEditorGeneration(readiness.token);
      if (parsed.status === "editable") {
        modeRef.current = "blocks";
        profileRef.current = parsed.profile;
        frontmatterRef.current = parsed.frontmatter;
        setMode("blocks");
        setCurrentPage(
          createNativePage(normalized, parsed.blocks, normalized.editorFont),
        );
      } else if (parsed.status === "repairable") {
        modeRef.current = "repair-required";
        profileRef.current = null;
        frontmatterRef.current = null;
        repairCandidateRef.current = {
          generation: normalized.generation,
          input: normalized,
          blocks: parsed.blocks,
          frontmatter: parsed.frontmatter,
          profile: parsed.profile,
          normalizedMarkdown: parsed.normalizedMarkdown,
        };
        setMode("repair-required");
        setCurrentPage(null);
      } else {
        modeRef.current = "unavailable";
        profileRef.current = null;
        frontmatterRef.current = null;
        setMode("unavailable");
        setCurrentPage(null);
      }
      setIsLoadingPage(false);
      await readiness.promise;
      if (normalized.generation === generationRef.current) focusEditor();
    },
    [applyPreferences, beginPageReadiness, focusEditor, setCurrentPage],
  );

  const receiveAcknowledgement = useCallback(
    (acknowledgement: SaveAcknowledgement) => {
      if (
        !isValidEnvelope(acknowledgement) ||
        acknowledgement.pageID !== pageIDRef.current
      )
        return;
      const isPendingSave =
        acknowledgement.requestID === pendingRequestRef.current;
      const flushedDraft =
        flushedDraftRef.current?.requestID === acknowledgement.requestID
          ? flushedDraftRef.current
          : null;
      if (!isPendingSave && !flushedDraft) return;
      const sentMarkdown = flushedDraft?.markdown ?? pendingMarkdownRef.current;
      const sentDirtyVersion =
        flushedDraft?.dirtyVersion ?? lastSentDirtyVersionRef.current;
      if (isPendingSave) pendingRequestRef.current = null;
      if (flushedDraft) flushedDraftRef.current = null;
      if (isPendingSave) {
        pendingWaitersRef.current
          .splice(0)
          .forEach((waiter) => waiter.resolve());
      }

      if (acknowledgement.status === "saved") {
        revisionRef.current = acknowledgement.revision;
        window.__gooseBridgeContext = {
          pageID: acknowledgement.pageID,
          revision: acknowledgement.revision,
        };
        const changedAfterSend = dirtyVersionRef.current !== sentDirtyVersion;
        originalMarkdownRef.current = sentMarkdown;
        if (!changedAfterSend) {
          dirtyVersionRef.current = 0;
          lastSentDirtyVersionRef.current = 0;
        }
        setSaveState(changedAfterSend ? "saving" : "saved");
        setErrorMessage("");
        if (changedAfterSend) {
          saveTimerRef.current = window.setTimeout(
            () => void commitDraftRef.current(),
            120,
          );
        }
        return;
      }

      setErrorMessage(acknowledgement.message ?? "保存失败，请重试。");
      setSaveState(
        acknowledgement.status === "conflict" ? "conflict" : "failed",
      );
    },
    [],
  );

  const dispatchCommand = useCallback(
    (command: EditorCommand) => {
      if (!matchesCurrentEnvelope(command) || modeRef.current !== "blocks")
        return;
      const editor = editorRef.current?.editor;
      if (!editor) return;
      const cursor = editor.getTextCursorPosition();
      const selectedBlocks = editor.getSelection()?.blocks ?? [cursor.block];
      const setTextAlignment = (alignment: "left" | "center" | "right") => {
        editor.transact(() => {
          for (const block of selectedBlocks) {
            editor.updateBlock(block, { props: { textAlignment: alignment } });
          }
        });
      };
      const clearFormatting = () => {
        // removeStyles 会经 Tiptap 立即派发事务；不能包在 BlockNote transact 内，
        // 否则后续对齐更新会复用已提交的事务而触发 mismatched transaction。
        editor.removeStyles({
          bold: true,
          italic: true,
          underline: true,
          strike: true,
          code: true,
          textColor: true,
          backgroundColor: true,
        });
        const blocksToReset = editor.getSelection()?.blocks ?? [
          editor.getTextCursorPosition().block,
        ];
        editor.transact(() => {
          for (const block of blocksToReset) {
            editor.updateBlock(block, { props: { textAlignment: "left" } });
          }
        });
      };
      switch (command.name) {
        case "bold":
          editor.toggleStyles({ bold: true });
          break;
        case "italic":
          editor.toggleStyles({ italic: true });
          break;
        case "underline":
          editor.toggleStyles({ underline: true });
          break;
        case "strike":
          editor.toggleStyles({ strike: true });
          break;
        case "code":
          editor.toggleStyles({ code: true });
          break;
        case "heading1":
          editor.updateBlock(cursor.block, {
            type: "heading",
            props: { level: 1 },
          });
          break;
        case "heading2":
          editor.updateBlock(cursor.block, {
            type: "heading",
            props: { level: 2 },
          });
          break;
        case "heading3":
          editor.updateBlock(cursor.block, {
            type: "heading",
            props: { level: 3 },
          });
          break;
        case "bulletList":
          editor.updateBlock(cursor.block, { type: "bulletListItem" });
          break;
        case "numberedList":
          editor.updateBlock(cursor.block, { type: "numberedListItem" });
          break;
        case "checkList":
          editor.updateBlock(cursor.block, { type: "checkListItem" });
          break;
        case "blockquote":
          editor.updateBlock(cursor.block, { type: "quote" });
          break;
        case "alignLeft":
          setTextAlignment("left");
          break;
        case "alignCenter":
          setTextAlignment("center");
          break;
        case "alignRight":
          setTextAlignment("right");
          break;
        case "clearFormatting":
          clearFormatting();
          break;
        case "find":
          window.dispatchEvent(new CustomEvent("goose-note:editor-find-open"));
          break;
        case "findNext":
        case "findPrevious":
          window.dispatchEvent(new CustomEvent("goose-note:editor-find-open"));
          window.dispatchEvent(
            new CustomEvent("goose-note:editor-find-nav", {
              detail: {
                direction: command.name === "findNext" ? "next" : "previous",
              },
            }),
          );
          break;
        case "link": {
          document.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "k",
              metaKey: true,
              bubbles: true,
            }),
          );
          break;
        }
        default:
          break;
      }
    },
    [matchesCurrentEnvelope],
  );

  const applyNativeAISelection = useCallback(
    (replacement: NativeAISelectionReplacement) => {
      if (!matchesCurrentEnvelope(replacement) || modeRef.current !== "blocks")
        return false;
      const editor = editorRef.current?.editor;
      return editor ? applyAISelection(editor, replacement) : false;
    },
    [matchesCurrentEnvelope],
  );

  const clear = useCallback(
    (envelope: BridgeEnvelope) => {
      if (!matchesCurrentEnvelope(envelope)) return;
      nativeResourceBridge.invalidate();
      nativeAssetBridge.invalidate();
      nativeAITransportBridge.invalidate();
      invalidateAISelections();
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pageIDRef.current = null;
      revisionRef.current = 0;
      titleRef.current = "";
      originalMarkdownRef.current = "";
      profileRef.current = null;
      frontmatterRef.current = null;
      repairCandidateRef.current = null;
      acceptedRepairMarkdownRef.current = "";
      dirtyVersionRef.current = 0;
      lastSentDirtyVersionRef.current = 0;
      pendingRequestRef.current = null;
      pendingMarkdownRef.current = "";
      flushedDraftRef.current = null;
      const readiness = pageReadyBarrierRef.current;
      if (readiness && !readiness.settled) {
        window.clearTimeout(readiness.timeout);
        readiness.settled = true;
        readiness.reject(new Error("编辑器已清空，页面装载已取消。"));
      }
      pageReadyBarrierRef.current = null;
      pageLoadTokenRef.current += 1;
      applyingHostPageRef.current = false;
      composingRef.current = false;
      compositionWaitersRef.current.splice(0).forEach((resolve) => resolve());
      pendingWaitersRef.current.splice(0).forEach((waiter) => {
        waiter.reject(new Error("编辑器已清空，保存请求已取消。"));
      });
      window.__gooseBridgeContext = { pageID: "", revision: 0 };
      setCurrentPage(null);
      setRepairDeclined(false);
      setMode("blocks");
      setIsLoadingPage(false);
      setCommittedPageToken(0);
      setSaveState("idle");
      setErrorMessage("");
    },
    [matchesCurrentEnvelope, setCurrentPage],
  );

  useEffect(() => {
    window.gooseEditor = {
      receivePage,
      receiveAcknowledgement,
      receiveLocalResource: nativeResourceBridge.receive,
      receiveLocalAsset: nativeAssetBridge.receive,
      receiveAIResult: nativeAITransportBridge.receiveResult,
      receiveAIDelta: nativeAITransportBridge.receiveDelta,
      updatePreferences: applyPreferences,
      clear,
      dispatchCommand,
      applyAISelection: applyNativeAISelection,
      focusEditor: (envelope) => {
        if (matchesCurrentEnvelope(envelope)) focusEditor();
      },
      flushAndGetDraft: async (envelope) => {
        const normalizedEnvelope =
          envelope ??
          (window.webkit?.messageHandlers?.gooseNotes
            ? undefined
            : {
                version: 1 as const,
                requestID: createRequestID(),
                ...(window.__gooseBridgeContext ?? { pageID: "", revision: 0 }),
              });
        if (
          !normalizedEnvelope ||
          !matchesCurrentEnvelope(normalizedEnvelope) ||
          !pageIDRef.current
        ) {
          throw new Error("编辑器桥接上下文已失效。");
        }
        const identity = currentPageIdentity();
        if (!identity) throw new Error("编辑器桥接上下文已失效。");
        const readiness = pageReadyBarrierRef.current;
        if (readiness?.token === identity.token) {
          await readiness.promise;
        }
        if (!matchesPageIdentity(identity) || applyingHostPageRef.current) {
          throw new Error("编辑器桥接上下文已失效。");
        }
        await finishComposition();
        if (!matchesPageIdentity(identity)) {
          throw new Error("编辑器桥接上下文已失效。");
        }
        if (modeRef.current === "blocks") {
          window.dispatchEvent(
            new CustomEvent("goose-note:flush-editor", {
              detail: { immediate: true },
            }),
          );
        }
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        await waitForPending();
        if (!matchesPageIdentity(identity)) {
          throw new Error("编辑器桥接上下文已失效。");
        }
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        const draft = await buildDraft(identity);
        flushedDraftRef.current = {
          requestID: draft.requestID,
          markdown: draft.markdown,
          dirtyVersion: dirtyVersionRef.current,
        };
        if (draft.hasChanges) setSaveState("saving");
        return draft;
      },
    };
    if (!readyPostedRef.current) {
      readyPostedRef.current = true;
      window.__gooseBridgeContext = { pageID: "", revision: 0 };
      postToHost({
        version: 1,
        type: "ready",
        requestID: createRequestID(),
        pageID: "",
        revision: 0,
      });
    }
  }, [
    applyPreferences,
    applyNativeAISelection,
    buildDraft,
    clear,
    dispatchCommand,
    focusEditor,
    finishComposition,
    currentPageIdentity,
    matchesCurrentEnvelope,
    matchesPageIdentity,
    receiveAcknowledgement,
    receivePage,
    waitForPending,
  ]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      const readiness = pageReadyBarrierRef.current;
      if (readiness && !readiness.settled) {
        window.clearTimeout(readiness.timeout);
        readiness.settled = true;
        readiness.reject(new Error("编辑器已关闭，页面装载已取消。"));
      }
      pageReadyBarrierRef.current = null;
      pageLoadTokenRef.current += 1;
      compositionWaitersRef.current.splice(0).forEach((resolve) => resolve());
      pendingWaitersRef.current.splice(0).forEach((waiter) => {
        waiter.reject(new Error("编辑器已关闭，保存请求已取消。"));
      });
      nativeResourceBridge.invalidate();
      nativeAssetBridge.invalidate();
      nativeAITransportBridge.invalidate();
    },
    [],
  );

  const settings = useMemo<EditorSettings>(
    () => ({
      theme: appearance,
      editorFontSize: fontSize,
      tableEvenColumnWidth: true,
      customFonts: {
        default: { label: null, font: null },
        serif: { label: null, font: null },
        mono: { label: null, font: null },
      },
      defaultCodeBlockWrap: false,
      onDefaultCodeBlockWrapChange: () => {},
      ai: EMPTY_AI_SETTINGS,
      searchProviders: [],
      customActions: [],
      openLinksInHost: false,
      // 原生编辑器当前没有系统 openPath 桥，保留内置灯箱作为可用回退。
      useInternalImageViewer: true,
      features: {
        tablePresentationControls: false,
        mermaidUnsafeHTML: false,
        transcodeVideoUploads: false,
        openAttachmentsExternally: false,
      },
      sidebarCollapsed: false,
    }),
    [appearance, fontSize, fullWidth],
  );

  const pageContext = useMemo<EditorPageContext | null>(
    () =>
      page
        ? {
            page,
            contentMode: "raw",
            isEditorFullWidth: fullWidth,
            onContentChange: (content, options) => {
              if (applyingHostPageRef.current) return;
              const current = pageRef.current;
              if (current) setCurrentPage({ ...current, content });
              if (!options?.silent) markDirty();
            },
            onOpenPage: () => {},
            getActivePageLocalFilePath: () => pageIDRef.current,
            searchPages: () => [],
            resolvePageContexts: () => [],
            getLatestPage: (pageId) =>
              pageRef.current?.id === pageId ? pageRef.current : null,
            onPromotePreview: () => {},
          }
        : null,
    [fullWidth, markDirty, page, setCurrentPage],
  );

  const retry = () => {
    setErrorMessage("");
    setSaveState("saving");
    void commitDraft();
  };

  useEffect(() => {
    const showUnavailableAI = () => {
      const context = window.__gooseBridgeContext;
      if (context?.pageID && window.webkit?.messageHandlers?.gooseNotes) {
        postToHost({
          version: 1,
          type: "aiWorkspaceEntry",
          requestID: createRequestID(),
          pageID: context.pageID,
          revision: context.revision,
        });
        return;
      }
      setAIUnavailableMessage(
        "AI 生成功能需要在原生应用中配置服务后才能使用。",
      );
    };
    window.addEventListener("goose-note:native-ai-entry", showUnavailableAI);
    return () =>
      window.removeEventListener(
        "goose-note:native-ai-entry",
        showUnavailableAI,
      );
  }, []);

  const reload = () => {
    if (!pageIDRef.current) return;
    postToHost({
      version: 1,
      type: "reloadRequest",
      requestID: createRequestID(),
      pageID: pageIDRef.current,
      revision: revisionRef.current,
    });
  };

  const acceptRepair = () => {
    const candidate = repairCandidateRef.current;
    if (
      !candidate ||
      modeRef.current !== "repair-required" ||
      candidate.generation !== generationRef.current ||
      candidate.input.pageID !== pageIDRef.current
    )
      return;
    const readiness = beginPageReadiness(candidate.generation);
    applyingHostPageRef.current = true;
    modeRef.current = "blocks";
    profileRef.current = candidate.profile;
    frontmatterRef.current = candidate.frontmatter;
    acceptedRepairMarkdownRef.current = candidate.normalizedMarkdown;
    setRepairDeclined(false);
    setMode("blocks");
    setCommittedPageToken(readiness.token);
    setEditorGeneration(readiness.token);
    setCurrentPage(
      createNativePage(
        {
          ...candidate.input,
          editorFont: font,
          editorFontSize: fontSize,
          fullWidth,
        },
        candidate.blocks,
        font,
      ),
    );
    void readiness.promise
      .then(() => {
        if (
          readiness.token !== pageLoadTokenRef.current ||
          candidate.generation !== generationRef.current
        )
          return;
        markDirty();
        focusEditor();
      })
      .catch(() => {
        if (
          readiness.token !== pageLoadTokenRef.current ||
          candidate.generation !== generationRef.current
        )
          return;
        if (pageReadyBarrierRef.current === readiness) {
          pageReadyBarrierRef.current = null;
        }
        applyingHostPageRef.current = false;
        modeRef.current = "repair-required";
        profileRef.current = null;
        frontmatterRef.current = null;
        acceptedRepairMarkdownRef.current = "";
        setMode("repair-required");
        setCurrentPage(null);
      });
  };

  const keepOriginal = () => {
    setRepairDeclined(true);
    window.requestAnimationFrame(() => primaryGateActionRef.current?.focus());
  };

  return (
    <main
      className="native-editor-root"
      data-theme={appearance}
      data-font-family={font === "sans" ? "default" : font}
      data-font-size={String(fontSize)}
      data-editor-mode={mode}
      data-loading={String(isLoadingPage)}
      data-page-load-token={String(committedPageToken)}
      data-testid="editor-surface"
      onCompositionStartCapture={() => {
        composingRef.current = true;
      }}
      onCompositionEndCapture={() => {
        composingRef.current = false;
        compositionWaitersRef.current.splice(0).forEach((resolve) => resolve());
      }}
    >
      {pageIDRef.current ? (
        <>
          {(saveState === "failed" || saveState === "conflict") && (
            <div
              className="native-editor-error"
              role="alert"
              data-testid="save-error"
            >
              <AlertCircle aria-hidden="true" size={17} />
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={saveState === "conflict" ? reload : retry}
              >
                <RotateCcw aria-hidden="true" size={14} />
                {saveState === "conflict" ? "重新载入" : "重试"}
              </button>
            </div>
          )}
          {aiUnavailableMessage && (
            <div className="native-ai-notice" role="status">
              <span>{aiUnavailableMessage}</span>
              <button type="button" onClick={() => setAIUnavailableMessage("")}>
                知道了
              </button>
            </div>
          )}
          {isLoadingPage ? (
            <div
              className="native-editor-placeholder"
              role="status"
              aria-live="polite"
            >
              <FileText aria-hidden="true" size={28} />
              <p>正在载入文档…</p>
            </div>
          ) : mode === "repair-required" ? (
            <section
              className="native-format-gate"
              aria-labelledby="native-format-gate-title"
              aria-describedby="native-format-gate-description native-format-gate-detail"
              data-testid="format-repair-gate"
            >
              <div
                className="native-format-gate__content"
                role="status"
                aria-live="polite"
              >
                <span className="native-format-gate__icon" aria-hidden="true">
                  <FileText size={24} />
                </span>
                <h1 id="native-format-gate-title">
                  {repairDeclined ? "已保持原文" : "此文件需要先整理格式"}
                </h1>
                <p id="native-format-gate-description">
                  {repairDeclined
                    ? "编辑器没有加载或修改此文件。需要编辑时，可再选择修复格式。"
                    : "其中有编辑器暂时不能完整保留的 Markdown 写法，原文件尚未更改。"}
                </p>
                <p
                  className="native-format-gate__detail"
                  id="native-format-gate-detail"
                >
                  修复后会转换为编辑器支持的格式，并保存到原文件。
                </p>
                <div className="native-format-gate__actions">
                  <button
                    ref={primaryGateActionRef}
                    className="native-format-gate__primary"
                    type="button"
                    onClick={acceptRepair}
                  >
                    {repairDeclined ? "修复格式并加载" : "加载并修复格式"}
                  </button>
                  {!repairDeclined && (
                    <button
                      className="native-format-gate__secondary"
                      type="button"
                      onClick={keepOriginal}
                    >
                      保持原文
                    </button>
                  )}
                </div>
              </div>
            </section>
          ) : mode === "unavailable" ? (
            <section
              className="native-format-gate"
              aria-labelledby="native-format-unavailable-title"
              aria-describedby="native-format-unavailable-description"
              data-testid="format-unavailable-gate"
            >
              <div
                className="native-format-gate__content"
                role="status"
                aria-live="polite"
              >
                <span className="native-format-gate__icon" aria-hidden="true">
                  <FileText size={24} />
                </span>
                <h1 id="native-format-unavailable-title">
                  此文件暂时无法安全加载
                </h1>
                <p id="native-format-unavailable-description">
                  原文件没有修改。请确认文件仍是有效的 Markdown 后重试。
                </p>
                <div className="native-format-gate__actions">
                  <button
                    ref={primaryGateActionRef}
                    className="native-format-gate__secondary"
                    type="button"
                    onClick={reload}
                  >
                    重新载入文件
                  </button>
                </div>
              </div>
            </section>
          ) : page && pageContext ? (
            <div
              className="page-scroll-container native-editor-scroll"
              data-testid="editor-document"
            >
              <EditorPlatformProvider platform={nativeEditorPlatform}>
                <EditorHostProvider
                  settings={settings}
                  pageContext={pageContext}
                >
                  <Editor
                    key={`${page.id}:${editorGeneration}`}
                    ref={editorRef}
                    editable
                    showSideMenu
                    spellCheck
                  />
                </EditorHostProvider>
              </EditorPlatformProvider>
            </div>
          ) : null}
          <p className="native-sr-only" aria-live="polite" aria-atomic="true">
            {saveState === "saving"
              ? "正在保存"
              : saveState === "saved"
                ? "已保存"
                : ""}
          </p>
        </>
      ) : (
        <div className="native-editor-placeholder" aria-label="未打开文件">
          <FileText aria-hidden="true" size={34} />
          <p>新建或打开 Markdown 文件开始写作</p>
        </div>
      )}
    </main>
  );
}
