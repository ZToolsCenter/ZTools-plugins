import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHOW_PID_PREF_KEY,
  SHOW_PORTS_PREF_KEY,
  persistBool,
  restoreBool,
  restoreDisplayPrefs,
  portsVisibleOnPage,
} from "./settings";

const settings = readFileSync(resolve(import.meta.dir, "settings.ts"), "utf8");
const main = readFileSync(resolve(import.meta.dir, "main.ts"), "utf8");
const css = readFileSync(resolve(import.meta.dir, "../styles/app.css"), "utf8");

describe("显示偏好", () => {
  test("默认关 PID、开服务端口", () => {
    expect(SHOW_PID_PREF_KEY).toBe("pk_show_pid");
    expect(SHOW_PORTS_PREF_KEY).toBe("pk_show_ports");
    expect(restoreDisplayPrefs(null, null)).toEqual({ showPid: false, showPorts: true });
    expect(restoreBool("1", false)).toBe(true);
    expect(restoreBool("0", true)).toBe(false);
    expect(persistBool(true)).toBe("1");
    expect(portsVisibleOnPage(true, "all")).toBe(true);
    expect(portsVisibleOnPage(true, "gui")).toBe(false);
    expect(portsVisibleOnPage(false, "all")).toBe(false);
  });

  test("设置是独立整页，竖排两项开关", () => {
    expect(settings).toContain("显示 PID");
    expect(settings).toContain("显示服务端口");
    expect(settings).toContain("Java、Go、Node、Vite、Bun、Python");
    expect(settings).toContain("pk-settings-page");
    expect(settings).toContain('role: "switch"');
    expect(main).toContain("pk-settings-btn");
    expect(main).toContain('page: "list" | "settings"');
    expect(css).toContain(".pk-settings-page");
    expect(css).toContain(".pk-setting-row");
    expect(css).toContain("flex-direction: column");
  });
});
