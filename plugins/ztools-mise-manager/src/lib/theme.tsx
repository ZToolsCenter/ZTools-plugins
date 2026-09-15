import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "ztools-mise-theme";

function getSystemDark(): boolean {
  if (window.ztools && typeof window.ztools.isDarkColors === "function") {
    return !!window.ztools.isDarkColors();
  }
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && getSystemDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function setStoredTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

/** 启动时初始化主题（render 前调用） */
export function initTheme() {
  applyTheme(getStoredTheme());
}

const THEMES: { key: Theme; label: string; icon: string }[] = [
  { key: "light", label: "浅色", icon: "☀️" },
  { key: "dark", label: "深色", icon: "🌙" },
  { key: "system", label: "跟随系统", icon: "💻" },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme());

  // 跟随系统时，系统主题变化自动生效
  useEffect(() => {
    if (theme !== "system") return;
    applyTheme("system");
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq?.addEventListener?.("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
  }, [theme]);

  const change = (t: Theme) => {
    setStoredTheme(t);
    setTheme(t);
  };

  const current = THEMES.find((t) => t.key === theme) || THEMES[2];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" title={`主题: ${current.label}`}>
          <span className="text-base leading-none">{current.icon}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.key}
            onClick={() => change(t.key)}
            className={t.key === theme ? "bg-accent text-accent-foreground" : ""}
          >
            <span>{t.icon}</span> {t.label}
            {t.key === theme && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
