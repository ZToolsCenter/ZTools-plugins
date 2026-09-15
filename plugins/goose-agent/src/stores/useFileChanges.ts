/**
 * 会话级 Agent 文件变更 store（ADR 0010）。
 * 持久化 byConversation（ga:file-changes）；focusPath 仅内存。
 * 同 conversationId + path 合并：保留最早 before + 最新 after/kind。
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { gaStateStorage } from "@/stores/settings/gaStorage";

export type FileChangeKind = "create" | "modify" | "delete" | "rename";

export const MAX_CHANGES_PER_CONVERSATION = 50;
export const MAX_CHANGE_CONVERSATIONS = 40;
/** 单侧 before/after 字符上限；超则 slice 并标 truncated */
export const MAX_CONTENT_CHARS = 200_000;

const KINDS = new Set<FileChangeKind>([
  "create",
  "modify",
  "delete",
  "rename",
]);

export interface FileChange {
  id: string;
  conversationId: string;
  /** 变更后主路径；rename 为 to */
  path: string;
  fromPath?: string;
  kind: FileChangeKind;
  before: string | null;
  after: string | null;
  truncated?: boolean;
  binary?: boolean;
  toolCallId?: string;
  updatedAt: number;
}

/** recordChange 入参：id/updatedAt 可选（store 自动补） */
export type FileChangeInput = Omit<FileChange, "id" | "updatedAt"> & {
  id?: string;
};

const EMPTY_CHANGES: FileChange[] = [];

interface FileChangesState {
  /** conversationId → 该会话变更列表（按 path 合并） */
  byConversation: Record<string, FileChange[]>;
  /** UI 打开差异页时可选 focus（不持久化） */
  focusPath: string | null;
  setFocusPath: (path: string | null) => void;
  /**
   * 按 path 合并：同 conversationId+path 更新 after/kind，before 取最早。
   * rename 且带 fromPath 时迁入最终 path 并移除 from 条目。
   */
  recordChange: (partial: FileChangeInput) => void;
  /**
   * 移除会话内某 path 的变更记录；若 focusPath 命中则清空 focus。
   */
  removeChange: (conversationId: string, path: string) => void;
  getChanges: (conversationId: string) => FileChange[];
  getChange: (conversationId: string, path: string) => FileChange | undefined;
  count: (conversationId: string) => number;
  clearConversation: (conversationId: string) => void;
  clearAll: () => void;
}

function createChangeId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `fc-${globalThis.crypto.randomUUID()}`;
  }
  return `fc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function stripUndefinedOptionals(change: FileChange): FileChange {
  const next = { ...change };
  if (!next.truncated) delete next.truncated;
  if (!next.binary) delete next.binary;
  if (!next.fromPath) delete next.fromPath;
  if (!next.toolCallId) delete next.toolCallId;
  return next;
}

/**
 * 保留最早 before：
 * - 已有条目优先（含 create 的 null）
 * - 仅当既有 before 为 null 且 kind≠create 时，用后续非 null 填补（读失败恢复）
 * - 无既有条目时用 incoming
 */
function resolveBefore(
  prior: FileChange | undefined,
  incoming: string | null,
): string | null {
  if (!prior) return incoming;
  if (prior.before !== null) return prior.before;
  if (prior.kind === "create") return null;
  return incoming ?? null;
}

/** 截断过长文本；若发生截断返回 truncated=true */
export function clampContent(
  value: string | null | undefined,
): { text: string | null; truncated: boolean } {
  if (value == null) return { text: null, truncated: false };
  if (typeof value !== "string") return { text: null, truncated: false };
  if (value.length <= MAX_CONTENT_CHARS) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, MAX_CONTENT_CHARS), truncated: true };
}

function isFileChangeKind(v: unknown): v is FileChangeKind {
  return typeof v === "string" && KINDS.has(v as FileChangeKind);
}

/**
 * 规范化单条 FileChange；非法返回 null。
 * 校验 kind/path/conversationId；截断异常大字符串。
 */
export function normalizeFileChange(
  raw: unknown,
  fallbackConversationId?: string,
): FileChange | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const conversationId =
    typeof o.conversationId === "string" && o.conversationId
      ? o.conversationId
      : fallbackConversationId;
  if (!conversationId) return null;

  const path = typeof o.path === "string" ? o.path : "";
  if (!path) return null;

  if (!isFileChangeKind(o.kind)) return null;

  const beforeRaw =
    o.before === null || o.before === undefined
      ? null
      : typeof o.before === "string"
        ? o.before
        : null;
  const afterRaw =
    o.after === null || o.after === undefined
      ? null
      : typeof o.after === "string"
        ? o.after
        : null;

  const beforeClamp = clampContent(beforeRaw);
  const afterClamp = clampContent(afterRaw);

  const updatedAt =
    typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
      ? o.updatedAt
      : Date.now();

  const id =
    typeof o.id === "string" && o.id ? o.id : createChangeId();

  const truncated =
    o.truncated === true || beforeClamp.truncated || afterClamp.truncated
      ? true
      : undefined;

  return stripUndefinedOptionals({
    id,
    conversationId,
    path,
    fromPath:
      typeof o.fromPath === "string" && o.fromPath ? o.fromPath : undefined,
    kind: o.kind,
    before: beforeClamp.text,
    after: afterClamp.text,
    truncated,
    binary: o.binary === true ? true : undefined,
    toolCallId:
      typeof o.toolCallId === "string" && o.toolCallId
        ? o.toolCallId
        : undefined,
    updatedAt,
  });
}

/**
 * 按 updatedAt 升序丢最旧，保留最多 max 条。
 */
export function trimChangesList(
  list: FileChange[],
  max = MAX_CHANGES_PER_CONVERSATION,
): FileChange[] {
  if (list.length <= max) return list;
  const sorted = [...list].sort((a, b) => a.updatedAt - b.updatedAt);
  return sorted.slice(sorted.length - max);
}

/**
 * 会话桶超限：按该会话内最新 updatedAt 丢最旧会话。
 */
export function trimConversations(
  byConversation: Record<string, FileChange[]>,
  max = MAX_CHANGE_CONVERSATIONS,
): Record<string, FileChange[]> {
  const keys = Object.keys(byConversation);
  if (keys.length <= max) return byConversation;

  const scored = keys.map((id) => {
    const list = byConversation[id] ?? [];
    const latest = list.reduce(
      (m, c) => (c.updatedAt > m ? c.updatedAt : m),
      0,
    );
    return { id, latest };
  });
  scored.sort((a, b) => a.latest - b.latest);
  const drop = new Set(scored.slice(0, scored.length - max).map((s) => s.id));
  const next: Record<string, FileChange[]> = {};
  for (const id of keys) {
    if (!drop.has(id)) next[id] = byConversation[id]!;
  }
  return next;
}

/**
 * rehydrate / merge 用：校验并 enforce 上限。
 */
export function normalizeByConversation(
  raw: unknown,
): Record<string, FileChange[]> {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const next: Record<string, FileChange[]> = {};

  for (const [convId, listRaw] of Object.entries(src)) {
    if (!convId || !Array.isArray(listRaw)) continue;
    const list: FileChange[] = [];
    for (const item of listRaw) {
      const n = normalizeFileChange(item, convId);
      if (n) list.push(n);
    }
    if (list.length === 0) continue;
    // 同 path 去重（保留 updatedAt 更新者）
    const byPath = new Map<string, FileChange>();
    for (const c of list) {
      const prev = byPath.get(c.path);
      if (!prev || c.updatedAt >= prev.updatedAt) {
        byPath.set(c.path, { ...c, conversationId: convId });
      }
    }
    next[convId] = trimChangesList([...byPath.values()]);
  }

  return trimConversations(next);
}

/**
 * 会话文件变更 store。
 * persist 逻辑键 `file-changes` → 物理 `ga:file-changes`。
 * partialize 仅 byConversation；focusPath 不落盘。
 */
export const useFileChanges = create<FileChangesState>()(
  persist(
    (set, get) => ({
      byConversation: {},
      focusPath: null,

      setFocusPath: (path) => set({ focusPath: path }),

      getChanges: (conversationId) => {
        if (!conversationId) return EMPTY_CHANGES;
        return get().byConversation[conversationId] ?? EMPTY_CHANGES;
      },

      getChange: (conversationId, path) => {
        if (!conversationId || !path) return undefined;
        return get().byConversation[conversationId]?.find(
          (c) => c.path === path,
        );
      },

      count: (conversationId) => {
        if (!conversationId) return 0;
        return get().byConversation[conversationId]?.length ?? 0;
      },

      recordChange: (partial) => {
        if (!partial.conversationId || !partial.path) return;
        if (!isFileChangeKind(partial.kind)) return;

        set((state) => {
          const convId = partial.conversationId;
          let list = state.byConversation[convId] ?? [];
          const now = Date.now();

          // rename：迁出 fromPath 条目（保留其 earliest before）
          let migrated: FileChange | undefined;
          if (
            partial.kind === "rename" &&
            partial.fromPath &&
            partial.fromPath !== partial.path
          ) {
            const fromIdx = list.findIndex((c) => c.path === partial.fromPath);
            if (fromIdx >= 0) {
              migrated = list[fromIdx];
              list = list.filter((_, i) => i !== fromIdx);
            }
          }

          const idx = list.findIndex((c) => c.path === partial.path);
          // 优先用同 path 既有条目；否则用 from 迁移条目
          const prior = idx >= 0 ? list[idx] : migrated;

          const beforeClamp = clampContent(
            resolveBefore(prior, partial.before ?? null),
          );
          const afterClamp = clampContent(partial.after ?? null);

          const merged = stripUndefinedOptionals({
            id: prior?.id ?? partial.id ?? createChangeId(),
            conversationId: convId,
            path: partial.path,
            fromPath: partial.fromPath ?? prior?.fromPath,
            kind: partial.kind,
            before: beforeClamp.text,
            after: afterClamp.text,
            truncated:
              prior?.truncated ||
              partial.truncated ||
              beforeClamp.truncated ||
              afterClamp.truncated
                ? true
                : undefined,
            binary: prior?.binary || partial.binary ? true : undefined,
            toolCallId: partial.toolCallId ?? prior?.toolCallId,
            updatedAt: now,
          });

          let nextList =
            idx >= 0
              ? list.map((c, i) => (i === idx ? merged : c))
              : [...list, merged];

          nextList = trimChangesList(nextList);

          let byConversation: Record<string, FileChange[]> = {
            ...state.byConversation,
            [convId]: nextList,
          };
          byConversation = trimConversations(byConversation);

          return { byConversation };
        });
      },

      removeChange: (conversationId, path) => {
        if (!conversationId || !path) return;
        set((state) => {
          const list = state.byConversation[conversationId];
          if (!list?.length) return state;
          const nextList = list.filter((c) => c.path !== path);
          if (nextList.length === list.length) return state;

          const clearFocus = state.focusPath === path;
          if (nextList.length === 0) {
            const { [conversationId]: _removed, ...rest } =
              state.byConversation;
            return {
              byConversation: rest,
              focusPath: clearFocus ? null : state.focusPath,
            };
          }
          return {
            byConversation: {
              ...state.byConversation,
              [conversationId]: nextList,
            },
            focusPath: clearFocus ? null : state.focusPath,
          };
        });
      },

      clearConversation: (conversationId) => {
        set((state) => {
          if (!(conversationId in state.byConversation)) return state;
          const { [conversationId]: removed, ...rest } = state.byConversation;
          const clearFocus =
            state.focusPath != null &&
            removed?.some((c) => c.path === state.focusPath);
          return {
            byConversation: rest,
            focusPath: clearFocus ? null : state.focusPath,
          };
        });
      },

      clearAll: () => set({ byConversation: {}, focusPath: null }),
    }),
    {
      name: "file-changes",
      version: 1,
      storage: createJSONStorage(() => gaStateStorage),
      partialize: (state) => ({
        byConversation: state.byConversation,
      }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as { byConversation?: unknown })
            : {};
        return {
          ...current,
          byConversation: normalizeByConversation(raw.byConversation),
          // focusPath 永不从磁盘恢复
          focusPath: current.focusPath ?? null,
        };
      },
    },
  ),
);
