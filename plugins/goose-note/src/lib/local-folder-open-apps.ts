export type LocalFolderOpenAppKind = "file-manager" | "editor" | "terminal";

export interface LocalFolderOpenAppCandidate {
  id: string;
  label: string;
  appName: string;
  aliases?: string[];
  commands?: string[];
  kind: LocalFolderOpenAppKind;
}

export const LOCAL_FOLDER_FILE_MANAGER_CANDIDATES: LocalFolderOpenAppCandidate[] = [
  {
    id: "finder",
    label: "访达",
    appName: "Finder",
    aliases: ["Finder"],
    kind: "file-manager",
  },
  {
    id: "path-finder",
    label: "Path Finder",
    appName: "Path Finder",
    kind: "file-manager",
  },
  {
    id: "forklift",
    label: "ForkLift",
    appName: "ForkLift",
    kind: "file-manager",
  },
  {
    id: "commander-one",
    label: "Commander One",
    appName: "Commander One",
    kind: "file-manager",
  },
];

export const LOCAL_FOLDER_EDITOR_CANDIDATES: LocalFolderOpenAppCandidate[] = [
  { id: "cursor", label: "Cursor", appName: "Cursor", commands: ["cursor"], kind: "editor" },
  { id: "trae", label: "Trae", appName: "Trae", commands: ["trae"], kind: "editor" },
  { id: "zed", label: "Zed", appName: "Zed", commands: ["zed"], kind: "editor" },
  {
    id: "vscode",
    label: "Visual Studio Code",
    appName: "Visual Studio Code",
    aliases: ["Code"],
    commands: ["code"],
    kind: "editor",
  },
  { id: "windsurf", label: "Windsurf", appName: "Windsurf", commands: ["windsurf"], kind: "editor" },
  { id: "typora", label: "Typora", appName: "Typora", commands: ["typora"], kind: "editor" },
  { id: "obsidian", label: "Obsidian", appName: "Obsidian", kind: "editor" },
  { id: "sublime-text", label: "Sublime Text", appName: "Sublime Text", aliases: ["Sublime Text 2"], commands: ["subl"], kind: "editor" },
  { id: "vscodium", label: "VSCodium", appName: "VSCodium", commands: ["codium"], kind: "editor" },
  { id: "coteditor", label: "CotEditor", appName: "CotEditor", kind: "editor" },
  { id: "bbedit", label: "BBEdit", appName: "BBEdit", commands: ["bbedit"], kind: "editor" },
  { id: "textmate", label: "TextMate", appName: "TextMate", commands: ["mate"], kind: "editor" },
  { id: "nova", label: "Nova", appName: "Nova", kind: "editor" },
  { id: "webstorm", label: "WebStorm", appName: "WebStorm", aliases: ["JetBrains WebStorm"], kind: "editor" },
  { id: "intellij-idea", label: "IntelliJ IDEA", appName: "IntelliJ IDEA", aliases: ["IntelliJ IDEA Ultimate", "IntelliJ IDEA CE"], kind: "editor" },
  { id: "pycharm", label: "PyCharm", appName: "PyCharm", aliases: ["PyCharm Professional", "PyCharm CE"], kind: "editor" },
  { id: "goland", label: "GoLand", appName: "GoLand", kind: "editor" },
  { id: "phpstorm", label: "PhpStorm", appName: "PhpStorm", kind: "editor" },
  { id: "rubymine", label: "RubyMine", appName: "RubyMine", kind: "editor" },
  { id: "clion", label: "CLion", appName: "CLion", kind: "editor" },
  { id: "fleet", label: "Fleet", appName: "Fleet", kind: "editor" },
];

export const LOCAL_FOLDER_TERMINAL_CANDIDATES: LocalFolderOpenAppCandidate[] = [
  { id: "terminal", label: "终端", appName: "Terminal", aliases: ["Terminal"], kind: "terminal" },
  { id: "iterm", label: "iTerm2", appName: "iTerm", aliases: ["iTerm2"], kind: "terminal" },
  { id: "ghostty", label: "Ghostty", appName: "Ghostty", commands: ["ghostty"], kind: "terminal" },
  { id: "wezterm", label: "WezTerm", appName: "WezTerm", commands: ["wezterm"], kind: "terminal" },
  { id: "warp", label: "Warp", appName: "Warp", kind: "terminal" },
  { id: "kitty", label: "Kitty", appName: "kitty", aliases: ["Kitty"], commands: ["kitty"], kind: "terminal" },
  { id: "alacritty", label: "Alacritty", appName: "Alacritty", commands: ["alacritty"], kind: "terminal" },
  { id: "tabby", label: "Tabby", appName: "Tabby", commands: ["tabby"], kind: "terminal" },
  { id: "hyper", label: "Hyper", appName: "Hyper", commands: ["hyper"], kind: "terminal" },
  { id: "rio", label: "Rio", appName: "Rio", commands: ["rio"], kind: "terminal" },
  { id: "cmux", label: "Cmux", appName: "Cmux", commands: ["cmux"], kind: "terminal" },
  { id: "otty", label: "Otty", appName: "Otty", commands: ["otty"], kind: "terminal" },
  { id: "kero", label: "Kero", appName: "Kero", kind: "terminal" },
];

export function formatLocalFolderOpenAppName(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const lastPart = trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed;
  return lastPart.replace(/\.app$/i, "") || fallback;
}
