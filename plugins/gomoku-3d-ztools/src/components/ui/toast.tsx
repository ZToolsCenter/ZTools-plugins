import * as React from "react";
import { useTranslation } from "react-i18next";

export interface ToastItem {
  id: number;
  title: string;
  desc?: string;
  icon?: React.ReactNode;
  toneClass?: string;
}

interface ToasterProps {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}

export function Toaster({ items, onDismiss }: ToasterProps) {
  const { t: tr } = useTranslation();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-white/60 bg-white/85 px-4 py-3 shadow-[var(--shadow-float)] backdrop-blur-md animate-in fade-in slide-in-from-top-4 zoom-in-95 duration-300"
        >
          {t.icon && (
            <span
              className={
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
                (t.toneClass ?? "bg-orange-100 text-orange-600")
              }
            >
              {t.icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-stone-800">
              {t.title}
            </div>
            {t.desc && (
              <div className="truncate text-xs text-stone-500">{t.desc}</div>
            )}
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            aria-label={tr("toast.close")}
            className="shrink-0 rounded-full p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
