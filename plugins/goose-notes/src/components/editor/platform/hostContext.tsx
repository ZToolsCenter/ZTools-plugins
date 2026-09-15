/**
 * 宿主注入上下文 —— 编辑器内核消费的应用级状态（settings + 当前页 + 跨页能力）。
 *
 * 编辑器内核**禁止直接 import 宿主 store**（usePages/useNotebooks/useSettings/useTabs）。
 * 宿主把这些 store 桥成下面的注入对象，经 <EditorHostProvider> 注入；编辑器内部只读
 * useEditorSettings() / useEditorPageContext()，或调注入回调。
 *
 * 字段以 extraction-blueprint.md §3「Store 处置决议」+「宿主注入接口最终形状」为准。
 * 编辑器自有类型（Page / BlockNoteContent / AISettings / CustomFonts 等）从 app 现有
 * 类型 import 复用，避免重复定义。
 *
 * 来源：plans/2026-06-01-Tauri迁移与编辑器抽取计划/extraction-blueprint.md §3
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Page } from "@/types";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type {
  AiReferenceSuggestionItem,
  AiFileReferenceAttrs,
  ResolvedAiReferenceContext,
} from "@/components/editor/ai/composer/referenceLookup";
import type { EditorPlatform } from "./types";
import type { OpenExternalResourceResult } from "@/components/editor/utils/openResourceExternally";

export interface EditorFontConfig {
  label: string | null;
  font: string | null;
}

export interface EditorCustomFonts {
  default: EditorFontConfig;
  serif: EditorFontConfig;
  mono: EditorFontConfig;
}

export interface EditorAISettings {
  enabled: boolean;
  selectedModelId: string | null;
  workspaceSelectedModelId: string | null;
  workspaceReasoningLevel: "default" | "low" | "medium" | "high";
  /** 供应商预设；缺省时由 base URL / 协议推断 */
  customProviderId?: string | null;
  customProtocol: "openai-responses" | "openai" | "claude";
  customOpenAIResponsesBaseURL: string;
  customOpenAIBaseURL: string;
  customClaudeBaseURL: string;
  customOpenAIResponsesApiKey: string;
  customOpenAIApiKey: string;
  customClaudeApiKey: string;
  customModelOptions: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
}

export interface EditorSearchProvider {
  id: string;
  name: string;
  urlTemplate: string;
  isEnabled: boolean;
}

export interface EditorCustomAction {
  id: string;
  name: string;
  pluginName?: string;
  command: string;
  isEnabled: boolean;
}

export interface EditorFeaturePolicy {
  /** 只展示能够由当前文档格式持久化的表格外观操作。 */
  tablePresentationControls: boolean;
  /** 是否允许 Mermaid HTML 标签；不可信文档宿主应保持 false。 */
  mermaidUnsafeHTML: boolean;
  /** 上传视频时是否由宿主转码为 MP4。 */
  transcodeVideoUploads: boolean;
  /** 附件操作是否能直接交给系统默认应用。 */
  openAttachmentsExternally: boolean;
}

/** 宿主透传给编辑器的设置（替换对 useSettings 的直读）。 */
export interface EditorSettings {
  theme: "light" | "dark" | "system";
  /** 正文字号（px）；由宿主同步到编辑器的 CSS 变量。 */
  editorFontSize: number;
  tableEvenColumnWidth: boolean;
  customFonts: EditorCustomFonts;
  defaultCodeBlockWrap: boolean;
  onDefaultCodeBlockWrapChange: (v: boolean) => void;
  /** 整个 ai slice 透传，编辑器内部按需读字段 */
  ai: EditorAISettings;
  searchProviders: EditorSearchProvider[];
  customActions: EditorCustomAction[];
  /** 链接是否交给宿主内置浏览能力；编辑器不识别具体宿主。 */
  openLinksInHost: boolean;
  /** true 使用应用内灯箱；false 优先调用系统默认图片查看器。 */
  useInternalImageViewer: boolean;
  features: EditorFeaturePolicy;
  /** 原生编辑器没有 Web 侧栏；默认 false，主工作区按自身状态注入。 */
  sidebarCollapsed?: boolean;
  /** 宿主提供的自定义动作跳转能力；不支持的宿主可不传。 */
  redirectAction?: (
    label: string | [string, string],
    payload?: unknown,
  ) => void;
}

/** 宿主透传给编辑器的「当前页 + 跨页能力」（替换对 usePages/useNotebooks/useTabs 的直读）。 */
export interface EditorPageContext {
  /** 替换 activePageId + getPage（宿主决定哪页激活） */
  page: Page;
  /** 宿主决定正文是按原始块处理，还是应用页面级规范化规则。 */
  contentMode: "raw" | "normalized";
  /** 宿主决定编辑器是否使用全宽。 */
  isEditorFullWidth: boolean;
  /** 替换 updatePage（去抖在宿主或编辑器内皆可）。silent=true 时宿主跳过标脏与写盘（切页/normalize 路径）。 */
  onContentChange: (
    content: BlockNoteContent,
    options?: { silent?: boolean },
  ) => void;
  /** 替换 useTabs.openTab（chip 点击导航） */
  onOpenPage: (pageId: string) => void;
  /** 图片相对路径解析：返回当前激活页的本地文件路径 */
  getActivePageLocalFilePath: () => string | null;
  /** 宿主负责把持久化附件还原为真实文件并交给系统默认应用。 */
  onOpenAttachment?: (
    source: string,
    fileName: string,
  ) => Promise<OpenExternalResourceResult>;
  /** AI @mention 跨页能力（封装 usePages/useNotebooks 全量访问，编辑器不直接碰 store） */
  searchPages: (query: string) => AiReferenceSuggestionItem[];
  resolvePageContexts: (
    refs: AiFileReferenceAttrs[],
  ) => ResolvedAiReferenceContext[];
  /** 外部重载时取得宿主最新页面；未提供时沿用当前 page。 */
  getLatestPage?: (pageId: string) => Page | null;
  /** 编辑后把预览标签提升为正式标签；无标签宿主可不提供。 */
  onPromotePreview?: () => void;
}

/** 编辑器对外 props（宿主接线在 Step 6 完成）。 */
export interface EditorProps {
  platform: EditorPlatform;
  settings: EditorSettings;
  pageContext: EditorPageContext;
  readonly?: boolean;
}

const EditorSettingsContext = createContext<EditorSettings | null>(null);
const EditorPageContextContext = createContext<EditorPageContext | null>(null);

export function EditorHostProvider({
  settings,
  pageContext,
  children,
}: {
  settings: EditorSettings;
  pageContext: EditorPageContext;
  children: ReactNode;
}) {
  return (
    <EditorSettingsContext.Provider value={settings}>
      <EditorPageContextContext.Provider value={pageContext}>
        {children}
      </EditorPageContextContext.Provider>
    </EditorSettingsContext.Provider>
  );
}

export function useEditorSettings(): EditorSettings {
  const ctx = useContext(EditorSettingsContext);
  if (!ctx) {
    throw new Error(
      "useEditorSettings 必须在 <EditorHostProvider> 内使用（宿主需注入 settings）。",
    );
  }
  return ctx;
}

export function useEditorPageContext(): EditorPageContext {
  const ctx = useContext(EditorPageContextContext);
  if (!ctx) {
    throw new Error(
      "useEditorPageContext 必须在 <EditorHostProvider> 内使用（宿主需注入 pageContext）。",
    );
  }
  return ctx;
}
