/* 设置页：独立整页、竖排开关。偏好读写走 bridge pref。 */
import { h } from "./atoms";
import { icon } from "./icons";

export const SHOW_PID_PREF_KEY = "pk_show_pid";
export const SHOW_PORTS_PREF_KEY = "pk_show_ports";

export type DisplayPrefKey = "showPid" | "showPorts";

export interface DisplayPrefs {
  showPid: boolean;
  showPorts: boolean;
}

export function restoreBool(value: string | null, fallback: boolean): boolean {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

export function persistBool(value: boolean): string {
  return value ? "1" : "0";
}

export function restoreDisplayPrefs(pid: string | null, ports: string | null): DisplayPrefs {
  return {
    showPid: restoreBool(pid, false),
    showPorts: restoreBool(ports, true),
  };
}

/** 界面分类是窗口应用，不展示服务端口。 */
export function portsVisibleOnPage(showPorts: boolean, category: string): boolean {
  return showPorts && category !== "gui";
}

function switchControl(checked: boolean, label: string, onToggle: () => void): HTMLButtonElement {
  const thumb = h("span", { className: "pk-switch-thumb" });
  return h("button", {
    className: "pk-switch",
    attrs: {
      type: "button",
      role: "switch",
      "aria-checked": checked ? "true" : "false",
      "aria-label": label,
    },
    on: { click: onToggle },
    children: [thumb],
  }) as HTMLButtonElement;
}

function settingRow(
  title: string,
  detail: string,
  checked: boolean,
  onToggle: () => void,
): { row: HTMLElement; sw: HTMLButtonElement } {
  const sw = switchControl(checked, title, onToggle);
  const row = h("div", {
    className: "pk-setting-row",
    children: [
      h("div", {
        className: "pk-setting-copy",
        children: [
          h("div", { className: "pk-setting-title", text: title }),
          h("div", { className: "pk-setting-detail", text: detail }),
        ],
      }),
      sw,
    ],
  });
  return { row, sw };
}

export interface SettingsPageRefs {
  root: HTMLElement;
  back: HTMLButtonElement;
  pidSwitch: HTMLButtonElement;
  portsSwitch: HTMLButtonElement;
  sync(prefs: DisplayPrefs): void;
}

export function buildSettingsPage(
  prefs: DisplayPrefs,
  onBack: () => void,
  onChange: (key: DisplayPrefKey, value: boolean) => void,
): SettingsPageRefs {
  const pid = settingRow(
    "显示 PID",
    "进程号常显在名称旁，方便终端对照。",
    prefs.showPid,
    () => onChange("showPid", pid.sw.getAttribute("aria-checked") !== "true"),
  );
  const ports = settingRow(
    "显示服务端口",
    "Java、Go、Node、Vite、Bun、Python 等正在监听的端口。",
    prefs.showPorts,
    () => onChange("showPorts", ports.sw.getAttribute("aria-checked") !== "true"),
  );
  const back = h("button", {
    className: "pk-settings-back",
    attrs: { type: "button", "aria-label": "返回进程列表" },
    on: { click: onBack },
    children: [icon("chevron-left", 16, { color: "var(--fg-2)" } as any), document.createTextNode("返回")],
  }) as HTMLButtonElement;
  const header = h("header", {
    className: "pk-settings-bar",
    children: [
      back,
      h("h1", { className: "pk-settings-heading", text: "设置" }),
    ],
  });
  const list = h("div", {
    className: "pk-settings-list",
    attrs: { role: "group", "aria-label": "显示" },
    children: [
      h("div", { className: "pk-settings-label", text: "显示" }),
      pid.row,
      ports.row,
    ],
  });
  const root = h("section", {
    className: "pk-settings-page",
    attrs: { hidden: "", "aria-label": "设置" },
    children: [header, list],
  });
  return {
    root,
    back,
    pidSwitch: pid.sw,
    portsSwitch: ports.sw,
    sync(next) {
      pid.sw.setAttribute("aria-checked", next.showPid ? "true" : "false");
      ports.sw.setAttribute("aria-checked", next.showPorts ? "true" : "false");
    },
  };
}
