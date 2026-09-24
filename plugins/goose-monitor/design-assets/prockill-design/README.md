# ProcKill — Design System

A bilingual (中文 / EN) **process & application manager** delivered as a **uTools plugin**, with a **Tauri** shell so the same UI runs as a standalone cross-platform app (macOS / Windows / Linux).

> This is a **greenfield** design system — there was no pre-existing brand, codebase, or Figma file. Everything here was designed from scratch around the product spec below. Treat every value as a proposal open to iteration.

---

## What the product is

ProcKill is a keyboard-first "activity monitor that kills things." It lists running **GUI applications** (and, in other tabs, all processes / CPU hogs / memory hogs / network / background services), and lets the user end a process by pressing **⏎**. Its defining ideas:

- **Helper merging.** Chrome, VS Code, Slack, Electron apps etc. spawn many `*/Helper` sub-processes. ProcKill **groups them under their parent app** and sums CPU + memory, so the list reads like the apps you actually recognize — not 38 cryptic rows. A "more" affordance expands the merged breakdown (per-helper CPU / mem / PID / role).
- **Rich per-row data.** Each row shows the app **icon**, **name**, **merged process count**, **CPU %**, **memory**, **run path**, and **PID**.
- **Category rail.** A left list switches scope: `GUI 应用 / 全部进程 / CPU 占用 / 内存占用 / 网络·端口 / 后台服务`. Switchable by mouse or **⌘1–6** (Windows / Linux get their own modifier). Switching a category **auto-selects the first row**.
- **Sorting.** Top-right control sorts by memory / CPU / name / process count, asc/desc.
- **Keyboard nav.** ↑↓←→ to move, ⏎ to end the process, ⌘F to search.
- **First-kill confirm.** The first time you press ⏎, a confirmation dialog appears with a **"以后不再提醒" (don't remind again)** checkbox; once checked, future kills are immediate.

### Sources & references
- **fkill** (Sindre Sorhus) — the CLI ancestor; ProcKill is essentially a GUI, app-grouped take on it.
- **uTools** — the Chinese launcher/plugin host the plugin targets (plugin panel ≈ 800px wide).
- **Tauri** — the Rust desktop shell used to ship outside uTools.
- Visual touchstones: macOS **Activity Monitor**, **iStat Menus**, **Raycast**, **Linear**.

No proprietary assets from any of the above were copied; this system is original.

---

## Index — what's in this folder

| Path | What |
|---|---|
| `README.md` | This file — context + content & visual foundations + iconography + index |
| `colors_and_type.css` | All design tokens: color (dark+light), type scale, radii, spacing, shadows |
| `SKILL.md` | Agent-Skill manifest so this folder works as a downloadable Claude skill |
| `REVIEW.md` | Review of the 5 drafts + recommendation of which the user will likely pick |
| `5 Designs.html` | **★ Main deliverable** — the 5 drafts side-by-side on a pan/zoom canvas |
| `versions/` | The React source for each draft (`v1_table` … `v6_dialog`) + `shared.jsx` data/atoms |
| `assets/icons/` | Inlined **Lucide** UI icons (MIT) used across the system |
| `preview/` | Small HTML cards that populate the **Design System** tab |
| `ui_kits/process-manager/` | Interactive, reusable recreation of the recommended direction |

---

## CONTENT FUNDAMENTALS — how copy is written

The product is bilingual by design, and the split is **semantic, not decorative**:

- **Chinese for chrome & affordances** — labels, categories, buttons, hints: `GUI 应用`, `结束进程`, `切换分类`, `以后不再提醒`, `排序`, `进程明细`.
- **English / mono for machine data** — app names (`Google Chrome`), file paths (`/Applications/…`), PIDs (`1287`), metrics (`23.4%`, `2.41 GB`). These are quoted verbatim from the OS, so they're never translated.

Tone & rules:
- **Plain, terse, system-y.** No marketing voice, no exclamation, no emoji. The app talks like a tool: `已合并 14 进程`, `共 38 个进程`, `按内存`.
- **Address:** impersonal / imperative. We tell the user what a key does (`移动选择`, `结束进程`), we don't say "you" or "we". Confirmations are factual about consequences: `这将强制结束该应用及其合并的 14 个进程，未保存的内容可能会丢失。`
- **Numbers:** tabular, fixed precision. CPU → one decimal + `%` (`8.9%`). Memory → `MB` under 1024, else `GB` to 2 decimals (`1.60 GB`). Counts → `×14` or `14 进程`. PIDs raw.
- **Casing:** English app/product names keep their official casing (`iTerm2`, `Visual Studio Code`). Mono labels like `kill` stay lowercase.
- **Keys** are shown as keycaps (`⏎ ⌘1 Esc ␣ j k /`), never spelled out.

---

## VISUAL FOUNDATIONS

**Overall vibe:** a calm, dense, cross-platform-neutral system tool. Dark-primary, near-neutral charcoal chrome, with color reserved for *meaning* (selection, danger, and the three metric categories). Think Activity Monitor's information density with Linear's restraint and Raycast's keyboard-forward chrome.

**Color**
- Backgrounds are layered cool charcoals, not pure black: `--bg-app #121317` → `--bg-sidebar #17181C` → `--bg-panel #1B1D22` → `--bg-elev #212329`. Elevation is communicated by getting *lighter* + a 1px hairline border, not by heavy shadows.
- Text steps down in three tiers: `--fg-1 #ECEEF2` (names, numbers) → `--fg-2 #9BA1AC` (secondary) → `--fg-3 #5E636E` (paths, hints, PIDs).
- **One accent**, periwinkle blue `--accent #5B7CFA`, carries selection, focus rings, and brand. Selection is a *tint* (`rgba(accent, .16)`) plus a 2px inset left bar — never a full-saturation fill.
- **Danger red `--danger #F2555A`** is reserved exclusively for the kill action (button, confirm dialog, the skull badge). Seeing red always means "this ends a process."
- **Metric hues** give the data life without becoming a rainbow: CPU = amber `#F5B544`, memory = violet `#9B8CFF`, network = teal `#3FB6C9`. These appear only as meter fills and tiny legend dots.
- A full **light theme** mirrors every token (`[data-theme="light"]`) — same accent/danger/metric hues, inverted neutrals.

**Type**
- UI: **IBM Plex Sans** (Latin) with system **PingFang SC / Microsoft YaHei** for CJK — a deliberate bilingual pairing, not a single CJK webfont (keeps the bundle light).
- Data: **IBM Plex Mono**, `tabular-nums`, for every number, PID, and path so columns align and digits don't jitter as values tick.
- This is an **app UI at 800px**, so the scale is small-but-legible: title 17, row name 13.5, body 13, captions 11, eyebrow labels 10.5 uppercase +0.07em tracking. Nothing below 10.5px.

**Spacing & shape**
- 4pt spacing base. Radii: window 12, cards/panels 10, rows/buttons 8, chips 6, micro 4, pills 999.
- Rows are 30px (compact) → 44px (comfortable) → 56px (roomy/launcher) depending on the layout's density target.

**Backgrounds / texture:** none. Flat solid surfaces, hairline borders. No gradients on chrome (the only gradient is the subtle top-light on app-icon tiles, mimicking real macOS icons). No images, no patterns, no glassmorphism on content — blur is used *only* on the modal scrim.

**Borders & elevation:** 1px hairlines (`rgba(255,255,255,.07)`) divide regions. Cards = `--bg-elev` + hairline + a near-invisible `--shadow-card`. The only real shadow in the system is `--shadow-pop` on the confirm dialog (plus `--shadow-window` around the whole plugin frame).

**Hover / press / selection**
- Hover: a 3.8%-white wash (`--bg-row-hover`) on the row/button. No color shift, no scale.
- Selection (keyboard cursor): accent tint + 2px inset accent bar (lists/tables), or a 1.5px accent border + 3px tint ring (cards). Always clearly the "where am I" indicator.
- Press: brief darken; destructive buttons never bounce or grow.

**Motion:** minimal and fast. Category/sort changes cross-fade (~120ms). Dialog: 140ms scrim fade + subtle scale-in. Meters animate width on value change (~200ms ease-out). No springy/bouncy easing — this is a utility, motion should feel inst/precise. Easing: `cubic-bezier(.2,.7,.3,1)` for enters, linear-ish for meters.

**Transparency / blur:** used sparingly and only for the modal scrim (`rgba(8,9,12,.55)` + `blur(3px)`). Chrome surfaces are fully opaque so dense text stays crisp.

**Imagery / icon color vibe:** app icons are saturated brand-color tiles (the only vivid color in the list); UI icons are monochrome and inherit text color. No photography.

---

## ICONOGRAPHY

Two distinct icon roles:

1. **UI / system icons → Lucide (MIT), inlined.** Files live in `assets/icons/*.svg` and are injected inline (so `stroke="currentColor"` inherits the element's color for perfect tinting at any size, fully offline). Lucide's 2px-stroke, rounded-cap, 24px-grid style sets the icon language: `cpu`, `memory-stick`, `wifi`, `server`, `layout-grid`, `list`, `search`, `rotate-cw`, `arrow-down-wide-narrow`, `chevron-down/right`, `git-branch`, `check`, and `skull` (the brand/kill mark). To add an icon, import the matching Lucide SVG and add it to `versions/icons-data.js`.
   - *Substitution note:* the spec named no icon set, so Lucide was chosen as a clean, free, comprehensive match. Swap freely if you prefer Phosphor/Tabler — keep one set, 2px stroke, rounded caps.
2. **App / brand icons → robust monogram tiles.** Real third-party app logos (Chrome, Slack, Figma…) are trademarked and risky to ship, and CDN logo sets get items removed. So `AppIcon` renders a **brand-colored rounded-square tile with a 1–2 letter monogram** and a subtle top-light — reads unmistakably as "an app icon," never 404s, works offline. In a real build you'd swap these for the OS-provided icon of each running app (`.icns` / `HICON` / `.desktop` icon), which Tauri can read at runtime; the tile is the design-time placeholder.

**Emoji / unicode:** no emoji anywhere. The only unicode "icons" are keycap glyphs (`⏎ ⌘ ␣`) and the count prefix `×`, which are typographic, not decorative.
