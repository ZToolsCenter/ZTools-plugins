export const HOST_FONTS_CSS = `
@font-face {
  font-family: "Anthropic Sans";
  src: url("https://assets.claude.ai/Fonts/AnthropicSans-Text-Regular-Static.otf") format("opentype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Anthropic Sans";
  src: url("https://assets.claude.ai/Fonts/AnthropicSans-Text-Medium-Static.otf") format("opentype");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Anthropic Serif";
  src: url("https://assets.claude.ai/Fonts/AnthropicSerif-Text-Regular-Static.otf") format("opentype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Anthropic Serif";
  src: url("https://assets.claude.ai/Fonts/AnthropicSerif-Text-Medium-Static.otf") format("opentype");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
`;

export const HTML_THEME = {
  light: {
    colorScheme: "light",
    bgPrimary: "#ffffff",
    bgSecondary: "rgba(31,30,29,0.04)",
    bgTertiary: "#faf9f5",
    bgInverse: "#141413",
    bgGhost: "rgba(255,255,255,0)",
    bgDisabled: "rgba(255,255,255,0.5)",
    textPrimary: "#141413",
    textSecondary: "#3d3d3a",
    textTertiary: "#73726c",
    textInverse: "#ffffff",
    textGhost: "rgba(115,114,108,.5)",
    textDisabled: "rgba(20,20,19,0.5)",
    borderTertiary: "rgba(31,30,29,.15)",
    borderSecondary: "rgba(31,30,29,.3)",
    borderPrimary: "rgba(31,30,29,.4)",
    borderInverse: "rgba(255,255,255,0.3)",
    borderGhost: "rgba(31,30,29,0)",
    borderInfo: "rgba(70,130,213,1)",
    borderDanger: "rgba(167,61,57,1)",
    borderSuccess: "rgba(67,116,38,1)",
    borderWarning: "rgba(128,92,31,1)",
    borderDisabled: "rgba(31,30,29,0.1)",
    ringPrimary: "rgba(20,20,19,0.7)",
    ringSecondary: "rgba(61,61,58,0.7)",
    ringInverse: "rgba(255,255,255,0.7)",
    ringInfo: "rgba(50,102,173,0.5)",
    ringDanger: "rgba(167,61,57,0.5)",
    ringSuccess: "rgba(67,116,38,0.5)",
    ringWarning: "rgba(128,92,31,0.5)",
    bgInfo: "#d6e4f6",
    textInfo: "#3266ad",
    bgSuccess: "#e9f1dc",
    textSuccess: "#265b19",
    bgWarning: "#f6eedf",
    textWarning: "#5a4815",
    bgDanger: "#f7ecec",
    textDanger: "#7f2c28",
    purple: "#eeedfe",
    teal: "#e1f5ee",
    coral: "#faece7",
    pink: "#fbeaf0",
    blue: "#e6f1fb",
    gray: "#f1efe8",
    green: "#eaf3de",
    amber: "#faeeda",
    red: "#fcebeb",
    purpleStroke: "#534ab7",
    tealStroke: "#0f6e56",
    coralStroke: "#993c1d",
    pinkStroke: "#993556",
    blueStroke: "#185fa5",
    grayStroke: "#5f5e5a",
    greenStroke: "#3b6d11",
    amberStroke: "#854f0b",
    redStroke: "#a32d2d",
    purpleTextH: "#3c3489",
    tealTextH: "#085041",
    coralTextH: "#712b13",
    pinkTextH: "#72243e",
    blueTextH: "#0c447c",
    grayTextH: "#444441",
    greenTextH: "#27500a",
    amberTextH: "#633806",
    redTextH: "#791f1f",
    purpleTextS: "#534ab7",
    tealTextS: "#0f6e56",
    coralTextS: "#993c1d",
    pinkTextS: "#993556",
    blueTextS: "#185fa5",
    grayTextS: "#5f5e5a",
    greenTextS: "#3b6d11",
    amberTextS: "#854f0b",
    redTextS: "#a32d2d",
  },
  dark: {
    colorScheme: "dark",
    bgPrimary: "#2E2E2D",
    bgSecondary: "rgba(250,249,245,0.04)",
    bgTertiary: "#2E2E2D",
    bgInverse: "#faf9f5",
    bgGhost: "rgba(48,48,46,0)",
    bgDisabled: "rgba(48,48,46,0.5)",
    textPrimary: "#faf9f5",
    textSecondary: "#c2c0b6",
    textTertiary: "#9c9a92",
    textInverse: "#141413",
    textGhost: "rgba(156,154,146,.5)",
    textDisabled: "rgba(250,249,245,0.5)",
    borderTertiary: "rgba(222,220,209,.15)",
    borderSecondary: "rgba(222,220,209,.3)",
    borderPrimary: "rgba(222,220,209,.4)",
    borderInverse: "rgba(20,20,19,0.15)",
    borderGhost: "rgba(222,220,209,0)",
    borderInfo: "rgba(70,130,213,1)",
    borderDanger: "rgba(205,92,88,1)",
    borderSuccess: "rgba(89,145,48,1)",
    borderWarning: "rgba(168,120,41,1)",
    borderDisabled: "rgba(222,220,209,0.1)",
    ringPrimary: "rgba(250,249,245,0.7)",
    ringSecondary: "rgba(194,192,182,0.7)",
    ringInverse: "rgba(20,20,19,0.7)",
    ringInfo: "rgba(128,170,221,0.5)",
    ringDanger: "rgba(205,92,88,0.5)",
    ringSuccess: "rgba(89,145,48,0.5)",
    ringWarning: "rgba(168,120,41,0.5)",
    bgInfo: "#253e5f",
    textInfo: "#80aade",
    bgSuccess: "#1b4614",
    textSuccess: "#7ab948",
    bgWarning: "#483a0f",
    textWarning: "#d1a041",
    bgDanger: "#602a28",
    textDanger: "#ee8884",
    purple: "#6c5ff5",
    teal: "#009e79",
    coral: "#e0522e",
    pink: "#e0356e",
    blue: "#2878d8",
    gray: "#7a7875",
    green: "#58ab1e",
    amber: "#dd7c10",
    red: "#d03c3c",
    purpleStroke: "#afa9ec",
    tealStroke: "#5dcaa5",
    coralStroke: "#f0997b",
    pinkStroke: "#ed93b1",
    blueStroke: "#85b7eb",
    grayStroke: "#b4b2a9",
    greenStroke: "#97c459",
    amberStroke: "#ef9f27",
    redStroke: "#f09595",
    purpleTextH: "#cecbf6",
    tealTextH: "#9fe1cb",
    coralTextH: "#f5c4b3",
    pinkTextH: "#f4c0d1",
    blueTextH: "#b5d4f4",
    grayTextH: "#d3d1c7",
    greenTextH: "#c0dd97",
    amberTextH: "#fac775",
    redTextH: "#f7c1c1",
    purpleTextS: "#afa9ec",
    tealTextS: "#5dcaa5",
    coralTextS: "#f0997b",
    pinkTextS: "#ed93b1",
    blueTextS: "#85b7eb",
    grayTextS: "#b4b2a9",
    greenTextS: "#97c459",
    amberTextS: "#ef9f27",
    redTextS: "#f09595",
  },
} as const;

export function buildDesignSystemCss(isDark: boolean) {
  const t = isDark ? HTML_THEME.dark : HTML_THEME.light;

  const ramps = ["purple","teal","coral","pink","blue","gray","green","amber","red"] as const;
  const colorRampCss = ramps.map(name => {
    const fill = t[name];
    const stroke = t[`${name}Stroke` as keyof typeof t];
    const textH = t[`${name}TextH` as keyof typeof t];
    const textS = t[`${name}TextS` as keyof typeof t];
    return `
g.c-${name} > rect, g.c-${name} > ellipse, g.c-${name} > circle, g.c-${name} > polygon,
rect.c-${name}, ellipse.c-${name}, circle.c-${name}, polygon.c-${name} {
  fill: ${fill}; stroke: ${stroke};
}
.c-${name} > .th, .c-${name} > .t { fill: ${textH}; }
.c-${name} > .ts { fill: ${textS}; }
div.c-${name}, span.c-${name}, td.c-${name}, th.c-${name}, li.c-${name},
section.c-${name}, article.c-${name}, header.c-${name}, p.c-${name},
.bg-${name}, .ic-${name} {
  background: ${fill};
  color: ${textH};
}
.text-${name} { color: ${stroke}; }`;
  }).join("\n");

  const colorVarsCss = ramps.map(name => {
    const fill = t[name];
    const stroke = t[`${name}Stroke` as keyof typeof t];
    const textH = t[`${name}TextH` as keyof typeof t];
    return `  --c-${name}: ${fill};\n  --c-${name}-stroke: ${stroke};\n  --c-${name}-text: ${textH};`;
  }).join("\n");

  return `
:root {
  color-scheme: ${t.colorScheme};
  --font-sans: "Anthropic Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-serif: "Anthropic Serif", Georgia, "Times New Roman", serif;
  --font-mono: ui-monospace, monospace;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --font-text-xs-size: 12px;
  --font-text-sm-size: 14px;
  --font-text-md-size: 16px;
  --font-text-lg-size: 20px;
  --font-text-xs-line-height: 1.4;
  --font-text-sm-line-height: 1.4;
  --font-text-md-line-height: 1.4;
  --font-text-lg-line-height: 1.25;
  --color-background-primary: ${t.bgPrimary};
  --color-background-secondary: ${t.bgSecondary};
  --color-background-tertiary: ${t.bgTertiary};
  --color-background-inverse: ${t.bgInverse};
  --color-background-ghost: ${t.bgGhost};
  --color-background-disabled: ${t.bgDisabled};
  --color-background-info: ${t.bgInfo};
  --color-background-success: ${t.bgSuccess};
  --color-background-warning: ${t.bgWarning};
  --color-background-danger: ${t.bgDanger};
  --color-text-primary: ${t.textPrimary};
  --color-text-secondary: ${t.textSecondary};
  --color-text-tertiary: ${t.textTertiary};
  --color-text-inverse: ${t.textInverse};
  --color-text-ghost: ${t.textGhost};
  --color-text-disabled: ${t.textDisabled};
  --color-text-info: ${t.textInfo};
  --color-text-success: ${t.textSuccess};
  --color-text-warning: ${t.textWarning};
  --color-text-danger: ${t.textDanger};
  --color-border-primary: ${t.borderPrimary};
  --color-border-secondary: ${t.borderSecondary};
  --color-border-tertiary: ${t.borderTertiary};
  --color-border-inverse: ${t.borderInverse};
  --color-border-ghost: ${t.borderGhost};
  --color-border-info: ${t.borderInfo};
  --color-border-danger: ${t.borderDanger};
  --color-border-success: ${t.borderSuccess};
  --color-border-warning: ${t.borderWarning};
  --color-border-disabled: ${t.borderDisabled};
  --color-ring-primary: ${t.ringPrimary};
  --color-ring-secondary: ${t.ringSecondary};
  --color-ring-inverse: ${t.ringInverse};
  --color-ring-info: ${t.ringInfo};
  --color-ring-danger: ${t.ringDanger};
  --color-ring-success: ${t.ringSuccess};
  --color-ring-warning: ${t.ringWarning};
  --p: var(--color-text-primary);
  --s: var(--color-text-secondary);
  --t: var(--color-text-tertiary);
  --bg2: var(--color-background-secondary);
  --b: var(--color-border-secondary);
${colorVarsCss}
  --border-radius-xs: 4px;
  --border-radius-sm: 6px;
  --border-radius-md: 8px;
  --border-radius-lg: 10px;
  --border-radius-xl: 12px;
  --border-radius-full: 9999px;
  --border-width-regular: 0.5px;
  --shadow-hairline: 0 1px 2px 0 rgba(0,0,0,0.05);
  --shadow-sm: 0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
input, select, textarea, button { font-family: inherit; }
html, body {
  width: 100%;
  overflow: hidden;
  scrollbar-width: none;
}
html { background: ${t.bgPrimary} !important; }
html::-webkit-scrollbar, body::-webkit-scrollbar {
  width: 0;
  height: 0;
}
body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
  background: ${t.bgPrimary} !important;
  color: var(--color-text-primary);
  padding: 0;
  margin: 0;
  position: relative;
  overflow: hidden;
}
h1, h2, h3, h4, h5, h6 { color: var(--color-text-primary); }
h1 { font-size: 22px; font-weight: 500; }
h2 { font-size: 18px; font-weight: 500; }
h3 { font-size: 16px; font-weight: 500; }
label { font-size: 13px; color: var(--color-text-secondary); display: block; margin-bottom: 4px; }
input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), select, textarea {
  font-family: inherit;
  font-size: 16px;
  padding: 8px 12px;
  border: 0.5px solid var(--color-border-tertiary);
  border-radius: var(--border-radius-sm);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  width: 100%;
  height: 36px;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
textarea {
  height: auto;
  min-height: 80px;
  resize: vertical;
}
input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):hover, select:hover, textarea:hover {
  border-color: var(--color-border-secondary);
}
input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):focus, select:focus, textarea:focus {
  border-color: var(--color-border-info);
  box-shadow: 0 0 0 3px var(--color-background-info);
}
select { cursor: pointer; }
button {
  font-family: inherit;
  font-size: 14px;
  padding: 8px 16px;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background .15s, transform .1s;
}
button:hover { background: var(--color-background-secondary); }
button:active { background: var(--color-border-tertiary); transform: scale(0.98); }
input[type=range] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: ${isDark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.08)"};
  border: none;
  padding: 0;
  outline: none;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-background-primary);
  border: 1px solid var(--color-border-secondary);
  cursor: pointer;
  transition: border-color .15s, transform .15s;
}
input[type=range]:hover::-webkit-slider-thumb { border-color: var(--color-border-primary); transform: scale(1.1); }
input[type=range]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-background-primary);
  border: 1px solid var(--color-border-secondary);
  cursor: pointer;
}
#vis-container {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 16px clamp(4px, 1vw, 10px);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: clamp(12px, 1.9vw, 18px);
  min-width: 0;
  overflow: visible;
}
#vis-container > * {
  max-width: 100%;
  min-width: 0;
}
#vis-container > svg {
  display: block;
  margin-inline: 0;
  width: 100%;
  max-width: 100%;
  height: auto;
  overflow: visible;
}
#vis-container > :where(section, article, .viz-module, [data-viz-module]) {
  width: 100%;
  min-width: 0;
  overflow: visible;
}
#vis-container > .tab-content {
  width: 100%;
  min-width: 0;
  overflow: visible;
}
#vis-container :where(.overflow-auto, .overflow-y-auto):not([data-goose-keep-scroll]) {
  overflow-y: hidden !important;
  max-height: none !important;
  height: auto !important;
}
#vis-container :is(
  [style*="overflow:auto"],
  [style*="overflow: auto"],
  [style*="overflow:scroll"],
  [style*="overflow: scroll"],
  [style*="overflow-y:auto"],
  [style*="overflow-y: auto"],
  [style*="overflow-y:scroll"],
  [style*="overflow-y: scroll"]
):not([data-goose-keep-scroll]) {
  overflow-y: hidden !important;
  max-height: none !important;
  height: auto !important;
}
:where(
  #vis-container > section:not(.tab-content):not(.gallery):not(.tab-bar):not(.nav-pills):not(.btn-row),
  #vis-container > article:not(.tab-content):not(.gallery):not(.tab-bar):not(.nav-pills):not(.btn-row),
  #vis-container > .viz-module:not(.tab-content):not(.gallery):not(.tab-bar):not(.nav-pills):not(.btn-row),
  #vis-container > [data-viz-module]:not(.tab-content):not(.gallery):not(.tab-bar):not(.nav-pills):not(.btn-row)
) > :where(* + *) {
  margin-top: clamp(12px, 1.9vw, 18px);
}
#vis-container [data-goose-shell-root] {
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  outline: none !important;
  padding: 0 !important;
}
#vis-container > .viz-module-stack {
  width: 100%;
  min-width: 0;
  overflow: visible;
}
#vis-container > .viz-module-stack > :where(
  section + section,
  section + article,
  section + .viz-module,
  section + [data-viz-module],
  article + section,
  article + article,
  article + .viz-module,
  article + [data-viz-module],
  .viz-module + section,
  .viz-module + article,
  .viz-module + .viz-module,
  .viz-module + [data-viz-module],
  [data-viz-module] + section,
  [data-viz-module] + article,
  [data-viz-module] + .viz-module,
  [data-viz-module] + [data-viz-module]
) {
  margin-top: clamp(12px, 1.9vw, 18px);
}
#vis-container :where(svg, canvas, img, table) {
  max-width: 100%;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
thead th {
  background: transparent;
  color: var(--color-text-secondary);
  font-weight: 500;
  font-size: 12px;
  text-align: left;
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--color-border-secondary);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
tbody td {
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--color-border-tertiary);
  color: var(--color-text-primary);
  font-size: 13px;
}
tbody tr:last-child td { border-bottom: none; }
.flex { display: flex; }
.inline-flex { display: inline-flex; }
.grid { display: grid; }
.flex-col { flex-direction: column; }
.flex-row { flex-direction: row; }
.flex-wrap { flex-wrap: wrap; }
.flex-1 { flex: 1 1 0; }
.grow { flex-grow: 1; }
.shrink-0 { flex-shrink: 0; }
.basis-0 { flex-basis: 0; }
.flex-none { flex: none; }
.items-start { align-items: flex-start; }
.items-center { align-items: center; }
.items-end { align-items: flex-end; }
.justify-start { justify-content: flex-start; }
.justify-center { justify-content: center; }
.justify-end { justify-content: flex-end; }
.justify-between { justify-content: space-between; }
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.gap-4 { gap: 16px; }
.gap-6 { gap: 24px; }
.gap-8 { gap: 32px; }
.grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
.grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
.grid-cols-4 { grid-template-columns: repeat(4, 1fr); }
.p-2 { padding: 8px; }
.p-3 { padding: 12px; }
.p-4 { padding: 16px; }
.p-6 { padding: 24px; }
.px-2 { padding-left: 8px; padding-right: 8px; }
.px-3 { padding-left: 12px; padding-right: 12px; }
.px-4 { padding-left: 16px; padding-right: 16px; }
.py-2 { padding-top: 8px; padding-bottom: 8px; }
.py-3 { padding-top: 12px; padding-bottom: 12px; }
.py-4 { padding-top: 16px; padding-bottom: 16px; }
.m-0 { margin: 0; }
.mb-2 { margin-bottom: 8px; }
.mb-3 { margin-bottom: 12px; }
.mb-4 { margin-bottom: 16px; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.w-full { width: 100%; }
.max-w-full { max-width: 100%; }
.min-w-0 { min-width: 0; }
.min-h-0 { min-height: 0; }
.h-full { height: 100%; }
.min-h-screen { min-height: 100%; }
.text-sm { font-size: 12px; }
.text-base { font-size: 14px; }
.text-lg { font-size: 16px; }
.text-xl { font-size: 18px; }
.font-medium { font-weight: 500; }
.font-bold { font-weight: 500; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.text-secondary { color: var(--color-text-secondary); }
.text-tertiary { color: var(--color-text-tertiary); }
.rounded { border-radius: var(--border-radius-md); }
.rounded-lg { border-radius: var(--border-radius-lg); }
.border { border: 0.5px solid var(--color-border-secondary); }
.border-tertiary { border: 0.5px solid var(--color-border-tertiary); }
.bg-secondary { background: var(--color-background-secondary); }
.bg-info { background: var(--color-background-info); }
.text-info { color: var(--color-text-info); }
.bg-success { background: var(--color-background-success); }
.text-success { color: var(--color-text-success); }
.bg-warning { background: var(--color-background-warning); }
.text-warning { color: var(--color-text-warning); }
.bg-danger { background: var(--color-background-danger); }
.text-danger { color: var(--color-text-danger); }
.cursor-pointer { cursor: pointer; }
.overflow-hidden { overflow: hidden; }
.overflow-auto { overflow: auto; }
.overflow-x-auto { overflow-x: auto; }
.overflow-y-auto { overflow-y: auto; }
.hidden { display: none; }
.block { display: block; }
.inline-block { display: inline-block; }
.relative { position: relative; }
.absolute { position: absolute; }
.sticky { position: sticky; }
.transition { transition: all 0.15s ease; }
#vis-container h1 { font-size: 22px; font-weight: 600; line-height: 1.3; margin-bottom: 1rem; }
#vis-container h2 { font-size: 18px; font-weight: 500; margin-bottom: 0.75rem; }
#vis-container h3 { font-size: 15px; font-weight: 500; margin-bottom: 0.5rem; }
#vis-container h4, #vis-container h5, #vis-container h6 { margin-bottom: 0.4rem; }
.card > * + * { margin-top: 8px; }
.gallery { display: flex; flex-direction: column; gap: 1.5rem; padding: 0; }
.section-title { font-size: 18px; font-weight: 500; margin-bottom: 12px; color: var(--color-text-primary); }
.section-desc { font-size: 13px; color: var(--color-text-secondary); margin-bottom: 16px; line-height: 1.6; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 12px; align-items: stretch; }
.card {
  background: transparent;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-lg);
  padding: 1rem 1.125rem;
  overflow: visible;
  height: 100%;
}
.card:hover { border-color: var(--color-border-primary); }
.card-label { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px; letter-spacing: .02em; }
.card-icon {
  font-size: 24px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--border-radius-md);
}
.card-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary); margin: 0 0 4px; }
.card-sub { font-size: 11px; color: var(--color-text-secondary); line-height: 1.4; margin: 0; }
.metric-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(148px, 100%), 1fr)); gap: 12px; margin-bottom: 0; align-items: stretch; }
.metric {
  background: transparent;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  padding: 12px 16px;
  height: 100%;
}
.metric-label { font-size: 12px; color: var(--color-text-secondary); }
.metric-val { font-size: 22px; font-weight: 500; margin-top: 6px; }
.badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: var(--border-radius-md);
}
.badge-info { background: var(--color-background-info); color: var(--color-text-info); }
.badge-success { background: var(--color-background-success); color: var(--color-text-success); }
.badge-warning { background: var(--color-background-warning); color: var(--color-text-warning); }
.badge-danger { background: var(--color-background-danger); color: var(--color-text-danger); }
.tab-bar { display: flex; flex-wrap: wrap; gap: 8px; border-bottom: none; margin-bottom: 12px; }
.tab {
  padding: 8px 14px;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  border: 0.5px solid var(--color-border-tertiary);
  border-radius: var(--border-radius-full);
  background: var(--color-background-secondary);
  transition: all .2s;
}
.tab.active {
  color: var(--color-text-primary);
  border-color: var(--color-border-secondary);
  background: var(--color-background-primary);
  box-shadow: var(--shadow-sm);
  font-weight: 500;
}
.tab:hover { color: var(--color-text-primary); border-color: var(--color-border-secondary); }
.tab-content { display: none; min-width: 0; overflow: visible; }
.tab-content.active { display: flex; flex-direction: column; gap: 12px; }
.compare-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 12px; align-items: stretch; }
.compare-card {
  background: transparent;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-lg);
  padding: 16px;
  height: 100%;
}
.compare-card.featured { border: 2px solid var(--color-border-info); }
.compare-name { font-size: 16px; font-weight: 500; color: var(--color-text-primary); margin-bottom: 6px; }
.compare-price { font-size: 24px; font-weight: 500; color: var(--color-text-primary); margin-bottom: 8px; }
.compare-feat { font-size: 13px; line-height: 1.7; color: var(--color-text-secondary); }
.record { display: flex; align-items: center; gap: 12px; }
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background-info);
  color: var(--color-text-info);
  font-weight: 500;
  flex: none;
}
.record-name { font-size: 14px; font-weight: 500; color: var(--color-text-primary); }
.record-role { font-size: 12px; color: var(--color-text-secondary); margin-top: 2px; }
.nav-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.pill {
  padding: 6px 10px;
  border-radius: var(--border-radius-full);
  font-size: 12px;
  color: var(--color-text-secondary);
  border: 0.5px solid var(--color-border-tertiary);
  background: var(--color-background-secondary);
  cursor: pointer;
  transition: all .15s;
}
.pill.active {
  border-color: var(--color-border-secondary);
  background: var(--color-background-primary);
  box-shadow: var(--shadow-sm);
  color: var(--color-text-primary);
}
.btn-row { display: flex; gap: 10px; margin-top: 16px; }
.divider { border: none; border-top: 0.5px solid var(--color-border-tertiary); margin: 1.5rem 0; }
.ic-blue { background: var(--color-background-info); color: var(--color-text-info); }
.ic-green { background: var(--color-background-success); color: var(--color-text-success); }
.ic-amber { background: var(--color-background-warning); color: var(--color-text-warning); }
.ic-red { background: var(--color-background-danger); color: var(--color-text-danger); }
.ic-purple { background: ${t.purple}; color: ${t.purpleStroke}; }
.leader { stroke: var(--t); stroke-width: 0.5; stroke-dasharray: 4 3; fill: none; }
.t { font-size: 14px; fill: var(--p); }
.ts { font-size: 12px; fill: var(--s); }
.th { font-size: 14px; font-weight: 500; fill: var(--p); }
.box { fill: var(--bg2); stroke: var(--b); stroke-width: 0.5; }
.arr { stroke: var(--t); fill: none; stroke-width: 1.5; }
.node { cursor: pointer; }
.node:hover rect, .node:hover .box { filter: brightness(0.97); }
.node:hover text { opacity: 0.8; }
${colorRampCss}
svg.classDiagram,
svg.erDiagram {
  font-size: 13px;
  max-width: 100%;
  height: auto;
}
svg.classDiagram foreignObject,
svg.erDiagram foreignObject {
  overflow: visible;
}
svg.classDiagram foreignObject > div,
svg.erDiagram foreignObject > div {
  max-width: none !important;
}
svg.classDiagram .nodeLabel,
svg.erDiagram .nodeLabel,
svg.classDiagram .label foreignObject div,
svg.erDiagram .label foreignObject div {
  font-family: var(--font-sans) !important;
  font-size: 13px !important;
  font-weight: 400 !important;
  color: var(--color-text-secondary) !important;
}
svg.classDiagram .label-group .nodeLabel,
svg.erDiagram .name .nodeLabel {
  font-size: 14px !important;
  font-weight: 500 !important;
  color: var(--color-text-primary) !important;
}
svg.classDiagram .label-group .label {
  font-weight: 500 !important;
}
svg.classDiagram .edgeLabel,
svg.classDiagram .edgeLabel span,
svg.classDiagram .edgeTerminals foreignObject div,
svg.erDiagram .edgeLabel,
svg.erDiagram .edgeLabel span {
  font-size: 11px !important;
  color: var(--color-text-tertiary) !important;
}
svg.classDiagram .node path[stroke]:not([stroke="none"]),
svg.classDiagram .divider path,
svg.erDiagram .node path[stroke]:not([stroke="none"]),
svg.erDiagram .divider path {
  stroke: var(--color-border-tertiary) !important;
  stroke-width: 0.5px !important;
  fill: none !important;
}
svg.classDiagram .node .basic path[fill]:not([fill="none"]) {
  fill: var(--color-background-primary) !important;
  stroke: none !important;
  stroke-width: 0 !important;
}
svg.erDiagram .node > g:first-child > path[fill]:not([fill="none"]) {
  fill: var(--color-background-secondary) !important;
}
svg.erDiagram .row-rect-odd path[fill]:not([fill="none"]) {
  fill: var(--color-background-primary) !important;
}
svg.erDiagram .row-rect-even path[fill]:not([fill="none"]) {
  fill: var(--color-background-secondary) !important;
}
svg.erDiagram .relationshipLine,
svg.classDiagram .relation {
  stroke: var(--color-text-tertiary) !important;
  stroke-width: 1px !important;
}
svg.classDiagram .marker,
svg.classDiagram marker path,
svg.erDiagram .marker,
svg.erDiagram marker path {
  stroke: var(--color-text-tertiary) !important;
  stroke-width: 1px !important;
}
svg.classDiagram marker path[fill]:not([fill="none"]):not([fill="transparent"]),
svg.erDiagram marker path[fill]:not([fill="none"]):not([fill="transparent"]) {
  fill: var(--color-text-tertiary) !important;
}
svg.classDiagram .labelBkg,
svg.erDiagram .labelBkg {
  background-color: var(--color-background-primary) !important;
  opacity: 1 !important;
}
`;
}
