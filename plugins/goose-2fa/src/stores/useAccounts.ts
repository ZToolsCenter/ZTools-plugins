import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
import type { AccountData, NewAccountInput, VaultGroup } from "@/lib/types";
import type { PlatformAdapter } from "@/platform/types";
import { normalizeNewAccountInput, normalizeStoredAccounts } from "@/lib/account-validation";
import {
  UNGROUPED_KEY,
  nextGroupOrder,
  normalizeGroupName,
  resolveSelectedGroup,
} from "@/lib/groups";
import {
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
  normalizeAccentColor,
  type AccentColor,
} from "@/lib/accent-color";

let platform: PlatformAdapter;
let persistQueue: Promise<void> = Promise.resolve();

export function initPlatform(adapter: PlatformAdapter) {
  platform = adapter;
  persistQueue = Promise.resolve();
}

export type ViewMode = "grid" | "compact" | "list";

const VIEW_MODE_KEY = "goose-2fa-view";
const GROUP_KEY = "goose-2fa-group";
const ACCENT_COLOR_KEY = "goose-2fa-accent";
/** 旧版分组曾落在 localStorage；迁移到平台存储后删除 */
const LEGACY_GROUPS_KEY = "goose-2fa-groups";
/** 兼容旧 issuer 侧栏选中，读取一次后清除 */
const LEGACY_CATEGORY_KEY = "goose-2fa-category";

function loadViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY);
  if (stored === "compact" || stored === "list" || stored === "grid") return stored;
  return "compact";
}

function loadSelectedGroup(): string | null {
  const stored = localStorage.getItem(GROUP_KEY);
  if (stored) return stored;
  // 旧分类键不再映射到一级分组，直接丢弃以免脏状态
  if (localStorage.getItem(LEGACY_CATEGORY_KEY)) {
    localStorage.removeItem(LEGACY_CATEGORY_KEY);
  }
  return null;
}

function normalizeGroups(values: unknown): VaultGroup[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((g): g is VaultGroup => {
      if (!g || typeof g !== "object") return false;
      const group = g as VaultGroup;
      return typeof group.id === "string" && typeof group.name === "string";
    })
    .map((g, i) => ({
      id: g.id,
      name: g.name,
      order: typeof g.order === "number" ? g.order : i,
      createdAt: typeof g.createdAt === "number" ? g.createdAt : Date.now(),
    }));
}

function readLegacyLocalGroups(): VaultGroup[] {
  try {
    const raw = localStorage.getItem(LEGACY_GROUPS_KEY);
    if (!raw) return [];
    return normalizeGroups(JSON.parse(raw));
  } catch {
    return [];
  }
}

function clearLegacyLocalGroups() {
  localStorage.removeItem(LEGACY_GROUPS_KEY);
}

function persistGroups(groups: VaultGroup[]) {
  const snapshot = groups.map((group) => ({ ...group }));
  persistQueue = persistQueue
    .then(() => Promise.resolve(platform.saveGroups(snapshot)))
    .then(() => {
      clearLegacyLocalGroups();
    })
    .catch((err) => {
      console.error("[goose-2fa] persist groups failed:", err);
      platform.showNotification("分组保存失败，请检查存储权限后重试");
    });
}

function loadAccentColor(): AccentColor {
  return normalizeAccentColor(localStorage.getItem(ACCENT_COLOR_KEY) ?? DEFAULT_ACCENT_COLOR);
}

const initialAccentColor = loadAccentColor();
applyAccentColor(initialAccentColor);

interface AccountsState {
  accounts: AccountData[];
  trash: AccountData[];
  groups: VaultGroup[];
  searchQuery: string;
  showAddForm: boolean;
  showDataTransfer: boolean;
  showTrash: boolean;
  isDark: boolean;
  isThemeLocked: boolean;
  editMode: boolean;
  viewMode: ViewMode;
  selectedGroup: string | null;
  accentColor: AccentColor;
  loadStatus: "idle" | "loading" | "ready" | "error";
  loadError: string | null;

  load: () => Promise<void>;
  save: (accounts: AccountData[]) => void;
  setViewMode: (mode: ViewMode) => void;
  setSelectedGroup: (groupId: string | null) => void;
  setAccentColor: (accentColor: AccentColor) => void;
  reorderAccounts: (activeId: string, overId: string) => void;
  addAccount: (input: NewAccountInput) => void;
  importAccounts: (inputs: NewAccountInput[], groups?: VaultGroup[]) => void;
  removeAccount: (id: string) => void;
  restoreAccount: (id: string) => void;
  permanentlyDelete: (id: string) => void;
  emptyTrash: () => void;
  updateNote: (id: string, note: string) => void;
  updateRemark: (id: string, remark: string) => void;
  updateAccountGroup: (id: string, groupId: string | null) => void;
  createGroup: (name: string) => string | null;
  renameGroup: (id: string, name: string) => boolean;
  deleteGroup: (id: string) => void;
  reorderGroups: (activeId: string, overId: string) => void;
  incrementCounter: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setShowAddForm: (show: boolean) => void;
  setShowDataTransfer: (show: boolean) => void;
  setShowTrash: (show: boolean) => void;
  toggleDark: () => void;
  toggleThemeLock: () => void;
  syncSystemDark: (isDark: boolean) => void;
  setEditMode: (edit: boolean) => void;
}

function persist(accounts: AccountData[]) {
  const snapshot = accounts.map((account) => ({ ...account }));
  persistQueue = persistQueue
    .then(() => Promise.resolve(platform.saveAccounts(snapshot)))
    .catch((err) => {
      console.error("[goose-2fa] persist failed:", err);
      platform.showNotification("账户保存失败，请检查存储权限后重试");
    });
}

function persistTrash(trash: AccountData[]) {
  localStorage.setItem("goose-2fa-trash", JSON.stringify(trash));
}

async function loadFromStorage(): Promise<AccountData[]> {
  return platform.loadAccounts();
}

function loadTrashFromStorage(): AccountData[] {
  try {
    const raw = localStorage.getItem("goose-2fa-trash");
    return raw ? normalizeStoredAccounts(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export const useAccounts = create<AccountsState>((set, get) => ({
  accounts: [],
  trash: [],
  groups: [],
  searchQuery: "",
  showAddForm: false,
  showDataTransfer: false,
  showTrash: false,
  isDark: localStorage.getItem("goose-2fa-dark") !== null
    ? localStorage.getItem("goose-2fa-dark") === "true"
    : window.matchMedia("(prefers-color-scheme: dark)").matches,
  isThemeLocked: localStorage.getItem("goose-2fa-dark") !== null,
  editMode: false,
  viewMode: loadViewMode(),
  selectedGroup: loadSelectedGroup(),
  accentColor: initialAccentColor,
  loadStatus: "idle",
  loadError: null,

  load: async () => {
    if (get().loadStatus === "loading") return;
    set({ loadStatus: "loading", loadError: null });
    try {
      const platformGroups = normalizeGroups(await Promise.resolve(platform.loadGroups()));
      const legacyGroups = readLegacyLocalGroups();
      // 平台存储优先；若平台尚无分组，迁移旧 localStorage 数据
      let groups = platformGroups;
      if (groups.length === 0 && legacyGroups.length > 0) {
        groups = legacyGroups;
        persistGroups(groups);
      } else if (platformGroups.length > 0 && legacyGroups.length > 0) {
        clearLegacyLocalGroups();
      }
      const validGroupIds = new Set(groups.map((group) => group.id));
      const trash = normalizeStoredAccounts(loadTrashFromStorage(), validGroupIds);
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const validTrash = trash.filter((a) => (a.deletedAt ?? 0) > thirtyDaysAgo);
      if (validTrash.length !== trash.length) persistTrash(validTrash);
      const loaded = await loadFromStorage();
      const accounts = normalizeStoredAccounts(loaded, validGroupIds);
      const selectedGroup = resolveSelectedGroup(get().selectedGroup, groups, accounts);
      if (selectedGroup !== get().selectedGroup) {
        if (selectedGroup) localStorage.setItem(GROUP_KEY, selectedGroup);
        else localStorage.removeItem(GROUP_KEY);
      }
      set({ accounts, trash: validTrash, groups, selectedGroup, loadStatus: "ready" });
    } catch (error) {
      console.error("[goose-2fa] load failed:", error);
      set({
        loadStatus: "error",
        loadError: "无法读取本地账户，请重试。已有数据不会被覆盖。",
      });
    }
  },

  save: (accounts) => {
    persist(accounts);
    set({ accounts });
  },

  setViewMode: (mode) => {
    localStorage.setItem(VIEW_MODE_KEY, mode);
    set({ viewMode: mode });
  },

  setSelectedGroup: (groupId) => {
    if (groupId) localStorage.setItem(GROUP_KEY, groupId);
    else localStorage.removeItem(GROUP_KEY);
    set({ selectedGroup: groupId });
  },

  setAccentColor: (accentColor) => {
    const normalized = normalizeAccentColor(accentColor);
    localStorage.setItem(ACCENT_COLOR_KEY, normalized);
    applyAccentColor(normalized);
    set({ accentColor: normalized });
  },

  reorderAccounts: (activeId, overId) => {
    if (activeId === overId) return;
    const current = get().accounts;
    const from = current.findIndex((a) => a.id === activeId);
    const to = current.findIndex((a) => a.id === overId);
    if (from === -1 || to === -1) return;
    const next = arrayMove(current, from, to);
    persist(next);
    set({ accounts: next });
  },

  addAccount: (input) => {
    const normalized = normalizeNewAccountInput(input);
    if (!normalized) return;
    const displayName = normalized.issuer
      ? `${normalized.issuer} (${normalized.name})`
      : normalized.name;

    const selected = get().selectedGroup;
    const groupId =
      selected && selected !== UNGROUPED_KEY && get().groups.some((g) => g.id === selected)
        ? selected
        : null;

    const account: AccountData = {
      ...normalized,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      originalName: displayName,
      groupId,
    };

    const next = [...get().accounts, account];
    persist(next);
    set({ accounts: next, showAddForm: false });
  },

  importAccounts: (inputs, importedGroups = []) => {
    const now = Date.now();
    const selected = get().selectedGroup;
    const selectedGroupId =
      selected && selected !== UNGROUPED_KEY && get().groups.some((g) => g.id === selected)
        ? selected
        : null;
    const currentGroups = get().groups;
    const mergedGroups = [...currentGroups];
    const groupIdMap = new Map<string, string>();
    for (const imported of importedGroups) {
      const sameId = mergedGroups.find((group) => group.id === imported.id);
      const sameName = mergedGroups.find(
        (group) => group.name.localeCompare(imported.name, undefined, { sensitivity: "accent" }) === 0,
      );
      if (sameId && sameId.name.localeCompare(imported.name, undefined, { sensitivity: "accent" }) === 0) {
        groupIdMap.set(imported.id, sameId.id);
      } else if (sameName) {
        groupIdMap.set(imported.id, sameName.id);
      } else {
        const id = imported.id && !sameId ? imported.id : crypto.randomUUID();
        groupIdMap.set(imported.id, id);
        mergedGroups.push({
          ...imported,
          id,
          order: nextGroupOrder(mergedGroups),
          createdAt: imported.createdAt || now,
        });
      }
    }
    const newAccounts = inputs
      .map(normalizeNewAccountInput)
      .filter((input): input is NewAccountInput => input !== null)
      .map((input, i) => ({
        ...input,
        id: crypto.randomUUID(),
        createdAt: now + i,
        groupId: importedGroups.length > 0
          ? (input.groupId ? groupIdMap.get(input.groupId) ?? null : null)
          : selectedGroupId,
      }));
    const next = [...get().accounts, ...newAccounts];
    if (mergedGroups.length !== currentGroups.length) persistGroups(mergedGroups);
    persist(next);
    set({ accounts: next, groups: mergedGroups });
  },

  updateNote: (id, note) => {
    const next = get().accounts.map((a) =>
      a.id === id ? { ...a, note } : a,
    );
    persist(next);
    set({ accounts: next });
  },

  updateRemark: (id, remark) => {
    const next = get().accounts.map((a) =>
      a.id === id ? { ...a, remark } : a,
    );
    persist(next);
    set({ accounts: next });
  },

  updateAccountGroup: (id, groupId) => {
    if (groupId !== null && !get().groups.some((group) => group.id === groupId)) return;
    const safeGroupId = groupId;
    const current = get().accounts.find((account) => account.id === id);
    if (!current || (current.groupId ?? null) === safeGroupId) return;
    const next = get().accounts.map((a) =>
      a.id === id ? { ...a, groupId: safeGroupId } : a,
    );
    persist(next);
    set({ accounts: next });
  },

  createGroup: (name) => {
    const cleaned = normalizeGroupName(name);
    if (!cleaned) return null;
    const groups = get().groups;
    if (groups.some((g) => g.name.localeCompare(cleaned, undefined, { sensitivity: "accent" }) === 0)) return null;
    const group: VaultGroup = {
      id: crypto.randomUUID(),
      name: cleaned,
      order: nextGroupOrder(groups),
      createdAt: Date.now(),
    };
    const next = [...groups, group];
    persistGroups(next);
    set({ groups: next, selectedGroup: group.id });
    localStorage.setItem(GROUP_KEY, group.id);
    return group.id;
  },

  renameGroup: (id, name) => {
    const cleaned = normalizeGroupName(name);
    if (!cleaned) return false;
    const groups = get().groups;
    if (groups.some((g) => g.id !== id && g.name.localeCompare(cleaned, undefined, { sensitivity: "accent" }) === 0)) return false;
    const next = groups.map((g) => (g.id === id ? { ...g, name: cleaned } : g));
    persistGroups(next);
    set({ groups: next });
    return true;
  },

  deleteGroup: (id) => {
    const nextGroups = get().groups.filter((g) => g.id !== id);
    const nextAccounts = get().accounts.map((a) =>
      a.groupId === id ? { ...a, groupId: null } : a,
    );
    const nextTrash = get().trash.map((a) =>
      a.groupId === id ? { ...a, groupId: null } : a,
    );
    persistGroups(nextGroups);
    persist(nextAccounts);
    persistTrash(nextTrash);
    const selectedGroup =
      get().selectedGroup === id ? null : get().selectedGroup;
    if (selectedGroup) localStorage.setItem(GROUP_KEY, selectedGroup);
    else localStorage.removeItem(GROUP_KEY);
    set({ groups: nextGroups, accounts: nextAccounts, trash: nextTrash, selectedGroup });
  },

  reorderGroups: (activeId, overId) => {
    if (activeId === overId) return;
    if (activeId === UNGROUPED_KEY || overId === UNGROUPED_KEY) return;
    const current = get().groups;
    const sorted = [...current].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"),
    );
    const from = sorted.findIndex((g) => g.id === activeId);
    const to = sorted.findIndex((g) => g.id === overId);
    if (from === -1 || to === -1) return;
    const moved = arrayMove(sorted, from, to).map((g, i) => ({ ...g, order: i }));
    persistGroups(moved);
    set({ groups: moved });
  },

  removeAccount: (id) => {
    const account = get().accounts.find((a) => a.id === id);
    const next = get().accounts.filter((a) => a.id !== id);
    persist(next);
    if (account) {
      const trashed = { ...account, deletedAt: Date.now() };
      const nextTrash = [...get().trash, trashed];
      persistTrash(nextTrash);
      set({ accounts: next, trash: nextTrash });
    } else {
      set({ accounts: next });
    }
  },

  restoreAccount: (id) => {
    const account = get().trash.find((a) => a.id === id);
    if (!account) return;
    const { deletedAt: _, ...restored } = account;
    const safeGroupId = restored.groupId && get().groups.some((group) => group.id === restored.groupId)
      ? restored.groupId
      : null;
    const nextTrash = get().trash.filter((a) => a.id !== id);
    const nextAccounts = [...get().accounts, { ...restored, groupId: safeGroupId } as AccountData];
    persist(nextAccounts);
    persistTrash(nextTrash);
    set({ accounts: nextAccounts, trash: nextTrash });
  },

  permanentlyDelete: (id) => {
    const nextTrash = get().trash.filter((a) => a.id !== id);
    persistTrash(nextTrash);
    set({ trash: nextTrash });
  },

  emptyTrash: () => {
    persistTrash([]);
    set({ trash: [] });
  },

  incrementCounter: (id) => {
    const next = get().accounts.map((a) =>
      a.id === id ? { ...a, counter: a.counter + 1 } : a,
    );
    persist(next);
    set({ accounts: next });
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setShowAddForm: (showAddForm) => set({ showAddForm }),
  setShowDataTransfer: (showDataTransfer) => set({ showDataTransfer }),
  setShowTrash: (showTrash) => set({ showTrash }),

  toggleDark: () => {
    const next = !get().isDark;
    localStorage.setItem("goose-2fa-dark", String(next));
    document.documentElement.classList.toggle("dark", next);
    set({ isDark: next, isThemeLocked: true });
  },

  toggleThemeLock: () => {
    if (get().isThemeLocked) {
      localStorage.removeItem("goose-2fa-dark");
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", systemDark);
      set({ isThemeLocked: false, isDark: systemDark });
    } else {
      localStorage.setItem("goose-2fa-dark", String(get().isDark));
      set({ isThemeLocked: true });
    }
  },

  syncSystemDark: (isDark) => {
    document.documentElement.classList.toggle("dark", isDark);
    set({ isDark });
  },

  setEditMode: (editMode) => set({ editMode }),
}));
