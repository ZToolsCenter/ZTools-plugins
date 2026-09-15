import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useAccounts } from "@/stores/useAccounts";
import { usePlatform } from "@/platform/context";
import { Header } from "@/components/Header";
import { CodeGrid } from "@/components/CodeGrid";
import { AddAccount } from "@/components/AddAccount";
import { DataTransfer } from "@/components/DataTransfer";
import { TrashBin } from "@/components/TrashBin";
import { AccountDetail } from "@/components/AccountDetail";
import { QuickCode } from "@/components/QuickCode";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import type { AccountData } from "@/lib/types";
import type { PluginEnterDetail } from "@/platform/types";

type FlipState = "idle" | "opening" | "open" | "closing";

export default function App() {
  const platform = usePlatform();
  const accounts = useAccounts((s) => s.accounts);
  const trash = useAccounts((s) => s.trash);
  const groups = useAccounts((s) => s.groups);
  const searchQuery = useAccounts((s) => s.searchQuery);
  const showAddForm = useAccounts((s) => s.showAddForm);
  const showDataTransfer = useAccounts((s) => s.showDataTransfer);
  const showTrash = useAccounts((s) => s.showTrash);
  const isDark = useAccounts((s) => s.isDark);
  const isThemeLocked = useAccounts((s) => s.isThemeLocked);
  const viewMode = useAccounts((s) => s.viewMode);
  const setViewMode = useAccounts((s) => s.setViewMode);
  const selectedGroup = useAccounts((s) => s.selectedGroup);
  const setSelectedGroup = useAccounts((s) => s.setSelectedGroup);
  const accentColor = useAccounts((s) => s.accentColor);
  const loadStatus = useAccounts((s) => s.loadStatus);
  const loadError = useAccounts((s) => s.loadError);
  const setAccentColor = useAccounts((s) => s.setAccentColor);
  const reorderAccounts = useAccounts((s) => s.reorderAccounts);
  const load = useAccounts((s) => s.load);
  const addAccount = useAccounts((s) => s.addAccount);
  const importAccounts = useAccounts((s) => s.importAccounts);
  const removeAccount = useAccounts((s) => s.removeAccount);
  const restoreAccount = useAccounts((s) => s.restoreAccount);
  const permanentlyDelete = useAccounts((s) => s.permanentlyDelete);
  const emptyTrash = useAccounts((s) => s.emptyTrash);
  const updateNote = useAccounts((s) => s.updateNote);
  const updateRemark = useAccounts((s) => s.updateRemark);
  const updateAccountGroup = useAccounts((s) => s.updateAccountGroup);
  const createGroup = useAccounts((s) => s.createGroup);
  const renameGroup = useAccounts((s) => s.renameGroup);
  const deleteGroup = useAccounts((s) => s.deleteGroup);
  const incrementCounter = useAccounts((s) => s.incrementCounter);
  const setSearchQuery = useAccounts((s) => s.setSearchQuery);
  const setShowAddForm = useAccounts((s) => s.setShowAddForm);
  const setShowDataTransfer = useAccounts((s) => s.setShowDataTransfer);
  const setShowTrash = useAccounts((s) => s.setShowTrash);
  const toggleDark = useAccounts((s) => s.toggleDark);
  const toggleThemeLock = useAccounts((s) => s.toggleThemeLock);
  const syncSystemDark = useAccounts((s) => s.syncSystemDark);

  const [addFormAction, setAddFormAction] = useState<"clipboard" | "capture" | undefined>();
  const [detailAccount, setDetailAccount] = useState<AccountData | null>(null);
  const [flipState, setFlipState] = useState<FlipState>("idle");
  const [quickMode, setQuickMode] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusReturnRef = useRef<HTMLElement | null>(null);

  const transitionDelay = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360;

  useEffect(() => {
    load();
    document.documentElement.classList.toggle("dark", useAccounts.getState().isDark);
  }, [load]);

  useEffect(() => {
    // uTools (Electron) 环境：监听 nativeTheme 派发的主题变化事件
    const handleThemeChanged = (e: CustomEvent<{ isDark: boolean }>) => {
      if (localStorage.getItem("goose-2fa-dark") === null) {
        syncSystemDark(e.detail.isDark);
      }
    };
    window.addEventListener("goose-2fa:theme-changed", handleThemeChanged as EventListener);

    // 浏览器开发环境兜底：matchMedia
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const mqHandler = (e: MediaQueryListEvent) => {
      if (localStorage.getItem("goose-2fa-dark") === null) {
        syncSystemDark(e.matches);
      }
    };
    mq.addEventListener("change", mqHandler);

    return () => {
      window.removeEventListener("goose-2fa:theme-changed", handleThemeChanged as EventListener);
      mq.removeEventListener("change", mqHandler);
    };
  }, [syncSystemDark]);

  useEffect(() => {
    const handleEnter = (e: Event) => {
      const detail = (e as CustomEvent<PluginEnterDetail>).detail;
      load();
      if (detail?.code === "quick") {
        const raw = (detail?.payload ?? "").trim();
        const query = raw.replace(/^(2fa|otp|验证码)\s+/i, "").trim();
        setQuickQuery(query);
        setQuickMode(true);
      } else {
        setQuickQuery("");
        setQuickMode(false);
        setSearchQuery("");
      }
    };
    const handleOut = () => setQuickMode(false);
    window.addEventListener("goose-2fa:plugin-enter", handleEnter);
    window.addEventListener("goose-2fa:plugin-out", handleOut);
    return () => {
      window.removeEventListener("goose-2fa:plugin-enter", handleEnter);
      window.removeEventListener("goose-2fa:plugin-out", handleOut);
    };
  }, [load, setSearchQuery]);

  const handleCopy = (_text: string) => {};

  const handleDetailCopy = async (text: string) => {
    try {
      await platform.copyText(text);
      return true;
    } catch {
      return false;
    }
  };

  const handleOpenDetail = useCallback((account: AccountData) => {
    clearTimeout(timerRef.current);
    focusReturnRef.current = document.activeElement as HTMLElement | null;
    setDetailAccount(account);
    setFlipState("opening");
    timerRef.current = setTimeout(() => setFlipState("open"), transitionDelay());
  }, []);

  const handleCloseDetail = useCallback(() => {
    clearTimeout(timerRef.current);
    setFlipState("closing");
    timerRef.current = setTimeout(() => {
      setFlipState("idle");
      setDetailAccount(null);
      focusReturnRef.current?.focus();
    }, transitionDelay());
  }, []);

  const handleDeleteFromDetail = useCallback((id: string) => {
    clearTimeout(timerRef.current);
    setFlipState("closing");
    timerRef.current = setTimeout(() => {
      removeAccount(id);
      setFlipState("idle");
      setDetailAccount(null);
    }, transitionDelay());
  }, [removeAccount]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // 详情翻面时跟随 store 最新账户（改分组/备注后立即反映）。
  // 必须位于所有条件返回之前，保证每次渲染的 Hook 顺序一致。
  const liveDetail = useMemo(() => {
    if (!detailAccount) return null;
    return accounts.find((a) => a.id === detailAccount.id) ?? detailAccount;
  }, [accounts, detailAccount]);

  if (loadStatus !== "ready") {
    return (
      <VaultLoadState
        status={loadStatus}
        message={loadError}
        onRetry={load}
      />
    );
  }

  if (quickMode) {
    return (
      <QuickCode
        accounts={accounts}
        initialQuery={quickQuery}
        onIncrement={incrementCounter}
      />
    );
  }

  if (showTrash) {
    return (
      <div className="flex min-h-screen flex-col">
        <TrashBin
          trash={trash}
          onRestore={restoreAccount}
          onPermanentDelete={permanentlyDelete}
          onEmptyTrash={emptyTrash}
          onBack={() => setShowTrash(false)}
        />
      </div>
    );
  }

  if (showDataTransfer) {
    return (
      <div className="flex min-h-screen flex-col">
        <DataTransfer
          accounts={accounts}
          groups={groups}
          onImport={importAccounts}
          onCancel={() => setShowDataTransfer(false)}
        />
      </div>
    );
  }

  if (showAddForm) {
    return (
      <div className="flex min-h-screen flex-col">
        <AddAccount
          onAdd={addAccount}
          onBatchAdd={importAccounts}
          onCancel={() => { setShowAddForm(false); setAddFormAction(undefined); }}
          initialAction={addFormAction}
        />
      </div>
    );
  }

  const frontClass = [
    "flip-face flip-front flex min-h-0 flex-col bg-bg",
    flipState === "opening" ? "flipping-out" : "",
    flipState === "closing" ? "flipping-in" : "",
    flipState === "open" ? "pointer-events-none opacity-0" : "",
  ].join(" ");

  const backClass = [
    "flip-face flip-back",
    flipState === "opening" ? "flipping-in" : "",
    flipState === "closing" ? "flipping-out" : "",
    flipState === "idle" ? "pointer-events-none" : "",
    flipState === "open" ? "!transform-none !opacity-100" : "",
  ].join(" ");

  return (
    <div className="flip-scene">
      {/* 正面：主界面 */}
      <div
        className={frontClass}
        inert={flipState === "open" ? true : undefined}
        aria-hidden={flipState === "open"}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <Header
            hasAccounts={accounts.length > 0}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            viewMode={viewMode}
            onToggleView={() => {
              const next = viewMode === "compact" ? "grid" : viewMode === "grid" ? "list" : "compact";
              setViewMode(next);
            }}
            onAdd={() => { setAddFormAction(undefined); setShowAddForm(true); }}
            onManageData={() => setShowDataTransfer(true)}
            onTrash={() => setShowTrash(true)}
            isDark={isDark}
            isThemeLocked={isThemeLocked}
            onToggleDark={toggleDark}
            onToggleThemeLock={toggleThemeLock}
            accentColor={accentColor}
            onAccentColorChange={setAccentColor}
            trashCount={trash.length}
          />
          <CodeGrid
            accounts={accounts}
            groups={groups}
            searchQuery={searchQuery}
            viewMode={viewMode}
            selectedGroup={selectedGroup}
            onSelectGroup={setSelectedGroup}
            onCreateGroup={createGroup}
            onRenameGroup={renameGroup}
            onDeleteGroup={deleteGroup}
            onCopy={handleCopy}
            onDetail={handleOpenDetail}
            onIncrement={incrementCounter}
            onReorder={reorderAccounts}
            onMoveToGroup={updateAccountGroup}
            onAdd={() => { setAddFormAction(undefined); setShowAddForm(true); }}
            onClipboardImport={() => { setAddFormAction("clipboard"); setShowAddForm(true); }}
            onScreenCapture={() => { setAddFormAction("capture"); setShowAddForm(true); }}
          />
        </div>
      </div>

      {liveDetail ? (
        <div
          className={backClass}
          inert={flipState === "idle" ? true : undefined}
          aria-hidden={flipState === "idle"}
        >
          <AccountDetail
            account={liveDetail}
            groups={groups}
            onClose={handleCloseDetail}
            onDelete={handleDeleteFromDetail}
            onCopy={handleDetailCopy}
            onUpdateNote={updateNote}
            onUpdateRemark={updateRemark}
            onUpdateGroup={updateAccountGroup}
          />
        </div>
      ) : (
        <div className="flip-face flip-back pointer-events-none" aria-hidden="true" />
      )}
    </div>
  );
}

function VaultLoadState({
  status,
  message,
  onRetry,
}: {
  status: "idle" | "loading" | "error";
  message: string | null;
  onRetry: () => Promise<void>;
}) {
  const failed = status === "error";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-8 text-center">
      <div
        className={`flex h-11 w-11 items-center justify-center rounded-cell ${
          failed ? "bg-danger-soft text-timer-low" : "bg-accent-subtle text-accent"
        }`}
        aria-hidden="true"
      >
        {failed ? <AlertCircle size={21} /> : <LoaderCircle className="animate-spin" size={21} />}
      </div>
      <h1 className="mt-4 text-[15px] font-semibold text-fg">
        {failed ? "账户读取失败" : "正在读取本地账户"}
      </h1>
      <p className="mt-1.5 max-w-[280px] text-[12.5px] leading-relaxed text-fg-muted" role={failed ? "alert" : undefined}>
        {failed ? message : "请稍候，加载完成前不会写入或覆盖数据。"}
      </p>
      {failed && (
        <button
          type="button"
          onClick={() => void onRetry()}
          className="primary-control mt-4 flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[12.5px] font-medium text-accent-fg"
        >
          <RefreshCw size={13} />
          重试
        </button>
      )}
    </main>
  );
}
