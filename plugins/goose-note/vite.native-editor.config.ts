import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import postcss from "postcss";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(root, "dist-native-editor");
const tokenPath = path.resolve(
  process.env.GOOSE_NATIVE_EDITOR_TOKENS
    ?? path.resolve(root, "../super-note/Design/tokens.json"),
);

if (!existsSync(tokenPath)) {
  throw new Error(
    `缺少原生编辑器设计令牌：${tokenPath}\n`
      + "请设置 GOOSE_NATIVE_EDITOR_TOKENS 指向 consumer 的 Design/tokens.json。",
  );
}

const tokenSource = readFileSync(tokenPath, "utf8");
const tokens = JSON.parse(tokenSource) as {
  color: Record<string, { light: string; dark: string }>;
  space: Record<string, number>;
  radius: Record<string, number>;
  layer: Record<string, number>;
  font: Record<string, string>;
  motion: Record<string, number>;
  typography: Record<string, number>;
};

function kebab(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function cssRem(value: number) {
  return `${Number((value / 16).toFixed(4))}rem`;
}

function hexToHsl(hex: string) {
  const normalized = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`设计令牌不是六位十六进制颜色：${hex}`);
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return `${Number(hue.toFixed(2))} ${Number((saturation * 100).toFixed(2))}% ${Number((lightness * 100).toFixed(2))}%`;
}

function color(name: string, mode: "light" | "dark") {
  const value = tokens.color[name]?.[mode];
  if (!value) throw new Error(`设计令牌缺少 color.${name}.${mode}`);
  return value;
}

function nativeColorAliases(mode: "light" | "dark") {
  const value = (name: string) => color(name, mode);
  const channel = (name: string) => hexToHsl(value(name));
  const primaryForeground = mode === "light" ? "0 0% 100%" : channel("canvas");
  return [
    `  --background: ${channel("canvas")};`,
    `  --foreground: ${channel("textPrimary")};`,
    `  --card: ${channel("surfaceRaised")};`,
    `  --card-foreground: ${channel("textPrimary")};`,
    `  --popover: ${channel("surfaceRaised")};`,
    `  --popover-foreground: ${channel("textPrimary")};`,
    `  --primary: ${channel("accent")};`,
    `  --primary-foreground: ${primaryForeground};`,
    `  --secondary: ${channel("surfaceMuted")};`,
    `  --secondary-foreground: ${channel("textPrimary")};`,
    `  --muted: ${channel("surfaceMuted")};`,
    `  --muted-foreground: ${channel("textSecondary")};`,
    `  --accent: ${channel("surfaceMuted")};`,
    `  --accent-foreground: ${channel("textPrimary")};`,
    `  --destructive: ${channel("destructive")};`,
    `  --destructive-foreground: ${primaryForeground};`,
    `  --border: ${channel("separator")};`,
    `  --input: ${channel("separator")};`,
    `  --ring: ${channel("focus")};`,
    `  --goose-shell-bg: ${channel("canvas")};`,
    `  --goose-editor-bg: ${channel("canvas")};`,
    `  --goose-selected-bg: ${channel("surfaceMuted")};`,
    `  --goose-nav-title: ${channel("textSecondary")};`,
    `  --goose-interactive-hover: color-mix(in srgb, ${value("surfaceMuted")} 72%, ${value("canvas")});`,
    `  --goose-interactive-selected: ${value("surfaceMuted")};`,
    "  --goose-interactive-selected-border: transparent;",
    `  --goose-icon-chip-on-selected: color-mix(in srgb, ${value("surfaceMuted")} 82%, ${value("textPrimary")});`,
    `  --goose-block-subtle-bg: color-mix(in srgb, ${value("surfaceMuted")} 68%, ${value("canvas")});`,
    `  --goose-block-subtle-border: ${value("separator")};`,
    `  --goose-block-subtle-hover: ${value("surfaceMuted")};`,
    `  --goose-block-subtle-inset: color-mix(in srgb, ${value("surfaceMuted")} 45%, ${value("canvas")});`,
    `  --goose-callout-accent: ${value("textSecondary")};`,
    `  --goose-callout-bg: color-mix(in srgb, ${value("surfaceMuted")} 52%, ${value("canvas")});`,
    `  --goose-callout-border: ${value("separator")};`,
    `  --goose-inline-code-bg: ${value("surfaceMuted")};`,
    `  --goose-inline-code-fg: ${value("destructive")};`,
    `  --goose-inline-code-border-hover: ${value("separator")};`,
    `  --goose-color-danger: ${value("destructive")};`,
    `  --goose-color-danger-hover: ${value("destructive")};`,
    `  --goose-color-danger-subtle-bg: color-mix(in srgb, ${value("destructive")} 12%, ${value("canvas")});`,
    `  --goose-color-danger-focus: ${value("destructive")};`,
    `  --goose-color-favorite: ${value("warning")};`,
    `  --goose-color-unsaved: ${value("warning")};`,
    `  --goose-color-success: ${value("success")};`,
    `  --goose-color-lock-bg: ${value("accentMuted")};`,
    `  --goose-color-lock-text: ${value("textPrimary")};`,
    `  --goose-color-restore-hover: ${value("warning")};`,
    `  --goose-color-capture-hint: ${value("destructive")};`,
    "  --workspace-drag-line-color: hsl(var(--primary));",
    "  --workspace-drag-line-glow: 0 0 8px hsl(var(--primary) / 0.35);",
  ].join("\n");
}

function generatedTokenCSS() {
  const lightColors = Object.entries(tokens.color)
    .map(([name, value]) => `  --color-${kebab(name)}: ${value.light};`)
    .join("\n");
  const darkColors = Object.entries(tokens.color)
    .map(([name, value]) => `  --color-${kebab(name)}: ${value.dark};`)
    .join("\n");
  const scalars = [
    ...Object.entries(tokens.space).map(([name, value]) => `  --space-${kebab(name)}: ${value}px;`),
    ...Object.entries(tokens.radius).map(([name, value]) => `  --radius-${kebab(name)}: ${value}px;`),
    ...Object.entries(tokens.layer).map(([name, value]) => `  --layer-${kebab(name)}: ${value};`),
    ...Object.entries(tokens.font).map(([name, value]) => `  --font-${kebab(name)}: ${value};`),
    ...Object.entries(tokens.font).map(([name, value]) => `  --consumer-font-${kebab(name)}: ${value};`),
    ...Object.entries(tokens.motion).map(([name, value]) => `  --motion-${kebab(name)}: ${value}ms;`),
    ...Object.entries(tokens.typography).map(([name, value]) => {
      const unitless = name.endsWith("LineHeight") || name === "lineHeight";
      if (unitless) return `  --type-${kebab(name)}: ${value};`;
      if (name === "measure") return `  --type-${kebab(name)}: ${value}ch;`;
      return `  --type-${kebab(name)}: ${cssRem(value)};`;
    }),
    `  --font-default: ${tokens.font.sans};`,
    `  --radius: ${tokens.radius.medium}px;`,
    `  --radius-notion-slash: ${tokens.radius.large + 4}px;`,
    `  --radius-notion-slash-item: ${tokens.radius.medium + 2}px;`,
    `  --radius-notion-slash-icon: ${tokens.radius.medium}px;`,
  ].join("\n");
  return `:root, .light, [data-theme="light"] {\n${lightColors}\n${scalars}\n${nativeColorAliases("light")}\n}\n.dark, [data-theme="dark"] {\n${darkColors}\n${nativeColorAliases("dark")}\n}\n`;
}

function tokenPlugin(): Plugin {
  const publicID = "virtual:native-editor-tokens.css";
  const internalID = `\0${publicID}`;
  return {
    name: "native-editor-consumer-tokens",
    resolveId(id) {
      return id === publicID ? internalID : null;
    },
    load(id) {
      return id === internalID ? generatedTokenCSS() : null;
    },
  };
}

function classicLocalHTMLPlugin(): Plugin {
  return {
    name: "native-editor-classic-local-html",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html
          .replace(/<script type="module" crossorigin/g, "<script defer")
          .replace(/<script type="module"/g, "<script defer")
          .replace(/ rel="stylesheet" crossorigin/g, " rel=\"stylesheet\"");
      },
    },
  };
}

function editorOnlyCSSPlugin(): Plugin {
  return {
    name: "native-editor-only-css",
    enforce: "pre",
    transform(code, id) {
      const cleanID = id.replace(/\?.*$/, "").replaceAll("\\", "/");
      if (!cleanID.endsWith("/src/pages/workspace/styles/editor-base.css")) return null;
      const rootNode = postcss.parse(code, { from: cleanID });
      rootNode.walkComments((comment) => comment.remove());
      rootNode.walkRules((rule) => {
        const selectors = rule.selectors.filter((selector) => (
          !/quicknote|utools|data-ai/i.test(selector)
        ));
        if (selectors.length === 0) rule.remove();
        else rule.selectors = selectors;
      });
      return { code: rootNode.toString(), map: null };
    },
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "asset" || !item.fileName.endsWith(".css")) continue;
        const rootNode = postcss.parse(String(item.source));
        rootNode.walkComments((comment) => comment.remove());
        rootNode.walkRules((rule) => {
          const selectors = rule.selectors.filter((selector) => (
            !/quicknote|utools|data-ai/i.test(selector)
          ));
          if (selectors.length === 0) rule.remove();
          else rule.selectors = selectors;
        });
        item.source = rootNode.toString();
      }
    },
  };
}

function normalizeModuleID(id: string) {
  const clean = id.replace(/\?.*$/, "").replaceAll("\\", "/");
  const packageMatch = clean.match(/\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
  if (packageMatch) return `package:${packageMatch[1]}`;
  const sourceRoot = `${root.replaceAll("\\", "/")}/`;
  if (clean.startsWith(sourceRoot)) return clean.slice(sourceRoot.length);
  if (clean.startsWith("\0")) return `virtual:${clean.slice(1)}`;
  return null;
}

function listArtifactFiles(directory: string, relative = ""): string[] {
  return readdirSync(path.join(directory, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const next = path.posix.join(relative, entry.name);
      return entry.isDirectory() ? listArtifactFiles(directory, next) : [next];
    });
}

function artifactHash(directory: string) {
  const hash = createHash("sha256");
  for (const relativePath of listArtifactFiles(directory)
    .filter((file) => file !== "editor-manifest.json")
    .sort()) {
    const absolutePath = path.join(directory, relativePath);
    if (!statSync(absolutePath).isFile()) continue;
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function artifactPlugin(): Plugin {
  let modules: string[] = [];
  return {
    name: "native-editor-artifact",
    generateBundle() {
      modules = [...new Set(
        [...this.getModuleIds()]
          .map(normalizeModuleID)
          .filter((value): value is string => Boolean(value)),
      )].sort();
      this.emitFile({
        type: "asset",
        fileName: "editor-inputs.json",
        source: `${JSON.stringify({ target: "native-editor", modules }, null, 2)}\n`,
      });
    },
    closeBundle() {
      const generatedHTML = path.join(outputDirectory, "native-editor.html");
      const entryHTML = path.join(outputDirectory, "index.html");
      if (existsSync(generatedHTML)) renameSync(generatedHTML, entryHTML);
      const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      const dirty = execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim().length > 0;
      const manifest = {
        artifactVersion: 1,
        bridgeProtocolVersion: 1,
        target: "native-editor",
        entry: "index.html",
        handler: "gooseNotes",
        gitCommit,
        dirty,
        tokensHash: `sha256:${createHash("sha256").update(tokenSource).digest("hex")}`,
        capabilities: {
          markdown: true,
          openExternalLink: true,
          localResource: true,
          localAsset: true,
          saveAck: true,
          flush: true,
          ai: true,
          utools: false,
          quicknote: false,
          network: false,
        },
        contentHash: artifactHash(outputDirectory),
      };
      writeFileSync(
        path.join(outputDirectory, "editor-manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  };
}

const aliases = [
  ["^@/components/editor/toolbars/formatting$", "./src/native-editor/NativeFormattingToolbar.tsx"],
  ["^@/components/editor/state/formattingToolbarAi$", "./src/native-editor/formattingToolbarAiStub.ts"],
  ["^@/components/editor/menus/EditorContextMenu$", "./src/native-editor/NativeEditorContextMenu.tsx"],
  ["^@/pages/workspace/components/page/LocalFileTitle$", "./src/native-editor/LocalFileTitleStub.tsx"],
  ["^@/lib/fileStorage$", "./src/native-editor/fileStorage.ts"],
  ["^@/lib/videoStorage$", "./src/native-editor/videoStorage.ts"],
  ["^@/lib/videoProcessor$", "./src/native-editor/videoProcessor.ts"],
  ["^@/lib/openExternalUrl$", "./src/native-editor/openExternalUrl.ts"],
  ["^@/lib/imageExport/mermaid$", "./src/native-editor/nativeMermaid.ts"],
  ["^@/components/ui/input$", "./src/native-editor/NativeInput.tsx"],
  ["^@/components/editor/ai/transport/blocknoteAITransport$", "./src/native-editor/aiTransportStub.ts"],
  ["^@/components/editor/ai/GooseAIMenu$", "./src/native-editor/GooseAIMenuStub.tsx"],
  ["^@blocknote/xl-ai/locales$", "./src/native-editor/blocknoteAiStub.tsx"],
  ["^@blocknote/xl-ai$", "./src/native-editor/blocknoteAiStub.tsx"],
].map(([find, replacement]) => ({
  find: new RegExp(find),
  replacement: path.resolve(root, replacement),
}));

export default defineConfig({
  root,
  base: "./",
  publicDir: false,
  define: {
    __HOST_TARGET__: JSON.stringify("native-editor"),
    __GOOSE_LITE__: "false",
    __GOOSE_EDITOR_COMPACT__: "false",
    __GOOSE_EDITOR_AI__: "false",
    "import.meta": "{}",
  },
  plugins: [
    tokenPlugin(),
    react(),
    AutoImport({
      imports: [
        "react",
        {
          "lucide-react": [["*", "LucideIcons"]],
          clsx: ["clsx"],
        },
      ],
      dts: false,
      dirs: [
        "src/hooks",
        "src/lib",
        "src/components/ui",
        "src/components/editor/utils",
        "!src/components/editor/utils/cn.ts",
        "src/components/editor/hooks",
        "src/components/editor/state",
      ],
    }),
    editorOnlyCSSPlugin(),
    classicLocalHTMLPlugin(),
    artifactPlugin(),
  ],
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@blocknote/core",
      "@blocknote/react",
      "@blocknote/mantine",
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-transform",
      "prosemirror-view",
      "prosemirror-tables",
    ],
    alias: [
      ...aliases,
      { find: "@", replacement: path.resolve(root, "src") },
    ],
  },
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    minify: true,
    reportCompressedSize: false,
    rollupOptions: {
      input: path.resolve(root, "native-editor.html"),
      output: {
        format: "iife",
        entryFileNames: "assets/editor.js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
