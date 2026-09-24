import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Clock3,
  Code2,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  FileText,
  FolderOpen,
  Gauge,
  Home,
  Layers3,
  ListTree,
  LoaderCircle,
  Play,
  Presentation,
  ScanSearch,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Table2,
  Unplug,
  X
} from "lucide-react";

import {
  RECIPES,
  QUICK_ACTIONS,
  basename,
  buildQuickCommand,
  detectFormat,
  formatCommand,
  normalizeFilePayload,
  type QuickActionId
} from "./lib/commands";
import {
  AI_CANCEL_UNSETTLED_MESSAGE,
  createOfficeAiTurn,
  createOfficeAiTurnToolHandler,
  normalizeAiCancelResult,
  officeAiToolForTurn,
  type OfficeAiTurn
} from "./lib/ai";
import { parseStoredHistory, type HistoryItem } from "./lib/history";
import {
  defaultReasoningEffort,
  detectZToolsHostCompatibility,
  modelLabel,
  modelProviderLabel,
  modelValue,
  reasoningEffortOptions,
} from "./lib/ztools-compat";
import type {
  AiCancelResult,
  ApiResult,
  McpConfigurations,
  McpProbe,
  OfficeCliRunOutput,
  OfficeCliStatus,
  OfficeCliUpdateInfo,
  OfficeFormat,
  ViewId,
  ZToolsAiModel,
  ZToolsAiRequest
} from "./types";

type StatusPhase = "checking" | "ready" | "missing";
type ClientId = "generic" | "codex" | "claude" | "cursor" | "vscode";
type McpTransport = "ztools" | "stdio";
type AiPermissionMode = "read" | "once" | "always";

interface LastExecution {
  label: string;
  command: string;
  result: ApiResult<OfficeCliRunOutput>;
}

interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

const FORMAT_META: Record<OfficeFormat, {
  label: string;
  eyebrow: string;
  extension: string;
  description: string;
  view: ViewId;
  className: string;
  icon: typeof FileText;
}> = {
  word: {
    label: "Word",
    eyebrow: "WRITE / REVIEW",
    extension: ".docx",
    description: "读取正文、审阅结构、批量改写与格式校验。",
    view: "word",
    className: "word",
    icon: FileText
  },
  excel: {
    label: "Excel",
    eyebrow: "MODEL / ANALYZE",
    extension: ".xlsx",
    description: "单元格、公式、图表、透视表和工作簿自动化。",
    view: "excel",
    className: "excel",
    icon: Table2
  },
  powerpoint: {
    label: "PowerPoint",
    eyebrow: "PRESENT / INSPECT",
    extension: ".pptx",
    description: "幻灯片、形状、图表、动画与视觉审计。",
    view: "powerpoint",
    className: "powerpoint",
    icon: Presentation
  }
};

const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: "home", label: "总览", icon: Home },
  { id: "ai", label: "AI 助手", icon: Sparkles },
  { id: "word", label: "Word", icon: FileText },
  { id: "excel", label: "Excel", icon: Table2 },
  { id: "powerpoint", label: "PowerPoint", icon: Presentation },
  { id: "console", label: "命令台", icon: SquareTerminal },
  { id: "mcp", label: "MCP 接入", icon: Layers3 }
];

const CONSOLE_EXAMPLES = [
  "help docx paragraph",
  "view report.docx issues --json",
  "get report.docx /body/p[1] --depth 2 --json",
  "query book.xlsx \"cell:has(formula)\" --json",
  "validate deck.pptx --json"
];

const ZTOOLS_MCP_URL = "http://127.0.0.1:36579/mcp";
const OFFICECLI_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ZTOOLS_MCP_CONFIGS: Record<ClientId, unknown> = {
  generic: {
    type: "http",
    url: ZTOOLS_MCP_URL,
    headers: { Authorization: "Bearer <ZTOOLS_API_KEY>" }
  },
  codex: `[mcp_servers.ztools]\nurl = "${ZTOOLS_MCP_URL}"\nhttp_headers = { Authorization = "Bearer <ZTOOLS_API_KEY>" }\n`,
  claude: {
    mcpServers: {
      ztools: {
        type: "http",
        url: ZTOOLS_MCP_URL,
        headers: { Authorization: "Bearer <ZTOOLS_API_KEY>" }
      }
    }
  },
  cursor: {
    mcpServers: {
      ztools: {
        type: "http",
        url: ZTOOLS_MCP_URL,
        headers: { Authorization: "Bearer <ZTOOLS_API_KEY>" }
      }
    }
  },
  vscode: {
    servers: {
      ztools: {
        type: "http",
        url: ZTOOLS_MCP_URL,
        headers: { Authorization: "Bearer <ZTOOLS_API_KEY>" }
      }
    }
  }
};

function loadStoredHistory(): HistoryItem[] {
  try {
    return parseStoredHistory(localStorage.getItem("office-suite.history"));
  } catch {
    return [];
  }
}

function executionText(execution: LastExecution | null): string {
  if (!execution) return "选择一项操作后，OfficeCLI 的结构化输出会显示在这里。";
  if (!execution.result.ok) {
    return JSON.stringify(execution.result.error, null, 2);
  }
  const output = execution.result.data;
  if (output.json !== undefined) return JSON.stringify(output.json, null, 2);
  return [output.stdout, output.stderr].filter(Boolean).join("\n") || "命令执行成功，没有额外输出。";
}

function configText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {}, null, 2);
}

function OfficeWorkbenchApp() {
  const [view, setView] = useState<ViewId>("home");
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [statusPhase, setStatusPhase] = useState<StatusPhase>("checking");
  const [status, setStatus] = useState<OfficeCliStatus>({ installed: false });
  const [installingOfficeCli, setInstallingOfficeCli] = useState(false);
  const [installError, setInstallError] = useState("");
  const [officeCliUpdate, setOfficeCliUpdate] = useState<OfficeCliUpdateInfo | null>(null);
  const [checkingOfficeCliUpdate, setCheckingOfficeCliUpdate] = useState(false);
  const [updatingOfficeCli, setUpdatingOfficeCli] = useState(false);
  const [officeCliUpdateError, setOfficeCliUpdateError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>(loadStoredHistory);
  const [lastExecution, setLastExecution] = useState<LastExecution | null>(null);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [consoleCommand, setConsoleCommand] = useState("help");
  const [mcpConfigs, setMcpConfigs] = useState<ApiResult<McpConfigurations> | null>(null);
  const [mcpProbe, setMcpProbe] = useState<ApiResult<McpProbe> | null>(null);
  const [mcpStatus, setMcpStatus] = useState<ApiResult<unknown> | null>(null);
  const [mcpClient, setMcpClient] = useState<ClientId>("generic");
  const [mcpTransport, setMcpTransport] = useState<McpTransport>("ztools");
  const [toast, setToast] = useState("");
  const [aiModels, setAiModels] = useState<ZToolsAiModel[]>([]);
  const [aiModel, setAiModel] = useState("");
  const [aiModelsLoading, setAiModelsLoading] = useState(false);
  const [aiReasoningEffort, setAiReasoningEffort] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStopping, setAiStopping] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPermissionMode, setAiPermissionMode] = useState<AiPermissionMode>("read");
  const [showAiPermissionMenu, setShowAiPermissionMenu] = useState(false);
  const activeOperationRef = useRef<{ token: symbol; label: string } | null>(null);
  const statusRequestRef = useRef(0);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const aiRequestRef = useRef<ZToolsAiRequest | null>(null);
  const aiRequestGenerationRef = useRef(0);
  const aiPermissionRef = useRef<HTMLDivElement>(null);
  const aiActiveTurnRef = useRef<OfficeAiTurn | null>(null);
  const aiTurnHandlersRef = useRef(new Map<string, (input: Record<string, unknown>) => Promise<unknown>>());
  const aiCancelBarrierRef = useRef<Promise<AiCancelResult>>(Promise.resolve({ cancelled: 0, settled: true }));
  const aiCancelPendingRef = useRef(false);
  const aiStartTokenRef = useRef<symbol | null>(null);
  const aiToolSessionNonceRef = useRef("");
  if (!aiToolSessionNonceRef.current) {
    aiToolSessionNonceRef.current = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  const selectedFormat = selectedFile ? detectFormat(selectedFile) : null;
  const resultText = useMemo(() => executionText(lastExecution), [lastExecution]);
  const allowAiWrite = aiPermissionMode !== "read";
  const selectedAiModel = aiModels.find(model => modelValue(model) === aiModel);
  const availableReasoningEfforts = useMemo(
    () => reasoningEffortOptions(selectedAiModel),
    [selectedAiModel],
  );

  const releaseAiTurnHandlerEntries = useCallback((
    entries: Array<[string, (input: Record<string, unknown>) => Promise<unknown>]>
  ) => {
    const toolWindow = window as unknown as Record<string, unknown>;
    for (const [toolName, handler] of entries) {
      if (toolWindow[toolName] === handler) delete toolWindow[toolName];
      if (aiTurnHandlersRef.current.get(toolName) === handler) {
        aiTurnHandlersRef.current.delete(toolName);
      }
    }
  }, []);

  const releaseAiTurnHandler = useCallback((turn: OfficeAiTurn) => {
    const handler = aiTurnHandlersRef.current.get(turn.toolName);
    if (handler) releaseAiTurnHandlerEntries([[turn.toolName, handler]]);
  }, [releaseAiTurnHandlerEntries]);

  const beginAiCancellation = useCallback((): Promise<AiCancelResult> => {
    let requested: unknown = { cancelled: 0, settled: true };
    try {
      requested = window.officeSuite?.cancelAiRuns?.() ?? requested;
    } catch {
      requested = Promise.reject(new Error("OfficeCLI cancellation bridge failed."));
    }
    const barrier = Promise.resolve(requested).then(
      normalizeAiCancelResult,
      () => ({ cancelled: 0, settled: false })
    );
    aiCancelPendingRef.current = true;
    aiCancelBarrierRef.current = barrier;
    void barrier.then(() => {
      if (aiCancelBarrierRef.current === barrier) aiCancelPendingRef.current = false;
    });
    return barrier;
  }, []);

  const addFiles = useCallback((
    incoming: string[],
    options: { navigate?: boolean; selectFirst?: boolean } = {}
  ) => {
    const supported = incoming.filter(path => detectFormat(path));
    if (!supported.length) return;
    setFiles(previous => [...new Set([...previous, ...supported])]);
    setSelectedFile(previous => options.selectFirst ? supported[0] : previous || supported[0]);
    if (options.navigate !== false) {
      const firstFormat = detectFormat(supported[0]);
      if (firstFormat) setView(FORMAT_META[firstFormat].view);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    const requestId = ++statusRequestRef.current;
    setStatusPhase("checking");
    if (!window.officeSuite) {
      if (requestId !== statusRequestRef.current) return;
      setStatus({ installed: false });
      setStatusPhase("missing");
      return;
    }
    const response = await window.officeSuite.getStatus();
    if (requestId !== statusRequestRef.current) return;
    if (response.ok && response.data.installed) {
      setStatus(response.data);
      setStatusPhase("ready");
    } else {
      setStatus({ installed: false });
      setStatusPhase("missing");
    }
  }, []);

  const refreshOfficeCliUpdate = useCallback(async (reportError = false) => {
    if (!window.officeSuite?.checkOfficeCliUpdate) return;
    setCheckingOfficeCliUpdate(true);
    try {
      const response = await window.officeSuite.checkOfficeCliUpdate();
      if (response.ok) {
        setOfficeCliUpdate(response.data);
        setOfficeCliUpdateError("");
      } else if (reportError) {
        setOfficeCliUpdateError(response.error.message);
      }
    } catch (error) {
      if (reportError) {
        setOfficeCliUpdateError(error instanceof Error ? error.message : "OfficeCLI 更新检查失败。");
      }
    } finally {
      setCheckingOfficeCliUpdate(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (statusPhase !== "ready" || !status.version) {
      setOfficeCliUpdate(null);
      return;
    }
    const timer = window.setTimeout(() => void refreshOfficeCliUpdate(false), 1_500);
    const interval = window.setInterval(() => void refreshOfficeCliUpdate(false), OFFICECLI_UPDATE_INTERVAL_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [refreshOfficeCliUpdate, status.version, statusPhase]);

  useEffect(() => {
    try {
      localStorage.setItem("office-suite.history", JSON.stringify(history.slice(0, 12)));
    } catch {
      // Storage is an enhancement; the workbench still works when it is unavailable.
    }
  }, [history]);

  useEffect(() => {
    window.ztools?.onPluginEnter?.(launch => {
      addFiles(normalizeFilePayload(launch));
    });
  }, [addFiles]);

  useEffect(() => {
    const resetAiSession = () => {
      aiRequestGenerationRef.current += 1;
      aiStartTokenRef.current = null;
      aiActiveTurnRef.current = null;
      const inactiveHandlers = Array.from(aiTurnHandlersRef.current.entries());
      const cancelBarrier = beginAiCancellation();
      void cancelBarrier.then(() => releaseAiTurnHandlerEntries(inactiveHandlers));
      aiRequestRef.current?.abort();
      aiRequestRef.current = null;
      setAiBusy(false);
      setAiStopping(false);
      setAiPermissionMode("read");
      setShowAiPermissionMenu(false);
    };
    window.ztools?.onPluginOut?.(resetAiSession);
    return resetAiSession;
  }, [beginAiCancellation, releaseAiTurnHandlerEntries]);

  useEffect(() => {
    if (statusPhase === "ready") return;
    setMcpConfigs(null);
    setMcpProbe(null);
    setMcpStatus(null);
  }, [statusPhase]);

  useEffect(() => {
    if (!showAiPermissionMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!aiPermissionRef.current?.contains(event.target as Node)) setShowAiPermissionMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowAiPermissionMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showAiPermissionMenu]);

  useEffect(() => {
    setResultExpanded(false);
  }, [lastExecution]);

  useEffect(() => {
    if (view !== "ai") return;
    if (!window.ztools?.allAiModels) {
      setAiModels([]);
      setAiError("当前 ZTools 版本未提供原生 AI API。");
      return;
    }
    let active = true;
    setAiModelsLoading(true);
    setAiError("");
    void window.ztools.allAiModels().then(models => {
      if (!active) return;
      const usableModels = models.filter(model => Boolean(modelValue(model)));
      setAiModels(usableModels);
      setAiModel(previous => previous && usableModels.some(model => modelValue(model) === previous)
        ? previous
        : modelValue(usableModels[0]));
      if (!usableModels.length) setAiError("请先在 ZTools 设置中添加 AI 模型。");
    }).catch(error => {
      if (!active) return;
      setAiModels([]);
      setAiError(error instanceof Error ? error.message : "读取 ZTools AI 模型失败。");
    }).finally(() => {
      if (active) setAiModelsLoading(false);
    });
    return () => { active = false; };
  }, [view]);

  useEffect(() => {
    if (!selectedAiModel) {
      setAiReasoningEffort("");
      return;
    }
    const effortIds = availableReasoningEfforts.map(effort => effort.id);
    const defaultEffort = defaultReasoningEffort(selectedAiModel);
    setAiReasoningEffort(previous => previous && effortIds.includes(previous)
      ? previous
      : defaultEffort && effortIds.includes(defaultEffort)
        ? defaultEffort
        : effortIds[0] ?? "");
  }, [availableReasoningEfforts, selectedAiModel]);

  useEffect(() => () => {
    const toolWindow = window as unknown as Record<string, unknown>;
    for (const [toolName, handler] of aiTurnHandlersRef.current) {
      if (toolWindow[toolName] === handler) delete toolWindow[toolName];
    }
    aiTurnHandlersRef.current.clear();
  }, []);

  useEffect(() => {
    if (view !== "mcp" || !window.officeSuite || statusPhase !== "ready") return;
    let active = true;
    setMcpConfigs(null);
    setMcpStatus(null);
    void Promise.all([
      window.officeSuite.getMcpConfigs(),
      window.officeSuite.getMcpStatus()
    ]).then(([configs, currentStatus]) => {
      if (!active) return;
      setMcpConfigs(configs);
      setMcpStatus(currentStatus);
    }).catch(error => {
      if (!active) return;
      const failure = {
        ok: false,
        error: {
          code: "MCP_CONFIG_REJECTED",
          message: error instanceof Error ? error.message : "MCP 配置读取意外中断。"
        }
      } as const;
      setMcpConfigs(failure);
      setMcpStatus(failure);
    });
    return () => { active = false; };
  }, [view, statusPhase]);

  useEffect(() => {
    if (!showSettings) return;
    const dialog = settingsDialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [showSettings]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const beginOperation = (label: string): symbol | null => {
    if (activeOperationRef.current) {
      notify(`正在执行“${activeOperationRef.current.label}”，请稍候。`);
      return null;
    }
    const token = Symbol(label);
    activeOperationRef.current = { token, label };
    setBusyLabel(label);
    return token;
  };

  const endOperation = (token: symbol) => {
    if (activeOperationRef.current?.token !== token) return;
    activeOperationRef.current = null;
    setBusyLabel("");
  };

  const chooseFiles = async (options: { navigate?: boolean; selectFirst?: boolean } = {}) => {
    if (window.ztools?.showOpenDialog) {
      const result = await window.ztools.showOpenDialog({
        title: "选择 Office 文档",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Office Open XML", extensions: ["docx", "xlsx", "pptx"] }]
      });
      addFiles(normalizeFilePayload(result), options);
      return;
    }
    const manual = window.prompt("输入 Office 文件的绝对路径");
    if (manual) addFiles([manual], options);
  };

  const chooseOutputPath = async (format: OfficeFormat): Promise<string> => {
    const meta = FORMAT_META[format];
    if (window.ztools?.showSaveDialog) {
      const result = await window.ztools.showSaveDialog({
        title: `新建 ${meta.label} 文档`,
        defaultPath: `untitled${meta.extension}`,
        filters: [{ name: meta.label, extensions: [meta.extension.slice(1)] }]
      });
      return normalizeFilePayload(result)[0] ?? "";
    }
    return window.prompt(`输入新文件的绝对路径（${meta.extension}）`) ?? "";
  };

  const runCommand = async (command: string | string[], label: string) => {
    const printable = Array.isArray(command) ? formatCommand(command) : command;
    if (!window.officeSuite) {
      const unavailable: ApiResult<OfficeCliRunOutput> = {
        ok: false,
        error: { code: "BRIDGE_UNAVAILABLE", message: "ZTools preload 尚未加载。" }
      };
      setLastExecution({
        label,
        command: printable,
        result: unavailable
      });
      return unavailable;
    }

    const token = beginOperation(label);
    if (!token) {
      return {
        ok: false,
        error: { code: "OPERATION_BUSY", message: "另一个 Office 操作仍在执行。" }
      } satisfies ApiResult<OfficeCliRunOutput>;
    }

    try {
      let response: ApiResult<OfficeCliRunOutput>;
      try {
        response = await window.officeSuite.run(command, { timeoutMs: 120_000 });
      } catch (error) {
        response = {
          ok: false,
          error: {
            code: "BRIDGE_REJECTED",
            message: error instanceof Error ? error.message : "Office 操作意外中断。"
          }
        };
      }
      setLastExecution({ label, command: printable, result: response });
      setHistory(previous => [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          label,
          command: printable,
          ok: response.ok,
          at: new Date().toISOString()
        },
        ...previous
      ].slice(0, 12));
      return response;
    } finally {
      endOperation(token);
    }
  };

  const runQuickAction = async (action: QuickActionId, filePath = selectedFile) => {
    if (!filePath) return;
    const item = QUICK_ACTIONS.find(candidate => candidate.id === action);
    await runCommand(buildQuickCommand(action, filePath), item?.label ?? action);
  };

  const sendAiMessage = async () => {
    const prompt = aiPrompt.trim();
    const permissionModeForRequest = aiPermissionMode;
    if (!prompt || aiBusy || aiStartTokenRef.current) return;
    if (!window.ztools?.ai) {
      setAiError("当前 ZTools 版本未提供原生 AI API。");
      return;
    }
    if (!aiModel) {
      setAiError("请先在 ZTools 设置中添加并选择 AI 模型。");
      return;
    }

    const startToken = Symbol("office-ai-start");
    const preflightGeneration = aiRequestGenerationRef.current;
    const cancelBarrier = aiCancelBarrierRef.current;
    aiStartTokenRef.current = startToken;
    setAiBusy(true);
    if (aiCancelPendingRef.current) setAiStopping(true);
    const cancelResult = normalizeAiCancelResult(await cancelBarrier);
    if (
      aiStartTokenRef.current !== startToken ||
      aiRequestGenerationRef.current !== preflightGeneration ||
      aiCancelBarrierRef.current !== cancelBarrier
    ) {
      // stop/plugin-out may already own the visible reset. Only clear state when
      // this preflight still owns the single-flight token.
      if (aiStartTokenRef.current === startToken) {
        aiStartTokenRef.current = null;
        setAiStopping(false);
        setAiBusy(false);
      }
      return;
    }
    aiStartTokenRef.current = null;
    setAiStopping(false);
    const cancellationWarning = cancelResult.settled ? "" : AI_CANCEL_UNSETTLED_MESSAGE;

    const userMessage: AiChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt
    };
    const assistantId = `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const assistantMessage: AiChatMessage = {
      id: assistantId,
      role: "assistant",
      content: ""
    };
    const conversation = [...aiMessages, userMessage];
    setAiMessages([...conversation, assistantMessage]);
    setAiPrompt("");
    setAiError(cancellationWarning);
    setShowAiPermissionMenu(false);
    const requestGeneration = ++aiRequestGenerationRef.current;
    const aiTurn = createOfficeAiTurn(aiToolSessionNonceRef.current, requestGeneration);
    aiActiveTurnRef.current = aiTurn;

    const officeDocument = createOfficeAiTurnToolHandler({
      turn: aiTurn,
      getActiveTurn: () => aiActiveTurnRef.current,
      selectedFile,
      allowWrite: permissionModeForRequest !== "read",
      runForAi: async (command, options) => {
        if (!window.officeSuite?.runForAi) {
          return {
            ok: false,
            error: { code: "BRIDGE_UNAVAILABLE", message: "OfficeCLI bridge unavailable." }
          };
        }
        return window.officeSuite.runForAi(command, options);
      },
      onResult: (command, result) => {
        const printable = command === null
          ? "参数校验失败"
          : Array.isArray(command)
            ? formatCommand(command)
            : command;
        setLastExecution({ label: "AI 工具调用", command: printable, result });
      }
    });
    const toolWindow = window as unknown as Record<string, unknown>;
    toolWindow[aiTurn.toolName] = officeDocument;
    aiTurnHandlersRef.current.set(aiTurn.toolName, officeDocument);

    const selectedContext = selectedFile
      ? `The currently selected document is: ${selectedFile}`
      : "No document is currently selected. Ask for an absolute path when one is required.";
    const systemPrompt = [
      "You are the native Office assistant inside ZTools.",
      `Use the provided Office document function (${aiTurn.toolName}) for factual document inspection and every claimed file operation.`,
      `Call ${aiTurn.toolName} with operation, filePath, and args. To read content use operation=view and args=[\"text\"]; never use read as an operation.`,
      "Use absolute paths and read operations before edits.",
      "Use help or load_skill when OfficeCLI syntax is uncertain.",
      "If a tool returns AI_WRITE_APPROVAL_REQUIRED, explain that the user must choose a modification permission mode below the prompt; never claim the file changed.",
      "Summarize successful changes and report tool errors honestly.",
      selectedContext
    ].join(" ");

    let request: ZToolsAiRequest;
    try {
      request = window.ztools.ai({
        model: aiModel,
        ...(aiReasoningEffort ? { reasoningEffort: aiReasoningEffort } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          ...conversation.map(message => ({ role: message.role, content: message.content }))
        ],
        tools: [officeAiToolForTurn(aiTurn)]
      }, chunk => {
        if (aiRequestGenerationRef.current !== requestGeneration) return;
        const content = typeof chunk.content === "string" ? chunk.content : "";
        const reasoning = chunk.reasoning_content ?? "";
        if (!content && !reasoning) return;
        setAiMessages(previous => previous.map(message => message.id === assistantId
          ? {
              ...message,
              content: message.content + content,
              reasoning: (message.reasoning ?? "") + reasoning
            }
          : message));
      });
    } catch (error) {
      releaseAiTurnHandler(aiTurn);
      if (aiRequestGenerationRef.current === requestGeneration) {
        if (aiActiveTurnRef.current?.token === aiTurn.token) aiActiveTurnRef.current = null;
        setAiError(error instanceof Error ? error.message : "ZTools AI 请求启动失败。");
        setAiBusy(false);
        if (permissionModeForRequest === "once") {
          setAiPermissionMode("read");
        }
      }
      return;
    }
    aiRequestRef.current = request;

    try {
      await request;
    } catch (error) {
      if (aiRequestGenerationRef.current === requestGeneration) {
        setAiError(error instanceof Error ? error.message : "ZTools AI 请求失败。");
      }
    } finally {
      if (aiRequestGenerationRef.current !== requestGeneration) {
        await aiCancelBarrierRef.current;
      }
      releaseAiTurnHandler(aiTurn);
      if (aiRequestGenerationRef.current === requestGeneration) {
        if (aiActiveTurnRef.current?.token === aiTurn.token) aiActiveTurnRef.current = null;
        if (aiRequestRef.current === request) aiRequestRef.current = null;
        setAiBusy(false);
        if (permissionModeForRequest === "once") {
          setAiPermissionMode("read");
        }
      }
    }
  };

  const stopAiMessage = async () => {
    if (aiStopping) return;
    const stopGeneration = ++aiRequestGenerationRef.current;
    aiStartTokenRef.current = null;
    aiActiveTurnRef.current = null;
    const cancelBarrier = beginAiCancellation();
    aiRequestRef.current?.abort();
    aiRequestRef.current = null;
    setAiBusy(true);
    setAiStopping(true);
    setShowAiPermissionMenu(false);
    if (aiPermissionMode === "once") {
      setAiPermissionMode("read");
    }
    const result = normalizeAiCancelResult(await cancelBarrier);
    if (
      aiRequestGenerationRef.current === stopGeneration &&
      aiCancelBarrierRef.current === cancelBarrier
    ) {
      setAiStopping(false);
      setAiBusy(false);
      setAiError(result.settled ? "已停止本次生成。" : AI_CANCEL_UNSETTLED_MESSAGE);
    }
  };

  const createDocument = async (format: OfficeFormat) => {
    const outputPath = await chooseOutputPath(format);
    if (!outputPath) return;
    const response = await runCommand(["create", outputPath, "--json"], `新建 ${FORMAT_META[format].label}`);
    if (response?.ok) addFiles([outputPath]);
  };

  const copyText = async (text: string) => {
    if (window.ztools?.copyText) window.ztools.copyText(text);
    else await navigator.clipboard.writeText(text);
    notify("已复制到剪贴板");
  };

  const restoreSettingsFocus = () => {
    const target = settingsReturnFocusRef.current;
    settingsReturnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  };

  const openSettings = () => {
    settingsReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setShowSettings(true);
  };

  const closeSettings = () => {
    if (settingsDialogRef.current?.open) settingsDialogRef.current.close();
    setShowSettings(false);
    restoreSettingsFocus();
  };

  const retryRuntimeDiscovery = () => {
    closeSettings();
    void refreshStatus();
  };

  const installOfficeCli = async () => {
    if (installingOfficeCli) return;
    if (!window.officeSuite?.installOfficeCli) {
      setInstallError("当前插件版本未提供一键安装能力。");
      return;
    }
    setInstallingOfficeCli(true);
    setInstallError("");
    try {
      const response = await window.officeSuite.installOfficeCli();
      if (!response.ok) {
        setInstallError(response.error.message);
        return;
      }
      setStatus(response.data);
      setStatusPhase("ready");
      setShowSettings(false);
      notify(`OfficeCLI ${response.data.version ?? ""} 安装成功`);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "OfficeCLI 安装意外中断。");
    } finally {
      setInstallingOfficeCli(false);
    }
  };

  const updateOfficeCli = async () => {
    if (updatingOfficeCli || !window.officeSuite?.updateOfficeCli) return;
    const token = beginOperation("更新 OfficeCLI");
    if (!token) return;
    setUpdatingOfficeCli(true);
    setOfficeCliUpdateError("");
    try {
      const response = await window.officeSuite.updateOfficeCli();
      if (!response.ok) {
        setOfficeCliUpdateError(response.error.message);
        return;
      }
      setStatus(response.data);
      setStatusPhase("ready");
      setOfficeCliUpdate({
        installed: true,
        currentVersion: response.data.version ?? null,
        latestVersion: response.data.version ?? null,
        updateAvailable: false,
        checkedAt: new Date().toISOString()
      });
      notify(`OfficeCLI 已更新到 ${response.data.version ?? "最新版本"}`);
    } catch (error) {
      setOfficeCliUpdateError(error instanceof Error ? error.message : "OfficeCLI 更新意外中断。");
    } finally {
      setUpdatingOfficeCli(false);
      endOperation(token);
    }
  };

  const probeMcp = async () => {
    if (!window.officeSuite) return;
    const token = beginOperation("探测 MCP");
    if (!token) return;
    try {
      try {
        setMcpProbe(await window.officeSuite.probeMcp());
      } catch (error) {
        setMcpProbe({
          ok: false,
          error: {
            code: "MCP_PROBE_REJECTED",
            message: error instanceof Error ? error.message : "MCP 探测意外中断。"
          }
        });
      }
    } finally {
      endOperation(token);
    }
  };

  const changeMcpRegistration = async (
    target: "lms" | "claude" | "cursor" | "vscode",
    mode: "register" | "unregister"
  ) => {
    if (!window.officeSuite) return;
    const label = `${mode === "register" ? "注册" : "移除"} ${target}`;
    const token = beginOperation(label);
    if (!token) return;
    try {
      try {
        const response = mode === "register"
          ? await window.officeSuite.registerMcp(target)
          : await window.officeSuite.unregisterMcp(target);
        notify(response.ok ? "MCP 配置已更新" : response.error.message);
        setMcpStatus(await window.officeSuite.getMcpStatus());
      } catch (error) {
        notify(error instanceof Error ? error.message : "MCP 配置更新意外中断。");
      }
    } finally {
      endOperation(token);
    }
  };

  const renderHome = () => (
    <div className="view-stack home-view">
      <section className="hero-panel reveal">
        <div className="hero-copy">
          <span className="section-index">01 — DOCUMENT OPERATIONS</span>
          <h1>一个工作台，<br /><em>三种文档世界。</em></h1>
          <p>
            让 Word、Excel 和 PowerPoint 共享同一套可检查、可批处理、可被 AI 调用的命令语言。
          </p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => void chooseFiles()}>
              <FolderOpen size={17} /> 选择文档
            </button>
            <button className="button ghost" onClick={() => setView("console")}>
              打开命令台 <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
        <div className="hero-diagram" aria-label="OfficeCLI processing diagram">
          <div className="diagram-orbit orbit-word">W</div>
          <div className="diagram-orbit orbit-excel">X</div>
          <div className="diagram-orbit orbit-powerpoint">P</div>
          <div className="diagram-core"><Code2 size={27} /><span>CLI</span></div>
          <div className="diagram-caption">OPEN XML / STDIO / JSON</div>
        </div>
      </section>

      {statusPhase === "missing" && (
        <DependencyNotice
          installing={installingOfficeCli}
          error={installError}
          onInstall={() => void installOfficeCli()}
          onSettings={openSettings}
        />
      )}

      <section className="format-grid reveal delay-1">
        {(Object.keys(FORMAT_META) as OfficeFormat[]).map(format => {
          const meta = FORMAT_META[format];
          const Icon = meta.icon;
          const count = files.filter(path => detectFormat(path) === format).length;
          return (
            <button
              className={`format-card ${meta.className}`}
              key={format}
              onClick={() => setView(meta.view)}
            >
              <span className="format-number">0{format === "word" ? 1 : format === "excel" ? 2 : 3}</span>
              <Icon size={28} strokeWidth={1.6} />
              <span className="format-eyebrow">{meta.eyebrow}</span>
              <strong>{meta.label}</strong>
              <span>{meta.description}</span>
              <span className="format-footer">{count ? `${count} 个已载入` : `支持 ${meta.extension}`} <ChevronRight size={16} /></span>
            </button>
          );
        })}
      </section>

      <section className="home-bottom reveal delay-2">
        <DocumentQueue
          files={files}
          selectedFile={selectedFile}
          onSelect={setSelectedFile}
          onAdd={() => void chooseFiles()}
          onRemove={path => {
            const remaining = files.filter(item => item !== path);
            setFiles(remaining);
            if (selectedFile === path) setSelectedFile(remaining[0] ?? "");
          }}
        />
        <ActivityList history={history} onOpenConsole={() => setView("console")} />
      </section>
    </div>
  );

  const renderFormatView = (format: OfficeFormat) => {
    const meta = FORMAT_META[format];
    const Icon = meta.icon;
    const formatFiles = files.filter(path => detectFormat(path) === format);
    const activePath = selectedFormat === format ? selectedFile : formatFiles[0] ?? "";

    return (
      <div className={`view-stack workbench-view theme-${meta.className}`}>
        <section className="workbench-heading reveal">
          <div className="heading-icon"><Icon size={34} /></div>
          <div>
            <span className="section-index">{meta.eyebrow}</span>
            <h1>{meta.label} 工作站</h1>
            <p>{meta.description}</p>
          </div>
          <button className="button format-action" disabled={Boolean(busyLabel)} onClick={() => void createDocument(format)}>
            <FilePlus2 size={17} /> 新建 {meta.extension}
          </button>
        </section>

        <section
          className="file-stage reveal delay-1"
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            const paths = Array.from(event.dataTransfer.files)
              .map(file => (file as File & { path?: string }).path ?? "")
              .filter(Boolean);
            addFiles(paths);
          }}
        >
          <div className="stage-label"><span>ACTIVE DOCUMENT</span><span>{formatFiles.length} FILES</span></div>
          {activePath ? (
            <div className="active-file">
              <div className="file-mark"><Icon size={24} /></div>
              <div className="file-copy">
                <strong>{basename(activePath)}</strong>
                <span title={activePath}>{activePath}</span>
              </div>
              <select
                aria-label="切换当前文档"
                value={activePath}
                onChange={event => setSelectedFile(event.target.value)}
              >
                {formatFiles.map(path => <option value={path} key={path}>{basename(path)}</option>)}
              </select>
              <button className="icon-button" title="在系统中打开" onClick={() => void window.ztools?.shellOpenPath?.(activePath)}>
                <ExternalLink size={17} />
              </button>
            </div>
          ) : (
            <button className="empty-file" onClick={() => void chooseFiles()}>
              <FolderOpen size={26} />
              <strong>拖入或选择 {meta.extension} 文件</strong>
              <span>文件只在本机交给 OfficeCLI 处理</span>
            </button>
          )}
        </section>

        <div className="workbench-columns reveal delay-2">
          <section className="operation-panel">
            <div className="panel-title"><span>QUICK OPERATIONS</span><strong>文档操作</strong></div>
            <div className="operation-grid">
              {QUICK_ACTIONS.map((action, index) => {
                const icons = [ListTree, FileText, Gauge, ScanSearch, FileCheck2, Activity];
                const ActionIcon = icons[index];
                return (
                  <button
                    key={action.id}
                    disabled={!activePath || Boolean(busyLabel)}
                    onClick={() => void runQuickAction(action.id, activePath)}
                  >
                    <ActionIcon size={19} />
                    <strong>{action.label}</strong>
                    <span>{action.description}</span>
                    <ChevronRight size={15} className="operation-arrow" />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="recipe-panel">
            <div className="panel-title"><span>COMMAND RECIPES</span><strong>专业配方</strong></div>
            <div className="recipe-list">
              {RECIPES[format].map((recipe, index) => {
                const command = activePath ? recipe.command(activePath) : [];
                return (
                  <button
                    key={recipe.title}
                    disabled={!activePath || Boolean(busyLabel)}
                    onClick={() => void runCommand(command, recipe.title)}
                  >
                    <span className="recipe-index">R{index + 1}</span>
                    <span><strong>{recipe.title}</strong><code>{command.length ? formatCommand(command) : "等待选择文件"}</code></span>
                    <Play size={15} />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    );
  };

  const renderConsole = () => (
    <div className="view-stack console-view">
      <section className="console-heading reveal">
        <div>
          <span className="section-index">RAW POWER / CONTROLLED PROCESS</span>
          <h1>Office 命令台</h1>
          <p>直接使用 OfficeCLI 语法；执行器固定为 OfficeCLI，不经过 shell。</p>
        </div>
        <ShieldCheck size={38} />
      </section>

      <section className="terminal-shell reveal delay-1">
        <div className="terminal-bar">
          <span><i className="terminal-dot red" /><i className="terminal-dot amber" /><i className="terminal-dot green" /></span>
          <span>officecli — safe argv mode</span>
          <span>{status.version ?? "not connected"}</span>
        </div>
        <div className="command-editor">
          <span className="prompt-mark">›</span>
          <textarea
            aria-label="OfficeCLI 命令"
            spellCheck={false}
            value={consoleCommand}
            onChange={event => setConsoleCommand(event.target.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void runCommand(consoleCommand, "命令台执行");
              }
            }}
          />
          <button
            className="run-command"
            disabled={!consoleCommand.trim() || Boolean(busyLabel)}
            onClick={() => void runCommand(consoleCommand, "命令台执行")}
          >
            {busyLabel ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
            RUN
          </button>
        </div>
        <div className="command-hint">⌘ / Ctrl + Enter 执行 · 允许文档操作、help 与 load_skill · 禁止安装和配置管理命令</div>
      </section>

      <div className="console-grid reveal delay-2">
        <section className="examples-panel">
          <div className="panel-title"><span>STARTING POINTS</span><strong>命令样例</strong></div>
          {CONSOLE_EXAMPLES.map(example => (
            <button key={example} onClick={() => setConsoleCommand(example)}>
              <code>{example}</code><ChevronRight size={15} />
            </button>
          ))}
        </section>
        <ResultPanel
          execution={lastExecution}
          text={resultText}
          busy={Boolean(busyLabel)}
          onCopy={() => void copyText(resultText)}
        />
      </div>
    </div>
  );

  const renderAi = () => (
    <div className="view-stack ai-view">
      <section className="ai-hero reveal">
        <div className="ai-intro">
          <span className="section-index">ZTOOLS NATIVE AI / OFFICE TOOLS</span>
          <h1>使用你已经配置的 AI。</h1>
          <p>模型请求由 ZTools 宿主发送，插件不会读取或保存提供商 API Key。</p>
        </div>
        <label className="ai-model-picker">
          <span>当前模型</span>
          <select
            aria-label="ZTools AI 模型"
            value={aiModel}
            disabled={aiModelsLoading || !aiModels.length}
            onChange={event => setAiModel(event.target.value)}
          >
            {!aiModels.length && <option value="">{aiModelsLoading ? "正在读取…" : "暂无模型"}</option>}
            {aiModels.map(model => <option value={modelValue(model)} key={modelValue(model)}>{modelLabel(model)}</option>)}
          </select>
          <small>{selectedAiModel?.description || "来自 ZTools 设置"}</small>
          {selectedAiModel && (
            <small className="ai-model-capabilities">
              {[
                modelProviderLabel(selectedAiModel),
                selectedAiModel.contextWindow ? `${selectedAiModel.contextWindow.toLocaleString()} context` : "",
                selectedAiModel.inputModalities?.length ? selectedAiModel.inputModalities.join(" / ") : ""
              ].filter(Boolean).join(" · ") || "模型能力由 ZTools 管理"}
            </small>
          )}
          {availableReasoningEfforts.length > 0 && (
            <label className="ai-reasoning-picker">
              <span>思考深度</span>
              <select
                aria-label="AI 思考深度"
                value={aiReasoningEffort}
                disabled={aiBusy}
                onChange={event => setAiReasoningEffort(event.target.value)}
              >
                {availableReasoningEfforts.map(effort => <option key={effort.id} value={effort.id}>{effort.label}</option>)}
              </select>
            </label>
          )}
        </label>
      </section>

      <div className="ai-workspace reveal delay-1">
        <section className="ai-chat-panel">
          <div className="ai-chat-header">
            <span><Sparkles size={16} /><strong>Office AI 助手</strong></span>
            <button
              disabled={!aiMessages.length || aiBusy}
              onClick={() => { setAiMessages([]); setAiError(""); }}
            >清空对话</button>
          </div>
          <div className="ai-transcript" aria-live="polite">
            {aiMessages.length ? aiMessages.map(message => (
              <article className={`ai-message ${message.role}`} key={message.id}>
                <span>{message.role === "user" ? "YOU" : "AI"}</span>
                <div>
                  {message.reasoning && <details><summary>思考过程</summary><p>{message.reasoning}</p></details>}
                  <p>{message.content || (message.role === "assistant" && aiBusy
                    ? "正在调用 ZTools AI…"
                    : "未返回文本。")}</p>
                </div>
              </article>
            )) : (
              <div className="ai-empty-state">
                <span><Sparkles size={28} /></span>
                <strong>让 AI 阅读、检查或修改 Office 文档</strong>
                <p>例如：“检查当前 Word 文档的格式问题，并给出修复建议。”</p>
              </div>
            )}
          </div>
          {aiError && <div className="ai-error"><CircleAlert size={15} />{aiError}</div>}
          <div className="ai-composer">
            <textarea
              aria-label="向 Office AI 提问"
              placeholder="描述你要检查、创建或修改的内容…"
              value={aiPrompt}
              disabled={aiBusy}
              onChange={event => setAiPrompt(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void sendAiMessage();
                }
              }}
            />
            <div className="ai-composer-footer">
              <div className="ai-permission-control" ref={aiPermissionRef}>
                <button
                  type="button"
                  className={`ai-permission-trigger ${allowAiWrite ? "write-enabled" : ""} ${aiPermissionMode === "always" ? "always-enabled" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={showAiPermissionMenu}
                  disabled={aiBusy}
                  onClick={() => setShowAiPermissionMenu(previous => !previous)}
                >
                  <ShieldCheck size={15} />
                  {aiPermissionMode === "always" ? "始终允许修改" : aiPermissionMode === "once" ? "本次允许修改" : "只读模式"}
                  <ChevronRight size={14} />
                </button>
                {showAiPermissionMenu && (
                  <div className="ai-permission-menu" role="menu" aria-label="AI 文件权限模式">
                    <div className="ai-permission-heading">
                      <strong>AI 如何操作文件？</strong>
                      <small>权限仅影响 OfficeCLI 工具，不会上传原始文件。</small>
                    </div>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={aiPermissionMode === "read"}
                      className={aiPermissionMode === "read" ? "selected" : ""}
                      onClick={() => { setAiPermissionMode("read"); setShowAiPermissionMenu(false); }}
                    >
                      <FileText size={18} />
                      <span><strong>只读模式</strong><small>允许读取、检查和预览，不修改文件</small></span>
                      {aiPermissionMode === "read" && <Check size={17} />}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={aiPermissionMode === "once"}
                      className={aiPermissionMode === "once" ? "selected write" : "write"}
                      onClick={() => { setAiPermissionMode("once"); setShowAiPermissionMenu(false); }}
                    >
                      <ShieldCheck size={18} />
                      <span><strong>本次允许修改</strong><small>允许下一次发送修改文件，完成后自动恢复只读</small></span>
                      {aiPermissionMode === "once" && <Check size={17} />}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={aiPermissionMode === "always"}
                      className={aiPermissionMode === "always" ? "selected always" : "always"}
                      onClick={() => { setAiPermissionMode("always"); setShowAiPermissionMenu(false); }}
                    >
                      <CircleAlert size={18} />
                      <span><strong>始终允许修改</strong><small>当前插件会话内持续允许；关闭或重新加载后失效</small></span>
                      {aiPermissionMode === "always" && <Check size={17} />}
                    </button>
                  </div>
                )}
              </div>
              {aiBusy ? (
                <button
                  className="ai-send stop"
                  disabled={aiStopping}
                  onClick={() => void stopAiMessage()}
                ><X size={16} />{aiStopping ? "正在停止…" : "停止"}</button>
              ) : (
                <button
                  className="ai-send"
                  disabled={!aiPrompt.trim() || !aiModel || statusPhase !== "ready"}
                  onClick={() => void sendAiMessage()}
                ><ArrowUpRight size={16} />发送</button>
              )}
            </div>
          </div>
          <div className="ai-composer-hint">⌘ / Ctrl + Enter 发送 · 工具调用经过 OfficeCLI 安全策略</div>
        </section>

        <aside className="ai-context-panel">
          <div className="panel-title"><span>ACTIVE CONTEXT</span><strong>本轮上下文</strong></div>
          <div className="ai-context-file">
            <span><FileText size={18} /></span>
            <div>
              <strong>{selectedFile ? basename(selectedFile) : "尚未选择文档"}</strong>
              <small title={selectedFile}>{selectedFile || "AI 会在需要时询问绝对路径"}</small>
            </div>
            <button onClick={() => void chooseFiles({ navigate: false, selectFirst: true })}>
              {selectedFile ? "更换" : "选择"}
            </button>
          </div>
          <div className="ai-capability-list">
            <div><Check size={15} /><span><strong>ZTools 内置 AI</strong><small>复用设置中的模型与凭据</small></span></div>
            <div><Check size={15} /><span><strong>OfficeCLI Function Tool</strong><small>自动执行受控文档命令</small></span></div>
            <div><Check size={15} /><span><strong>ZTools MCP</strong><small>外部客户端入口保持可用</small></span></div>
          </div>
          <p className="ai-privacy-note">提示词、所选文件路径及工具结果会发送给当前 AI 提供商；原始 Office 文件不会被自动上传。</p>
        </aside>
      </div>
    </div>
  );

  const renderMcp = () => {
    const configuration = mcpTransport === "ztools"
      ? ZTOOLS_MCP_CONFIGS[mcpClient]
      : mcpConfigs?.ok ? mcpConfigs.data.configs?.[mcpClient] : undefined;
    const canCopyConfiguration = mcpTransport === "ztools"
      || Boolean(mcpConfigs?.ok && configuration !== undefined);
    const configurationDisplay = mcpTransport === "ztools"
      ? configText(configuration)
      : !mcpConfigs
        ? "正在读取 OfficeCLI 路径…"
        : mcpConfigs.ok
          ? configText(configuration)
          : `读取失败：${mcpConfigs.error.message}`;
    const clientLabels: Record<ClientId, string> = {
      generic: "通用 JSON",
      codex: "Codex",
      claude: "Claude",
      cursor: "Cursor",
      vscode: "VS Code"
    };
    return (
      <div className="view-stack mcp-view">
        <section className="mcp-hero reveal">
          <div>
            <span className="section-index">MODEL CONTEXT PROTOCOL / STDIO</span>
            <h1>让 AI 直接操作 Office。</h1>
            <p>ZTools 网关暴露受控 <code>office_document(command)</code>；高级模式可直连 OfficeCLI stdio。</p>
          </div>
          <div className={`mcp-signal ${mcpProbe?.ok ? "online" : ""}`}>
            <span className="signal-ring"><Sparkles size={28} /></span>
            <strong>{mcpProbe?.ok ? "HANDSHAKE OK" : "READY TO PROBE"}</strong>
            <small>{mcpProbe?.ok ? `${mcpProbe.data.serverInfo?.name ?? "officecli"} ${mcpProbe.data.serverInfo?.version ?? ""}` : "stdio / JSON-RPC"}</small>
          </div>
        </section>

        <section className="probe-strip reveal delay-1">
          <div><Activity size={19} /><span><strong>原生 MCP 自检</strong><small>initialize → tools/list</small></span></div>
          <div className="probe-detail">
            {mcpProbe?.ok && <><span>协议 {mcpProbe.data.protocolVersion}</span><span>工具 {mcpProbe.data.toolNames?.join(", ")}</span></>}
            {mcpProbe && !mcpProbe.ok && <span className="error-text">{mcpProbe.error.message}</span>}
          </div>
          <button className="button primary" disabled={Boolean(busyLabel) || statusPhase !== "ready"} onClick={() => void probeMcp()}>
            {busyLabel === "探测 MCP" ? <LoaderCircle className="spin" size={16} /> : <Activity size={16} />}
            运行握手
          </button>
        </section>

        <div className="mcp-grid reveal delay-2">
          <section className="config-panel">
            <div className="panel-title"><span>CLIENT CONFIGURATION</span><strong>复制接入配置</strong></div>
            <div className="transport-switch" aria-label="MCP 传输方式">
              <button className={mcpTransport === "ztools" ? "active" : ""} onClick={() => setMcpTransport("ztools")}>
                <ShieldCheck size={14} /><span><strong>ZTools HTTP 网关</strong><small>推荐 · 插件策略保护</small></span>
              </button>
              <button className={mcpTransport === "stdio" ? "active" : ""} onClick={() => setMcpTransport("stdio")}>
                <SquareTerminal size={14} /><span><strong>OfficeCLI stdio</strong><small>高级 · 直接完整能力</small></span>
              </button>
            </div>
            <div className="client-tabs">
              {(Object.keys(clientLabels) as ClientId[]).map(client => (
                <button className={mcpClient === client ? "active" : ""} key={client} onClick={() => setMcpClient(client)}>
                  {clientLabels[client]}
                </button>
              ))}
            </div>
            <div className="config-code">
              <div><span>{clientLabels[mcpClient]}</span><button disabled={!canCopyConfiguration} onClick={() => void copyText(configText(configuration))}><Clipboard size={15} /> COPY</button></div>
              <pre>{configurationDisplay}</pre>
            </div>
            <p className="config-note"><ShieldCheck size={15} /> {mcpTransport === "ztools"
              ? <>先在 ZTools 设置 → MCP 服务中启用服务并替换 API Key；工具名以客户端 <code>tools/list</code> 为准。</>
              : <>配置直接启动 <code>officecli mcp</code>，会绕过插件侧策略，适合可信本机客户端。</>}
            </p>
          </section>

          <section className="registration-panel">
            <div className="panel-title"><span>{mcpTransport === "ztools" ? "ZTOOLS GATEWAY" : "ONE-CLICK REGISTRATION"}</span><strong>{mcpTransport === "ztools" ? "接入步骤" : "客户端注册"}</strong></div>
            {mcpTransport === "ztools" ? (
              <ol className="gateway-steps">
                <li><span>01</span><div><strong>开启宿主服务</strong><small>打开 ZTools 设置 → MCP 服务，启用 HTTP 端点。</small></div></li>
                <li><span>02</span><div><strong>复制 API Key</strong><small>将配置中的占位符替换为设置页生成的 Key。</small></div></li>
                <li><span>03</span><div><strong>刷新 tools/list</strong><small>找到 <code>office_suite_workbench_office_document</code>（实际名称以列表为准）。</small></div></li>
              </ol>
            ) : (["claude", "cursor", "vscode", "lms"] as const).map(target => (
                <div className="client-row" key={target}>
                  <span className="client-monogram">{target.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{target === "lms" ? "LM Studio" : target === "vscode" ? "VS Code" : target[0].toUpperCase() + target.slice(1)}</strong><small>由 OfficeCLI 管理配置</small></span>
                  <button disabled={Boolean(busyLabel)} onClick={() => void changeMcpRegistration(target, "register")}>注册</button>
                  <button disabled={Boolean(busyLabel)} className="subtle" onClick={() => void changeMcpRegistration(target, "unregister")}>移除</button>
                </div>
              ))}
            <div className="registration-state">
              <span>{mcpTransport === "ztools" ? "安全提示" : "当前状态"}</span>
              <pre>{mcpTransport === "ztools"
                ? "宿主端点使用 Bearer Key。不要把 Key 放入仓库、截图或聊天记录；跨设备访问前请同时检查系统防火墙。"
                : mcpStatus ? configText(mcpStatus.ok ? mcpStatus.data : mcpStatus.error) : "尚未读取"}</pre>
            </div>
          </section>
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")} aria-label="返回总览">
          <img src="./logo.svg" alt="" />
          <span><strong>OFFICE / SUITE</strong><small>powered by OfficeCLI</small></span>
        </button>
        <div className="topbar-center"><span>LOCAL DOCUMENT OPERATIONS</span><i /><span>NATIVE AI + MCP</span></div>
        <button className={`runtime-status ${statusPhase} ${officeCliUpdate?.updateAvailable ? "has-update" : ""}`} onClick={openSettings}>
          {statusPhase === "checking" && <LoaderCircle className="spin" size={15} />}
          {statusPhase === "ready" && <Check size={15} />}
          {statusPhase === "missing" && <Unplug size={15} />}
          <span>{statusPhase === "ready"
            ? officeCliUpdate?.updateAvailable
              ? `可更新 ${officeCliUpdate.latestVersion}`
              : `OfficeCLI ${status.version ?? "online"}`
            : statusPhase === "checking" ? "正在探测" : "需要连接"}</span>
          <Settings2 size={14} />
        </button>
      </header>

      <aside className="sidebar">
        <nav>
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} title={item.label}>
                <Icon size={19} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <span>{files.length.toString().padStart(2, "0")}</span>
          <small>DOCS<br />LOADED</small>
        </div>
      </aside>

      <main className="main-canvas">
        {view === "home" && renderHome()}
        {view === "ai" && renderAi()}
        {view === "word" && renderFormatView("word")}
        {view === "excel" && renderFormatView("excel")}
        {view === "powerpoint" && renderFormatView("powerpoint")}
        {view === "console" && renderConsole()}
        {view === "mcp" && renderMcp()}
      </main>

      {lastExecution && view !== "console" && (
        <aside className={`result-drawer ${view === "ai" ? `ai-compact ${resultExpanded ? "expanded" : ""}` : ""}`}>
          <ResultPanel
            execution={lastExecution}
            text={resultText}
            busy={Boolean(busyLabel)}
            onCopy={() => void copyText(resultText)}
            onClose={() => setLastExecution(null)}
            compact={view === "ai"}
            expanded={resultExpanded}
            onToggle={() => setResultExpanded(previous => !previous)}
          />
        </aside>
      )}

      {showSettings && (
          <dialog
            ref={settingsDialogRef}
            className="settings-modal"
            aria-labelledby="settings-title"
            onCancel={event => { event.preventDefault(); closeSettings(); }}
            onClose={() => { setShowSettings(false); restoreSettingsFocus(); }}
          >
            <button className="modal-close" onClick={closeSettings} aria-label="关闭"><X size={18} /></button>
            <span className="section-index">RUNTIME CONNECTION</span>
            <h2 id="settings-title">OfficeCLI 运行时</h2>
            <p>插件只使用 PATH、只读环境变量 <code>OFFICECLI_PATH</code> 与官方常见安装目录中发现的 OfficeCLI，不接受页面指定任意可执行文件。</p>
            <div className="runtime-readout">
              <span>{statusPhase === "ready" ? <Check size={16} /> : <CircleAlert size={16} />}</span>
              <div><strong>{statusPhase === "ready" ? "运行时已连接" : "尚未发现 OfficeCLI"}</strong><small>{status.binaryPath ?? "可直接安装到当前用户目录，无需打开终端"}</small></div>
            </div>
            {officeCliUpdate?.updateAvailable && (
              <div className="runtime-update-card">
                <span><ArrowUpRight size={17} /></span>
                <div>
                  <strong>发现 OfficeCLI {officeCliUpdate.latestVersion}</strong>
                  <small>当前版本 {officeCliUpdate.currentVersion}；更新时继续使用国内镜像与 SHA-256 校验。</small>
                </div>
                <button disabled={updatingOfficeCli || Boolean(busyLabel)} onClick={() => void updateOfficeCli()}>
                  {updatingOfficeCli ? <><LoaderCircle className="spin" size={14} /> 更新中…</> : "一键更新"}
                </button>
              </div>
            )}
            {installError && <div className="install-error"><CircleAlert size={15} />{installError}</div>}
            {officeCliUpdateError && <div className="install-error"><CircleAlert size={15} />{officeCliUpdateError}</div>}
            <div className="modal-actions">
              <button className="button ghost" onClick={() => void window.ztools?.shellOpenExternal?.("https://github.com/iOfficeAI/OfficeCLI")}>
                安装说明 <ExternalLink size={15} />
              </button>
              {statusPhase === "missing" ? (
                <button className="button primary" disabled={installingOfficeCli} onClick={() => void installOfficeCli()}>
                  {installingOfficeCli ? <><LoaderCircle className="spin" size={15} /> 正在安装…</> : "一键安装"}
                </button>
              ) : (
                <>
                  <button className="button ghost" disabled={checkingOfficeCliUpdate} onClick={() => void refreshOfficeCliUpdate(true)}>
                    {checkingOfficeCliUpdate ? <><LoaderCircle className="spin" size={14} /> 检查中…</> : "检查更新"}
                  </button>
                  <button className="button primary" onClick={retryRuntimeDiscovery}>重新探测</button>
                </>
              )}
            </div>
          </dialog>
      )}

      {busyLabel && <div className="busy-pill"><LoaderCircle className="spin" size={15} /> {busyLabel}</div>}
      {toast && <div className="toast"><Check size={15} /> {toast}</div>}
    </div>
  );
}

export default function App() {
  const compatibility = detectZToolsHostCompatibility(window.ztools);
  if (compatibility.requiresUpgrade) {
    return (
      <main className="app-shell upgrade-required" role="alert">
        <section className="panel">
          <span className="section-index">ZTOOLS VERSION REQUIRED</span>
          <h1>请升级 ZTools 后使用 Office 全家桶</h1>
          <p>{compatibility.version
            ? `当前版本 ${compatibility.version} 低于 2.4.0。`
            : "无法确认当前 ZTools 版本。"} 为了获得更完整、稳定的体验，请升级至 ZTools 2.4.0 或更高版本。</p>
        </section>
      </main>
    );
  }
  return <OfficeWorkbenchApp />;
}

function DependencyNotice({
  installing,
  error,
  onInstall,
  onSettings
}: {
  installing: boolean;
  error: string;
  onInstall: () => void;
  onSettings: () => void;
}) {
  return (
    <section className="dependency-notice reveal">
      <CircleAlert size={22} />
      <div>
        <strong>还差一个 OfficeCLI 运行时</strong>
        <span>{error || "优先从国内镜像下载，校验 SHA-256 后安装；镜像不可用时自动回退 GitHub。"}</span>
      </div>
      <button className="dependency-secondary" onClick={onSettings}>更多选项</button>
      <button className="dependency-install" disabled={installing} onClick={onInstall}>
        {installing ? <><LoaderCircle className="spin" size={15} /> 正在安装…</> : <>一键安装 <ChevronRight size={15} /></>}
      </button>
    </section>
  );
}

function DocumentQueue({
  files,
  selectedFile,
  onSelect,
  onAdd,
  onRemove
}: {
  files: string[];
  selectedFile: string;
  onSelect: (path: string) => void;
  onAdd: () => void;
  onRemove: (path: string) => void;
}) {
  return (
    <section className="document-queue">
      <div className="panel-title"><span>DOCUMENT QUEUE</span><strong>已载入文档</strong><button onClick={onAdd}><FilePlus2 size={15} /> 添加</button></div>
      {files.length ? (
        <div className="queue-list">
          {files.slice(0, 6).map(path => {
            const format = detectFormat(path)!;
            const meta = FORMAT_META[format];
            const Icon = meta.icon;
            return (
              <div className={`queue-row ${selectedFile === path ? "selected" : ""}`} key={path}>
                <button className="queue-select" onClick={() => onSelect(path)}>
                  <span className={`queue-icon ${meta.className}`}><Icon size={17} /></span>
                  <span><strong>{basename(path)}</strong><small>{path}</small></span>
                  <i>{meta.extension}</i>
                </button>
                <button className="remove-file" aria-label={`移除 ${basename(path)}`} onClick={() => onRemove(path)}><X size={14} /></button>
              </div>
            );
          })}
        </div>
      ) : (
        <button className="queue-empty" onClick={onAdd}><FolderOpen size={23} /><span><strong>尚未载入文档</strong><small>选择 docx、xlsx 或 pptx 开始</small></span></button>
      )}
    </section>
  );
}

function ActivityList({ history, onOpenConsole }: { history: HistoryItem[]; onOpenConsole: () => void }) {
  return (
    <section className="activity-list">
      <div className="panel-title"><span>RECENT RUNS</span><strong>最近执行</strong><button onClick={onOpenConsole}>命令台 <ArrowUpRight size={14} /></button></div>
      {history.length ? history.slice(0, 5).map(item => (
        <div className="activity-row" key={item.id}>
          <span className={item.ok ? "success" : "failure"}>{item.ok ? <Check size={13} /> : <X size={13} />}</span>
          <span><strong>{item.label}</strong><code>{item.command}</code></span>
          <time><Clock3 size={12} />{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
      )) : <div className="activity-empty"><Activity size={22} /><span>执行记录会保存在本机</span></div>}
    </section>
  );
}

function ResultPanel({
  execution,
  text,
  busy,
  onCopy,
  onClose,
  compact = false,
  expanded = false,
  onToggle
}: {
  execution: LastExecution | null;
  text: string;
  busy: boolean;
  onCopy: () => void;
  onClose?: () => void;
  compact?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const ok = execution?.result.ok;
  const showDetails = !compact || expanded;
  return (
    <section className={`result-panel ${compact ? "is-compact" : ""} ${expanded ? "is-expanded" : ""}`}>
      <div className="result-title">
        <span className={execution ? (ok ? "success" : "failure") : "idle"}>{busy ? <LoaderCircle className="spin" size={14} /> : ok ? <Check size={14} /> : execution ? <X size={14} /> : <Code2 size={14} />}</span>
        <span><small>COMMAND OUTPUT</small><strong>{execution?.label ?? "等待执行"}</strong></span>
        <div className="result-actions">
          <button onClick={onCopy} title="复制结果"><Clipboard size={15} /></button>
          {compact && onToggle && (
            <button className={`result-toggle ${expanded ? "expanded" : ""}`} onClick={onToggle} title={expanded ? "收起详情" : "展开详情"}>
              <ChevronRight size={15} />
            </button>
          )}
          {onClose && <button onClick={onClose} title="关闭"><X size={15} /></button>}
        </div>
      </div>
      {execution && <code className="executed-command">$ officecli {execution.command}</code>}
      {showDetails && execution?.result.ok && Boolean(execution.result.data.previewImages?.length) && (
        <div className="result-previews" aria-label="视觉预览">
          {execution.result.data.previewImages?.map(preview => (
            <figure key={preview.path}>
              <button
                type="button"
                title="用系统默认应用打开图片"
                onClick={() => void window.ztools?.shellOpenPath?.(preview.path)}
              >
                <img src={preview.dataUrl} alt={`OfficeCLI 视觉预览：${basename(preview.path)}`} />
              </button>
              <figcaption title={preview.path}>{basename(preview.path)}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {showDetails && <pre>{text}</pre>}
    </section>
  );
}
