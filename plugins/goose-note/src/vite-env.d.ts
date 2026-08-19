/// <reference types="vite/client" />
export {}

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
}

declare global {
  const __HOST_TARGET__: "utools" | "native-editor";

  /**
   * 速记小窗（plugin B / dist-quicknote）精简构建标志。
   * GOOSE_BUILD_TARGET=quicknote 的构建里为 true（见 vite.config.ts define），
   * 编辑器据此把 math/mermaid 退化为纯代码块、隐藏代码格式化按钮，
   * 配合 alias 把 katex/mermaid/prettier 等重型依赖排除出小窗包。
   * 主应用（plugin A）构建恒为 false，行为完全不变。
   */
  const __GOOSE_LITE__: boolean;
  const __GOOSE_EDITOR_COMPACT__: boolean;

  /**
   * 编辑器 AI 能力编译开关。主笔记本为 true；速记和原生 macOS 编辑器产物为 false。
   * 与 __GOOSE_LITE__ 分离，确保原生编辑器保留数学、Mermaid、视频和代码格式化，
   * 同时不会把 AI SDK 或 AI 菜单带入生产包。
   */
  const __GOOSE_EDITOR_AI__: boolean;

  interface GooseFs {
    readDir: (dir: string) => any[];
    readDirAsync?: (dir: string) => Promise<any[]>;
    readFile: (path: string) => string | null;
    readFileAsync?: (path: string) => Promise<string | null>;
    readFileBase64?: (path: string) => string | null;
    readFileStat?: (
      path: string,
    ) => { ok: boolean; error?: string | null; content?: string | null };
    readFileStatAsync?: (
      path: string,
    ) => Promise<{ ok: boolean; error?: string | null; content?: string | null }>;
    writeFile: (path: string, content: string, encoding?: string) => boolean;
    writeFileAsync?: (path: string, content: string, encoding?: string) => Promise<boolean>;
    exists: (path: string) => boolean;
    existsAsync?: (path: string) => Promise<boolean>;
    realpathAsync?: (path: string) => Promise<string | null>;
    watch: (dir: string, cb: any) => any;
    unwatch: (dir: string) => void;
    mkdir: (dir: string) => boolean | Promise<boolean>;
    deleteFile: (path: string) => boolean | Promise<boolean>;
    deleteDir: (path: string) => boolean | Promise<boolean>;
    rename: (oldPath: string, newPath: string) => boolean | Promise<boolean>;
    writeTempFile?: (relativePath: string, contentBase64: string) => Promise<string | null>;
    cleanupTempFiles?: (prefix: string, maxAgeMs: number) => Promise<void>;
    selectDirectory?: () => Promise<string | null>;
    restoreLastDirectory?: () => Promise<string | null>;
    revealItemInFolder?: (path: string) => boolean | Promise<boolean>;
    listAvailableOpenApps?: <T extends { appName: string }>(candidates: T[]) => Promise<T[]>;
    openWithApp?: (path: string, app: string) => Promise<boolean>;
    openTerminalAtPath?: (path: string, terminal?: string) => Promise<boolean>;
  }

  interface Window {
    utools?: any;
    gooseAiContext?: {
      readGlobalPrompt: () => string | null;
      listLocalSkills: () => Array<{ path: string; content: string }>;
    };
    gooseFs?: GooseFs;
    gooseWeb?: {
      fetchText: (url: string) => Promise<{
        ok: true;
        url: string;
        status: number;
        contentType: string;
        text: string;
      }>;
    };
    /** B 插件（独立速记）preload 注入的标志，子窗 web 侧据此区分 redirect vs 本地落库。 */
    __GOOSE_QUICKNOTE_STANDALONE__?: boolean;
  }
}
