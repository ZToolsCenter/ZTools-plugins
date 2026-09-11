import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import {
  getDbStorageItem,
  setDbStorageItem,
  uToolsStorage,
} from "@/lib/storage";
import { usePages } from "@/stores/usePages";
import { useNotebooks, DEFAULT_NOTEBOOK } from "@/stores/useNotebooks";
import { createEmptyLocalPageContent } from "@/components/editor/utils/blocknote-content";
import type { JSONContent, Page } from "@/types";
import {
  applyRedo,
  applyUndo,
  createEmptySlotStacks,
  budgetQuickNoteHistory,
  normalizeSlotStacks,
  recordEditHistory,
} from "@/lib/quicknote/undoHistory";
import type { QuickNoteSlotStacks } from "@/lib/quicknote/undoHistory";
import {
  acknowledgeRecoveryEntry,
  canApplyRecoveryEntry,
  listRecoveryEntries,
  recordRecoveryEntry,
} from "@/lib/storage/recoveryJournal";
import { getContentSignature } from "@/components/editor/utils/blocknote-content";
import { toast } from "@/components/ui/sonner";

/**
 * 速记小窗状态（独立窗口进程内使用）。
 *
 * 小窗与主窗是两个独立的 WebView 进程，但共享同一份 uTools db。小窗是「草稿便签」：
 * 不直接对应一条真实笔记，编辑内容只落到草稿存储，不写进 pages、不进笔记列表 / 搜索。
 * 用户点左上角「保存到笔记本」才把当前槽位草稿整体 createPageRecord 入库，
 * 随后清空该槽位、回到空白便签。
 *
 * 支持 1–5 五个独立草稿槽位（activeSlot + drafts），各自持久化、互不覆盖，
 * 每个槽位名称（slotNames）也独立持久化。
 * 另持久化 pinned、editorZoom、windowWidth/windowHeight、windowX/windowY，
 * 以及每槽撤销/重做栈（关窗后 Ctrl/Cmd+Z 仍可回退）。
 * 当前正在编辑的 draftPage 是会话态（基于当前槽位草稿现造），不持久化。
 */
export type QuickNoteSlot = 1 | 2 | 3 | 4 | 5;

export const QUICKNOTE_SLOT_COUNT = 5;
export const QUICKNOTE_SLOTS: readonly QuickNoteSlot[] = [1, 2, 3, 4, 5];

export type QuickNoteDrafts = Record<QuickNoteSlot, JSONContent | null>;
export type QuickNoteSlotNames = Record<QuickNoteSlot, string>;

const pendingQuickNoteRecoveryRevisions = new Map<QuickNoteSlot, number>();

const recordQuickNoteRecovery = (
  slot: QuickNoteSlot,
  previous: JSONContent | null,
  content: JSONContent | null,
): void => {
  const entry = recordRecoveryEntry({
    source: "quicknote",
    id: String(slot),
    content,
    baseSignature: getContentSignature(previous),
  });
  if (entry) {
    pendingQuickNoteRecoveryRevisions.set(slot, entry.revision);
    return;
  }
  toast.error("速记恢复备份写入失败", {
    id: "goose-quicknote-journal-failed",
    description: "请暂时不要关闭小窗，并复制重要内容后重试。",
  });
};

export function recoverQuickNoteDrafts(draftsRaw: unknown): {
  drafts: QuickNoteDrafts;
  recoveredSlots: QuickNoteSlot[];
  conflictSlots: QuickNoteSlot[];
} {
  const drafts = normalizeDrafts(draftsRaw);
  const recoveredSlots: QuickNoteSlot[] = [];
  const conflictSlots: QuickNoteSlot[] = [];
  for (const entry of listRecoveryEntries("quicknote")) {
    const slot = normalizeSlot(entry.id);
    const current = drafts[slot];
    const alreadyCurrent =
      getContentSignature(current) === getContentSignature(entry.content);
    if (alreadyCurrent) {
      if (!acknowledgeRecoveryEntry("quicknote", String(slot), entry.revision)) {
        pendingQuickNoteRecoveryRevisions.set(slot, entry.revision);
      }
      continue;
    }
    if (!canApplyRecoveryEntry(entry, current)) {
      conflictSlots.push(slot);
      continue;
    }
    drafts[slot] = entry.content;
    recoveredSlots.push(slot);
    pendingQuickNoteRecoveryRevisions.set(slot, entry.revision);
  }
  return { drafts, recoveredSlots, conflictSlots };
}

const quickNoteStorage: StateStorage = {
  getItem: (name) => uToolsStorage.getItem(name),
  setItem: (name, value) => {
    const saved = setDbStorageItem(name, value);
    if (saved) {
      for (const [slot, revision] of pendingQuickNoteRecoveryRevisions) {
        const acknowledged = acknowledgeRecoveryEntry(
          "quicknote",
          String(slot),
          revision,
        );
        if (
          acknowledged &&
          pendingQuickNoteRecoveryRevisions.get(slot) === revision
        ) {
          pendingQuickNoteRecoveryRevisions.delete(slot);
        }
      }
      return;
    }
    toast.error("速记暂未保存", {
      id: "goose-quicknote-save-failed",
      description: "当前草稿已放入恢复备份，可点击重试。",
      action: {
        label: "重试",
        onClick: () => {
          useQuickNote.setState((state) => ({ drafts: { ...state.drafts } }));
        },
      },
    });
  },
  removeItem: (name) => uToolsStorage.removeItem(name),
};

export function createEmptyQuickNoteDrafts(): QuickNoteDrafts {
  return { 1: null, 2: null, 3: null, 4: null, 5: null };
}

export function createDefaultQuickNoteSlotNames(): QuickNoteSlotNames {
  return { 1: "", 2: "", 3: "", 4: "", 5: "" };
}

function normalizeSlot(value: unknown): QuickNoteSlot {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 2 || n === 3 || n === 4 || n === 5) return n;
  return 1;
}

function normalizeDrafts(
  raw: unknown,
  legacyDraft?: JSONContent | null,
): QuickNoteDrafts {
  const empty = createEmptyQuickNoteDrafts();
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, JSONContent | null>;
    for (const slot of QUICKNOTE_SLOTS) {
      const key = String(slot);
      if (key in rec) empty[slot] = rec[key] ?? null;
      else if (slot in (raw as object)) {
        empty[slot] = (raw as QuickNoteDrafts)[slot] ?? null;
      }
    }
    return empty;
  }
  // 旧版单草稿：迁移到槽位 1
  if (legacyDraft !== undefined) {
    empty[1] = legacyDraft ?? null;
  }
  return empty;
}

function normalizeSlotName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 24) : "";
}

function normalizeSlotNames(raw: unknown): QuickNoteSlotNames {
  const names = createDefaultQuickNoteSlotNames();
  if (!raw || typeof raw !== "object") return names;
  const record = raw as Record<string, unknown>;
  for (const slot of QUICKNOTE_SLOTS) {
    names[slot] = normalizeSlotName(record[String(slot)]);
  }
  return names;
}

/**
 * 便签名称单独落库，避免改名时同步重写包含正文与 200 步撤销快照的速记主文档。
 * uTools 的数据库调用是同步的；主文档较大时，这种无关的整包写入会直接堵住旧渲染进程。
 */
const QUICKNOTE_SLOT_NAMES_STORAGE_KEY = "goose-note:quicknote-slot-names";

interface PersistedQuickNoteSlotNames {
  version: 1;
  slotNames: QuickNoteSlotNames;
}

export function updateQuickNoteSlotName(
  current: QuickNoteSlotNames,
  slot: QuickNoteSlot,
  name: string,
): QuickNoteSlotNames {
  const target = normalizeSlot(slot);
  const normalizedName = normalizeSlotName(name);
  if (current[target] === normalizedName) return current;
  return { ...current, [target]: normalizedName };
}

export function parsePersistedQuickNoteSlotNames(
  raw: string | null,
  fallback: QuickNoteSlotNames,
): QuickNoteSlotNames {
  if (!raw) return normalizeSlotNames(fallback);
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedQuickNoteSlotNames>;
    return normalizeSlotNames(parsed.slotNames);
  } catch {
    return normalizeSlotNames(fallback);
  }
}

export function serializeQuickNoteSlotNames(
  slotNames: QuickNoteSlotNames,
): string {
  return JSON.stringify({
    version: 1,
    slotNames: normalizeSlotNames(slotNames),
  } satisfies PersistedQuickNoteSlotNames);
}

/** 新存储不存在时以主文档里的旧字段兜底，实现无感迁移。 */
export function loadQuickNoteSlotNames(
  legacyNames: QuickNoteSlotNames,
): QuickNoteSlotNames {
  return parsePersistedQuickNoteSlotNames(
    getDbStorageItem(QUICKNOTE_SLOT_NAMES_STORAGE_KEY),
    legacyNames,
  );
}

export function persistQuickNoteSlotNames(slotNames: QuickNoteSlotNames): void {
  setDbStorageItem(
    QUICKNOTE_SLOT_NAMES_STORAGE_KEY,
    serializeQuickNoteSlotNames(slotNames),
  );
}

export function getQuickNoteSlotName(
  slot: QuickNoteSlot,
  names: QuickNoteSlotNames,
): string {
  return normalizeSlotName(names[slot]) || `便签 ${slot}`;
}

interface QuickNoteState {
  /** 当前激活的草稿槽位（1–5） */
  activeSlot: QuickNoteSlot;
  /** 五个独立草稿内容（各自持久化） */
  drafts: QuickNoteDrafts;
  /** 五个草稿槽位的自定义名称；空字符串回退为“便签 N”。 */
  slotNames: QuickNoteSlotNames;
  /**
   * 每槽撤销栈（持久化）。栈顶是最近一步可回退到的内容快照。
   * 关窗后仍可继续 Ctrl/Cmd+Z。
   */
  undoStacks: QuickNoteSlotStacks;
  /**
   * 每槽重做栈（持久化）。撤销后写入；新编辑会清空。
   */
  redoStacks: QuickNoteSlotStacks;
  /**
   * 是否置顶钉住。速记小窗强制置顶（产品决定，无取消入口），恒为 true。
   * 字段保留仅为持久化结构兼容；不再有切换 UI。
   */
  pinned: boolean;
  /** 记住的窗口宽度（持久化，下次开窗沿用；手动拖动后更新） */
  windowWidth: number;
  /** 记住的窗口高度（持久化，下次开窗沿用；手动拖动后更新） */
  windowHeight: number;
  /**
   * 记住的窗口左上角 x/y（持久化，下次开窗沿用）。
   * preload 用 win.getBounds() 权威写入 db；web 侧拖动停下 / 关窗时经 setWindowPosition
   * 同步进 store，避免后续草稿 persist 用旧坐标覆盖。
   */
  windowX?: number;
  windowY?: number;
  /**
   * 编辑界面缩放比例（Cmd +/- 调整，持久化；下次开窗沿用）。
   * 与窗口像素尺寸无关：只缩放编辑内容视觉大小。
   */
  editorZoom: number;
  /** 切换当前草稿槽位（不改其它槽位内容） */
  setActiveSlot: (slot: QuickNoteSlot) => void;
  /** 重命名指定草稿槽位；空名称恢复默认“便签 N”。 */
  setSlotName: (slot: QuickNoteSlot, name: string) => void;
  /**
   * 草稿内容变更（编辑器 onContentChange 调用）。
   * 可显式指定 slot：切换槽位时旧编辑器卸载前的最后一次 onChange 仍写回原槽，避免串写。
   */
  setDraftContent: (
    content: JSONContent,
    slot?: QuickNoteSlot,
    options?: { recordHistory?: boolean },
  ) => void;
  /**
   * 撤销当前槽位一步。返回恢复后的内容；无历史时返回 null 且不改状态。
   * 注意：返回 null 既可能表示「无历史」，也可能表示恢复到空草稿——用 applied 语义
   * 时请改用 undoDraft 的 boolean 返回值。
   */
  undoDraft: () => { content: JSONContent | null; applied: boolean };
  /** 重做当前槽位一步。 */
  redoDraft: () => { content: JSONContent | null; applied: boolean };
  /**
   * 保存当前槽位草稿到笔记本：以草稿内容新建一条真实笔记并落库，随后清空该槽位。
   * 返回新笔记 id；草稿为空时返回 null（不产生空笔记）。
   */
  saveDraftToNotebook: () => string | null;
  /** 清空当前槽位草稿，回到空白便签。 */
  clearDraft: () => void;
  setWindowWidth: (width: number) => void;
  setWindowHeight: (height: number) => void;
  setWindowSize: (width: number, height: number) => void;
  /** 更新编辑界面缩放（持久化）。 */
  setEditorZoom: (zoom: number) => void;
  /**
   * 同步窗口屏幕坐标到 store（与 preload 权威写入配合）。
   * 子窗拖动停下后调用，避免后续 store persist 用旧/空坐标盖掉 preload 写的位置。
   */
  setWindowPosition: (x: number, y: number) => void;
}

/** 速记小窗默认宽度，与 preload QUICKNOTE_WIDTH 保持一致。 */
export const QUICKNOTE_DEFAULT_WIDTH = 480;
/** 速记小窗最小宽度，与 preload minWidth 保持一致。 */
export const QUICKNOTE_MIN_WIDTH = 320;
/** 速记小窗默认高度，与 preload QUICKNOTE_HEIGHT 保持一致。 */
export const QUICKNOTE_DEFAULT_HEIGHT = 350;
/** 速记小窗最小高度，与 preload QUICKNOTE_MIN_HEIGHT 保持一致。 */
export const QUICKNOTE_MIN_HEIGHT = 300;
/** 编辑界面缩放下限（Cmd -）。 */
export const QUICKNOTE_ZOOM_MIN = 0.7;
/** 编辑界面缩放上限（Cmd +）。 */
export const QUICKNOTE_ZOOM_MAX = 1.8;
/** 编辑界面缩放步进。 */
export const QUICKNOTE_ZOOM_STEP = 0.1;
/** 编辑界面默认缩放。 */
export const QUICKNOTE_ZOOM_DEFAULT = 1;

/** 把缩放值钳到合法范围，并四舍五入到 0.01，避免浮点漂移。 */
export function clampQuickNoteZoom(zoom: unknown): number {
  const n = typeof zoom === "number" ? zoom : Number(zoom);
  if (!Number.isFinite(n)) return QUICKNOTE_ZOOM_DEFAULT;
  const clamped = Math.min(QUICKNOTE_ZOOM_MAX, Math.max(QUICKNOTE_ZOOM_MIN, n));
  return Math.round(clamped * 100) / 100;
}

// 可承载 inline 文本、且空内容即视为「空白」的块类型。结构化块（image/table/
// codeBlock/file/video/audio…）即使没有 inline text 也是真实内容，不能被当空白清掉。
const TEXTUAL_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "callout",
]);

function inlineContentHasText(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as { text?: unknown; content?: unknown };
    return (
      (typeof candidate.text === "string" &&
        candidate.text.trim().length > 0) ||
      inlineContentHasText(candidate.content)
    );
  });
}

function blockHasMeaningfulContent(block: unknown): boolean {
  if (!block || typeof block !== "object") return false;
  const candidate = block as {
    type?: unknown;
    content?: unknown;
    children?: unknown;
  };
  const type = typeof candidate.type === "string" ? candidate.type : "";
  if (!type || !TEXTUAL_BLOCK_TYPES.has(type)) return true;
  if (inlineContentHasText(candidate.content)) return true;
  return (
    Array.isArray(candidate.children) &&
    candidate.children.some(blockHasMeaningfulContent)
  );
}

/** 判断草稿是否为空白，供保存门控与槽位占用提示共用。 */
export function isQuickNoteDraftEmpty(content: JSONContent | null): boolean {
  if (!content) return true;
  if (Array.isArray(content)) return !content.some(blockHasMeaningfulContent);
  if (typeof content !== "object") return true;
  const root = content as { type?: unknown; content?: unknown };
  if (root.type === "doc" && Array.isArray(root.content)) {
    return !root.content.some(blockHasMeaningfulContent);
  }
  return !blockHasMeaningfulContent(root);
}

/** 读取当前激活槽位的草稿内容。 */
export function getActiveDraftContent(state: {
  activeSlot: QuickNoteSlot;
  drafts: QuickNoteDrafts;
}): JSONContent | null {
  return state.drafts[state.activeSlot] ?? null;
}

/** 会话内每槽最近一次成功记入撤销栈的时间（不持久化，仅用于输入合并窗口）。 */
const lastUndoRecordAtBySlot: Partial<Record<QuickNoteSlot, number>> = {};

export const useQuickNote = create<QuickNoteState>()(
  persist(
    (set, get) => ({
      activeSlot: 1,
      drafts: createEmptyQuickNoteDrafts(),
      slotNames: createDefaultQuickNoteSlotNames(),
      undoStacks: createEmptySlotStacks(),
      redoStacks: createEmptySlotStacks(),
      pinned: true, // 强制置顶，恒 true
      windowWidth: QUICKNOTE_DEFAULT_WIDTH,
      windowHeight: QUICKNOTE_DEFAULT_HEIGHT,
      windowX: undefined,
      windowY: undefined,
      editorZoom: QUICKNOTE_ZOOM_DEFAULT,

      setActiveSlot: (slot) => {
        const next = normalizeSlot(slot);
        const previous = get().activeSlot;
        if (next === previous) return;
        // 切槽是明确的编辑边界：回到任一槽后首次输入都应形成新撤销步，
        // 不能和切换前 800ms 内的输入合并，否则一次撤销会直接退回空稿。
        lastUndoRecordAtBySlot[previous] = 0;
        lastUndoRecordAtBySlot[next] = 0;
        set({ activeSlot: next });
      },

      setSlotName: (slot, name) => {
        const target = normalizeSlot(slot);
        set((state) => ({
          slotNames: updateQuickNoteSlotName(state.slotNames, target, name),
        }));
      },

      setDraftContent: (content, slot, options) =>
        set((state) => {
          const target = slot != null ? normalizeSlot(slot) : state.activeSlot;
          const previous = state.drafts[target] ?? null;
          const recordHistory = options?.recordHistory !== false;
          recordQuickNoteRecovery(target, previous, content);
          if (!recordHistory) {
            return {
              drafts: { ...state.drafts, [target]: content },
            };
          }
          // lastRecordAt 不持久化：用模块级 map 保持合并窗口（会话内有效即可）
          const lastAt = lastUndoRecordAtBySlot[target] ?? 0;
          const hist = recordEditHistory({
            undo: state.undoStacks[target] ?? [],
            redo: state.redoStacks[target] ?? [],
            previous,
            next: content,
            lastRecordAt: lastAt,
          });
          if (hist.recorded) {
            lastUndoRecordAtBySlot[target] = hist.lastRecordAt;
          }
          return {
            drafts: { ...state.drafts, [target]: content },
            undoStacks: { ...state.undoStacks, [target]: hist.undo },
            redoStacks: { ...state.redoStacks, [target]: hist.redo },
          };
        }),

      undoDraft: () => {
        const state = get();
        const slot = state.activeSlot;
        const result = applyUndo({
          undo: state.undoStacks[slot] ?? [],
          redo: state.redoStacks[slot] ?? [],
          current: state.drafts[slot] ?? null,
        });
        if (!result.applied) {
          return { content: state.drafts[slot] ?? null, applied: false };
        }
        // 撤销/重做本身不记入历史；并重置合并窗口，避免紧接着的 onChange 误合并
        lastUndoRecordAtBySlot[slot] = 0;
        recordQuickNoteRecovery(slot, state.drafts[slot] ?? null, result.content);
        set({
          drafts: { ...state.drafts, [slot]: result.content },
          undoStacks: { ...state.undoStacks, [slot]: result.undo },
          redoStacks: { ...state.redoStacks, [slot]: result.redo },
        });
        return { content: result.content, applied: true };
      },

      redoDraft: () => {
        const state = get();
        const slot = state.activeSlot;
        const result = applyRedo({
          undo: state.undoStacks[slot] ?? [],
          redo: state.redoStacks[slot] ?? [],
          current: state.drafts[slot] ?? null,
        });
        if (!result.applied) {
          return { content: state.drafts[slot] ?? null, applied: false };
        }
        lastUndoRecordAtBySlot[slot] = 0;
        recordQuickNoteRecovery(slot, state.drafts[slot] ?? null, result.content);
        set({
          drafts: { ...state.drafts, [slot]: result.content },
          undoStacks: { ...state.undoStacks, [slot]: result.undo },
          redoStacks: { ...state.redoStacks, [slot]: result.redo },
        });
        return { content: result.content, applied: true };
      },

      saveDraftToNotebook: () => {
        const content = getActiveDraftContent(get());
        if (isQuickNoteDraftEmpty(content)) {
          get().clearDraft();
          return null;
        }
        const nbId =
          useNotebooks.getState().activeNotebookId ?? DEFAULT_NOTEBOOK;
        const id = usePages.getState().createPageRecord({
          workspaceId: nbId,
          content: content ?? undefined,
        });
        get().clearDraft();
        return id;
      },

      clearDraft: () =>
        set((state) => {
          const slot = state.activeSlot;
          const previous = state.drafts[slot] ?? null;
          recordQuickNoteRecovery(slot, previous, null);
          // 清空也记一步，方便撤销恢复
          const hist = recordEditHistory({
            undo: state.undoStacks[slot] ?? [],
            redo: state.redoStacks[slot] ?? [],
            previous,
            next: null,
            lastRecordAt: 0, // 强制新步，不与编辑合并
          });
          if (hist.recorded) {
            lastUndoRecordAtBySlot[slot] = hist.lastRecordAt;
          }
          return {
            drafts: { ...state.drafts, [slot]: null },
            undoStacks: { ...state.undoStacks, [slot]: hist.undo },
            redoStacks: { ...state.redoStacks, [slot]: hist.redo },
          };
        }),

      setWindowWidth: (width) =>
        set({ windowWidth: Math.max(QUICKNOTE_MIN_WIDTH, Math.round(width)) }),
      setWindowHeight: (height) =>
        set({
          windowHeight: Math.max(QUICKNOTE_MIN_HEIGHT, Math.round(height)),
        }),
      setWindowSize: (width, height) =>
        set({
          windowWidth: Math.max(QUICKNOTE_MIN_WIDTH, Math.round(width)),
          windowHeight: Math.max(QUICKNOTE_MIN_HEIGHT, Math.round(height)),
        }),

      setEditorZoom: (zoom: number) =>
        set({ editorZoom: clampQuickNoteZoom(zoom) }),

      setWindowPosition: (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        set({ windowX: Math.round(x), windowY: Math.round(y) });
      },
    }),
    {
      name: "goose-note:quicknote",
      version: 3,
      storage: createJSONStorage(() => quickNoteStorage),
      partialize: (state) => ({
        ...budgetQuickNoteHistory(state.undoStacks, state.redoStacks),
        activeSlot: state.activeSlot,
        drafts: state.drafts,
        slotNames: state.slotNames,
        pinned: true, // 强制置顶，写回恒 true
        editorZoom: state.editorZoom,
        windowWidth: state.windowWidth,
        windowHeight: state.windowHeight,
        // 位置：preload 与 setWindowPosition 双写；这里必须始终带上 store 内最新
        // windowX/Y，否则草稿 onChange 触发的 persist 会用缺省/旧值把 preload 刚写的位置抹掉。
        windowX: state.windowX,
        windowY: state.windowY,
      }),
      migrate: (persisted, version) => {
        const raw = (persisted ?? {}) as Record<string, unknown>;
        if (version < 1) {
          // v0：单字段 draftContent → 槽位 1，其余空
          return {
            ...raw,
            activeSlot: 1,
            drafts: normalizeDrafts(
              undefined,
              (raw.draftContent as JSONContent | null) ?? null,
            ),
            slotNames: createDefaultQuickNoteSlotNames(),
            undoStacks: createEmptySlotStacks(),
            redoStacks: createEmptySlotStacks(),
          };
        }
        if (version < 2) {
          return {
            ...raw,
            activeSlot: normalizeSlot(raw.activeSlot),
            drafts: normalizeDrafts(
              raw.drafts,
              (raw.draftContent as JSONContent | null) ?? null,
            ),
            slotNames: createDefaultQuickNoteSlotNames(),
            undoStacks: createEmptySlotStacks(),
            redoStacks: createEmptySlotStacks(),
          };
        }
        const normalized = {
          ...raw,
          activeSlot: normalizeSlot(raw.activeSlot),
          drafts: normalizeDrafts(
            raw.drafts,
            (raw.draftContent as JSONContent | null) ?? null,
          ),
          undoStacks: normalizeSlotStacks(raw.undoStacks),
          redoStacks: normalizeSlotStacks(raw.redoStacks),
          slotNames: normalizeSlotNames(raw.slotNames),
        };
        return normalized;
      },
      // 兜底：缺 drafts / 脏 activeSlot 时仍能归一，避免 rehydrate 后崩溃
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const recovery = recoverQuickNoteDrafts(
          normalizeDrafts(
            p.drafts,
            (p.draftContent as JSONContent | null | undefined) ?? null,
          ),
        );
        const history = budgetQuickNoteHistory(
          p.undoStacks ?? (current as QuickNoteState).undoStacks,
          p.redoStacks ?? (current as QuickNoteState).redoStacks,
        );
        if (recovery.recoveredSlots.length > 0) {
          queueMicrotask(() =>
            toast.warning("已恢复未完成保存的速记", {
              id: "goose-quicknote-recovered",
              description: "恢复内容已放回原便签槽位，请确认后继续编辑。",
            }),
          );
        }
        if (recovery.conflictSlots.length > 0) {
          queueMicrotask(() =>
            toast.warning("发现未自动覆盖的速记恢复稿", {
              id: "goose-quicknote-recovery-conflict",
              description: "现有草稿更新，恢复稿仍被安全保留。",
            }),
          );
        }
        return {
          ...current,
          ...p,
          activeSlot: normalizeSlot(p.activeSlot ?? current.activeSlot),
          drafts: recovery.drafts,
          slotNames: normalizeSlotNames(p.slotNames),
          undoStacks: history.undoStacks,
          redoStacks: history.redoStacks,
          pinned: true,
        } as typeof current;
      },
      skipHydration: true,
    },
  ),
);

/**
 * 草稿是否为「空白单块」：null / 空数组 / 仅含一个无可见文本的块（如空段落、空标题）。
 * 用于把这类草稿归一成不带标题的空段落，覆盖存量脏数据（早期被强转的空 H1）。
 * 只看首块有无 inline 文本，不碰块类型 props——避免 isDraftEmpty 那种按 JSON 文本
 * 糊匹配、被 props 里 "default"/"left" 等拉丁字母值误判的问题。
 */
const isBlankSingleBlockDraft = (content: JSONContent | null): boolean => {
  if (!content) return true;
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return true;
  if (content.length > 1) return false;
  const only = content[0] as {
    type?: string;
    content?: unknown;
    children?: unknown[];
  };
  if (Array.isArray(only.children) && only.children.length > 0) return false;
  // 仅对文本类块判空；结构化块一律保留（视为有内容）。
  if (!only.type || !TEXTUAL_BLOCK_TYPES.has(only.type)) return false;
  const inline = only.content;
  if (inline == null) return true; // 空段落/空标题：content 为 undefined
  if (typeof inline === "string") return inline.length === 0;
  if (Array.isArray(inline)) {
    return inline.every(
      (n) =>
        typeof (n as { text?: unknown })?.text !== "string" ||
        (n as { text: string }).text.length === 0,
    );
  }
  return false;
};

/**
 * 把草稿首块的 heading 降级为 paragraph（保留 inline 文字与通用排版属性，仅去掉 level）。
 *
 * 「小窗首块永远从正文起手、绝不是标题一」是产品红线（[[title-heading-is-sacred]] 的反面：
 * 主窗首块恒 H1，小窗首块恒非标题）。运行期路径（normalize/firstTitleGuard）已全部豁免草稿页，
 * 不会再主动把首块转 H1；但**存量持久化**里可能残留早期被强转的 H1 首块——用户在那个 H1 块里
 * 继续编辑，onChange 又原样存回 H1，形成「重开即标题1」的死循环（isBlankSingleBlockDraft 只清
 * 空白块、清不掉有内容的 H1）。这里在加载构造 draftPage 时一次性把首块掰回正文，打破循环。
 *
 * 只动**首块**、只把 **heading→paragraph**：第二行起的标题、其它块类型一律原样保留。
 */
function demoteFirstHeadingToParagraph(content: JSONContent): JSONContent {
  if (!Array.isArray(content) || content.length === 0) return content;
  const first = content[0] as {
    type?: string;
    props?: Record<string, unknown>;
  };
  if (first?.type !== "heading") return content;
  const props = first.props ?? {};
  // paragraph 仅保留通用排版属性（颜色/对齐），丢弃 heading 专属的 level / isToggleable。
  const paragraphProps: Record<string, unknown> = {};
  for (const key of ["textColor", "backgroundColor", "textAlignment"]) {
    if (props[key] !== undefined) paragraphProps[key] = props[key];
  }
  const demoted = { ...first, type: "paragraph", props: paragraphProps };
  return [demoted, ...content.slice(1)] as JSONContent;
}

/** 造一个用于驱动编辑器的草稿 page（不入 pages map、不持久化为 page 快照）。 */
export function buildQuickNoteDraftPage(content: JSONContent | null): Page {
  const now = Date.now();
  // 空白草稿一律从空段落起手，不预置任何标题块——小窗是「草稿便签」，不走主窗
  // 「首块恒为 H1」约定。这里对「无可见文本」的草稿（null / 单个空块，含早期 normalize
  // 未豁免时把空段落强转空 H1 回写持久化所留下的存量脏数据）统一归一成空段落：
  // 既保证新草稿不冒空标题1，也清掉存量脏数据。注意此处用结构化判空而非 isDraftEmpty
  // ——后者按 JSON 文本糊匹配，块 props 里的 "default"/"left" 等值含拉丁字母会被误判为非空。
  // 非空草稿再额外把「有内容的 H1 首块」降级为正文：覆盖存量脏数据，确保小窗首行永不是标题一。
  const draftContent = isBlankSingleBlockDraft(content)
    ? createEmptyLocalPageContent()
    : demoteFirstHeadingToParagraph(content as JSONContent);
  return {
    id: "__quicknote_draft__",
    workspaceId: DEFAULT_NOTEBOOK,
    parentId: undefined,
    content: draftContent,
    isFolder: false,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: now,
    updatedAt: now,
    order: now,
  };
}
