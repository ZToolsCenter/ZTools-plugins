import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { usePlatform } from "@/platform/context";
import { useOtpCode } from "@/hooks/useOtpCode";
import { formatCode } from "@/lib/otp";
import { filterAccounts } from "@/lib/search";
import type { AccountData } from "@/lib/types";

interface QuickCodeProps {
  accounts: AccountData[];
  initialQuery: string;
  onIncrement: (id: string) => void;
}

export function QuickCode({ accounts, initialQuery, onIncrement }: QuickCodeProps) {
  const platform = usePlatform();
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const pickingRef = useRef(false);

  const filtered = useMemo(() => filterAccounts(accounts, query), [accounts, query]);

  useEffect(() => {
    platform.setSubInput?.(setQuery, "搜索账户名、发行方或备注", initialQuery);
    return () => platform.removeSubInput?.();
  }, [initialQuery, platform]);

  const resultIds = filtered.map((account) => account.id).join(",");
  useEffect(() => setSelectedIndex(0), [resultIds]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const pick = useCallback(async (account: AccountData, code: string) => {
    if (pickingRef.current || !/^\d+$/.test(code)) return;
    pickingRef.current = true;
    setError("");
    try {
      const pasted = platform.pasteText?.(code) ?? false;
      if (!pasted) {
        await platform.copyText(code);
        platform.showNotification(`已复制 ${account.issuer || account.name} 验证码`);
        platform.hideWindow();
      }
      if (account.type === "hotp") onIncrement(account.id);
    } catch {
      setError("未能粘贴或复制验证码，请重试");
    } finally {
      window.setTimeout(() => {
        pickingRef.current = false;
      }, 250);
    }
  }, [onIncrement, platform]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const account = filtered[selectedIndex];
        const code = listRef.current
          ?.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`)
          ?.dataset.code;
        if (account && code) void pick(account, code);
      } else if (event.key === "Escape") {
        event.preventDefault();
        platform.outPlugin?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, pick, platform, selectedIndex]);

  if (accounts.length === 0) {
    return <QuickEmpty title="还没有账户" hint="输入“管理鹅的验证”添加账户" />;
  }

  if (filtered.length === 0) {
    return <QuickEmpty title="没有匹配结果" hint={`没有账户匹配“${query}”`} />;
  }

  return (
    <main className="flex h-screen flex-col bg-bg">
      {error && (
        <p role="alert" className="mx-3 mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-timer-low">
          {error}
        </p>
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5" role="listbox" aria-label="验证码账户">
        {filtered.map((account, index) => (
          <QuickRow
            key={account.id}
            account={account}
            index={index}
            selected={index === selectedIndex}
            onHover={() => setSelectedIndex(index)}
            onPick={pick}
          />
        ))}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t bg-surface px-4 text-[10.5px] text-fg-faint">
        <span className="tabular-nums">{filtered.length === accounts.length ? `${accounts.length} 个账户` : `${filtered.length} / ${accounts.length}`}</span>
        <span className="flex items-center gap-2">
          <kbd className="rounded border bg-bg px-1.5 py-0.5">↑ ↓</kbd><span>选择</span>
          <kbd className="rounded border bg-bg px-1.5 py-0.5"><CornerDownLeft size={10} /></kbd><span>粘贴</span>
          <kbd className="rounded border bg-bg px-1.5 py-0.5">Esc</kbd><span>退出</span>
        </span>
      </div>
    </main>
  );
}

function QuickRow({
  account,
  index,
  selected,
  onHover,
  onPick,
}: {
  account: AccountData;
  index: number;
  selected: boolean;
  onHover: () => void;
  onPick: (account: AccountData, code: string) => Promise<void>;
}) {
  const { code, remaining, period } = useOtpCode(account);
  const isLow = account.type === "totp" && remaining <= 5;
  const progress = account.type === "totp" ? Math.max(0, Math.min(1, remaining / period)) : 1;
  const initial = (account.issuer || account.name || "?").trim().charAt(0).toUpperCase();

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-row-index={index}
      data-code={code}
      onClick={() => void onPick(account, code)}
      onMouseEnter={onHover}
      className={`flex h-14 w-full items-center gap-3 px-4 text-left transition-colors active:bg-surface-active ${selected ? "bg-surface-hover" : "hover:bg-surface"}`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${selected ? "bg-accent text-accent-fg" : "bg-accent-subtle text-accent"}`} aria-hidden="true">
        {initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-fg">{account.issuer || account.name}</span>
        {account.issuer && <span className="truncate text-[11px] text-fg-faint">{account.name}</span>}
      </span>
      <span className={`font-mono text-[22px] font-semibold tracking-[0.06em] ${isLow ? "text-timer-low" : selected ? "text-accent" : "text-fg"}`}>
        {formatCode(code)}
      </span>
      {account.type === "totp" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-label={`剩余 ${Math.ceil(remaining)} 秒`}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--color-border)" strokeWidth="2" />
          <circle className={`timer-ring ${remaining === period ? "timer-reset" : ""}`} cx="8" cy="8" r="6.5" fill="none" stroke={isLow ? "var(--color-timer-low)" : "var(--color-accent)"} strokeWidth="2" strokeLinecap="round" strokeDasharray={2 * Math.PI * 6.5} style={{ strokeDashoffset: 2 * Math.PI * 6.5 * (1 - progress) }} transform="rotate(-90 8 8)" />
        </svg>
      ) : (
        <span className="text-[10px] text-fg-faint">#{account.counter}</span>
      )}
    </button>
  );
}

function QuickEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <main className="flex h-screen flex-col items-center justify-center bg-bg px-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-subtle text-accent" aria-hidden="true"><Search size={19} /></span>
      <h1 className="mt-4 text-[14px] font-semibold text-fg">{title}</h1>
      <p className="mt-1.5 text-[12px] text-fg-muted">{hint}</p>
    </main>
  );
}
