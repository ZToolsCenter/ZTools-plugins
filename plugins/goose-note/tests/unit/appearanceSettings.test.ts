import { expect, test } from "playwright/test";
import {
  normalizeAccentColor,
  normalizeCodeStyle,
  resolveCodeTheme,
} from "../../src/stores/settings/types";
import {
  APPEARANCE_INITIAL_STATE,
  createAppearanceSlice,
} from "../../src/stores/settings/slices/appearanceSlice";
import { resolveTheme } from "../../src/hooks/useResolvedTheme";
import { migrateCodeStyleTo2026 } from "../../src/lib/code-style-migration";
import { applyAccentColor, syncAccentColorCssVars } from "../../src/lib/accentColor";

test("强调色默认使用黑白配色，非法持久化值安全回退", () => {
  expect(APPEARANCE_INITIAL_STATE.accentColor).toBe("mono");
  expect(normalizeAccentColor(undefined)).toBe("mono");
  expect(normalizeAccentColor("unknown")).toBe("mono");
  expect(normalizeAccentColor("ocean")).toBe("ocean");
  expect(normalizeAccentColor("mono")).toBe("mono");
  expect(normalizeAccentColor("teal")).toBe("mono");
  expect(normalizeAccentColor("grape")).toBe("grape");
});

test("应用强调色写入 data-goose-accent 与关键 runtime token", () => {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const classList = new Set<string>(["dark"]);
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      head: {
        appendChild: () => undefined,
      },
      getElementById: () => null,
      createElement: () => ({
        id: "",
        textContent: "",
      }),
      documentElement: {
        classList: {
          contains: (name: string) => classList.has(name),
        },
        setAttribute: (name: string, value: string) =>
          attributes.set(name, value),
        style: {
          setProperty: (name: string, value: string, _priority?: string) =>
            properties.set(name, value),
        },
      },
    },
  });

  try {
    applyAccentColor("amber");
    expect(attributes.get("data-goose-accent")).toBe("amber");
    expect(properties.get("--goose-inline-code-bg")).toBe("#4a3b24");
    expect(properties.get("--goose-inline-code-fg")).toBe("#fde68a");
    expect(properties.get("--goose-inline-code-border-hover")).toBe("#f59e0b");
    expect(properties.get("--goose-interactive-selected-fg")).toBe("#fbbf24");
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  }
});

test("应用强调色在浅色模式写入对应 light runtime token", () => {
  const properties = new Map<string, string>();
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      head: {
        appendChild: () => undefined,
      },
      getElementById: () => null,
      createElement: () => ({
        id: "",
        textContent: "",
      }),
      documentElement: {
        classList: {
          contains: () => false,
        },
        setAttribute: () => undefined,
        style: {
          setProperty: (name: string, value: string, _priority?: string) =>
            properties.set(name, value),
        },
      },
    },
  });

  try {
    applyAccentColor("amber");
    expect(properties.get("--goose-inline-code-bg")).toBe("#fffbeb");
    expect(properties.get("--goose-inline-code-fg")).toBe("#b45309");
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  }
});

test("主题 class 变化后 re-sync 会按 dark/light 重写 inline-code token", () => {
  const properties = new Map<string, string>();
  const classList = new Set<string>();
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      head: {
        appendChild: () => undefined,
      },
      getElementById: () => null,
      createElement: () => ({
        id: "",
        textContent: "",
      }),
      documentElement: {
        classList: {
          contains: (name: string) => classList.has(name),
          add: (name: string) => {
            classList.add(name);
          },
          remove: (name: string) => {
            classList.delete(name);
          },
        },
        getAttribute: () => "amber",
        setAttribute: () => undefined,
        style: {
          setProperty: (name: string, value: string, _priority?: string) =>
            properties.set(name, value),
        },
      },
    },
  });

  try {
    applyAccentColor("amber");
    expect(properties.get("--goose-inline-code-bg")).toBe("#fffbeb");
    expect(properties.get("--goose-inline-code-fg")).toBe("#b45309");

    classList.add("dark");
    syncAccentColorCssVars();
    expect(properties.get("--goose-inline-code-bg")).toBe("#4a3b24");
    expect(properties.get("--goose-inline-code-fg")).toBe("#fde68a");
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  }
});

test("GitHub 是默认且第一优先的代码风格", () => {
  expect(APPEARANCE_INITIAL_STATE.codeStyle).toBe("github");
  expect(normalizeCodeStyle("default")).toBe("github");
  expect(normalizeCodeStyle(undefined)).toBe("github");
  expect(normalizeCodeStyle("unknown")).toBe("github");
  expect(resolveCodeTheme("github", false)).toBe("github-light");
  expect(resolveCodeTheme("github", true)).toBe("github-dark");
});

test("Catppuccin 按界面明暗自动使用 Latte 和 Mocha", () => {
  expect(normalizeCodeStyle("catppuccin")).toBe("catppuccin");
  expect(resolveCodeTheme("catppuccin", false)).toBe("catppuccin-latte");
  expect(resolveCodeTheme("catppuccin", true)).toBe("catppuccin-mocha");
  expect(migrateCodeStyleTo2026("catppuccin")).toBe("catppuccin");
});

test("Dracula 使用独立设置值并按深浅模式映射", () => {
  expect(normalizeCodeStyle("dracula")).toBe("dracula");
  expect(resolveCodeTheme("dracula", true)).toBe("dracula");
  expect(resolveCodeTheme("dracula", false)).toBe("github-light-mod");
});

test("旧版 Nord 设置值仍保持兼容", () => {
  expect(normalizeCodeStyle("nord")).toBe("nord");
  expect(normalizeCodeStyle("nord-light")).toBe("nord-light");
  expect(migrateCodeStyleTo2026("nord")).toBe("nord");
  expect(migrateCodeStyleTo2026("nord-light")).toBe("nord-light");
  expect(resolveCodeTheme("nord", true)).toBe("nord");
  expect(resolveCodeTheme("nord-light", false)).toBe("nord-light");
});

test("跟随系统主题能解析系统明暗状态", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

test("主题轮转顺序为 system → light → dark → system", () => {
  expect(APPEARANCE_INITIAL_STATE.theme).toBe("system");

  let theme: "system" | "light" | "dark" = "system";
  const applied: Array<"system" | "light" | "dark"> = [];
  const slice = createAppearanceSlice(
    (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ theme } as never)
          : updater;
      if (next.theme) theme = next.theme;
    },
    () => ({
      applyTheme: (nextTheme) => {
        applied.push(nextTheme);
      },
      applyAccentColor: () => undefined,
      applyCodeStyle: () => undefined,
    }),
  );

  slice.toggleDarkMode();
  expect(theme).toBe("light");
  slice.toggleDarkMode();
  expect(theme).toBe("dark");
  slice.toggleDarkMode();
  expect(theme).toBe("system");
  expect(applied).toEqual(["light", "dark", "system"]);
});

