export type NativeEditorAppearance = "light" | "dark";
export type NativeEditorFont = "sans" | "serif" | "mono";
export type NativeEditorMode = "blocks" | "repair-required" | "unavailable";
export type EditorCommandName =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "numberedList"
  | "checkList"
  | "blockquote"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "clearFormatting"
  | "link"
  | "find"
  | "findNext"
  | "findPrevious";

export interface BridgeEnvelope {
  version: 1;
  requestID: string;
  pageID: string;
  revision: number;
}

export interface EditorPagePayload extends BridgeEnvelope {
  generation: number;
  title: string;
  markdown: string;
  appearance: NativeEditorAppearance;
  editorFont: NativeEditorFont;
  editorFontSize: number;
  fullWidth: boolean;
  reduceMotion: boolean;
  increaseContrast: boolean;
}

export type EditorPageInput = Omit<EditorPagePayload, "requestID"> & {
  requestID?: string;
};

export interface EditorPreferences extends BridgeEnvelope {
  appearance: NativeEditorAppearance;
  editorFont: NativeEditorFont;
  editorFontSize: number;
  fullWidth: boolean;
  reduceMotion: boolean;
  increaseContrast: boolean;
}

export interface EditorDraft extends BridgeEnvelope {
  baseRevision: number;
  title: string;
  markdown: string;
  hasChanges: boolean;
}

export interface SaveAcknowledgement extends BridgeEnvelope {
  status: "saved" | "conflict" | "failed";
  message?: string;
}

export interface LocalResourceAcknowledgement extends BridgeEnvelope {
  status: "resolved" | "rejected" | "failed";
  url?: string;
  message?: string;
}

export interface LocalAssetAcknowledgement extends BridgeEnvelope {
  status: "saved" | "rejected" | "failed";
  relativePath?: string;
  mediaType?: string;
  message?: string;
}

/**
 * 原生 AI 服务的最小、版本化消息契约。WebView 只转交 BlockNote 已生成的
 * UI stream chunk，绝不持有密钥、拼装 URL 或发起网络请求。
 */
export interface NativeAIRequest extends BridgeEnvelope {
  type: "aiRequest";
  chatID: string;
  messages: unknown[];
  toolDefinitions: unknown;
}

export interface NativeAIResult extends BridgeEnvelope {
  status: "started" | "completed" | "failed" | "unavailable";
  message?: string;
}

export interface NativeAIDelta extends BridgeEnvelope {
  chunk: unknown;
}

export interface NativeAICancel extends BridgeEnvelope {
  type: "aiCancel";
}

/** 编辑器内 AI 入口只请求原生壳打开受控的工作区面板，不传密钥或文件句柄。 */
export interface NativeAIWorkspaceEntry extends BridgeEnvelope {
  type: "aiWorkspaceEntry";
}

/** 选区改写只把文本交给原生面板，WebView 不拥有模型凭据或写文件能力。 */
export interface NativeAISelectionRequest extends BridgeEnvelope {
  type: "aiSelectionRequest";
  selectedText: string;
}

export interface NativeAISelectionReplacement extends BridgeEnvelope {
  selectionRequestID: string;
  replacement: string;
}

export interface EditorCommand extends BridgeEnvelope {
  name: EditorCommandName;
}

export type HostMessage =
  | (EditorDraft & { type: "change" })
  | (BridgeEnvelope & { type: "ready" | "dirty" | "reloadRequest" })
  | (BridgeEnvelope & { type: "resolveLocalResource"; source: string })
  | (BridgeEnvelope & {
      type: "saveLocalAsset";
      filename: string;
      mediaType: string;
      base64: string;
    })
  | (BridgeEnvelope & { type: "openExternalLink"; url: string })
  | NativeAIRequest
  | NativeAICancel
  | NativeAIWorkspaceEntry
  | NativeAISelectionRequest
  | (BridgeEnvelope & { type: "diagnostic"; message: string });

export interface GooseNativeEditorAPI {
  receivePage(page: EditorPageInput): Promise<void> | void;
  receiveAcknowledgement(acknowledgement: SaveAcknowledgement): void;
  receiveLocalResource(acknowledgement: LocalResourceAcknowledgement): void;
  receiveLocalAsset(acknowledgement: LocalAssetAcknowledgement): void;
  receiveAIResult(result: NativeAIResult): void;
  receiveAIDelta(delta: NativeAIDelta): void;
  updatePreferences(preferences: EditorPreferences): void;
  clear(envelope: BridgeEnvelope): void;
  dispatchCommand(command: EditorCommand): void;
  flushAndGetDraft(envelope?: BridgeEnvelope): Promise<EditorDraft>;
  focusEditor(envelope: BridgeEnvelope): void;
  applyAISelection(replacement: NativeAISelectionReplacement): boolean;
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        gooseNotes?: { postMessage(message: HostMessage): void };
      };
    };
    gooseEditor: GooseNativeEditorAPI;
    __gooseBridgeContext?: Pick<BridgeEnvelope, "pageID" | "revision">;
  }
}
