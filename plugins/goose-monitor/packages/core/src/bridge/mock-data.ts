/* 浏览器预览用的假数据，来自设计稿 shared.jsx 的 APPS / SYS。
   让 UI 在没有任何原生后端时也能完整跑、可"假关闭"。

   关键：数据是"活的"——每次 tick() 围绕基线做有界随机游走，
   CPU 抖动较大、内存缓慢漂移。id 始终稳定（增量渲染靠 id 复用 DOM），
   这样浏览器预览能真实验证「轮询刷新不闪烁」与所有交互闭环。 */
import type { AppRow, CategoryId, Helper } from "../types";

// 每个进程的基线（围绕它游走），以及当前值。基线让数值长期稳定、不漂走。
interface Seed {
  id: string; name: string; monogram: string;
  pid: number; path: string; sys?: boolean; systemOwned?: boolean; visible?: boolean;
  cpuBase: number; memBase: number;
  helpers: Array<{ name: string; role: string; pid: number; cpuBase: number; memBase: number; ports?: number[] }>;
  ports?: number[];
}

const APP_SEEDS: Seed[] = [
  {
    id: "chrome", name: "Google Chrome", monogram: "C", visible: true,
    pid: 1287, path: "/Applications/Google Chrome.app", cpuBase: 23.4, memBase: 2470,
    helpers: [
      { name: "Google Chrome", role: "主进程", pid: 1287, cpuBase: 4.2, memBase: 412 },
      { name: "Chrome Helper (GPU)", role: "GPU", pid: 1301, cpuBase: 6.1, memBase: 388 },
      { name: "Chrome Helper (Renderer)", role: "标签页 ×9", pid: 1322, cpuBase: 11.8, memBase: 1480 },
      { name: "Chrome Helper", role: "网络服务", pid: 1340, cpuBase: 1.3, memBase: 190 },
    ],
  },
  {
    id: "code", name: "Visual Studio Code", monogram: "VS", visible: true,
    pid: 980, path: "/Applications/Visual Studio Code.app", cpuBase: 11.2, memBase: 1180,
    helpers: [
      { name: "Code", role: "主进程", pid: 980, cpuBase: 2.1, memBase: 260 },
      { name: "Code Helper (Renderer)", role: "窗口 ×2", pid: 991, cpuBase: 5.4, memBase: 540 },
      { name: "Code Helper (Plugin)", role: "扩展宿主", pid: 1004, cpuBase: 2.9, memBase: 300 },
      { name: "Code Helper (GPU)", role: "GPU", pid: 1010, cpuBase: 0.8, memBase: 80 },
    ],
  },
  { id: "figma", name: "Figma", monogram: "Fg", pid: 1455, path: "/Applications/Figma.app", visible: true, cpuBase: 6.8, memBase: 1040, helpers: [] },
  { id: "wechat", name: "微信", monogram: "微", pid: 1500, path: "/Applications/WeChat.app", visible: true, cpuBase: 1.8, memBase: 884, helpers: [] },
  { id: "slack", name: "Slack", monogram: "Sl", pid: 1622, path: "/Applications/Slack.app", cpuBase: 4.1, memBase: 845, helpers: [] },
  { id: "qq", name: "QQ", monogram: "Q", pid: 1700, path: "/Applications/QQ.app", cpuBase: 1.1, memBase: 562, helpers: [] },
  { id: "docker", name: "Docker Desktop", monogram: "Dk", pid: 760, path: "/Applications/Docker.app", cpuBase: 8.9, memBase: 1640, helpers: [] },
  { id: "netease", name: "网易云音乐", monogram: "云", pid: 1950, path: "/Applications/NeteaseMusic.app", cpuBase: 0.9, memBase: 430, helpers: [] },
  { id: "spotify", name: "Spotify", monogram: "Sp", pid: 2010, path: "/Applications/Spotify.app", cpuBase: 1.2, memBase: 412, helpers: [] },
  { id: "notion", name: "Notion", monogram: "N", pid: 1890, path: "/Applications/Notion.app", cpuBase: 2.0, memBase: 690, helpers: [] },
  { id: "iterm", name: "iTerm2", monogram: "iT", pid: 540, path: "/Applications/iTerm.app", cpuBase: 2.3, memBase: 230, helpers: [] },
  { id: "music", name: "Music", monogram: "M", pid: 2240, path: "/System/Applications/Music.app", systemOwned: true, cpuBase: 0.6, memBase: 318, helpers: [] },
  { id: "finder", name: "Finder", monogram: "Fi", pid: 312, path: "/System/Library/CoreServices/Finder.app", systemOwned: true, cpuBase: 0.4, memBase: 180, helpers: [] },
];

const SYS_SEEDS: Seed[] = [
  { id: "kernel", name: "kernel_task", monogram: "K", pid: 0, path: "/System", sys: true, cpuBase: 6.4, memBase: 1820, helpers: [] },
  { id: "wsd", name: "WindowServer", monogram: "W", pid: 142, path: "/System/Library/.../WindowServer", sys: true, cpuBase: 5.1, memBase: 980, helpers: [] },
  { id: "mds", name: "mds_stores", monogram: "m", pid: 388, path: "/System/Library/.../mds_stores", sys: true, cpuBase: 1.8, memBase: 240, helpers: [] },
  { id: "node", name: "node (vite)", monogram: "nd", pid: 4821, path: "~/dev/app/node_modules/.bin/vite", sys: true, cpuBase: 3.2, memBase: 410, ports: [5173, 24678], helpers: [] },
  { id: "pg", name: "postgres", monogram: "Pg", pid: 690, path: "/opt/homebrew/.../postgres", sys: true, cpuBase: 0.7, memBase: 256, ports: [5432], helpers: [] },
  { id: "ssh", name: "sshd", monogram: "ss", pid: 901, path: "/usr/sbin/sshd", sys: true, cpuBase: 0.1, memBase: 36, helpers: [] },
];

// 围绕基线的有界随机游走：cpu 抖动 ±35% 基线、内存 ±4%；非负、CPU 封顶 99。
function jitter(base: number, ratio: number, max: number): number {
  const delta = base * ratio * (Math.random() * 2 - 1);
  return Math.max(0, Math.min(max, base + delta));
}

function buildRow(seed: Seed): AppRow {
  const helpers: Helper[] = seed.helpers.map((h) => ({
    name: h.name, role: h.role, pid: h.pid, ports: h.ports,
    cpu: +jitter(h.cpuBase, 0.35, 99).toFixed(1),
    mem: Math.round(jitter(h.memBase, 0.04, 1e9)),
  }));
  // 有 helper 时聚合值 = helper 之和（与真实合并语义一致）；否则单进程自身游走。
  const cpu = helpers.length
    ? +helpers.reduce((a, h) => a + h.cpu, 0).toFixed(1)
    : +jitter(seed.cpuBase, 0.35, 99).toFixed(1);
  const mem = helpers.length
    ? helpers.reduce((a, h) => a + h.mem, 0)
    : Math.round(jitter(seed.memBase, 0.04, 1e9));
  const procs = helpers.length || 1;
  return {
    id: seed.id, identity: `mock:${seed.id}`, snapshotToken: `mock-snapshot:${seed.id}`,
    name: seed.name, monogram: seed.monogram,
    procs, cpu, mem, pid: seed.pid, path: seed.path, helpers,
    sys: seed.sys, systemOwned: seed.systemOwned || seed.sys,
    allPids: [seed.pid, ...helpers.map((h) => h.pid)],
    ports: seed.ports,
  };
}

// 每次调用都生成一份新的、带抖动的快照（已被 kill 的不再出现）。
function snapshot(killed: Set<string>): { apps: AppRow[]; sys: AppRow[] } {
  return {
    apps: APP_SEEDS.filter((s) => !killed.has(s.id)).map(buildRow),
    sys: SYS_SEEDS.filter((s) => !killed.has(s.id)).map(buildRow),
  };
}

function pickCategory(cat: CategoryId, apps: AppRow[], sys: AppRow[]): AppRow[] {
  if (cat === "cpu") return [...apps, ...sys];
  if (cat === "mem") return [...apps, ...sys];
  if (cat === "all") return [...apps, ...sys];
  if (cat === "net" || cat === "gui") return apps;
  if (cat === "bg") return sys;
  return apps;
}

export function mockGuiPids(killed: Set<string>): number[] {
  return APP_SEEDS.filter((seed) => seed.visible && !killed.has(seed.id)).map((seed) => seed.pid);
}

export function mockNetworkSnapshot(killed: Set<string>): import("../types").NetworkSnapshot {
  const { apps, sys } = snapshot(killed);
  const rows = [...apps, ...sys].slice(0, 6);
  return {
    status: "supported",
    sampledAt: Date.now(),
    windowMs: 1000,
    apps: rows.map((app, index) => ({
      app,
      activePids: (app.allPids || [app.pid]).slice(0, 2),
      downloadBps: index === 2 ? 0 : 920 + index * 184_320,
      uploadBps: index === 4 ? 0 : 340 + index * 31_744,
    })),
  };
}

// 一次性生成「同一份快照」下的分类列表 + 系统资源，保证资源条与列表数据自洽
// （否则 list 与 stats 各取一份独立 jitter，求和对不上，干扰预览验证）。
export function tickSnapshot(cat: CategoryId, killed: Set<string>): {
  list: AppRow[]; cpu: number; memUsed: number;
} {
  const { apps, sys } = snapshot(killed);
  const all = [...apps, ...sys];
  return {
    list: pickCategory(cat, apps, sys),
    cpu: Math.min(100, all.reduce((a, x) => a + x.cpu, 0)),
    memUsed: all.reduce((a, x) => a + x.mem, 0),
  };
}
