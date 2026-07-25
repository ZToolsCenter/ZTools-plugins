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
import { OFFICE_AI_TOOL, normalizeOfficeAiToolInput } from "./lib/ai";
import { parseStoredHistory, type HistoryItem } from "./lib/history";
import type {
  ApiResult,
  McpConfigurations,
  McpProbe,
  OfficeCliRunOutput,
  OfficeCliStatus,
  OfficeFormat,
  ViewId,
  ZToolsAiModel,
  ZToolsAiRequest
} from "./types";

type StatusPhase = "checking" | "ready" | "missing";
type ClientId = "generic" | "codex" | "claude" | "cursor" | "vscode";
type McpTransport = "ztools" | "stdio";

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

export default function App() {
  const [view, setView] = useState<ViewId>("home");
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [statusPhase, setStatusPhase] = useState<StatusPhase>("checking");
  const [status, setStatus] = useState<OfficeCliStatus>({ installed: false });
  const [showSettings, setShowSettings] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>(loadStoredHistory);
  const [lastExecution, setLastExecution] = useState<LastExecution | null>(null);
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
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [allowAiWrite, setAllowAiWrite] = useState(false);
  const activeOperationRef = useRef<{ token: symbol; label: string } | null>(null);
  const statusRequestRef = useRef(0);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const aiRequestRef = useRef<ZToolsAiRequest | null>(null);
  const allowAiWriteRef = useRef(false);
  const selectedFileRef = useRef("");

  const selectedFormat = selectedFile ? detectFormat(selectedFile) : null;
  const resultText = useMemo(() => executionText(lastExecution), [lastExecution]);

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

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

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
    if (statusPhase === "ready") return;
    setMcpConfigs(null);
    setMcpProbe(null);
    setMcpStatus(null);
  }, [statusPhase]);

  useEffect(() => {
    allowAiWriteRef.current = allowAiWrite;
  }, [allowAiWrite]);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

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
      setAiModels(models);
      setAiModel(previous => previous && models.some(model => model.id === previous)
        ? previous
        : models[0]?.id ?? "");
      if (!models.length) setAiError("请先在 ZTools 设置中添加 AI 模型。");
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
    const officeDocument = async (input: Record<string, unknown>) => {
      if (!window.officeSuite) {
        return { ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "OfficeCLI bridge unavailable." } };
      }
      let command: string | string[];
      try {
        command = normalizeOfficeAiToolInput(input, selectedFileRef.current);
      } catch (error) {
        const failure: ApiResult<OfficeCliRunOutput> = {
          ok: false,
          error: {
            code: "AI_TOOL_INPUT_INVALID",
            message: error instanceof Error ? error.message : "Invalid office_document input."
          }
        };
        setLastExecution({ label: "AI 工具调用", command: "参数校验失败", result: failure });
        return failure;
      }
      const result = await window.officeSuite.runForAi(command, {
        allowWrite: allowAiWriteRef.current
      });
      const printable = Array.isArray(command) ? formatCommand(command) : command;
      setLastExecution({ label: "AI 工具调用", command: printable, result });
      if (!result.ok) return result;
      const { previewImages: _previewImages, ...safeOutput } = result.data;
      return { ok: true, ...safeOutput };
    };
    window.office_document = officeDocument;
    return () => {
      if (window.office_document === officeDocument) delete window.office_document;
    };
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
    if (!prompt || aiBusy) return;
    if (!window.ztools?.ai) {
      setAiError("当前 ZTools 版本未提供原生 AI API。");
      return;
    }
    if (!aiModel) {
      setAiError("请先在 ZTools 设置中添加并选择 AI 模型。");
      return;
    }

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
    setAiError("");
    setAiBusy(true);

    const selectedContext = selectedFile
      ? `The currently selected document is: ${selectedFile}`
      : "No document is currently selected. Ask for an absolute path when one is required.";
    const systemPrompt = [
      "You are the native Office assistant inside ZTools.",
      "Use the office_document function for factual document inspection and every claimed file operation.",
      "Call office_document with operation, filePath, and args. To read content use operation=view and args=[\"text\"]; never use read as an operation.",
      "Use absolute paths and read operations before edits.",
      "Use help or load_skill when OfficeCLI syntax is uncertain.",
      "If a tool returns AI_WRITE_APPROVAL_REQUIRED, explain that the user must enable the modification switch; never claim the file changed.",
      "Summarize successful changes and report tool errors honestly.",
      selectedContext
    ].join(" ");

    let request: ZToolsAiRequest;
    try {
      request = window.ztools.ai({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          ...conversation.map(message => ({ role: message.role, content: message.content }))
        ],
        tools: [OFFICE_AI_TOOL]
      }, chunk => {
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
      setAiError(error instanceof Error ? error.message : "ZTools AI 请求启动失败。");
      setAiBusy(false);
      setAllowAiWrite(false);
      allowAiWriteRef.current = false;
      return;
    }
    aiRequestRef.current = request;

    try {
      await request;
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "ZTools AI 请求失败。");
    } finally {
      if (aiRequestRef.current === request) aiRequestRef.current = null;
      setAiBusy(false);
      setAllowAiWrite(false);
      allowAiWriteRef.current = false;
    }
  };

  const stopAiMessage = () => {
    aiRequestRef.current?.abort();
    aiRequestRef.current = null;
    setAiBusy(false);
    setAllowAiWrite(false);
    allowAiWriteRef.current = false;
    setAiError("已停止本次生成。");
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

      {statusPhase === "missing" && <DependencyNotice onSettings={openSettings} />}

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
        <div>
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
            {aiModels.map(model => <option value={model.id} key={model.id}>{model.label}</option>)}
          </select>
          <small>{aiModels.find(model => model.id === aiModel)?.description || "来自 ZTools 设置"}</small>
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
          <label className={`ai-write-toggle ai-write-inline ${allowAiWrite ? "enabled" : ""}`}>
            <input
              type="checkbox"
              checked={allowAiWrite}
              disabled={aiBusy}
              onChange={event => setAllowAiWrite(event.target.checked)}
            />
            <span><ShieldCheck size={18} /></span>
            <div>
              <strong>{allowAiWrite ? "已允许修改文件" : "需要 AI 修改文件？先开启写入授权"}</strong>
              <small>仅下一次发送有效；关闭时只允许读取、检查和预览。</small>
            </div>
          </label>
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
            {aiBusy ? (
              <button className="ai-send stop" onClick={stopAiMessage}><X size={16} />停止</button>
            ) : (
              <button
                className="ai-send"
                disabled={!aiPrompt.trim() || !aiModel || statusPhase !== "ready"}
                onClick={() => void sendAiMessage()}
              ><ArrowUpRight size={16} />发送</button>
            )}
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
        <button className={`runtime-status ${statusPhase}`} onClick={openSettings}>
          {statusPhase === "checking" && <LoaderCircle className="spin" size={15} />}
          {statusPhase === "ready" && <Check size={15} />}
          {statusPhase === "missing" && <Unplug size={15} />}
          <span>{statusPhase === "ready" ? `OfficeCLI ${status.version ?? "online"}` : statusPhase === "checking" ? "正在探测" : "需要连接"}</span>
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
        <aside className="result-drawer">
          <ResultPanel
            execution={lastExecution}
            text={resultText}
            busy={Boolean(busyLabel)}
            onCopy={() => void copyText(resultText)}
            onClose={() => setLastExecution(null)}
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
              <div><strong>{statusPhase === "ready" ? "运行时已连接" : "尚未发现 OfficeCLI"}</strong><small>{status.binaryPath ?? "安装后重启 ZTools，或设置 OFFICECLI_PATH"}</small></div>
            </div>
            <div className="modal-actions">
              <button className="button ghost" onClick={() => void window.ztools?.shellOpenExternal?.("https://github.com/iOfficeAI/OfficeCLI")}>
                安装说明 <ExternalLink size={15} />
              </button>
              <button className="button primary" onClick={retryRuntimeDiscovery}>重新探测</button>
            </div>
          </dialog>
      )}

      {busyLabel && <div className="busy-pill"><LoaderCircle className="spin" size={15} /> {busyLabel}</div>}
      {toast && <div className="toast"><Check size={15} /> {toast}</div>}
    </div>
  );
}

function DependencyNotice({ onSettings }: { onSettings: () => void }) {
  return (
    <section className="dependency-notice reveal">
      <CircleAlert size={22} />
      <div><strong>还差一个 OfficeCLI 运行时</strong><span>插件不会捆绑或静默安装第三方二进制；安装后即可获得全部文档与 MCP 能力。</span></div>
      <code>curl -fsSL https://d.officecli.ai/install.sh | bash</code>
      <button onClick={onSettings}>检查路径 <ChevronRight size={15} /></button>
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
  onClose
}: {
  execution: LastExecution | null;
  text: string;
  busy: boolean;
  onCopy: () => void;
  onClose?: () => void;
}) {
  const ok = execution?.result.ok;
  return (
    <section className="result-panel">
      <div className="result-title">
        <span className={execution ? (ok ? "success" : "failure") : "idle"}>{busy ? <LoaderCircle className="spin" size={14} /> : ok ? <Check size={14} /> : execution ? <X size={14} /> : <Code2 size={14} />}</span>
        <span><small>COMMAND OUTPUT</small><strong>{execution?.label ?? "等待执行"}</strong></span>
        <button onClick={onCopy} title="复制结果"><Clipboard size={15} /></button>
        {onClose && <button onClick={onClose} title="关闭"><X size={15} /></button>}
      </div>
      {execution && <code className="executed-command">$ officecli {execution.command}</code>}
      {execution?.result.ok && Boolean(execution.result.data.previewImages?.length) && (
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
      <pre>{text}</pre>
    </section>
  );
}
