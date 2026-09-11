import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appIconKind } from "./atoms";
import type { AppRow } from "./types";

const atomsSource = readFileSync(resolve(import.meta.dir, "atoms.ts"), "utf8");
const tokens = readFileSync(resolve(import.meta.dir, "../styles/tokens.css"), "utf8");
const appCss = readFileSync(resolve(import.meta.dir, "../styles/app.css"), "utf8");

const row = (overrides: Partial<AppRow> = {}): AppRow => ({
  id: "app",
  identity: "app",
  snapshotToken: "snapshot",
  name: "App",
  monogram: "Ap",
  procs: 1,
  cpu: 0,
  mem: 0,
  pid: 10,
  path: "/Applications/App.app",
  helpers: [],
  allPids: [10],
  ...overrides,
});

describe("应用图标类型", () => {
  test("真实图标始终优先", () => {
    expect(appIconKind(row({ iconUrl: "data:image/png;base64,AA==", systemOwned: true }))).toBe("real");
  });

  test("系统来源使用独立系统图标", () => {
    expect(appIconKind(row({ systemOwned: true }))).toBe("system");
    expect(appIconKind(row({ sys: true }))).toBe("system");
  });

  test("普通未知进程统一使用通用应用图标", () => {
    expect(appIconKind(row({ name: "python", monogram: "py" }))).toBe("application");
    expect(appIconKind(row({ name: "rapportd", monogram: "ra" }))).toBe("application");
  });

  test("系统与普通兜底图标共享主题化的明暗令牌", () => {
    expect(atomsSource).toContain('background: "var(--app-icon-bg)"');
    expect(atomsSource).toContain('border: "1px solid var(--app-icon-border)"');
    expect(atomsSource).toContain('color: "var(--app-icon-fg)"');
    expect(tokens.match(/--app-icon-bg:/g)).toHaveLength(2);
    expect(tokens.match(/--app-icon-border:/g)).toHaveLength(2);
    expect(tokens.match(/--app-icon-fg:/g)).toHaveLength(2);
    expect(tokens.match(/--port:/g)).toHaveLength(2);
  });

  test("末列指标使用统一右边界", () => {
    expect(appCss).toContain(".pk-process-row > :last-child");
    expect(appCss).toContain(".pk-helper-row > :last-child");
    expect(appCss).toContain("justify-self: end");
  });
});
