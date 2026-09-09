<script setup>
import {
  computed,
  defineAsyncComponent,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Ellipsis,
  Files,
  Folder,
  FolderOpen,
  GitFork,
  Globe2,
  ImagePlus,
  ListTodo,
  MessageSquarePlus,
  Pencil,
  Plus,
  Send,
  Settings,
  Square,
  Terminal,
  Wrench,
  X,
} from "@lucide/vue";
import MessageText from "./components/MessageText.vue";
import AssistantTurnActions from "./components/AssistantTurnActions.vue";
import ContextCompaction from "./components/ContextCompaction.vue";
import ContextMeter from "./components/ContextMeter.vue";
import ImageGallery from "./components/ImageGallery.vue";
import ModelReasoningPicker from "./components/ModelReasoningPicker.vue";
import QueueDock from "./components/QueueDock.vue";
import NewChatIcon from "./components/NewChatIcon.vue";
import PanelLeftIcon from "./components/PanelLeftIcon.vue";
import ReasoningPanel from "./components/ReasoningPanel.vue";
import ToolCall from "./components/ToolCall.vue";
import WorkspaceHoverCard from "./components/WorkspaceHoverCard.vue";
import WorkspacePicker from "./components/WorkspacePicker.vue";
import {
  DEFAULT_CONTEXT_POLICY,
  analyzeCompactionCandidate,
  applyUsageCalibration,
  buildCompactionMessages,
  buildContextProjection,
  createCompactedContextState,
  createContextCompactionMarker,
  createEmptyContextState,
  estimateContextTokens,
  estimateTextTokens,
  isContextWindowExceededError,
  appendContextCompactionMarker,
  normalizeContextState,
  normalizeContextWindow,
  projectContextTokens,
  shouldCompactContext,
  validateCompactionSummary,
} from "./services/context-compaction";
import {
  finalizeAssistantAfterChatFailure,
  resetAssistantForChatRetry,
} from "./services/assistant-attempt";
import { createConversationRuntime } from "./services/conversation-runtime";
import { createConversationHistoryRuntime } from "./services/conversation-history-runtime";
import { groupConversationsByWorkspace } from "./services/conversation-groups";
import {
  executeScheduledToolCalls,
  normalizeToolConcurrencyLimit,
} from "./services/tool-scheduler";
import {
  applyStreamingToolCallDelta,
  normalizeToolCalls,
} from "./services/tool-call-stream";
import {
  createReasoningEffortOptions,
  resolveSupportedReasoningEffort,
} from "./services/reasoning-options";
import {
  DEFAULT_RESIDENT_RUNTIME_LIMIT,
  selectRuntimeEvictions,
} from "./services/runtime-cache";
import { createConversationScrollController } from "./services/conversation-scroll";
import {
  QUEUED_PLACEMENT,
  STEERING_PLACEMENT,
  appendPendingMessage,
  claimPendingMessages,
  createPendingMessage,
  editPendingMessage,
  recoverConversationInbox,
  removePendingMessage,
  steerPendingMessage,
} from "./services/conversation-inbox";
import {
  createChatFailureSnapshot,
  createChatRetryState,
  createEmptyChatRetryState,
} from "./services/chat-retry";
import {
  ALL_TOOLS,
  DEFAULT_ENABLED_TOOLS,
  getModelTools,
  PLUGIN_DEVELOPMENT_TOOL_GROUPS,
  buildSystemPrompt,
  getToolExecutionMode,
  isShellToolName,
  TOOL_GROUPS,
} from "./tools";
import { isSupportedZToolsVersion } from "./utils/app-version";

const MIN_ZTOOLS_VERSION = "3.2.0";

/**
 * 在聊天正文真正需要渲染时加载 Markdown AST 与渲染组件。
 * @returns {Promise<Record<string, unknown>>} Markdown 组件模块。
 */
function loadMarkdownContentComponent() {
  return import("./components/MarkdownContent.vue");
}

const MarkdownContent = defineAsyncComponent({
  loader: loadMarkdownContentComponent,
  delay: 0,
  suspensible: false,
});

const bridge = window.zvcBridge;
const ztoolsVersion = ref("");
const ztoolsVersionCheckPending = ref(true);
const ztoolsVersionSupported = ref(false);
const isZToolsVersionUnsupported = computed(
  () => !ztoolsVersionCheckPending.value && !ztoolsVersionSupported.value,
);

async function checkZToolsVersion() {
  try {
    const getAppVersion = window.ztools?.getAppVersion;
    if (typeof getAppVersion !== "function") {
      throw new Error("ZTools getAppVersion API is unavailable");
    }

    const version = await Promise.resolve(getAppVersion.call(window.ztools));
    ztoolsVersion.value = String(version ?? "").trim();
    ztoolsVersionSupported.value = isSupportedZToolsVersion(
      ztoolsVersion.value,
      MIN_ZTOOLS_VERSION,
    );
  } catch (error) {
    console.error("获取 ZTools 版本失败:", error);
  } finally {
    ztoolsVersionCheckPending.value = false;
  }
}

const conversationHistoryRuntime = createConversationHistoryRuntime({
  bridge,
  markRaw,
  onTrace: (event, details) => trace(event, details),
  messageHasImages: (message) => getMessageImages(message).length > 0,
});
const {
  getExecutionMessages,
  ensureExecutionMessages,
  markMessageDirty: markRuntimeMessageDirty,
  appendMessage: appendRuntimeMessage,
  replaceMessages: replaceExecutionMessages,
  findToolCallMessage,
  captureChanges: captureRuntimeMessageChanges,
  acknowledgeChanges: acknowledgeRuntimeMessageChanges,
} = conversationHistoryRuntime;
const workspaces = ref([]);
const conversations = ref([]);
const skills = ref([]);
const runtimePlatform = ref("");
const activeConversationId = ref("");
const defaultSelectedModel = ref("");
const hostModels = ref([]);
const conversationRuntimes = reactive(new Map());
let defaultAutoApproveTools = true;
const emptyRuntime = reactive(
  createConversationRuntime(
    { id: "", contextState: createEmptyContextState() },
    {
      defaultTools: DEFAULT_ENABLED_TOOLS,
      defaultAutoApprove: defaultAutoApproveTools,
      normalizeContextState,
    },
  ),
);
const activeRuntime = computed(
  () => conversationRuntimes.get(activeConversationId.value) || emptyRuntime,
);
const selectedModel = computed({
  get: () => activeRuntime.value.modelKey || defaultSelectedModel.value,
  set: (value) => {
    const modelKey = String(value || "");
    const nextModel = modelOptions.value.find(
      (option) => option.value === modelKey,
    );
    if (
      nextModel &&
      !nextModel.inputModalities?.includes("image") &&
      conversationHasImages(activeRuntime.value)
    ) {
      activeRuntime.value.error =
        "当前会话包含图片，不能切换到未启用图片输入的模型。";
      return;
    }
    // 选择器写入当前会话，确保切换会话或重载后仍恢复本会话模型。
    activeRuntime.value.modelKey = modelKey;
    activeRuntime.value.reasoningEffort = resolveSupportedReasoningEffort(
      activeRuntime.value.reasoningEffort,
      nextModel || null,
    );
    defaultSelectedModel.value = modelKey;
    if (activeRuntime.value.id) void persistConversation(activeRuntime.value);
    bridge?.saveSelectedModel(modelKey);
    void refreshContextMeter(activeRuntime.value);
    // 恢复队列曾因模型缺失暂停时，用户完成选择后立即继续当前会话。
    if (modelKey && activeRuntime.value.pendingMessages.length)
      startConversationScheduler(activeRuntime.value);
  },
});
const activeWorkspaceId = bindActiveRuntimeField("projectId");
const workspaceLocked = bindActiveRuntimeField("workspaceLocked");
const messages = bindActiveRuntimeField("messages");
const displayedMessages = computed(() => messages.value);
const hasOlderMessages = computed(
  () => activeRuntime.value.historyHasMore === true,
);
const contextState = bindActiveRuntimeField("contextState");
const contextMeter = bindActiveRuntimeField("contextMeter");
const tasks = bindActiveRuntimeField("tasks");
const tasksCollapsed = ref(true);
const input = bindActiveRuntimeField("input");
const inputAttachments = bindActiveRuntimeField("inputAttachments");
const pendingMessages = bindActiveRuntimeField("pendingMessages");
const busy = bindActiveRuntimeField("busy");
const compacting = bindActiveRuntimeField("compacting");
const activeTurnElapsedSeconds = bindActiveRuntimeField(
  "activeTurnElapsedSeconds",
);
const requestId = bindActiveRuntimeField("requestId");
const createOpen = ref(false);
const workspaceName = ref("");
const collapsedWorkspaceIds = ref([]);
const expandedWorkspaceConversationIds = ref([]);
const sidebarOpen = ref(true);
const sidebarWidth = ref(220);
const sidebarResizing = ref(false);
const sidebarNow = ref(Date.now());
const conversationMenu = ref(null);
const conversationRenameTarget = ref(null);
const conversationRenameDraft = ref("");
const conversationRenameError = ref("");
const conversationRenaming = ref(false);
const renameIsComposing = ref(false);
const error = bindActiveRuntimeField("error");
const isComposing = ref(false);
const autoApproveTools = bindActiveRuntimeField("autoApproveTools");
const enabledToolNames = bindActiveRuntimeField("enabledToolNames");
const enabledSkills = bindActiveRuntimeField("enabledSkills");
const capabilitiesOpen = ref(false);
const settingsOpen = ref(false);
const streamBatchIntervalMs = ref(50);
const autoCompactionThresholdPercent = ref(70);
const toolConcurrencyLimit = ref(10);
const collapsedCapabilityGroups = reactive(
  Object.fromEntries(TOOL_GROUPS.map((group) => [group.id, true])),
);
const chatScroller = ref(null);
const chatContent = ref(null);
const taskStrip = ref(null);
const composerSeat = ref(null);
const composerInput = ref(null);
const attachmentInput = ref(null);
const composerDraggingImage = ref(false);
const submissionModeOpen = ref(false);
const busySubmissionMode = ref(QUEUED_PLACEMENT);
const autoScrollMessages = bindActiveRuntimeField("autoScrollMessages");
const pendingApprovals = reactive(new Map());
const pendingToolCancellations = new Map();
const persistenceTails = new Map();
const TOOL_EXECUTION_CANCELLED = Symbol("tool-execution-cancelled");
const UNFINISHED_TOOL_STATUSES = new Set([
  "streaming",
  "queued",
  "waiting",
  "running",
]);
const DEFAULT_TOOL_EXECUTION_TIMEOUT_MS = 130000;
const SHELL_DEFAULT_TIMEOUT_MS = 120000;
const SHELL_MAX_TIMEOUT_MS = 600000;
const TOOL_EXECUTION_TIMEOUT_GRACE_MS = 10000;
const MESSAGE_FOLLOW_THRESHOLD = 24;
const MAX_MESSAGE_IMAGES = 20;
const MAX_MESSAGE_IMAGE_BYTES = 100 * 1024 * 1024;
const COLLAPSED_WORKSPACE_CONVERSATION_LIMIT = 5;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
let messageResizeObserver = null;
const observedMessageResizeTargets = new Set();
let sidebarResizeOriginX = 0;
let sidebarResizeBaseWidth = 0;
let sidebarResizeLatestX = 0;
let sidebarResizeRaf = 0;
let sidebarTimeClock = 0;
let conversationSelectionGeneration = 0;
const STREAM_BATCH_INTERVAL_OPTIONS = [0, 20, 30, 50, 100, 200];
const AUTO_COMPACTION_THRESHOLD_OPTIONS = [50, 60, 70, 75, 80, 85, 90, 95];
const TOOL_CONCURRENCY_LIMIT_OPTIONS = [1, 2, 3, 5, 10, 15, 20];
const REASONING_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const REASONING_EFFORT_LABELS = {
  off: '关闭',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
}

const conversationScroll = createConversationScrollController({
  getActiveSessionId: () => activeConversationId.value,
  isPinned: (sessionId) =>
    conversationRuntimes.get(sessionId)?.autoScrollMessages !== false,
  setPinned: (sessionId, pinned) => {
    const runtime = conversationRuntimes.get(sessionId);
    if (runtime) runtime.autoScrollMessages = pinned;
  },
  threshold: MESSAGE_FOLLOW_THRESHOLD,
});

/**
 * 将一个字段代理到当前活动会话运行时，同时保留原有 ref 读写接口。
 * @param {string} field 会话运行时字段名。
 * @returns {import('vue').WritableComputedRef<unknown>} 当前会话字段的可写计算引用。
 */
function bindActiveRuntimeField(field) {
  return computed({
    get: () => activeRuntime.value[field],
    set: (value) => {
      activeRuntime.value[field] = value;
    },
  });
}

/**
 * 从持久化会话快照创建并登记响应式运行时。
 * @param {Record<string, unknown>} conversation 会话快照。
 * @returns {Record<string, unknown>} 已登记的响应式会话运行时。
 */
function registerConversationRuntime(conversation) {
  const runtime = reactive(
    createConversationRuntime(conversation, {
      defaultTools: DEFAULT_ENABLED_TOOLS,
      defaultAutoApprove: defaultAutoApproveTools,
      normalizeContextState,
    }),
  );
  // 旧会话只在模型 ID 唯一时迁移，避免同名模型被静默绑定到错误供应商。
  runtime.modelKey = modelOptions.value.length
    ? resolveHostModelKey(runtime.modelKey)
    : String(runtime.modelKey || "");
  const modelOption =
    modelOptions.value.find((option) => option.value === runtime.modelKey) ||
    null;
  if (modelOption)
    runtime.reasoningEffort = resolveSupportedReasoningEffort(
      runtime.reasoningEffort,
      modelOption,
    );
  // Skill 列表属于动态能力，登记时只保留当前仍存在的标识。
  runtime.enabledSkills = normalizeEnabledSkills(runtime.enabledSkills);
  conversationRuntimes.set(runtime.id, runtime);
  trace("conversation:runtime-registered", {
    conversationId: runtime.id,
    visibleMessages: runtime.messages.length,
    totalMessages: runtime.historyTotal,
    hasMore: runtime.historyHasMore,
  });
  return runtime;
}

/**
 * 回收超过容量且已完全静止的后台会话运行时。
 * @returns {void} 无返回值。
 */
function evictIdleConversationRuntimes() {
  const pendingIds = new Set(persistenceTails.keys());
  const candidates = selectRuntimeEvictions(conversationRuntimes.values(), {
    activeId: activeConversationId.value,
    limit: DEFAULT_RESIDENT_RUNTIME_LIMIT,
    pendingIds,
  });
  // 前端运行时与 preload 快照必须一起释放，避免完整历史仍在另一侧常驻。
  for (const id of candidates) {
    conversationRuntimes.delete(id);
    conversationHistoryRuntime.release(id);
    bridge?.releaseConversation?.(id);
  }
}

/**
 * 记录最近的前端诊断事件，便于排查流式响应和工具调用状态。
 * @param {string} event 事件名称。
 * @param {Record<string, unknown>} details 事件附加信息。
 * @returns {void} 无返回值。
 */
const trace = (event, details = {}) => {
  const entry = { at: Date.now(), event, ...details };
  window.__zvcTrace = [...(window.__zvcTrace || []), entry].slice(-100);
  console.log("[ZVC]", event, details);
};

const messageTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 将消息时间戳格式化为悬停时显示的本地时分。
 * @param {unknown} timestamp 消息时间戳。
 * @returns {string} `HH:mm` 格式的本地时间；时间戳无效时返回空字符串。
 */
function formatMessageTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "";
  return messageTimeFormatter.format(new Date(value));
}

/**
 * 按 Harness 的时间分桶规则生成会话列表中的紧凑相对时间。
 * @param {unknown} updatedAt 会话最后更新时间。
 * @returns {string} `刚刚`、分钟、小时、天、月或年格式的相对时间。
 */
function formatConversationRelativeTime(updatedAt) {
  const value = Number(updatedAt);
  if (!Number.isFinite(value) || value <= 0) return "";
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  const difference = Math.max(0, sidebarNow.value - value);
  if (difference < minute) return "刚刚";
  if (difference < hour) return `${Math.floor(difference / minute)}分钟`;
  if (difference < day) return `${Math.floor(difference / hour)}小时`;
  if (difference < 30 * day) return `${Math.floor(difference / day)}天`;
  if (difference < 365 * day)
    return `${Math.floor(difference / (30 * day))}个月`;
  return `${Math.floor(difference / (365 * day))}年`;
}

/**
 * 按更新时间倒序排列会话，确保最近活动会话保持在列表前方。
 * @param {Array<Record<string, unknown>>} items 待排序的会话列表。
 * @returns {Array<Record<string, unknown>>} 新的倒序会话数组。
 */
function sortConversationsByUpdatedAt(items) {
  return [...items].sort(
    (left, right) => Number(right.updatedAt) - Number(left.updatedAt),
  );
}

/**
 * 关闭当前会话行的操作菜单。
 * @returns {void} 无返回值。
 */
function closeConversationMenu() {
  conversationMenu.value = null;
}

/**
 * 根据三点按钮位置打开会话操作菜单，并避免菜单超出窗口边界。
 * @param {Record<string, unknown>} conversation 目标会话。
 * @param {MouseEvent} event 三点按钮点击事件。
 * @returns {void} 无返回值。
 */
function openConversationMenu(conversation, event) {
  const rect = event.currentTarget?.getBoundingClientRect?.();
  if (!rect) return;
  const width = 184;
  const height = 132;
  const margin = 8;
  let left = rect.right + 6;
  if (left + width > window.innerWidth - margin)
    left = Math.max(margin, rect.left - width - 6);
  const top = Math.min(
    Math.max(margin, rect.bottom + 4),
    Math.max(margin, window.innerHeight - height - margin),
  );
  conversationMenu.value = { conversationId: conversation.id, left, top };
}

/**
 * 打开会话重命名弹窗并选中现有标题。
 * @param {Record<string, unknown>} conversation 目标会话。
 * @returns {void} 无返回值。
 */
function openConversationRename(conversation) {
  closeConversationMenu();
  conversationRenameTarget.value = conversation;
  conversationRenameDraft.value = String(conversation.title || "");
  conversationRenameError.value = "";
  nextTick(() =>
    document.querySelector("#conversation-rename-input")?.select(),
  );
}

/**
 * 在没有保存进行中时关闭会话重命名弹窗。
 * @returns {void} 无返回值。
 */
function closeConversationRename() {
  if (conversationRenaming.value) return;
  conversationRenameTarget.value = null;
  conversationRenameError.value = "";
}

/**
 * 保存会话新标题并同步列表顺序。
 * @returns {Promise<void>} 保存完成或错误展示完成后的 Promise。
 */
async function renameConversation() {
  const target = conversationRenameTarget.value;
  const title = conversationRenameDraft.value.trim();
  if (!target || !title || conversationRenaming.value) return;
  conversationRenaming.value = true;
  conversationRenameError.value = "";
  try {
    // 后端完成长度限制和 JSONL 追加后，再提交界面状态。
    const saved = await bridge?.updateConversation(target.id, { title });
    if (!saved) throw new Error("会话不存在");
    conversations.value = sortConversationsByUpdatedAt(
      conversations.value.map((item) => (item.id === saved.id ? saved : item)),
    );
    conversationRenameTarget.value = null;
  } catch (event) {
    conversationRenameError.value = event.message || "重命名会话失败";
  } finally {
    conversationRenaming.value = false;
  }
}

/**
 * 处理重命名输入框的回车键，并避开中文输入法候选确认。
 * @param {KeyboardEvent} event 输入框键盘事件。
 * @returns {void} 无返回值。
 */
function handleConversationRenameKeydown(event) {
  if (event.key !== "Enter" || renameIsComposing.value) return;
  event.preventDefault();
  void renameConversation();
}

/**
 * 从目标会话的指定 Turn 或最后一个完整 Turn 创建分叉并立即切换。
 * @param {Record<string, unknown>} conversation 源会话。
 * @param {string} turnId 可选的目标 Turn 标识；为空时使用最后一个完整 Turn。
 * @returns {Promise<void>} 分叉创建和会话切换完成后的 Promise。
 */
async function forkConversationItem(conversation, turnId = "") {
  closeConversationMenu();
  const runtime = conversationRuntimes.get(conversation.id);
  // 先等待已经排队的保存，确保分叉读取到源会话最新的完整历史。
  if (runtime) await persistConversation(runtime);
  const forked = await bridge?.forkConversation(conversation.id, turnId);
  if (!forked) return;
  if (!conversationRuntimes.has(forked.id)) registerConversationRuntime(forked);
  conversations.value = sortConversationsByUpdatedAt([
    forked,
    ...conversations.value.filter((item) => item.id !== forked.id),
  ]);
  await selectConversation(forked.id);
}

/**
 * 从指定助手消息所在的完整 Turn 创建分叉会话。
 * @param {Record<string, unknown>} message 目标助手消息。
 * @returns {Promise<void>} 分叉创建和会话切换完成后的 Promise。
 */
async function forkConversationFromMessage(message) {
  const conversation = conversations.value.find(
    (item) => item.id === activeConversationId.value,
  );
  const turnId = String(message?.turnId || "");
  if (!conversation || !turnId) return;
  await forkConversationItem(conversation, turnId);
}

/**
 * 归档指定会话并在需要时选择一个仍可见的后继会话。
 * @param {Record<string, unknown>} conversation 目标会话。
 * @returns {Promise<void>} 归档和活动会话切换完成后的 Promise。
 */
async function archiveConversationItem(conversation) {
  closeConversationMenu();
  const archived = await bridge?.archiveConversation(conversation.id);
  if (!archived) return;
  // 归档只从普通列表隐藏，运行时和 JSONL 日志继续保留。
  conversations.value = conversations.value.filter(
    (item) => item.id !== conversation.id,
  );
  if (conversation.id !== activeConversationId.value) return;
  const next = conversations.value[0];
  if (next) await selectConversation(next.id);
  else newConversation();
}

/**
 * 分派当前会话菜单操作，并在执行前验证目标仍位于普通会话列表。
 * @param {'rename'|'fork'|'archive'} action 菜单操作标识。
 * @returns {Promise<void>} 菜单操作处理完成后的 Promise。
 */
async function handleConversationMenuAction(action) {
  const conversation = conversations.value.find(
    (item) => item.id === conversationMenu.value?.conversationId,
  );
  if (!conversation) {
    closeConversationMenu();
    return;
  }
  if (action === "rename") openConversationRename(conversation);
  else if (action === "fork") await forkConversationItem(conversation);
  else if (action === "archive") await archiveConversationItem(conversation);
}

/**
 * 将侧栏目标宽度限制在可用拖拽范围内。
 * @param {number} width 用户拖拽得到的目标宽度。
 * @returns {number} 取整并限制后的侧栏宽度。
 */
function clampSidebarWidth(width) {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

/**
 * 根据最新指针横坐标更新侧栏宽度。
 * @param {number} clientX 指针相对视口的横坐标。
 * @returns {void} 无返回值。
 */
function applySidebarResize(clientX) {
  sidebarWidth.value = clampSidebarWidth(
    sidebarResizeBaseWidth + clientX - sidebarResizeOriginX,
  );
}

/**
 * 将高频侧栏拖拽事件合并到下一绘制帧。
 * @returns {void} 无返回值。
 */
function scheduleSidebarResize() {
  if (sidebarResizeRaf) return;
  sidebarResizeRaf = requestAnimationFrame(() => {
    sidebarResizeRaf = 0;
    applySidebarResize(sidebarResizeLatestX);
  });
}

/**
 * 开始侧栏宽度拖拽并捕获当前指针。
 * @param {PointerEvent} event 侧栏分隔区域的指针按下事件。
 * @returns {void} 无返回值。
 */
function handleSidebarResizePointerDown(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  // 以拖拽开始时的实际宽度为基准，避免连续增量产生累积误差。
  sidebarResizeOriginX = event.clientX;
  sidebarResizeLatestX = event.clientX;
  sidebarResizeBaseWidth = sidebarWidth.value;
  event.currentTarget.setPointerCapture(event.pointerId);
  sidebarResizing.value = true;
}

/**
 * 记录侧栏拖拽中的最新指针位置并调度宽度刷新。
 * @param {PointerEvent} event 侧栏分隔区域的指针移动事件。
 * @returns {void} 无返回值。
 */
function handleSidebarResizePointerMove(event) {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
  sidebarResizeLatestX = event.clientX;
  scheduleSidebarResize();
}

/**
 * 完成或取消侧栏拖拽，并提交最后一次指针位置。
 * @param {PointerEvent} event 侧栏分隔区域的指针结束事件。
 * @returns {void} 无返回值。
 */
function finishSidebarResize(event) {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
  // 结束时取消尚未执行的帧任务，并同步提交最终位置。
  if (sidebarResizeRaf) cancelAnimationFrame(sidebarResizeRaf);
  sidebarResizeRaf = 0;
  sidebarResizeLatestX = event.clientX;
  applySidebarResize(sidebarResizeLatestX);
  event.currentTarget.releasePointerCapture(event.pointerId);
  sidebarResizing.value = false;
}

/**
 * 获取消息在界面尾部显示的时间戳。
 * @param {Record<string, unknown>} message 待渲染的消息。
 * @returns {unknown} 用户发送时间或助手整轮完成时间；其他消息返回空值。
 */
function getMessageTime(message) {
  if (message?.role === "user") return message.timestamp;
  if (message?.role === "assistant") return message.completedAt;
  return null;
}

const activeWorkspace = computed(
  () =>
    workspaces.value.find(
      (workspace) => workspace.id === activeWorkspaceId.value,
    ) || null,
);
const activeConversation = computed(
  () =>
    conversations.value.find(
      (conversation) => conversation.id === activeConversationId.value,
    ) || null,
);
const showWorkspacePicker = computed(() =>
  Boolean(activeConversation.value && !workspaceLocked.value),
);
const conversationGroups = computed(() =>
  groupConversationsByWorkspace(conversations.value, workspaces.value),
);
const enabledTools = computed(() =>
  ALL_TOOLS.filter((tool) =>
    enabledToolNames.value.includes(tool.function.name),
  ),
);
const selectableSkills = computed(() =>
  skills.value.filter((skill) => !skill.disabled),
);
const capabilityGroups = computed(() =>
  TOOL_GROUPS.map((group) => ({
    ...group,
    enabled: group.tools.filter((tool) =>
      enabledToolNames.value.includes(tool.function.name),
    ).length,
    description:
      {
        files: "读取、搜索和修改当前工作区中的文件。",
        search: "搜索当前工作区中的文件名和文件内容。",
        shell: "在当前工作区执行命令和管理后台进程。",
        tasks: "维护复杂任务的开发进度和检查清单。",
        web: "使用 DuckDuckGo 搜索并深入阅读网页内容。",
      }[group.id] || "",
  })),
);
const pluginDevelopmentToolNames = computed(() =>
  TOOL_GROUPS.filter((group) =>
    PLUGIN_DEVELOPMENT_TOOL_GROUPS.has(group.id),
  ).flatMap((group) => group.tools.map((tool) => tool.function.name)),
);
const pluginDevelopmentEnabled = computed(
  () =>
    enabledSkills.value.includes("develop-ztools-plugin") &&
    pluginDevelopmentToolNames.value.every((name) =>
      enabledToolNames.value.includes(name),
    ),
);

/**
 * 将宿主返回的推理配置整理为 ZVC 可安全选择的完整结构。
 * @param {unknown} value 宿主模型的推理配置。
 * @returns {{efforts: Array<{id: string, label: string}>, defaultEffort: string}|null} 规范化后的推理能力；模型未公开能力时返回 null。
 */
function normalizeHostReasoningConfig(value) {
  if (!value || typeof value !== 'object') return null
  const source = value
  const normalized = []
  const seen = new Set()
  const candidates = Array.isArray(source.efforts)
    ? source.efforts
    : Array.isArray(source.supportedEfforts)
      ? source.supportedEfforts
      : []
  for (const candidate of candidates) {
    const rawId = typeof candidate === 'string' ? candidate : candidate?.id
    const id = rawId === 'none' ? 'off' : rawId
    if (!REASONING_EFFORTS.includes(id) || seen.has(id)) continue
    seen.add(id)
    normalized.push({
      id,
      label:
        (candidate && typeof candidate === 'object' && String(candidate.label || '')) ||
        REASONING_EFFORT_LABELS[id] ||
        id,
    })
  }
  if (!normalized.length) return null
  const rawDefault = source.defaultEffort ?? source.effort
  const defaultEffort = rawDefault === 'none' ? 'off' : rawDefault
  return {
    efforts: normalized,
    defaultEffort: seen.has(defaultEffort) ? defaultEffort : '',
  }
}

/**
 * 将单个宿主模型转换为 ZVC 的选择器条目。
 * @param {Record<string, unknown>} model 宿主 allAiModels 返回的模型。
 * @returns {Record<string, unknown>} 统一后的模型选择条目。
 */
function normalizeHostModelOption(model) {
  return {
    value: String(model.value || model.id || ""),
    label: String(model.label || model.modelId || model.id || "未命名模型"),
    model: String(model.modelId || model.id || ""),
    reasoning: normalizeHostReasoningConfig(model.reasoning),
    inputModalities: Array.isArray(model.inputModalities)
      ? model.inputModalities
      : ["text"],
    contextWindow: normalizeContextWindow(model.contextWindow),
  };
}

const modelOptions = computed(() =>
  hostModels.value
    .map(normalizeHostModelOption)
    .filter((model) => model.value && model.model),
);
const selectedModelOption = computed(
  () =>
    modelOptions.value.find((option) => option.value === selectedModel.value) ||
    null,
);
const selectedReasoningEffortOptions = computed(() =>
  createReasoningEffortOptions(
    selectedModelOption.value?.reasoning,
    REASONING_EFFORT_LABELS,
  ),
);
const selectedReasoningEffort = computed({
  get: () =>
    resolveSupportedReasoningEffort(
      activeRuntime.value.reasoningEffort,
      selectedModelOption.value,
    ),
  set: (value) => {
    const effort = resolveSupportedReasoningEffort(
      value,
      selectedModelOption.value,
    );
    if (activeRuntime.value.reasoningEffort === effort) return;
    // 推理强度只写入当前会话；正在运行的 Turn 继续使用启动时锁定的值。
    activeRuntime.value.reasoningEffort = effort;
    if (activeRuntime.value.id) void persistConversation(activeRuntime.value);
  },
});
const activeSessionRunning = computed(() =>
  Boolean(
    busy.value || compacting.value || activeRuntime.value.operationPromise,
  ),
);
const queuedMessages = computed(() =>
  pendingMessages.value.filter(
    (message) => message.placement === QUEUED_PLACEMENT,
  ),
);
const steeringMessages = computed(() =>
  pendingMessages.value.filter(
    (message) => message.placement === STEERING_PLACEMENT,
  ),
);
const displayedPendingMessages = computed(() => [
  ...steeringMessages.value,
  ...queuedMessages.value,
]);
const effectiveBusySubmissionMode = computed(() =>
  compacting.value ? QUEUED_PLACEMENT : busySubmissionMode.value,
);

/**
 * 判断输入区是否包含可提交的文字或图片。
 * @returns {boolean} 存在消息草稿时返回 true。
 */
const composerHasContent = computed(() =>
  Boolean(input.value.trim() || inputAttachments.value.length),
);

/**
 * 判断主操作按钮当前是否应终止正在进行的会话。
 * @returns {boolean} 会话运行中且输入区为空时返回 true。
 */
const primaryActionStopsSession = computed(
  () => activeSessionRunning.value && !composerHasContent.value,
);

/**
 * 生成输入区主操作按钮的可访问名称和提示文案。
 * @returns {string} 当前主操作对应的用户文案。
 */
const primaryComposerActionLabel = computed(() => {
  if (primaryActionStopsSession.value) return "停止当前 Turn";
  if (!activeSessionRunning.value) return "发送";
  return effectiveBusySubmissionMode.value === STEERING_PLACEMENT
    ? "插话发送"
    : "排队发送";
});

const canSend = computed(() =>
  Boolean(
    activeConversation.value &&
    selectedModelOption.value &&
    composerHasContent.value,
  ),
);
const taskStatusCounts = computed(createTaskStatusCounts);
const taskProgressLabel = computed(buildTaskProgressLabel);
const activeTurnDuration = computed(buildActiveTurnDuration);
const runningStatusLabel = computed(buildRunningStatusLabel);

/**
 * 判断当前 Turn 是否已经有可展示的 token 统计。
 * @returns {boolean} 输入或输出 token 大于零时返回 true。
 */
const hasTurnTokenStats = computed(() => {
  const stats = activeRuntime.value.turnTokenStats;
  return Number(stats?.inputTokens) > 0 || Number(stats?.outputTokens) > 0;
});

/**
 * 将 token 数量格式化为紧凑的 Pi 风格读数。
 * @param {unknown} value 待格式化的 token 数量。
 * @returns {string} 使用 k 或 m 单位的紧凑数字。
 */
function formatCompactTokens(value) {
  const tokens = Math.max(0, Math.round(Number(value) || 0));
  if (tokens >= 1000000) return `${trimCompactDecimal(tokens / 1000000)}m`;
  if (tokens >= 1000) return `${trimCompactDecimal(tokens / 1000)}k`;
  return String(tokens);
}

/**
 * 移除紧凑 token 数中的无意义尾随零。
 * @param {number} value 已换算单位后的数字。
 * @returns {string} 最多保留一位小数的数字文本。
 */
function trimCompactDecimal(value) {
  return value.toFixed(1).replace(/\.0$/, "");
}

/**
 * 生成当前 Turn 的输入输出 token 展示文案。
 * @returns {string} 使用上箭头和下箭头区分输入、输出的文案。
 */
function buildTurnTokenStatsLabel() {
  const stats = activeRuntime.value.turnTokenStats || {};
  return `↑${formatCompactTokens(stats.inputTokens)} ↓${formatCompactTokens(stats.outputTokens)}`;
}

/**
 * 生成当前 Turn token 统计的完整无障碍说明。
 * @returns {string} 包含完整 token 数量和估算状态的说明文本。
 */
function buildTurnTokenStatsAriaLabel() {
  const stats = activeRuntime.value.turnTokenStats || {};
  const suffix = stats.exact ? "，来自模型 usage" : "，当前为估算值";
  return `输入 ${Number(stats.inputTokens) || 0} tokens，输出 ${Number(stats.outputTokens) || 0} tokens${suffix}`;
}

const turnTokenStatsLabel = computed(buildTurnTokenStatsLabel);
const turnTokenStatsAriaLabel = computed(buildTurnTokenStatsAriaLabel);

/**
 * 从消息有序内容块中提取图片引用，供用户消息和工具上下文展示。
 * @param {Record<string, unknown>} message 展示消息。
 * @returns {Array<Record<string, unknown>>} 图片附件引用列表。
 */
function getMessageImages(message) {
  return Array.isArray(message?.parts)
    ? message.parts
        .filter((part) => part?.type === "image" && part.attachment)
        .map((part) => part.attachment)
    : [];
}

/**
 * 判断会话历史是否包含用户上传或工具读取的图片。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {boolean} 会话是否包含图片内容块。
 */
function conversationHasImages(runtime) {
  const inboxHasImages =
    Array.isArray(runtime?.pendingMessages) &&
    runtime.pendingMessages.some((message) => message.attachments?.length > 0);
  return runtime?.hasImages === true || inboxHasImages;
}

/**
 * 判断会话是否正在执行模型请求、上下文压缩或工具循环。
 * @param {string} conversationId 会话标识。
 * @returns {boolean} 会话是否仍在运行。
 */
function conversationIsRunning(conversationId) {
  const runtime = conversationRuntimes.get(conversationId);
  return Boolean(
    runtime?.busy || runtime?.compacting || runtime?.operationPromise,
  );
}

/**
 * 判断后台会话是否已经完成且尚未被用户重新打开。
 * @param {string} conversationId 会话标识。
 * @returns {boolean} 是否需要显示完成提醒。
 */
function conversationHasCompletedUnread(conversationId) {
  return Boolean(conversationRuntimes.get(conversationId)?.completedUnread);
}

/**
 * 判断助手消息是否为一个完整 Turn 的最终输出。
 * @param {Record<string, unknown>} message 当前消息。
 * @param {number} index 消息在当前会话时间线中的位置。
 * @returns {boolean} 是否应在消息下方显示 Turn 分叉操作。
 */
function isCompletedTurnTail(message, index) {
  if (
    message?.role !== "assistant" ||
    message.status !== "completed" ||
    !message.turnId ||
    !message.completedAt
  )
    return false;
  // 带工具调用的助手消息属于模型与工具循环的中间步骤，不能作为完整 Turn 的分叉边界。
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
    return false;
  const fullIndex = messages.value.findIndex((item) => item?.id === message.id);
  const tailStart = fullIndex >= 0 ? fullIndex + 1 : index + 1;
  return !messages.value
    .slice(tailStart)
    .some(
      (item) => item?.role === "assistant" && item.turnId === message.turnId,
    );
}

/**
 * 返回模板和交互逻辑可安全遍历的连续工具调用列表。
 * @param {Record<string, unknown>} message 当前展示消息。
 * @returns {Array<Record<string, unknown>>} 不含稀疏空位或空值的工具调用列表。
 */
function getMessageToolCalls(message) {
  return normalizeToolCalls(message?.tool_calls);
}

/**
 * 统计当前任务清单中已完成、进行中和待处理的数量。
 * @returns {{completed: number, active: number, pending: number}} 各任务状态数量。
 */
function createTaskStatusCounts() {
  const completed = tasks.value.filter(
    (task) => task.status === "completed",
  ).length;
  const active = tasks.value.filter(
    (task) => task.status === "in_progress",
  ).length;
  return {
    completed,
    active,
    pending: Math.max(0, tasks.value.length - completed - active),
  };
}

/**
 * 生成任务面板标题中的非零状态摘要。
 * @returns {string} 使用间隔点连接的任务状态摘要。
 */
function buildTaskProgressLabel() {
  const counts = taskStatusCounts.value;
  return [
    counts.completed ? `${counts.completed} 已完成` : "",
    counts.active ? `${counts.active} 进行中` : "",
    counts.pending ? `${counts.pending} 待处理` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 将会话运行秒数格式化为紧凑的中文时长。
 * @param {number} elapsedSeconds 已运行秒数。
 * @returns {string} `N秒` 或 `N分N秒` 格式时长。
 */
function formatActiveTurnDuration(elapsedSeconds) {
  const seconds = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  return minutes
    ? `${minutes}分${String(seconds % 60).padStart(2, "0")}秒`
    : `${seconds}秒`;
}

/**
 * 生成当前运行状态显示的持续时间。
 * @returns {string} 当前会话轮次的格式化运行时长。
 */
function buildActiveTurnDuration() {
  return formatActiveTurnDuration(activeTurnElapsedSeconds.value);
}

/**
 * 根据当前操作生成明确的会话运行状态文案。
 * @returns {string} 压缩、重试或常规处理阶段对应的状态文案。
 */
function buildRunningStatusLabel() {
  if (compacting.value) return "正在压缩上下文…";
  const retry = activeRuntime.value.retryState;
  if (retry?.attempt) {
    // 依赖运行时钟每秒刷新计算属性，避免另建只服务于倒计时的计时器。
    void activeTurnElapsedSeconds.value;
    const seconds = Math.max(1, Math.ceil((retry.nextAt - Date.now()) / 1000));
    return `${retry.message}，${seconds} 秒后重试（${retry.attempt}/${retry.maxRetries}）`;
  }
  return "正在深入处理…";
}

/**
 * 清除指定会话的瞬时模型重试展示状态。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {void} 无返回值。
 */
function clearChatRetryState(runtime) {
  runtime.retryState = createEmptyChatRetryState();
}

/**
 * 取消指定会话正在等待的模型重试，并清空倒计时状态。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {void} 无返回值。
 */
function cancelChatRetryWait(runtime) {
  const cancel = runtime.retryWaitCancel;
  runtime.retryWaitCancel = null;
  if (typeof cancel === "function") cancel();
  clearChatRetryState(runtime);
}

/**
 * 等待一次可被停止按钮立即取消的模型重试退避。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {{delayMs: number}} retry 本次重试状态。
 * @returns {Promise<boolean>} 等待完成返回 true，被停止操作取消返回 false。
 */
function waitForChatRetry(runtime, retry) {
  return new Promise((resolve) => {
    // 将取消器绑定到所属会话，切换到其他会话不会影响当前退避。
    const timer = window.setTimeout(() => {
      if (runtime.retryWaitCancel === cancel) runtime.retryWaitCancel = null;
      resolve(true);
    }, retry.delayMs);
    const cancel = markRaw(() => {
      window.clearTimeout(timer);
      resolve(false);
    });
    runtime.retryWaitCancel = cancel;
  });
}

/**
 * 按当前时间更新指定会话的持续秒数。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {void} 无返回值。
 */
function updateActiveTurnClock(runtime) {
  runtime.activeTurnElapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - runtime.activeTurnStartedAt) / 1000),
  );
}

/**
 * 从当前时刻启动指定会话的运行计时器。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {void} 无返回值。
 */
function startActiveTurnClock(runtime) {
  // 新一轮开始前释放旧计时器，避免重复请求造成多个时钟并行更新。
  if (runtime.activeTurnClock) window.clearInterval(runtime.activeTurnClock);
  runtime.activeTurnStartedAt = Date.now();
  runtime.activeTurnElapsedSeconds = 0;
  runtime.activeTurnClock = window.setInterval(
    () => updateActiveTurnClock(runtime),
    1000,
  );
}

/**
 * 停止指定会话的运行计时器并释放浏览器定时资源。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {void} 无返回值。
 */
function stopActiveTurnClock(runtime) {
  if (runtime.activeTurnClock) window.clearInterval(runtime.activeTurnClock);
  runtime.activeTurnClock = 0;
}

/**
 * 生成当前会话内使用的唯一标识。
 * @returns {string} UUID 标识。
 */
function makeId() {
  return crypto.randomUUID();
}

/**
 * 根据累计流内容长度计算界面批量刷新间隔。
 * @param {number} totalLength 思考与正文的累计字符数。
 * @returns {number} 刷新间隔，单位为毫秒。
 */
function getStreamFlushDelay(totalLength) {
  if (totalLength > 8000) return 400;
  if (totalLength > 4000) return 250;
  if (totalLength > 1500) return 160;
  return 100;
}

/**
 * 为一条助手消息创建独立的流式内容缓冲区。
 * @param {Record<string, unknown>} runtime 消息所属会话运行时。
 * @param {Record<string, unknown>} assistant 当前助手消息对象。
 * @returns {Record<string, unknown>} 本轮响应的流缓冲状态。
 */
function startAssistantStream(runtime, assistant) {
  // 每轮响应使用独立缓冲，避免前一轮计时器写入新的助手消息。
  const stream = markRaw({
    runtime,
    assistant,
    content: assistant.content || "",
    reasoning: assistant.reasoning || "",
    lastFlushAt: 0,
    flushTimer: null,
    receivedChunks: 0,
    flushes: 0,
  });
  runtime.activeAssistantStream = stream;
  return stream;
}

/**
 * 规范化兼容 OpenAI usage 与 Pi usage 命名的 token 统计。
 * @param {unknown} usage 模型或宿主返回的 usage 对象。
 * @returns {{inputTokens: number, outputTokens: number}|null} 可用统计；没有有效字段时返回 null。
 */
function normalizeTurnTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const source = /** @type {Record<string, unknown>} */ (usage);
  const inputValue = Number(source.prompt_tokens ?? source.input_tokens);
  const outputValue = Number(source.completion_tokens ?? source.output_tokens);
  if (!Number.isFinite(inputValue) && !Number.isFinite(outputValue))
    return null;
  return {
    inputTokens: Number.isFinite(inputValue)
      ? Math.max(0, Math.round(inputValue))
      : 0,
    outputTokens: Number.isFinite(outputValue)
      ? Math.max(0, Math.round(outputValue))
      : 0,
  };
}

/**
 * 清空一个新 Turn 的累计 token 统计。
 * @param {Record<string, unknown>} runtime 当前会话运行时。
 * @returns {void} 无返回值。
 */
function resetTurnTokenStats(runtime) {
  // 新 Turn 开始时释放上一轮的累计值和 step usage 替换基线。
  runtime.turnTokenStats = {
    inputTokens: 0,
    outputTokens: 0,
    exact: false,
    committedInputTokens: 0,
    committedOutputTokens: 0,
    stepInputTokens: 0,
    stepOutputTokens: 0,
    stepUsage: null,
    allStepsExact: true,
  };
}

/**
 * 开始 Turn 内的一个模型 step 并保留之前 step 的累计值。
 * @param {Record<string, unknown>} runtime 当前会话运行时。
 * @param {number} inputTokens 当前模型请求的输入 token 估算。
 * @returns {void} 无返回值。
 */
function startTurnTokenStep(runtime, inputTokens) {
  const stats = runtime.turnTokenStats || {};
  const estimate = Math.max(0, Math.round(Number(inputTokens) || 0));
  // 新 step 只重置本步临时值，不能清除同一 Turn 前面模型步骤的累计值。
  stats.stepInputTokens = estimate;
  stats.stepOutputTokens = 0;
  stats.stepUsage = null;
  stats.exact = false;
  stats.inputTokens =
    Math.max(0, Math.round(Number(stats.committedInputTokens) || 0)) + estimate;
  stats.outputTokens = Math.max(
    0,
    Math.round(Number(stats.committedOutputTokens) || 0),
  );
  runtime.turnTokenStats = stats;
}

/**
 * 根据当前流缓冲内容更新输出 token 估算。
 * @param {Record<string, unknown>} runtime 当前会话运行时。
 * @param {string} reasoning 思考文本缓冲。
 * @param {string} content 正文文本缓冲。
 * @returns {void} 无返回值。
 */
function updateTurnOutputTokenEstimate(runtime, reasoning, content) {
  const stats = runtime.turnTokenStats || {
    inputTokens: 0,
    outputTokens: 0,
    exact: false,
  };
  const estimate = estimateTextTokens(`${reasoning || ""}\n${content || ""}`);
  // 当前 step 的估算输出叠加到已完成 step，避免工具循环时回到零。
  stats.stepOutputTokens = estimate;
  stats.outputTokens =
    Math.max(0, Math.round(Number(stats.committedOutputTokens) || 0)) +
    estimate;
  runtime.turnTokenStats = stats;
}

/**
 * 用模型最终 usage 覆盖当前 Turn 的 token 估算。
 * @param {Record<string, unknown>} runtime 当前会话运行时。
 * @param {unknown} usage 模型或宿主返回的 usage 对象。
 * @returns {boolean} 成功应用有效 usage 时返回 true。
 */
function applyTurnTokenUsage(runtime, usage) {
  const normalized = normalizeTurnTokenUsage(usage);
  if (!normalized) return false;
  const previous = runtime.turnTokenStats || {};
  // 同一 step 的流 usage 和最终 usage 采用后到值替换，禁止重复累加。
  previous.stepUsage = normalized;
  previous.stepInputTokens = normalized.inputTokens;
  previous.stepOutputTokens = normalized.outputTokens;
  previous.inputTokens =
    Math.max(0, Math.round(Number(previous.committedInputTokens) || 0)) +
    normalized.inputTokens;
  previous.outputTokens =
    Math.max(0, Math.round(Number(previous.committedOutputTokens) || 0)) +
    normalized.outputTokens;
  previous.exact = previous.allStepsExact !== false;
  runtime.turnTokenStats = previous;
  return true;
}

/**
 * 提交当前 step 的 token 统计，供 Turn 内下一个 step 继续累计。
 * @param {Record<string, unknown>} runtime 当前会话运行时。
 * @param {boolean} commitEstimate 没有 provider usage 时是否提交当前估算。
 * @returns {void} 无返回值。
 */
function settleTurnTokenStep(runtime, commitEstimate = true) {
  const stats = runtime.turnTokenStats || {};
  const usage = stats.stepUsage;
  const hasUsage = usage && typeof usage === "object";
  if (!hasUsage && !commitEstimate) return;
  const input = hasUsage
    ? Number(usage.inputTokens)
    : Number(stats.stepInputTokens);
  const output = hasUsage
    ? Number(usage.outputTokens)
    : Number(stats.stepOutputTokens);
  // 将本步权威值或估算值转移到 Turn 累计基线，并记录是否仍含估算。
  stats.committedInputTokens =
    Math.max(0, Math.round(Number(stats.committedInputTokens) || 0)) +
    Math.max(0, Math.round(input) || 0);
  stats.committedOutputTokens =
    Math.max(0, Math.round(Number(stats.committedOutputTokens) || 0)) +
    Math.max(0, Math.round(output) || 0);
  stats.allStepsExact = stats.allStepsExact !== false && Boolean(hasUsage);
  stats.inputTokens = stats.committedInputTokens;
  stats.outputTokens = stats.committedOutputTokens;
  stats.exact = stats.allStepsExact;
  stats.stepInputTokens = 0;
  stats.stepOutputTokens = 0;
  stats.stepUsage = null;
  runtime.turnTokenStats = stats;
}

/**
 * 将缓冲中的思考和正文批量同步到响应式消息对象。
 * @param {Record<string, unknown>|null} stream 要刷新的流缓冲状态。
 * @returns {boolean} 是否向界面写入了新内容。
 */
function flushAssistantStream(
  stream = activeRuntime.value.activeAssistantStream,
) {
  if (!stream) return false;
  // 清除待执行计时器，避免同一批内容被重复刷新。
  if (stream.flushTimer) {
    clearTimeout(stream.flushTimer);
    stream.flushTimer = null;
  }
  const contentChanged = stream.assistant.content !== stream.content;
  const reasoningChanged = stream.assistant.reasoning !== stream.reasoning;
  if (contentChanged) stream.assistant.content = stream.content;
  if (reasoningChanged) stream.assistant.reasoning = stream.reasoning;
  if (contentChanged || reasoningChanged)
    updateTurnOutputTokenEstimate(
      stream.runtime,
      stream.reasoning,
      stream.content,
    );
  stream.lastFlushAt = Date.now();
  if (contentChanged || reasoningChanged) {
    stream.flushes += 1;
    // Chromium 中由 ResizeObserver 在绘制前同步贴底；不支持时再使用异步兜底。
    if (!messageResizeObserver) void scrollRuntimeToBottom(stream.runtime);
  }
  return contentChanged || reasoningChanged;
}

/**
 * 按累计内容长度调度下一次流式界面刷新。
 * @param {Record<string, unknown>} stream 当前流缓冲状态。
 * @returns {void} 无返回值。
 */
function scheduleAssistantStreamFlush(stream) {
  if (stream.runtime.activeAssistantStream !== stream) return;
  const delay = getStreamFlushDelay(
    stream.content.length + stream.reasoning.length,
  );
  const remaining = delay - (Date.now() - stream.lastFlushAt);
  if (remaining <= 0) {
    flushAssistantStream(stream);
    return;
  }
  if (!stream.flushTimer) {
    stream.flushTimer = setTimeout(() => {
      if (stream.runtime.activeAssistantStream === stream)
        flushAssistantStream(stream);
    }, remaining);
  }
}

/**
 * 将模型分片追加到正文或思考缓冲，并触发节流刷新。
 * @param {Record<string, unknown>} stream 当前流缓冲状态。
 * @param {'content'|'reasoning'} type 分片类型。
 * @param {string} delta 本次收到的文本分片。
 * @returns {void} 无返回值。
 */
function appendAssistantStreamDelta(stream, type, delta) {
  if (stream.runtime.activeAssistantStream !== stream || !delta) return;
  if (type === "content") stream.content += delta;
  else if (type === "reasoning") stream.reasoning += delta;
  else return;
  stream.receivedChunks += 1;
  scheduleAssistantStreamFlush(stream);
}

/**
 * 结束当前流并强制发布尚未显示的尾部内容。
 * @param {Record<string, unknown>|null} stream 要结束的流缓冲状态。
 * @returns {void} 无返回值。
 */
function finishAssistantStream(
  stream = activeRuntime.value.activeAssistantStream,
) {
  if (!stream) return;
  // 正常结束、异常和用户停止都必须强制发布尾部，避免节流导致丢字。
  flushAssistantStream(stream);
  // 异常、中止及不含正文的响应也必须关闭思考状态，避免面板永久显示运行中。
  if (stream.assistant.reasoningStatus === "streaming")
    stream.assistant.reasoningStatus = "completed";
  window.__zvcLastStreamMetrics = {
    conversationId: stream.runtime.id,
    receivedChunks: stream.receivedChunks,
    flushes: stream.flushes,
    contentLength: stream.content.length,
    reasoningLength: stream.reasoning.length,
  };
  if (stream.runtime.activeAssistantStream === stream)
    stream.runtime.activeAssistantStream = null;
}

/**
 * 将主消息区立即滚动到底部，并记录本次程序写入的位置。
 * @param {boolean} force 是否忽略用户暂停自动跟随的状态。
 * @returns {Promise<void>} Vue DOM 更新并完成滚动后结束的 Promise。
 */
async function scrollToBottom(force = false) {
  await nextTick();
  if (force) autoScrollMessages.value = true;
  if (!autoScrollMessages.value || !chatScroller.value) return;
  // 控制器原子同步 DOM、程序滚动账本和当前会话的贴底所有权。
  conversationScroll.toBottom(chatScroller.value);
}

/**
 * 仅当指定会话仍在前台时滚动消息区，后台输出不干扰当前阅读位置。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {boolean} force 是否强制恢复该会话的自动跟随。
 * @returns {Promise<void>} 前台会话滚动完成或后台会话直接结束的 Promise。
 */
async function scrollRuntimeToBottom(runtime, force = false) {
  if (activeConversationId.value !== runtime.id) return;
  await nextTick();
  // 会话可能在 DOM 更新期间切换，后台响应不得滚动新会话。
  if (activeConversationId.value !== runtime.id) return;
  if (force) runtime.autoScrollMessages = true;
  if (!runtime.autoScrollMessages || !chatScroller.value) return;
  // 当前会话确认仍在前台后交由统一状态机完成贴底。
  conversationScroll.toBottom(chatScroller.value, runtime.id);
}

/**
 * 在当前消息窗口提交后恢复指定会话的语义阅读位置。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {Promise<void>} 会话位置恢复或首次贴底后结束的 Promise。
 */
async function restoreRuntimeScroll(runtime) {
  if (activeConversationId.value !== runtime.id) return;
  await nextTick();
  // 会话可能在 DOM 提交期间再次切换，过期恢复不得影响新会话。
  if (
    activeConversationId.value !== runtime.id ||
    !chatScroller.value ||
    !chatContent.value
  )
    return;
  conversationScroll.restore(runtime.id, chatScroller.value, chatContent.value);
}

/**
 * 根据滚动账本区分用户滚动与程序滚动，并更新自动跟随状态。
 * @returns {void} 无返回值。
 */
function handleChatScroll() {
  conversationScroll.handleScroll(chatScroller.value, chatContent.value);
}

/**
 * 将尺寸观察器同步绑定到所有会改变聊天可视区域的节点。
 * @returns {void} 无返回值。
 */
function syncMessageResizeObserver() {
  if (!messageResizeObserver) return;
  const nextTargets = new Set(
    [
      chatContent.value,
      chatScroller.value,
      taskStrip.value,
      composerSeat.value,
    ].filter(Boolean),
  );
  // 先释放已经卸载的会话节点，防止后台 DOM 变化干扰活动会话。
  for (const target of observedMessageResizeTargets) {
    if (!nextTargets.has(target)) {
      messageResizeObserver.unobserve(target);
      observedMessageResizeTargets.delete(target);
    }
  }
  // 消息、滚动视口、任务条和输入区共同决定底部几何位置。
  for (const target of nextTargets) {
    if (observedMessageResizeTargets.has(target)) continue;
    observedMessageResizeTargets.add(target);
    messageResizeObserver.observe(target);
  }
}

/**
 * 在消息内容尺寸变化时即时跟随到底部，使末尾运行状态保持在聊天区可视范围内。
 * @returns {void} 无返回值。
 */
function handleMessageContentResize() {
  // 只有仍持有贴底所有权的会话才跟随异步 Markdown 和输入区重排。
  conversationScroll.handleResize(chatScroller.value);
}

/**
 * 将指定会话中无法继续的助手响应和工具调用统一收口为已停止状态。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {boolean} restored 是否正在恢复上次意外中断的会话。
 * @returns {number} 被更新的助手消息和工具调用数量。
 */
function cancelUnfinishedTurnState(runtime, restored = false) {
  let changed = 0;
  for (const message of runtime.messages) {
    let messageChanged = false;
    if (message.role === "assistant" && message.status === "streaming") {
      message.status = "stopped";
      changed += 1;
      messageChanged = true;
    }
    for (const call of getMessageToolCalls(message)) {
      if (!UNFINISHED_TOOL_STATUSES.has(call.status)) continue;
      const wasRunning = call.status === "running";
      // 先通知 preload 终止真实进程树，再释放前端等待状态。
      if (wasRunning) bridge?.cancelTool?.(call.id);
      call.status = "cancelled";
      delete call.liveOutput;
      call.result = restored
        ? wasRunning
          ? "上次会话在工具执行期间中断，工具结果不可用，操作可能已经执行。"
          : "上次会话已中断，工具未执行。"
        : wasRunning
          ? "用户已终止本轮对话。工具结果已忽略，操作可能已经执行。"
          : "用户已终止本轮对话，工具未执行。";
      changed += 1;
      messageChanged = true;

      // 同时释放确认等待和执行等待，保证旧循环可以立即完成清理。
      const approvalResolve = pendingApprovals.get(call.id);
      if (approvalResolve) {
        pendingApprovals.delete(call.id);
        approvalResolve(call.result);
      }
      const cancellationResolve = pendingToolCancellations.get(call.id);
      if (cancellationResolve) {
        pendingToolCancellations.delete(call.id);
        cancellationResolve(TOOL_EXECUTION_CANCELLED);
      }
    }
    if (messageChanged) markRuntimeMessageDirty(runtime, message);
  }
  return changed;
}

/**
 * 将指定会话的原子消息变化和非消息状态串行持久化。
 * @param {Record<string, unknown>} runtime 会话运行时，默认使用当前活动会话。
 * @param {{preserveUpdatedAt?: boolean}} options 保存行为选项；恢复性写入可保留原活动时间。
 * @returns {Promise<void>} 保存完成后结束的 Promise。
 */
function persistConversation(runtime = activeRuntime.value, options = {}) {
  if (!runtime?.id) return Promise.resolve();
  const preserveUpdatedAt = options.preserveUpdatedAt === true;
  const previous = persistenceTails.get(runtime.id) || Promise.resolve();
  // 同一会话的保存严格排队，避免较早的异步写入覆盖较新的流式状态。
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const captured = captureRuntimeMessageChanges(runtime);
      trace("persist:start", {
        conversationId: runtime.id,
        changedMessages: captured.length,
        totalMessages: runtime.historyTotal,
      });
      const saved = await bridge?.commitConversationChanges(
        runtime.id,
        {
          state: {
            modelKey: runtime.modelKey,
            reasoningEffort: runtime.reasoningEffort,
            projectId: runtime.projectId,
            workspaceLocked: runtime.workspaceLocked,
            enabledTools: runtime.enabledToolNames,
            enabledSkills: runtime.enabledSkills,
            autoApproveTools: runtime.autoApproveTools,
            tasks: runtime.tasks,
            pendingMessages: runtime.pendingMessages,
            contextState: runtime.contextState,
            contextMeter: runtime.contextMeter,
            hasImages: runtime.hasImages,
          },
          upserts: captured.map((entry) => entry.message),
        },
        { preserveUpdatedAt },
      );
      // 只清理由本次成功提交覆盖的版本，保留写入期间产生的后续修改。
      acknowledgeRuntimeMessageChanges(runtime, captured);
      if (saved)
        conversations.value = sortConversationsByUpdatedAt(
          conversations.value.map((conversation) =>
            conversation.id === saved.id ? saved : conversation,
          ),
        );
      trace("persist:done", {
        conversationId: runtime.id,
        changedMessages: captured.length,
        totalMessages: runtime.historyTotal,
      });
    });
  persistenceTails.set(runtime.id, operation);
  return operation.finally(() => {
    // 只清理当前队尾，避免较早保存的 finally 删除后来追加的操作。
    if (persistenceTails.get(runtime.id) === operation)
      persistenceTails.delete(runtime.id);
    evictIdleConversationRuntimes();
  });
}

/**
 * 向前展开一页完整 Turn，并在 DOM 增高后保持原可视内容的位置。
 * @returns {Promise<void>} 历史窗口和滚动锚点更新完成后的 Promise。
 */
async function loadOlderMessages() {
  const runtime = activeRuntime.value;
  if (!runtime?.id || !runtime.historyHasMore || runtime.historyLoading) return;
  const scroller = chatScroller.value;
  const content = chatContent.value;
  // 请求发出前捕获稳定消息行，后续恢复不依赖可能继续变化的 scrollHeight。
  conversationScroll.beginPrepend(runtime.id, scroller, content);
  runtime.historyLoading = true;
  let prepended = false;
  try {
    const page = await bridge?.getConversationHistoryPage?.(runtime.id, {
      before: runtime.historyStartIndex,
      limit: 50,
    });
    if (page && activeRuntime.value.id === runtime.id) {
      const existingIds = new Set(
        runtime.messages.map((message) => String(message?.id || "")),
      );
      const older = page.messages.filter(
        (message) => !existingIds.has(String(message?.id || "")),
      );
      runtime.messages.unshift(...older);
      runtime.historyStartIndex = page.start;
      runtime.historyHasMore = page.hasMore === true;
      runtime.historyTotal = Math.max(
        runtime.historyTotal,
        Number(page.total) || runtime.messages.length,
      );
      prepended = older.length > 0;
      trace("history:page-loaded", {
        conversationId: runtime.id,
        loaded: older.length,
        visibleMessages: runtime.messages.length,
        start: page.start,
      });
    }
  } catch (event) {
    // 分页失败时释放临时锚点，保留用户当前阅读位置。
    conversationScroll.cancelPrepend(runtime.id);
    throw event;
  } finally {
    runtime.historyLoading = false;
  }
  await nextTick();
  if (
    !prepended ||
    activeRuntime.value.id !== runtime.id ||
    !scroller ||
    !content
  ) {
    conversationScroll.cancelPrepend(runtime.id);
    return;
  }
  conversationScroll.finishPrepend(runtime.id, scroller, content);
}

/**
 * 切换活动会话并恢复其消息、工作区和能力状态。
 * @param {string} id 目标会话标识。
 * @returns {Promise<void>} 会话状态恢复完成后结束的 Promise。
 */
async function selectConversation(id) {
  const generation = ++conversationSelectionGeneration;
  let runtime = conversationRuntimes.get(id);
  // 已驻留会话只更新轻量指针，避免每次切换都克隆整份历史。
  const conversation =
    runtime && typeof bridge?.setActiveConversationPointer === "function"
      ? await bridge.setActiveConversationPointer(id)
      : await bridge?.setActiveConversation(id);
  if (!conversation || generation !== conversationSelectionGeneration) return;
  let restoredInterruptedState = 0;
  let defaultedModel = false;
  if (!runtime) {
    runtime = registerConversationRuntime(conversation);
    const migratedModel = Boolean(
      conversation.modelKey && runtime.modelKey !== conversation.modelKey,
    );
    const normalizedReasoningEffort = Boolean(
      runtime.reasoningEffort &&
      runtime.reasoningEffort !== conversation.reasoningEffort,
    );
    if (!runtime.modelKey && defaultSelectedModel.value) {
      // 旧会话没有会话级模型时只继承一次全局默认值，之后由 JSONL 固化。
      runtime.modelKey = defaultSelectedModel.value;
      defaultedModel = true;
    }
    // 只有从磁盘首次恢复时才收口遗留状态；内存中的后台会话保持继续运行。
    restoredInterruptedState = cancelUnfinishedTurnState(runtime, true);
    if (migratedModel || normalizedReasoningEffort) defaultedModel = true;
  }
  // 会话选择只切换视图绑定，不再改变其他会话的运行生命周期。
  activeConversationId.value = id;
  runtime.lastAccessedAt = Date.now();
  runtime.completedUnread = false;
  // 仅用模型元数据补齐窗口容量，不为显示 0% 读数恢复完整消息历史。
  syncContextMeterWindow(runtime);
  // 恢复旧状态属于打开会话的内部整理，不应改变列表中的最后活动时间。
  if (restoredInterruptedState || defaultedModel)
    await persistConversation(runtime, { preserveUpdatedAt: true });
  // 新打开会话默认贴底；应用内返回已读会话时恢复该会话的语义阅读位置。
  await restoreRuntimeScroll(runtime);
  // 重载后恢复的 Inbox 只在对应会话被打开时继续执行，避免一次性唤醒全部历史会话。
  if (runtime.pendingMessages.length) startConversationScheduler(runtime);
  evictIdleConversationRuntimes();
}

/**
 * 判断 Skill 是否已在当前会话启用。
 * @param {Record<string, unknown>} skill Skill 描述对象。
 * @returns {boolean} Skill 是否启用。
 */
function skillIsEnabled(skill) {
  return (
    enabledSkills.value.includes(skill.id) ||
    enabledSkills.value.includes(skill.name)
  );
}

/**
 * 将旧名称或当前标识统一转换为有效 Skill 标识。
 * @param {string[]} names 待恢复的 Skill 名称或标识。
 * @returns {string[]} 当前可用的 Skill 标识列表。
 */
function normalizeEnabledSkills(names) {
  const selected = new Set(Array.isArray(names) ? names : []);
  // Skill 尚未完成延迟扫描时保留会话原值，避免首屏注册运行时误清空能力。
  if (!selectableSkills.value.length)
    return [...selected].map(String).filter(Boolean);
  return selectableSkills.value
    .filter((skill) => selected.has(skill.id) || selected.has(skill.name))
    .map((skill) => skill.id);
}

/**
 * 等待浏览器完成首帧提交，让 Skill 磁盘扫描不再阻塞插件可见时间。
 * @returns {Promise<void>} 首帧动画帧到达后结束的 Promise。
 */
function waitForFirstPaint() {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => resolve()),
  );
}

/**
 * 首帧后加载动态 Skill 元数据，并重新校验已驻留会话的 Skill 标识。
 * @returns {Promise<void>} Skill 扫描和运行时校验完成后的 Promise。
 */
async function loadSkillsAfterFirstPaint() {
  await waitForFirstPaint();
  const loadedSkills = await Promise.resolve(bridge?.getSkills?.() || []);
  skills.value = Array.isArray(loadedSkills) ? loadedSkills : [];
  for (const runtime of conversationRuntimes.values())
    runtime.enabledSkills = normalizeEnabledSkills(runtime.enabledSkills);
}

/**
 * 读取宿主管理的模型并校正全局默认值和已驻留会话模型键。
 * @param {unknown} persistedModelKey 初始状态保存的默认模型键。
 * @returns {Promise<void>} 模型列表与运行时模型键更新完成后的 Promise。
 */
async function loadHostModels(persistedModelKey) {
  hostModels.value = (await bridge?.getHostModels?.()) || [];
  defaultSelectedModel.value =
    resolveHostModelKey(persistedModelKey) ||
    resolveHostModelKey(defaultSelectedModel.value) ||
    modelOptions.value[0]?.value ||
    "";
  const persistenceOperations = [];
  for (const runtime of conversationRuntimes.values()) {
    const resolved =
      resolveHostModelKey(runtime.modelKey) ||
      (!runtime.modelKey ? defaultSelectedModel.value : "");
    if (!resolved) continue;
    const modelOption =
      modelOptions.value.find((option) => option.value === resolved) || null;
    const effort = resolveSupportedReasoningEffort(
      runtime.reasoningEffort,
      modelOption,
    );
    const changed =
      runtime.modelKey !== resolved || runtime.reasoningEffort !== effort;
    runtime.modelKey = resolved;
    runtime.reasoningEffort = effort;
    // 模型能力恢复只补齐会话配置，不应改变侧栏最后活动时间。
    if (changed && runtime.id)
      persistenceOperations.push(
        persistConversation(runtime, { preserveUpdatedAt: true }),
      );
  }
  await Promise.all(persistenceOperations);
}

/**
 * 创建并切换到一个使用默认能力的新会话，未明确指定时继承当前会话工作区。
 * @param {string|undefined} workspaceId 可选的初始工作区标识；空字符串表示明确不绑定。
 * @returns {Promise<void>} 新会话完成激活并聚焦输入框后的 Promise。
 */
async function newConversation(workspaceId) {
  // 侧栏工作区快捷入口优先使用显式值，普通新建入口则延续当前会话归属。
  const initialWorkspaceId =
    typeof workspaceId === "string"
      ? workspaceId
      : String(activeWorkspaceId.value || "");
  const defaultModel =
    modelOptions.value.find(
      (option) => option.value === defaultSelectedModel.value,
    ) || null;
  const conversation = bridge?.createConversation({
    enabledTools: DEFAULT_ENABLED_TOOLS,
    modelKey: defaultSelectedModel.value,
    reasoningEffort: resolveSupportedReasoningEffort("", defaultModel),
    projectId: initialWorkspaceId,
  });
  if (!conversation) return;
  if (!conversationRuntimes.has(conversation.id))
    registerConversationRuntime(conversation);
  conversations.value = [
    conversation,
    ...conversations.value.filter((item) => item.id !== conversation.id),
  ];
  await selectConversation(conversation.id);
  if (activeConversationId.value !== conversation.id) return;

  // 等待新会话界面和工作区选择器稳定后再移交焦点，避免点击按钮继续持有焦点。
  await nextTick();
  composerInput.value?.focus({ preventScroll: true });
}

/**
 * 打开工作区创建弹窗并聚焦名称输入框。
 * @returns {void} 无返回值。
 */
function openCreate() {
  workspaceName.value = "";
  createOpen.value = true;
  nextTick(() => document.querySelector("#workspace-name")?.focus());
}

/**
 * 创建空工作区并绑定到当前会话。
 * @returns {Promise<void>} 创建或错误处理完成后结束的 Promise。
 */
async function createWorkspace() {
  error.value = "";
  try {
    // 目录创建成功后再更新列表和会话绑定，避免界面出现无效工作区。
    const workspace = await bridge.createWorkspace({
      name: workspaceName.value,
    });
    workspaces.value = [
      workspace,
      ...workspaces.value.filter((item) => item.id !== workspace.id),
    ];
    createOpen.value = false;
    await bindWorkspace(workspace.id);
  } catch (event) {
    error.value = event.message || "创建工作区失败";
  }
}

/**
 * 登记本地文件夹为工作区并绑定到当前会话。
 * @returns {Promise<void>} 导入流程完成后结束的 Promise。
 */
async function importWorkspace() {
  const workspace = await bridge?.importWorkspace();
  if (!workspace) return;
  const existingIndex = workspaces.value.findIndex(
    (item) => item.id === workspace.id,
  );
  if (existingIndex < 0) workspaces.value.unshift(workspace);
  await bindWorkspace(workspace.id);
}

/**
 * 在首条用户消息发送前绑定或清除当前会话工作区。
 * @param {string} id 工作区标识；空字符串表示不绑定。
 * @returns {Promise<void>} 绑定状态更新完成后结束的 Promise。
 */
async function bindWorkspace(id) {
  if (!activeConversation.value || workspaceLocked.value) return;
  const workspace = id ? workspaces.value.find((item) => item.id === id) : null;
  if (id && !workspace) return;
  error.value = "";
  try {
    // 后端再次校验锁定边界，确保运行时和持久层不会产生不同绑定。
    const saved = await bridge?.setConversationWorkspace(
      activeConversation.value.id,
      id,
    );
    if (!saved) return;
    activeWorkspaceId.value = saved.projectId || "";
    conversations.value = sortConversationsByUpdatedAt(
      conversations.value.map((item) => (item.id === saved.id ? saved : item)),
    );
    await refreshContextMeter();
  } catch (event) {
    error.value = event.message || "切换工作区失败";
  }
}

/**
 * 切换侧边栏工作区分组的折叠状态并保存偏好。
 * @param {string} workspaceId 工作区标识。
 * @returns {void} 无返回值。
 */
function toggleWorkspaceGroup(workspaceId) {
  const next = new Set(collapsedWorkspaceIds.value);
  if (next.has(workspaceId)) {
    next.delete(workspaceId);
  } else {
    next.add(workspaceId);
    // 项目折叠后丢弃临时的“显示全部”状态，下次展开恢复紧凑列表。
    expandedWorkspaceConversationIds.value =
      expandedWorkspaceConversationIds.value.filter((id) => id !== workspaceId);
  }
  collapsedWorkspaceIds.value = [...next];
  bridge?.saveCollapsedWorkspaces(collapsedWorkspaceIds.value);
}

/**
 * 返回工作区当前应渲染的会话，默认仅保留最近五条。
 * @param {{workspace: {id: string}, conversations: Array<Record<string, unknown>>}} group 工作区会话分组。
 * @returns {Array<Record<string, unknown>>} 当前折叠状态下可见的会话列表。
 */
function visibleWorkspaceConversations(group) {
  if (expandedWorkspaceConversationIds.value.includes(group.workspace.id))
    return group.conversations;
  return group.conversations.slice(0, COLLAPSED_WORKSPACE_CONVERSATION_LIMIT);
}

/**
 * 切换指定工作区会话列表的“显示全部”状态。
 * @param {string} workspaceId 工作区标识。
 * @returns {void} 无返回值。
 */
function toggleWorkspaceConversations(workspaceId) {
  const next = new Set(expandedWorkspaceConversationIds.value);
  if (next.has(workspaceId)) next.delete(workspaceId);
  else next.add(workspaceId);
  expandedWorkspaceConversationIds.value = [...next];
}

/**
 * 合并当前会话的工具和 Skill 能力设置并持久化。
 * @param {Record<string, unknown>} patch 本次需要更新的能力字段。
 * @returns {void} 无返回值。
 */
function updateCapabilities(patch = {}) {
  if (patch.enabledTools)
    enabledToolNames.value = [...new Set(patch.enabledTools)];
  if (patch.enabledSkills)
    enabledSkills.value = [...new Set(patch.enabledSkills)];
  persistConversation();
  refreshContextMeter();
}

/**
 * 切换单个工具在当前会话中的启用状态。
 * @param {string} name 工具函数名称。
 * @param {boolean} checked 是否启用。
 * @returns {void} 无返回值。
 */
function toggleTool(name, checked) {
  const next = new Set(enabledToolNames.value);
  if (checked) next.add(name);
  else next.delete(name);
  updateCapabilities({ enabledTools: [...next] });
}

/**
 * 批量切换一个工具分组中的所有工具。
 * @param {Record<string, unknown>} group 工具分组描述。
 * @param {boolean} checked 是否启用整个分组。
 * @returns {void} 无返回值。
 */
function toggleGroup(group, checked) {
  const next = new Set(enabledToolNames.value);
  for (const tool of group.tools) {
    if (checked) next.add(tool.function.name);
    else next.delete(tool.function.name);
  }
  updateCapabilities({ enabledTools: [...next] });
}

/**
 * 根据复选框状态启用或关闭插件开发能力集合。
 * @param {boolean} checked 是否启用插件开发能力。
 * @returns {void} 无返回值。
 */
function togglePluginDevelopment(checked) {
  if (checked) enablePluginDevelopment();
  else disablePluginDevelopment();
}

/**
 * 切换能力分组的折叠状态。
 * @param {string} groupId 能力分组标识。
 * @returns {void} 无返回值。
 */
function toggleCapabilityGroup(groupId) {
  collapsedCapabilityGroups[groupId] = !collapsedCapabilityGroups[groupId];
}

/**
 * 获取能力分组对应的 Lucide 图标组件。
 * @param {string} groupId 能力分组标识。
 * @returns {unknown} 图标组件。
 */
function capabilityIcon(groupId) {
  return (
    { files: Files, shell: Terminal, tasks: ListTodo, web: Globe2 }[groupId] ||
    Wrench
  );
}

/**
 * 将内部工具名称转换为用户可读名称。
 * @param {string} name 工具函数名称。
 * @returns {string} 去除内部前缀后的名称。
 */
function formatToolName(name) {
  return name.startsWith("builtin_") ? name.slice("builtin_".length) : name;
}

/**
 * 打开或关闭能力弹窗，并在打开前刷新动态 Skill 列表。
 * @returns {Promise<void>} 弹窗状态更新完成后结束的 Promise。
 */
async function toggleCapabilities() {
  // 每次打开都重新扫描用户目录，确保新添加的 Skill 立即可选。
  if (!capabilitiesOpen.value) {
    const latestSkills = await bridge?.getSkills?.();
    if (Array.isArray(latestSkills)) skills.value = latestSkills;
  }
  capabilitiesOpen.value = !capabilitiesOpen.value;
}

/**
 * 切换单个 Skill 在当前会话中的启用状态。
 * @param {string} name Skill 标识。
 * @param {boolean} checked 是否启用。
 * @returns {void} 无返回值。
 */
function toggleSkill(name, checked) {
  const next = new Set(enabledSkills.value);
  if (checked) next.add(name);
  else next.delete(name);
  updateCapabilities({ enabledSkills: [...next] });
}

/**
 * 启用插件开发所需工具和内置 Skill，并打开能力弹窗。
 * @returns {void} 无返回值。
 */
function enablePluginDevelopment() {
  const next = new Set(enabledToolNames.value);
  for (const group of TOOL_GROUPS)
    if (PLUGIN_DEVELOPMENT_TOOL_GROUPS.has(group.id))
      group.tools.forEach((tool) => next.add(tool.function.name));
  enabledToolNames.value = [...next];
  enabledSkills.value = ["develop-ztools-plugin"];
  capabilitiesOpen.value = true;
  persistConversation();
}

/**
 * 关闭插件开发工具集合和对应 Skill。
 * @returns {void} 无返回值。
 */
function disablePluginDevelopment() {
  const developmentTools = new Set(pluginDevelopmentToolNames.value);
  enabledToolNames.value = enabledToolNames.value.filter(
    (name) => !developmentTools.has(name),
  );
  enabledSkills.value = enabledSkills.value.filter(
    (skill) => skill !== "develop-ztools-plugin",
  );
  updateCapabilities({
    enabledTools: enabledToolNames.value,
    enabledSkills: enabledSkills.value,
  });
}

/**
 * 保存自动执行工具设置，并释放当前已等待的确认请求。
 * @param {unknown} value 自动执行开关值。
 * @returns {void} 无返回值。
 */
function setAutoApproveTools(value) {
  const runtime = activeRuntime.value;
  autoApproveTools.value = Boolean(value);
  bridge?.saveAutoApproveTools(autoApproveTools.value);
  persistConversation();

  // 与 Anywhere 保持一致：开启后立即放行本轮已经等待的确认。
  if (!autoApproveTools.value) return;
  for (const [id, resolve] of pendingApprovals.entries()) {
    const call = runtime.messages
      .flatMap(getMessageToolCalls)
      .find((item) => item.id === id);
    if (!call) continue;
    pendingApprovals.delete(id);
    executeTool(runtime, call, true).then(resolve);
  }
}

/**
 * 将设置界面的流事件合并间隔限制为宿主 API 支持的整数范围。
 * @param {unknown} value 初始状态或控件传入的毫秒值。
 * @returns {number} 0 到 1000 之间的整数毫秒值。
 */
function normalizeStreamBatchIntervalMs(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval < 0) return 50;
  return Math.min(1000, Math.round(interval));
}

/**
 * 保存后续 AI 请求使用的流事件合并间隔。
 * @param {unknown} value 设置控件传入的毫秒值。
 * @returns {void} 无返回值。
 */
function setStreamBatchIntervalMs(value) {
  const interval = normalizeStreamBatchIntervalMs(value);
  const saved = bridge?.saveStreamBatchIntervalMs?.(interval);
  streamBatchIntervalMs.value = normalizeStreamBatchIntervalMs(
    saved ?? interval,
  );
}

/**
 * 将自动压缩阈值限制为压缩策略支持的整数百分比。
 * @param {unknown} value 初始状态或控件传入的百分比。
 * @returns {number} 50 到 95 之间的整数百分比。
 */
function normalizeAutoCompactionThresholdPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 70;
  return Math.min(95, Math.max(50, Math.round(percent)));
}

/**
 * 保存后续模型请求使用的自动压缩触发阈值。
 * @param {unknown} value 设置控件传入的百分比。
 * @returns {void} 无返回值。
 */
function setAutoCompactionThresholdPercent(value) {
  const percent = normalizeAutoCompactionThresholdPercent(value);
  const saved = bridge?.saveAutoCompactionThresholdPercent?.(percent);
  autoCompactionThresholdPercent.value =
    normalizeAutoCompactionThresholdPercent(saved ?? percent);
}

/**
 * 保存后续工具调度使用的最大并发调用数。
 * @param {unknown} value 设置控件传入的并发数量。
 * @returns {void} 无返回值。
 */
function setToolConcurrencyLimit(value) {
  const limit = normalizeToolConcurrencyLimit(value);
  const saved = bridge?.saveToolConcurrencyLimit?.(limit);
  toolConcurrencyLimit.value = normalizeToolConcurrencyLimit(saved ?? limit);
}

/**
 * 将工具参数 JSON 转换为对象，解析失败时返回空对象。
 * @param {unknown} raw 工具参数 JSON。
 * @returns {Record<string, unknown>} 解析后的参数对象。
 */
function parseToolArguments(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/**
 * 判断桥接结果是否同时包含模型输出、结构化展示数据和可选模型上下文。
 * @param {unknown} value 桥接层返回的工具结果。
 * @returns {boolean} 是否为结构化工具结果信封。
 */
function isPresentedToolResult(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "output" in value &&
    "presentation" in value,
  );
}

/**
 * 将工具结果转换为模型可直接理解的文本，字符串不再额外套 JSON 引号。
 * @param {unknown} value 工具返回值。
 * @returns {string} 发送给模型并保存到会话的结果文本。
 */
function serializeToolResult(value) {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? String(value) : serialized;
}

/**
 * 计算单次工具调用在前端等待的最长时间。
 * @param {Record<string, unknown>} call 工具调用对象。
 * @returns {number} 前端等待超时时间，单位毫秒。
 */
function getToolExecutionTimeoutMs(call) {
  if (!isShellToolName(call?.name) || call?.args?.background)
    return DEFAULT_TOOL_EXECUTION_TIMEOUT_MS;
  const requestedTimeout = Number(call.args?.timeoutMs);
  const shellTimeout =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.min(Math.max(requestedTimeout, 1000), SHELL_MAX_TIMEOUT_MS)
      : SHELL_DEFAULT_TIMEOUT_MS;
  // 给 preload 回调、序列化和界面状态发布预留固定收尾时间。
  return shellTimeout + TOOL_EXECUTION_TIMEOUT_GRACE_MS;
}

/**
 * 将 preload 发布的工具过程快照应用到当前调用，但不标记消息持久化。
 * @param {Record<string, unknown>} runtime 工具调用所属会话运行时。
 * @param {Record<string, unknown>} call 当前工具调用。
 * @param {Record<string, unknown>} update 有界过程更新。
 * @returns {void} 无返回值。
 */
function handleToolProgress(runtime, call, update) {
  if (!update || call.status !== "running") return;
  // 过程状态只驻留内存，最终结果到达后再统一提交 JSONL。
  call.liveOutput = update;
  trace("tool:update", {
    conversationId: runtime.id,
    id: call.id,
    name: call.name,
    phase: update.phase,
    outputChars: typeof update.output === "string" ? update.output.length : 0,
  });
}

/**
 * 执行一条工具调用，并维护确认、运行和结果状态。
 * @param {Record<string, unknown>} runtime 工具调用所属会话运行时。
 * @param {Record<string, unknown>} call 工具调用对象。
 * @param {boolean} approved 是否已经获得用户确认。
 * @param {boolean} persist 是否在本次调用中持久化状态。
 * @returns {Promise<string>} 可作为 tool 消息发送给模型的结果文本。
 */
async function executeTool(runtime, call, approved = false, persist = true) {
  if (!call) return "Tool error: 工具调用记录不存在。";
  const ownerMessage = findToolCallMessage(runtime, call.id);
  if (call.status === "cancelled")
    return call.result || "用户已终止本轮对话，工具未执行。";
  trace("tool:start", {
    conversationId: runtime.id,
    id: call.id,
    name: call.name,
    approved,
    persist,
  });
  if (!runtime.autoApproveTools && !approved) {
    call.status = "waiting";
    if (ownerMessage) markRuntimeMessageDirty(runtime, ownerMessage);
    // 在任何界面或存储等待前登记回调，避免快速点击时确认状态尚未建立。
    const approval = new Promise((resolve) =>
      pendingApprovals.set(call.id, resolve),
    );
    if (persist) await persistConversation(runtime);
    await scrollRuntimeToBottom(runtime);
    trace("tool:waiting", { id: call.id, name: call.name });
    return approval;
  }
  // 获得授权后先发布运行状态，让长命令有明确的界面反馈。
  call.status = "running";
  await scrollRuntimeToBottom(runtime);
  if (call.status === "cancelled") return call.result;
  let timeoutId = 0;
  try {
    // 本地工具不一定支持系统级中止，通过本轮取消信号及时释放对话循环并忽略迟到结果。
    const cancellationPromise = new Promise((resolve) =>
      pendingToolCancellations.set(call.id, resolve),
    );
    const executionTimeoutMs = getToolExecutionTimeoutMs(call);
    const toolPromise = bridge.invokeTool(
      runtime.projectId,
      call.name,
      call.args,
      {
        enabledSkills: runtime.enabledSkills,
        conversationId: runtime.id,
        callId: call.id,
        supportsImages:
          resolveRuntimeModelSelection(runtime)?.inputModalities?.includes(
            "image",
          ) === true,
      },
      (update) => handleToolProgress(runtime, call, update),
    );
    const result = await Promise.race([
      toolPromise,
      cancellationPromise,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("工具执行超时，请检查工作区或命令后重试。")),
          executionTimeoutMs,
        );
      }),
    ]);
    if (result === TOOL_EXECUTION_CANCELLED || call.status === "cancelled")
      return call.result;
    // 将界面展示数据与模型工具结果分离，避免差异元数据污染后续模型上下文。
    const output = isPresentedToolResult(result) ? result.output : result;
    call.presentation = isPresentedToolResult(result)
      ? result.presentation
      : null;
    call.modelContext =
      isPresentedToolResult(result) && Array.isArray(result.modelContext)
        ? result.modelContext
        : [];
    // 仅在桥接调用完整返回后标记成功并保存可序列化结果。
    call.status = "completed";
    call.result = serializeToolResult(output);
    delete call.liveOutput;
    trace("tool:done", {
      conversationId: runtime.id,
      id: call.id,
      name: call.name,
      status: call.status,
    });
    if (call.name === "task_write" && Array.isArray(output?.tasks))
      runtime.tasks = output.tasks;
    if (call.name === "task_read" && Array.isArray(output))
      runtime.tasks = output;
    return call.result;
  } catch (event) {
    if (call.status === "cancelled") return call.result;
    // 工具错误转换为模型可读结果，避免单个工具失败中断整个会话。
    call.status = "error";
    call.result = event?.result
      ? JSON.stringify(
          { ...event.result, error: event.message || String(event) },
          null,
          2,
        )
      : event.message || String(event);
    delete call.liveOutput;
    trace("tool:error", {
      conversationId: runtime.id,
      id: call.id,
      name: call.name,
      message: call.result,
    });
    return `Tool error: ${call.result}`;
  } finally {
    // 无论完成、失败还是取消，都释放执行取消器和超时计时器。
    pendingToolCancellations.delete(call.id);
    if (timeoutId) window.clearTimeout(timeoutId);
    if (ownerMessage) markRuntimeMessageDirty(runtime, ownerMessage);
    if (persist) await persistConversation(runtime);
    await scrollRuntimeToBottom(runtime);
  }
}

/**
 * 确认并继续执行一条正在等待的工具调用。
 * @param {string} id 工具调用标识。
 * @returns {void} 无返回值。
 */
function approveTool(id) {
  const runtime = activeRuntime.value;
  const resolve = pendingApprovals.get(id);
  const call = runtime.messages
    .flatMap(getMessageToolCalls)
    .find((item) => item.id === id);
  if (!call) {
    error.value = "找不到待执行的工具调用，请重新发送这条需求。";
    return;
  }
  if (!resolve) {
    error.value = "工具确认状态已过期，请重新发送这条需求。";
    call.status = "error";
    call.result = error.value;
    const ownerMessage = findToolCallMessage(runtime, id);
    if (ownerMessage) markRuntimeMessageDirty(runtime, ownerMessage);
    persistConversation(runtime);
    return;
  }
  pendingApprovals.delete(id);
  executeTool(runtime, call, true).then(resolve);
}

/**
 * 拒绝一条正在等待的工具调用并返回拒绝结果。
 * @param {string} id 工具调用标识。
 * @returns {void} 无返回值。
 */
function rejectTool(id) {
  const runtime = activeRuntime.value;
  const resolve = pendingApprovals.get(id);
  const call = runtime.messages
    .flatMap(getMessageToolCalls)
    .find((item) => item.id === id);
  if (!call) {
    error.value = "找不到待拒绝的工具调用，请重新发送这条需求。";
    return;
  }
  if (!resolve) {
    error.value = "工具确认状态已过期，请重新发送这条需求。";
    call.status = "error";
    call.result = error.value;
    const ownerMessage = findToolCallMessage(runtime, id);
    if (ownerMessage) markRuntimeMessageDirty(runtime, ownerMessage);
    persistConversation(runtime);
    return;
  }
  pendingApprovals.delete(id);
  call.status = "rejected";
  call.result = "用户拒绝了此操作。";
  const ownerMessage = findToolCallMessage(runtime, id);
  if (ownerMessage) markRuntimeMessageDirty(runtime, ownerMessage);
  resolve(call.result);
  persistConversation(runtime);
}

/**
 * 获取指定会话当前轮次锁定的模型选项。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {Record<string, unknown>|null} 模型选项；尚未配置时返回 null。
 */
function resolveRuntimeModelSelection(runtime) {
  const modelKey = getRuntimeModelKey(runtime);
  return modelOptions.value.find((option) => option.value === modelKey) || null;
}

/**
 * 获取指定会话当前模型步骤应使用的推理强度。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {Record<string, unknown>} selection 当前轮次锁定的模型选项。
 * @returns {string} 模型支持的推理强度。
 */
function resolveRuntimeReasoningEffort(runtime, selection) {
  const requested = runtime?.runningReasoningEffort || runtime?.reasoningEffort;
  return resolveSupportedReasoningEffort(requested, selection);
}

/**
 * 将旧 ZVC 模型键或宿主公开 ID 解析为宿主稳定模型标识。
 * @param {unknown} modelKey 会话或全局设置保存的模型键。
 * @returns {string} 唯一匹配的宿主模型标识；无法确定时返回空字符串。
 */
function resolveHostModelKey(modelKey) {
  const requested = String(modelKey || "");
  if (!requested) return "";
  const exact = modelOptions.value.find((option) => option.value === requested);
  if (exact) return exact.value;
  const legacyModelId = requested.includes("::")
    ? requested.slice(requested.lastIndexOf("::") + 2)
    : requested;
  const matches = modelOptions.value.filter(
    (option) => option.model === legacyModelId,
  );
  return matches.length === 1 ? matches[0].value : "";
}

/**
 * 获取指定会话下一次请求应使用的模型标识。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {string} 当前会话锁定的模型标识；没有会话模型时返回全局默认值。
 */
function getRuntimeModelKey(runtime) {
  return String(
    runtime?.runningModelKey ||
      runtime?.modelKey ||
      (runtime?.id === activeConversationId.value
        ? selectedModel.value
        : defaultSelectedModel.value) ||
      "",
  );
}

/**
 * 使用当前模型元数据同步会话上下文窗口，同时保留已持久化的 token 读数。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {void} 无返回值。
 */
function syncContextMeterWindow(runtime) {
  const selection = resolveRuntimeModelSelection(runtime);
  if (!selection) return;
  const current =
    runtime.contextMeter && typeof runtime.contextMeter === "object"
      ? runtime.contextMeter
      : {};
  runtime.contextMeter = {
    usedTokens: Math.max(0, Number(current.usedTokens) || 0),
    contextWindow: selection.contextWindow,
    breakdown:
      current.breakdown && typeof current.breakdown === "object"
        ? current.breakdown
        : {},
  };
}

/**
 * 构建指定会话模型步骤共享的系统提示词、工具定义和模型容量。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {Promise<Record<string, unknown>>} 当前模型请求信封。
 * @throws {Error} 尚未配置模型时抛出。
 */
async function createRequestEnvelope(runtime) {
  const selection = resolveRuntimeModelSelection(runtime);
  if (!selection) throw new Error("请先配置并选择模型");
  const skillTool = runtime.enabledSkills.length
    ? await bridge.getSkillToolDefinition(runtime.enabledSkills)
    : null;
  const workspace =
    workspaces.value.find((item) => item.id === runtime.projectId) || null;
  return {
    selection,
    modelKey: selection.value,
    contextWindow: selection.contextWindow,
    reasoningEffort: resolveRuntimeReasoningEffort(runtime, selection),
    systemPrompt: buildSystemPrompt({ project: workspace }),
    tools: [
      ...getModelTools(runtime.enabledToolNames, runtimePlatform.value),
      ...[skillTool].filter(Boolean),
    ],
  };
}

/**
 * 根据按需恢复的完整执行历史构建当前模型可见上下文。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {Record<string, unknown>} envelope 当前请求信封。
 * @returns {Record<string, unknown>} 已裁剪工具结果并应用摘要检查点的请求投影。
 */
function createCurrentContextProjection(runtime, envelope) {
  let projection = buildContextProjection({
    messages: getExecutionMessages(runtime),
    contextState: runtime.contextState,
    systemPrompt: envelope.systemPrompt,
    tools: envelope.tools,
    policy: DEFAULT_CONTEXT_POLICY,
    modelKey: envelope.modelKey,
  });
  if (!projection.stateValid) {
    // 摘要边界丢失时宁可恢复完整历史，禁止让失效摘要覆盖真实消息。
    runtime.contextState = createEmptyContextState();
    projection = buildContextProjection({
      messages: getExecutionMessages(runtime),
      contextState: runtime.contextState,
      systemPrompt: envelope.systemPrompt,
      tools: envelope.tools,
      policy: DEFAULT_CONTEXT_POLICY,
      modelKey: envelope.modelKey,
    });
  }
  return projection;
}

/**
 * 使用当前请求投影更新输入区的上下文占用读数和组成估算。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {Record<string, unknown>} envelope 当前模型请求信封。
 * @param {Record<string, unknown>} projection 当前模型可见上下文投影。
 * @returns {void} 无返回值。
 */
function updateContextMeter(runtime, envelope, projection) {
  const state = normalizeContextState(runtime.contextState);
  const scale =
    state.modelKey && state.modelKey !== envelope.modelKey
      ? 1
      : state.tokenScale;
  const systemTokens = envelope.systemPrompt
    ? estimateContextTokens(
        [{ role: "system", content: envelope.systemPrompt }],
        [],
        scale,
      )
    : 0;
  const toolsTokens = estimateContextTokens([], envelope.tools, scale);
  const messageTokens = Math.max(
    0,
    projection.estimatedTokens - systemTokens - toolsTokens,
  );
  runtime.contextMeter = {
    usedTokens: projectContextTokens(
      state,
      projection.rawEstimatedTokens,
      projection.estimatedTokens,
      envelope.modelKey,
    ),
    contextWindow: envelope.contextWindow,
    breakdown: { systemTokens, toolsTokens, messageTokens },
  };
}

/**
 * 根据指定会话、模型和能力异步重建上下文占用读数。
 * @param {Record<string, unknown>} runtime 会话运行时，默认使用当前活动会话。
 * @returns {Promise<void>} 最新有效读数提交后结束的 Promise。
 */
async function refreshContextMeter(runtime = activeRuntime.value) {
  const generation = ++runtime.contextMeterGeneration;
  if (!runtime.id || !resolveRuntimeModelSelection(runtime)) {
    runtime.contextMeter = { usedTokens: 0, contextWindow: 0, breakdown: {} };
    return;
  }
  try {
    // 该函数只由显式配置变化或执行流程调用，按需恢复历史后再重算读数。
    await ensureExecutionMessages(runtime);
    const envelope = await createRequestEnvelope(runtime);
    const projection = createCurrentContextProjection(runtime, envelope);
    // 会话、模型或能力在异步 Skill 定义加载期间变化时丢弃旧读数。
    if (
      generation !== runtime.contextMeterGeneration ||
      envelope.modelKey !== getRuntimeModelKey(runtime)
    )
      return;
    updateContextMeter(runtime, envelope, projection);
  } catch {
    // 模型配置临时不完整时隐藏读数，由下一次有效配置刷新。
    if (generation === runtime.contextMeterGeneration)
      runtime.contextMeter = { usedTokens: 0, contextWindow: 0, breakdown: {} };
  }
}

/**
 * 生成并原子提交一个历史摘要检查点。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {{force?: boolean, envelope?: Record<string, unknown>, projection?: Record<string, unknown>, reason?: string}} options 压缩触发方式和可复用请求状态。
 * @returns {Promise<boolean>} 是否成功提交了更小的上下文。
 * @throws {Error} 摘要请求失败或摘要不满足缩减条件时抛出。
 */
async function compactConversationContext(runtime, options = {}) {
  if (runtime.compacting) return false;
  await ensureExecutionMessages(runtime);
  const envelope = options.envelope || (await createRequestEnvelope(runtime));
  const projection =
    options.projection || createCurrentContextProjection(runtime, envelope);
  const force = options.force === true;
  const thresholdRatio = autoCompactionThresholdPercent.value / 100;
  if (
    !force &&
    !shouldCompactContext(
      projection.estimatedTokens,
      envelope.contextWindow,
      thresholdRatio,
    )
  )
    return false;

  const retainTokens = force
    ? 0
    : Math.floor(envelope.contextWindow * DEFAULT_CONTEXT_POLICY.retainRatio);
  const selection = analyzeCompactionCandidate({
    messages: getExecutionMessages(runtime),
    contextState: runtime.contextState,
    retainTokens,
    policy: DEFAULT_CONTEXT_POLICY,
  });
  const candidate = selection.candidate;
  if (!candidate) {
    // 达到压力线却没有协议安全范围时留下可诊断原因，避免自动压缩静默失效。
    trace("context:compact-skipped", {
      conversationId: runtime.id,
      reason: options.reason || (force ? "manual" : "pressure"),
      blockReason: selection.reason,
      estimatedTokens: projection.estimatedTokens,
      contextWindow: envelope.contextWindow,
      retainedTokens: selection.retainedTokens,
    });
    return false;
  }

  // 摘要在临时状态中生成，只有所有快照仍一致时才写入当前会话。
  const generation = ++runtime.contextOperationGeneration;
  const modelKey = envelope.modelKey;
  const boundaryId = runtime.contextState.compactedThroughMessageId;
  const historyIds = getExecutionMessages(runtime)
    .map((message) => message.id)
    .join("\n");
  const reason = options.reason || (force ? "manual" : "pressure");
  runtime.compacting = true;
  trace("context:compact-start", {
    conversationId: runtime.id,
    reason,
    messages: candidate.sourceMessageIds.length,
    shadowedTokens: candidate.shadowedTokens,
  });
  try {
    // 先提交压缩状态并保持末尾可见，避免同步进入网络请求时界面来不及绘制提示。
    await nextTick();
    await scrollRuntimeToBottom(runtime);
    const response = await bridge.summarizeContext(
      {
        model: envelope.selection.value,
        messages: buildCompactionMessages(candidate, envelope.systemPrompt),
        tools: envelope.tools,
        reasoningEffort: envelope.reasoningEffort || undefined,
        maxTokens: DEFAULT_CONTEXT_POLICY.summaryMaxTokens,
      },
      (event) => {
        if (
          generation === runtime.contextOperationGeneration &&
          event.type === "request"
        )
          runtime.requestId = event.requestId;
      },
    );

    // 停止、模型切换或本会话历史变化都会使异步摘要失去提交资格。
    if (
      generation !== runtime.contextOperationGeneration ||
      getRuntimeModelKey(runtime) !== modelKey ||
      runtime.contextState.compactedThroughMessageId !== boundaryId ||
      getExecutionMessages(runtime)
        .map((message) => message.id)
        .join("\n") !== historyIds
    )
      return false;

    const validated = validateCompactionSummary(response, candidate);
    const nextContextState = createCompactedContextState(
      runtime.contextState,
      candidate,
      validated,
      modelKey,
    );
    const marker = createContextCompactionMarker(candidate, validated, {
      id: makeId(),
      reason,
      timestamp: nextContextState.lastCompactedAt,
    });
    // 摘要状态和时间线标记一并提交，并按完成时间在当前消息末尾展示。
    const nextMessages = appendContextCompactionMarker(
      getExecutionMessages(runtime),
      marker,
    );
    replaceExecutionMessages(runtime, nextMessages);
    markRuntimeMessageDirty(runtime, marker);
    runtime.contextState = nextContextState;
    updateContextMeter(
      runtime,
      envelope,
      createCurrentContextProjection(runtime, envelope),
    );
    await persistConversation(runtime);
    await scrollRuntimeToBottom(runtime);
    trace("context:compact-done", {
      conversationId: runtime.id,
      summaryTokens: validated.summaryTokens,
      compactedThrough: candidate.lastMessageId,
    });
    return true;
  } finally {
    // 只允许当前代次释放状态，避免旧请求清理覆盖下一项操作。
    if (generation === runtime.contextOperationGeneration) {
      runtime.compacting = false;
      runtime.requestId = "";
    }
  }
}

/**
 * 在模型步骤前检查压力，并在需要时生成一次摘要。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @returns {Promise<{envelope: Record<string, unknown>, projection: Record<string, unknown>}>} 可直接发往模型的请求状态。
 * @throws {Error} 模型配置或请求信封构建失败时抛出。
 */
async function prepareModelRequest(runtime) {
  await ensureExecutionMessages(runtime);
  const envelope = await createRequestEnvelope(runtime);
  let projection = createCurrentContextProjection(runtime, envelope);
  const thresholdRatio = autoCompactionThresholdPercent.value / 100;
  if (
    shouldCompactContext(
      projection.estimatedTokens,
      envelope.contextWindow,
      thresholdRatio,
    )
  ) {
    try {
      const compacted = await compactConversationContext(runtime, {
        envelope,
        projection,
        reason: "pressure",
      });
      if (compacted)
        projection = createCurrentContextProjection(runtime, envelope);
    } catch (event) {
      // 自动压缩失败不破坏当前 Turn，原请求仍可继续并由溢出恢复兜底。
      trace("context:compact-error", {
        reason: "pressure",
        message: event.message || String(event),
      });
      console.warn("[ZVC context] automatic compaction failed", event);
    }
  }
  updateContextMeter(runtime, envelope, projection);
  return { envelope, projection };
}

/**
 * 由用户手动压缩当前会话的全部旧 Turn。
 * @returns {Promise<void>} 压缩完成或错误展示完成后的 Promise。
 */
async function compactContextNow() {
  const runtime = activeRuntime.value;
  if (runtime.busy || runtime.compacting) return;
  runtime.stopRequested = false;
  runtime.error = "";
  try {
    const compacted = await compactConversationContext(runtime, {
      force: true,
      reason: "manual",
    });
    if (!compacted) runtime.error = "当前没有足够的完整旧对话可压缩。";
  } catch (event) {
    runtime.error = event.message || "上下文压缩失败";
  } finally {
    // 手动压缩期间收到的排队消息在维护阶段结束后自动唤醒调度器。
    if (!runtime.compacting && runtime.pendingMessages.length)
      startConversationScheduler(runtime);
  }
}

/**
 * 把待处理消息转换为正式时间线中的用户消息。
 * @param {Record<string, unknown>} submission 已领取的提交内容。
 * @param {string} turnId 归属 Turn 标识。
 * @returns {Record<string, unknown>} 可追加到会话历史的用户消息。
 */
function createUserMessageFromSubmission(submission, turnId) {
  const text = String(submission.text || "").trim();
  const attachments = Array.isArray(submission.attachments)
    ? submission.attachments
    : [];
  const parts = [
    ...(text ? [{ type: "text", text }] : []),
    ...attachments.map((attachment) => ({ type: "image", attachment })),
  ];
  const message = {
    id: String(submission.id || makeId()),
    turnId,
    role: "user",
    content: text,
    timestamp: Number(submission.createdAt) || Date.now(),
  };
  // 纯文本沿用字符串协议，仅多模态消息保存有序内容块。
  if (attachments.length) message.parts = parts;
  return message;
}

/**
 * 在当前 Turn 的安全步骤边界领取全部插话消息并写入正式历史。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {string} turnId 当前 Turn 标识。
 * @returns {Promise<boolean>} 是否注入了至少一条插话消息。
 */
async function injectSteeringMessages(runtime, turnId) {
  if (!runtime.busy || runtime.compacting) return false;
  const result = claimPendingMessages(
    runtime.pendingMessages,
    STEERING_PLACEMENT,
  );
  if (!result.claimed.length) return false;
  // Inbox 删除和正式消息追加在同一次持久化中提交，避免重载时重复消费。
  runtime.pendingMessages = result.inbox;
  for (const submission of result.claimed)
    appendRuntimeMessage(
      runtime,
      createUserMessageFromSubmission(submission, turnId),
    );
  runtime.workspaceLocked = true;
  trace("inbox:steering-claimed", {
    conversationId: runtime.id,
    turnId,
    count: result.claimed.length,
  });
  await persistConversation(runtime);
  await scrollRuntimeToBottom(runtime);
  return true;
}

/**
 * 运行模型与工具之间的多轮循环，直到得到最终回复或用户终止本轮。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {string} turnId 本轮对话标识。
 * @returns {Promise<void>} 本轮模型与工具循环结束后的 Promise。
 * @throws {Error} 模型未配置或请求失败时抛出。
 */
async function runAssistantLoop(runtime, turnId) {
  let rounds = 0;
  while (runtime.busy) {
    // 每一模型步骤先完成上下文压力检查，再创建流式消息占位。
    rounds += 1;
    trace("loop:round", {
      conversationId: runtime.id,
      rounds,
      busy: runtime.busy,
      messages: getExecutionMessages(runtime).length,
    });
    console.log(
      "[ZVC loop] round start",
      runtime.id,
      rounds,
      "busy",
      runtime.busy,
    );
    let requestContext = await prepareModelRequest(runtime);
    if (!runtime.busy) return;
    // 保持助手消息为响应式对象，确保等待确认时工具卡片和执行按钮及时出现。
    // 中间工具轮次不记录展示时间，完整 Turn 结束后再统一发布尾部时间。
    const assistant = reactive({
      id: makeId(),
      turnId,
      role: "assistant",
      content: "",
      reasoning: "",
      reasoningStatus: "idle",
      status: "streaming",
      tool_calls: [],
    });
    const streamingToolCalls = new Map();
    let assistantStream = startAssistantStream(runtime, assistant);
    appendRuntimeMessage(runtime, assistant);
    await scrollRuntimeToBottom(runtime);
    let response;
    let overflowRetried = false;
    let transientRetryAttempt = 0;
    while (runtime.busy) {
      try {
        // 请求开始先显示当前输入上下文的估算，等待模型 usage 再替换为精确值。
        startTurnTokenStep(runtime, requestContext.projection.estimatedTokens);
        trace("chat:start", {
          rounds,
          retryAttempt: transientRetryAttempt,
          apiMessages: requestContext.projection.messages.length,
          estimatedTokens: requestContext.projection.estimatedTokens,
        });
        response = await bridge.chat(
          {
            model: requestContext.envelope.selection.value,
            messages: requestContext.projection.messages,
            tools: requestContext.envelope.tools,
            reasoningEffort: requestContext.envelope.reasoningEffort || undefined,
            streamBatchIntervalMs: streamBatchIntervalMs.value,
          },
          (event) => {
            // 停止后丢弃提供商可能迟到的流事件，避免重新创建运行中的工具卡片。
            if (!runtime.busy || runtime.compacting) return;
            if (event.type === "request") runtime.requestId = event.requestId;
            if (event.type === "usage")
              applyTurnTokenUsage(runtime, event.usage);
            if (event.type === "reasoning") {
              // 思考分片只控制思考面板，不再借用整轮助手消息的生成状态。
              assistant.reasoningStatus = "streaming";
              appendAssistantStreamDelta(
                assistantStream,
                event.type,
                event.delta,
              );
            }
            if (event.type === "reasoning_end") {
              // 在正文或工具到来前发布最后一批思考文本，再关闭面板运行状态。
              flushAssistantStream(assistantStream);
              assistant.reasoningStatus = "completed";
            }
            if (event.type === "content")
              appendAssistantStreamDelta(
                assistantStream,
                event.type,
                event.delta,
              );
            if (event.type === "tool_call") {
              applyStreamingToolCallDelta(
                assistant.tool_calls,
                streamingToolCalls,
                event,
                { makeId, parseArguments: parseToolArguments },
              );
              scrollRuntimeToBottom(runtime);
            }
          },
        );
        clearChatRetryState(runtime);
        trace("chat:done", {
          rounds,
          content: response.content?.length || 0,
          toolCalls: response.tool_calls?.length || 0,
        });
        break;
      } catch (event) {
        // Harness 会保留失败请求已经收到的 usage，但不把没有 usage 的半截估算计入 Turn。
        settleTurnTokenStep(runtime, false);
        finishAssistantStream(assistantStream);
        runtime.requestId = "";
        const failure = createChatFailureSnapshot(event);
        trace("chat:error", { conversationId: runtime.id, rounds, ...failure });
        if (!runtime.busy) {
          assistant.status = "stopped";
          if (!assistant.content) assistant.content = "已停止生成。";
          markRuntimeMessageDirty(runtime, assistant);
          await persistConversation(runtime);
          return;
        }
        if (!overflowRetried && isContextWindowExceededError(event)) {
          overflowRetried = true;
          let compacted = false;
          try {
            compacted = await compactConversationContext(runtime, {
              force: true,
              envelope: requestContext.envelope,
              reason: "context-overflow",
            });
          } catch (compactionError) {
            trace("context:compact-error", {
              reason: "context-overflow",
              message: compactionError.message || String(compactionError),
            });
          }
          if (compacted && runtime.busy) {
            // 只有上下文确实缩小后才复用当前占位消息重试一次。
            requestContext = {
              envelope: requestContext.envelope,
              projection: createCurrentContextProjection(
                runtime,
                requestContext.envelope,
              ),
            };
            assistant.status = "streaming";
            assistantStream = startAssistantStream(runtime, assistant);
            continue;
          }
        }
        const retry = createChatRetryState(event, transientRetryAttempt + 1);
        if (retry) {
          transientRetryAttempt = retry.attempt;
          // 回滚本次失败流，下一次请求继续复用同一个消息位置和协议上下文。
          resetAssistantForChatRetry(assistant);
          streamingToolCalls.clear();
          runtime.retryState = retry;
          trace("chat:retry-scheduled", {
            conversationId: runtime.id,
            rounds,
            attempt: retry.attempt,
            delayMs: retry.delayMs,
            message: retry.message,
          });
          const retryReady = await waitForChatRetry(runtime, retry);
          clearChatRetryState(runtime);
          if (!retryReady || !runtime.busy) {
            assistant.status = "stopped";
            if (!assistant.content) assistant.content = "已停止生成。";
            markRuntimeMessageDirty(runtime, assistant);
            await persistConversation(runtime);
            return;
          }
          // 退避结束后创建全新流缓冲，防止失败尝试的尾部分片写入新响应。
          assistantStream = startAssistantStream(runtime, assistant);
          continue;
        }
        // 重试耗尽或错误不可恢复时收口半截流，未完成工具必须明确表示未执行。
        finalizeAssistantAfterChatFailure(runtime, assistant, failure);
        markRuntimeMessageDirty(runtime, assistant);
        throw event;
      }
    }
    finishAssistantStream(assistantStream);
    runtime.requestId = "";
    if (!runtime.busy) {
      assistant.status = "stopped";
      if (!assistant.content) assistant.content = "已停止生成。";
      markRuntimeMessageDirty(runtime, assistant);
      await persistConversation(runtime);
      return;
    }
    // 最终响应覆盖缓冲结果，以提供商汇总内容为准并补齐可能遗漏的尾部。
    assistant.content = response.content || assistant.content || "";
    assistant.reasoning =
      response.reasoning_content ||
      response.reasoning ||
      assistant.reasoning ||
      "";
    updateTurnOutputTokenEstimate(
      runtime,
      assistant.reasoning,
      assistant.content,
    );
    applyTurnTokenUsage(runtime, response.usage);
    // 当前模型 step 完成后固化到 Turn 累计，工具完成后下一 step 从此基线继续。
    settleTurnTokenStep(runtime);
    if (assistant.reasoning) assistant.reasoningStatus = "completed";
    assistant.status = "completed";
    // 协议私有状态必须与本次 assistant 消息一起持久化，供后续模型步骤原生回放。
    if (
      response.replay_state &&
      typeof response.replay_state === "object" &&
      !Array.isArray(response.replay_state)
    ) {
      assistant.replay_state = response.replay_state;
    } else {
      delete assistant.replay_state;
    }
    assistant.tool_calls = normalizeToolCalls(response.tool_calls)
      .filter(
        (toolCall) =>
          toolCall.function && typeof toolCall.function === "object",
      )
      .map((toolCall) => ({
        id: toolCall.id || makeId(),
        name: toolCall.function.name,
        arguments: toolCall.function.arguments || "{}",
        args: parseToolArguments(toolCall.function.arguments),
        status: "queued",
        result: "",
        presentation: null,
      }));
    markRuntimeMessageDirty(runtime, assistant);
    runtime.contextState = applyUsageCalibration(
      runtime.contextState,
      response.usage,
      requestContext.projection.rawEstimatedTokens,
      requestContext.envelope.modelKey,
    );
    updateContextMeter(
      runtime,
      requestContext.envelope,
      createCurrentContextProjection(runtime, requestContext.envelope),
    );
    await persistConversation(runtime);
    trace("loop:assistant-saved", {
      conversationId: runtime.id,
      rounds,
      toolCalls: assistant.tool_calls.length,
    });
    if (!assistant.tool_calls.length) {
      // 最终回答之后仍有插话时，把它作为同一 Turn 的下一步骤继续处理。
      if (await injectSteeringMessages(runtime, turnId)) continue;
      break;
    }

    // 按并发安全策略调度工具；只读调用可并行，有副作用调用形成独占屏障。
    const scheduled = await executeScheduledToolCalls(assistant.tool_calls, {
      maxParallel: toolConcurrencyLimit.value,
      getMode: getToolExecutionMode,
      isCancelled: () => !runtime.busy,
      execute: (call) => executeTool(runtime, call, false, false),
    });
    const results = scheduled.results;
    trace("loop:tools-done", {
      conversationId: runtime.id,
      rounds,
      count: results.length,
      started: scheduled.started,
      skipped: scheduled.skipped,
      maxParallel: toolConcurrencyLimit.value,
    });
    console.log(
      "[ZVC loop] tools complete",
      runtime.id,
      rounds,
      assistant.tool_calls.map((call) => `${call.name}:${call.status}`),
    );
    for (const [index, call] of assistant.tool_calls.entries()) {
      appendRuntimeMessage(runtime, {
        id: makeId(),
        turnId,
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: results[index],
      });
    }
    for (const call of assistant.tool_calls) {
      if (
        Array.isArray(call.modelContext) &&
        call.modelContext.some((part) => part?.type === "image")
      ) {
        // 所有工具结果配对结束后再注入图片，避免打断并行 Function Calling 的协议顺序。
        appendRuntimeMessage(runtime, {
          id: makeId(),
          turnId,
          role: "user",
          source: "tool-context",
          content: "",
          parts: call.modelContext,
        });
      }
    }
    updateContextMeter(
      runtime,
      requestContext.envelope,
      createCurrentContextProjection(runtime, requestContext.envelope),
    );
    await persistConversation(runtime);
    trace("loop:tool-messages-saved", {
      conversationId: runtime.id,
      rounds,
      messages: getExecutionMessages(runtime).length,
    });
    console.log(
      "[ZVC loop] tools appended",
      runtime.id,
      rounds,
      "busy",
      runtime.busy,
    );
    if (!runtime.busy) return;
    // 工具调用及其结果完整配对后才注入插话，保证 Function Calling 历史合法。
    await injectSteeringMessages(runtime, turnId);
  }
}

/**
 * 在完整模型与工具循环结束后发布本轮唯一的助手完成时间。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {string} turnId 本轮对话标识。
 * @returns {Record<string, unknown>|null} 获得尾部时间的最后一条正文助手消息；没有正文时返回 null。
 */
function completeAssistantTurn(runtime, turnId) {
  // 从后向前查找最后一条正文，保持思考和工具中间轮次不显示独立时间。
  const closingMessage = getExecutionMessages(runtime).findLast(
    (message) =>
      message?.turnId === turnId &&
      message.role === "assistant" &&
      typeof message.content === "string" &&
      message.content.trim(),
  );
  if (!closingMessage) return null;
  closingMessage.completedAt = Date.now();
  markRuntimeMessageDirty(runtime, closingMessage);
  return closingMessage;
}

/**
 * 在指定会话中执行一轮完整的助手响应流程。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {Record<string, unknown>} submission 已校验并冻结的用户提交。
 * @returns {Promise<void>} 消息生成、保存和收尾完成后的 Promise。
 */
async function executeConversationTurn(runtime, submission) {
  // 在启动异步请求前重置本轮错误状态，但保留用户正在编辑的新草稿。
  cancelChatRetryWait(runtime);
  runtime.error = "";
  runtime.busy = true;
  runtime.stopRequested = false;
  runtime.runningModelKey = getRuntimeModelKey(runtime);
  const runningModel =
    modelOptions.value.find(
      (option) => option.value === runtime.runningModelKey,
    ) || null;
  runtime.runningReasoningEffort = resolveSupportedReasoningEffort(
    runtime.reasoningEffort,
    runningModel,
  );
  startActiveTurnClock(runtime);
  runtime.autoScrollMessages = true;
  const turnId = makeId();
  runtime.activeTurnId = turnId;
  // 新 Turn 先清除上一轮的读数，压缩或准备阶段不展示过期 token 统计。
  resetTurnTokenStats(runtime);
  await ensureExecutionMessages(runtime);
  // 与 Harness 的 standing plan 一致，新一轮开始时清除上一轮任务投影。
  runtime.tasks = [];
  // 正式领取时保留用户最初提交时间，不让排队等待改写消息时间。
  const userMessage = createUserMessageFromSubmission(submission, turnId);
  // 第一条用户消息提交时冻结工作区状态，避免后续工具在不同目录中继续同一历史。
  runtime.workspaceLocked = true;
  appendRuntimeMessage(runtime, userMessage);
  const conversation = conversations.value.find(
    (item) => item.id === runtime.id,
  );
  if (conversation?.title === "新的对话") {
    const text = String(submission.text || "");
    const attachmentCount = Array.isArray(submission.attachments)
      ? submission.attachments.length
      : 0;
    const title =
      text.replace(/\s+/g, " ").slice(0, 42) ||
      (attachmentCount === 1 ? "图片对话" : `${attachmentCount} 张图片`);
    bridge?.updateConversation(runtime.id, { title });
    conversations.value = conversations.value.map((item) =>
      item.id === runtime.id ? { ...item, title } : item,
    );
  }
  await persistConversation(runtime);
  try {
    await runAssistantLoop(runtime, turnId);
    // 停止流程会让循环提前正常返回，仅仍处于生成状态的完整 Turn 才发布尾部时间。
    if (runtime.busy) completeAssistantTurn(runtime, turnId);
  } catch (event) {
    if (runtime.busy) {
      runtime.error = event.message || "模型请求失败";
      console.error("[ZVC loop] failed", event);
    }
  } finally {
    const completedNormally = runtime.busy && !runtime.stopRequested;
    // 无论成功、失败或停止，都释放请求状态并提交本轮原子消息变化。
    runtime.busy = false;
    stopActiveTurnClock(runtime);
    cancelChatRetryWait(runtime);
    runtime.requestId = "";
    runtime.runningModelKey = "";
    runtime.runningReasoningEffort = "";
    runtime.activeTurnId = "";
    await refreshContextMeter(runtime);
    await persistConversation(runtime);
    // 后台完成使用一次性提示标记，重新打开会话时由选择动作清除。
    if (completedNormally && activeConversationId.value !== runtime.id)
      runtime.completedUnread = true;
    await scrollRuntimeToBottom(runtime);
  }
}

/**
 * 串行执行一个会话的首条提交和后续 FIFO 队列。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {Record<string, unknown>|null} initialSubmission 可立即执行的首条提交。
 * @returns {Promise<void>} Inbox 耗尽或执行失败后结束的 Promise。
 */
async function runConversationScheduler(runtime, initialSubmission = null) {
  let submission = initialSubmission;
  while (true) {
    if (!submission) {
      // 原 Turn 已不存在时，未消费插话优先降级到下一轮队首。
      runtime.pendingMessages = recoverConversationInbox(
        runtime.pendingMessages,
      );
      const result = claimPendingMessages(
        runtime.pendingMessages,
        QUEUED_PLACEMENT,
        1,
      );
      if (!result.claimed.length) return;
      runtime.pendingMessages = result.inbox;
      submission = result.claimed[0];
      trace("inbox:queued-claimed", {
        conversationId: runtime.id,
        messageId: submission.id,
      });
    }
    await executeConversationTurn(runtime, submission);
    submission = null;
  }
}

/**
 * 为指定会话启动唯一的 Inbox 调度器。
 * @param {Record<string, unknown>} runtime 会话运行时。
 * @param {Record<string, unknown>|null} initialSubmission 可立即执行的首条提交。
 * @returns {Promise<void>|null} 当前调度 Promise；会话暂不可调度时返回 null。
 */
function startConversationScheduler(runtime, initialSubmission = null) {
  if (
    !runtime?.id ||
    runtime.operationPromise ||
    runtime.busy ||
    runtime.compacting
  )
    return runtime?.operationPromise || null;
  if (!resolveRuntimeModelSelection(runtime)) {
    // 恢复队列时模型可能已被宿主移除，此时保留 Inbox 等待用户重新选择模型。
    runtime.error = "当前会话没有可用模型，排队消息将在选择模型后继续。";
    return null;
  }
  const operation = runConversationScheduler(runtime, initialSubmission);
  runtime.operationPromise = markRaw(operation);
  // Promise 清理使用身份保护，避免旧调度器覆盖后来启动的新调度器。
  void operation.then(
    () => {
      if (runtime.operationPromise === operation)
        runtime.operationPromise = null;
    },
    (event) => {
      if (runtime.operationPromise === operation)
        runtime.operationPromise = null;
      runtime.error = event?.message || "会话队列执行失败";
      console.error("[ZVC scheduler] failed", event);
    },
  );
  return operation;
}

/**
 * 提交当前草稿；运行中进入排队或插话 Inbox，空闲时立即启动 Turn。
 * @param {'queued'|'steering'} mode 运行中的投递模式。
 * @returns {Promise<void>|undefined|null} 持久化或调度 Promise；输入不可发送时返回 undefined。
 */
function sendMessage(mode = busySubmissionMode.value) {
  if (!canSend.value) {
    if (!selectedModelOption.value)
      error.value = "请先在 ZTools 设置中添加并启用 AI 模型。";
    return undefined;
  }
  const runtime = activeRuntime.value;
  const running = Boolean(
    runtime.busy || runtime.compacting || runtime.operationPromise,
  );
  const steeringAvailable = runtime.busy && !runtime.compacting;
  const placement =
    steeringAvailable && mode === STEERING_PLACEMENT
      ? STEERING_PLACEMENT
      : QUEUED_PLACEMENT;
  const targetModel =
    placement === STEERING_PLACEMENT
      ? resolveRuntimeModelSelection(runtime)
      : selectedModelOption.value;
  if (
    runtime.inputAttachments.length &&
    !targetModel?.inputModalities?.includes("image")
  ) {
    runtime.error =
      "当前模型未启用图片输入，请在模型设置中开启“支持图片”或切换模型。";
    return undefined;
  }
  const submission = createPendingMessage({
    id: makeId(),
    text: runtime.input,
    attachments: [...runtime.inputAttachments],
    placement,
    createdAt: Date.now(),
  });
  // 提交成功后立即释放草稿，允许用户继续编写下一条消息。
  runtime.input = "";
  runtime.inputAttachments = [];
  runtime.error = "";
  submissionModeOpen.value = false;
  if (!running) return startConversationScheduler(runtime, submission);
  runtime.pendingMessages = appendPendingMessage(
    runtime.pendingMessages,
    submission,
  );
  trace("inbox:inserted", {
    conversationId: runtime.id,
    messageId: submission.id,
    placement,
  });
  return persistConversation(runtime);
}

/**
 * 编辑当前会话中的一条普通排队消息。
 * @param {{id: string, text: string}} change 消息标识和新文本。
 * @returns {Promise<void>} 最新 Inbox 持久化完成后的 Promise。
 */
function editQueuedMessage(change) {
  const runtime = activeRuntime.value;
  runtime.pendingMessages = editPendingMessage(
    runtime.pendingMessages,
    change.id,
    change.text,
  );
  return persistConversation(runtime);
}

/**
 * 删除当前会话中的一条待处理消息。
 * @param {string} id 消息标识。
 * @returns {Promise<void>} 最新 Inbox 持久化完成后的 Promise。
 */
function deletePendingMessage(id) {
  const runtime = activeRuntime.value;
  runtime.pendingMessages = removePendingMessage(runtime.pendingMessages, id);
  return persistConversation(runtime);
}

/**
 * 把普通排队消息提升为当前 Turn 的安全插话。
 * @param {string} id 消息标识。
 * @returns {Promise<void>} 最新 Inbox 持久化完成后的 Promise。
 */
function promotePendingMessage(id) {
  const runtime = activeRuntime.value;
  if (!runtime.busy || runtime.compacting) {
    runtime.error = "当前 Turn 已结束，这条消息将继续按队列执行。";
    return Promise.resolve();
  }
  runtime.pendingMessages = steerPendingMessage(runtime.pendingMessages, id);
  trace("inbox:promoted", { conversationId: runtime.id, messageId: id });
  return persistConversation(runtime);
}

/**
 * 选择运行中 Enter 和发送按钮使用的默认投递模式。
 * @param {'queued'|'steering'} mode 新投递模式。
 * @returns {void} 无返回值。
 */
function selectBusySubmissionMode(mode) {
  busySubmissionMode.value =
    mode === STEERING_PLACEMENT ? STEERING_PLACEMENT : QUEUED_PLACEMENT;
  submissionModeOpen.value = false;
  nextTick(() => composerInput.value?.focus());
}

/**
 * 关闭发送模式菜单。
 * @returns {void} 无返回值。
 */
function closeSubmissionModeMenu() {
  submissionModeOpen.value = false;
}

/**
 * 打开系统图片选择器。
 * @returns {void} 无返回值。
 */
function openImagePicker() {
  attachmentInput.value?.click();
}

/**
 * 将用户选择、粘贴或拖入的图片保存为草稿附件引用。
 * @param {FileList|File[]} files 浏览器提供的候选文件。
 * @returns {Promise<void>} 全部有效图片处理完成后的 Promise。
 */
async function addComposerImages(files) {
  const candidates = [...(files || [])].filter((file) =>
    file?.type?.startsWith("image/"),
  );
  if (!candidates.length) return;
  const available = Math.max(
    0,
    MAX_MESSAGE_IMAGES - inputAttachments.value.length,
  );
  if (!available) {
    error.value = `每条消息最多添加 ${MAX_MESSAGE_IMAGES} 张图片。`;
    return;
  }
  try {
    const next = [...inputAttachments.value];
    for (const file of candidates.slice(0, available)) {
      if (
        next.reduce((total, item) => total + Number(item.bytes || 0), 0) +
          file.size >
        MAX_MESSAGE_IMAGE_BYTES
      )
        throw new Error("单条消息的图片总大小不能超过 100 MB");
      // 浏览器文件只在保存阶段转为字节，草稿和会话均不保留 Base64。
      const bytes = new Uint8Array(await file.arrayBuffer());
      const reference = await Promise.resolve(
        bridge.saveImageAttachment({
          bytes,
          mediaType: file.type,
          name: file.name,
        }),
      );
      next.push(reference);
    }
    inputAttachments.value = next;
    error.value = "";
  } catch (event) {
    error.value = event.message || "图片添加失败";
  } finally {
    // 允许用户再次选择同一个本地文件。
    if (attachmentInput.value) attachmentInput.value.value = "";
  }
}

/**
 * 处理隐藏文件输入框的选择结果。
 * @param {Event} event 文件输入变更事件。
 * @returns {Promise<void>} 图片保存完成后的 Promise。
 */
async function handleImageSelection(event) {
  await addComposerImages(event.target?.files || []);
}

/**
 * 从当前会话草稿中移除一张图片引用。
 * @param {number} index 图片在草稿中的位置。
 * @returns {void} 无返回值。
 */
function removeComposerImage(index) {
  inputAttachments.value = inputAttachments.value.filter(
    (_, itemIndex) => itemIndex !== index,
  );
}

/**
 * 处理输入框粘贴事件，并优先接收剪贴板中的图片文件。
 * @param {ClipboardEvent} event 粘贴事件。
 * @returns {Promise<void>} 图片读取完成后的 Promise。
 */
async function handleComposerPaste(event) {
  const files = [...(event.clipboardData?.files || [])].filter((file) =>
    file.type.startsWith("image/"),
  );
  if (!files.length) return;
  event.preventDefault();
  await addComposerImages(files);
}

/**
 * 处理图片拖入输入区，并阻止浏览器直接打开本地文件。
 * @param {DragEvent} event 拖放事件。
 * @returns {Promise<void>} 图片保存完成后的 Promise。
 */
async function handleComposerDrop(event) {
  event.preventDefault();
  composerDraggingImage.value = false;
  await addComposerImages(event.dataTransfer?.files || []);
}

/**
 * 停止指定会话的当前 Turn 并取消尚未执行的工具确认，同时保留 Inbox。
 * @param {Record<string, unknown>} runtime 会话运行时，默认使用当前活动会话。
 * @returns {Promise<void>} 已接收流内容持久化完成后的 Promise。
 */
function stopGeneration(runtime = activeRuntime.value) {
  if (!runtime?.id) return Promise.resolve();
  // 先使该会话摘要代次失效，再中止其请求，其他会话不受影响。
  runtime.stopRequested = true;
  runtime.contextOperationGeneration += 1;
  runtime.compacting = false;
  // 发布正文缓冲尾部，确保停止操作不会丢失已经收到的文本。
  runtime.busy = false;
  stopActiveTurnClock(runtime);
  cancelChatRetryWait(runtime);
  finishAssistantStream(runtime.activeAssistantStream);
  cancelUnfinishedTurnState(runtime, false);
  if (runtime.requestId) bridge?.abortChat(runtime.requestId);
  return persistConversation(runtime);
}

/**
 * 处理输入框发送快捷键，并避开输入法候选确认事件。
 * @param {KeyboardEvent} event 键盘事件。
 * @returns {void} 无返回值。
 */
function handleComposerKeydown(event) {
  // 输入法候选确认同样会产生 Enter 或 keyCode 229，应交由输入法消费。
  if (event.isComposing || event.keyCode === 229 || isComposing.value) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const accelerated = event.metaKey || event.ctrlKey;
    const alternateMode =
      busySubmissionMode.value === QUEUED_PLACEMENT
        ? STEERING_PLACEMENT
        : QUEUED_PLACEMENT;
    // 空闲时两种手势都立即发送；运行中加速手势使用默认模式的相反投递方式。
    sendMessage(
      activeSessionRunning.value && accelerated
        ? alternateMode
        : busySubmissionMode.value,
    );
  }
}

/**
 * 根据草稿的实际换行高度调整输入框，并在达到十四行上限后启用内部滚动。
 * @returns {void} 无返回值。
 */
function resizeComposerInput() {
  const element = composerInput.value;
  if (!element) return;

  // 先释放旧高度，确保删除文本或窗口变宽时输入框能够同步收缩。
  element.style.height = "auto";
  const style = getComputedStyle(element);
  const minHeight = Number.parseFloat(style.minHeight) || 0;
  const maxHeight = Number.parseFloat(style.maxHeight) || 336;
  const contentHeight = element.scrollHeight;

  // 达到上限后只滚动文本区域，避免输入框继续挤压聊天内容。
  element.style.height = `${Math.min(maxHeight, Math.max(minHeight, contentHeight))}px`;
  element.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}

/**
 * 在 Vue 完成草稿 DOM 更新后同步输入框高度。
 * @returns {void} 无返回值。
 */
function scheduleComposerInputResize() {
  nextTick(resizeComposerInput);
}

watch(
  [chatContent, chatScroller, taskStrip, composerSeat],
  syncMessageResizeObserver,
  { flush: "post" },
);
watch(input, scheduleComposerInputResize);
watch(composerHasContent, (hasContent) => {
  // 草稿清空后隐藏发送模式菜单，避免下一次输入时恢复过期展开状态。
  if (!hasContent) submissionModeOpen.value = false;
});

onMounted(async () => {
  await checkZToolsVersion();
  if (!ztoolsVersionSupported.value) return;

  if (typeof ResizeObserver !== "undefined") {
    messageResizeObserver = new ResizeObserver(handleMessageContentResize);
    syncMessageResizeObserver();
  }
  const initial = bridge?.getInitialState?.() || {
    workspaces: [],
    conversations: [],
  };
  workspaces.value = initial.workspaces || [];
  runtimePlatform.value = String(initial.runtimePlatform || "").trim();
  collapsedWorkspaceIds.value = Array.isArray(initial.collapsedWorkspaceIds)
    ? initial.collapsedWorkspaceIds
    : [];
  conversations.value = initial.conversations || [];
  skills.value = Array.isArray(initial.skills) ? initial.skills : [];
  defaultAutoApproveTools = initial.autoApproveTools !== false;
  streamBatchIntervalMs.value = normalizeStreamBatchIntervalMs(
    initial.streamBatchIntervalMs,
  );
  autoCompactionThresholdPercent.value =
    normalizeAutoCompactionThresholdPercent(
      initial.autoCompactionThresholdPercent,
    );
  toolConcurrencyLimit.value = normalizeToolConcurrencyLimit(
    initial.toolConcurrencyLimit,
  );
  // 先使用持久化模型键恢复会话，宿主模型列表返回后再统一校正。
  defaultSelectedModel.value = String(initial.selectedModel || "");
  const firstConversationId = conversations.value.some(
    (item) => item.id === initial.activeConversationId,
  )
    ? initial.activeConversationId
    : conversations.value[0]?.id;
  const conversationPromise = firstConversationId
    ? selectConversation(firstConversationId)
    : newConversation();
  const modelsPromise = loadHostModels(initial.selectedModel);
  void loadSkillsAfterFirstPaint();
  await Promise.all([conversationPromise, modelsPromise]);
  // 首次渲染后校准空草稿高度，并在窗口宽度变化时重新计算软换行。
  await nextTick();
  resizeComposerInput();
  // 相对时间每分钟刷新一次，避免静止列表长期显示旧分桶。
  sidebarTimeClock = window.setInterval(() => {
    sidebarNow.value = Date.now();
  }, 60_000);
  window.addEventListener("resize", resizeComposerInput);
  window.addEventListener("resize", closeConversationMenu);
  document.addEventListener("pointerdown", closeSubmissionModeMenu);
  window.ztools?.onPluginEnter?.(() => {});
});

onBeforeUnmount(() => {
  // 插件真正卸载时统一释放全部会话；普通会话切换不会进入此清理路径。
  for (const runtime of conversationRuntimes.values()) {
    runtime.contextOperationGeneration += 1;
    runtime.busy = false;
    runtime.compacting = false;
    cancelChatRetryWait(runtime);
    if (runtime.requestId) bridge?.abortChat(runtime.requestId);
    stopActiveTurnClock(runtime);
    finishAssistantStream(runtime.activeAssistantStream);
    cancelUnfinishedTurnState(runtime, false);
  }
  messageResizeObserver?.disconnect();
  observedMessageResizeTargets.clear();
  conversationScroll.clear();
  if (sidebarResizeRaf) cancelAnimationFrame(sidebarResizeRaf);
  if (sidebarTimeClock) window.clearInterval(sidebarTimeClock);
  window.removeEventListener("resize", resizeComposerInput);
  document.removeEventListener("pointerdown", closeSubmissionModeMenu);
  window.removeEventListener("resize", closeConversationMenu);
});
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'sidebar-collapsed': !sidebarOpen,
      'sidebar-resizing': sidebarResizing,
    }"
    :style="{ '--sidebar-width': `${sidebarWidth}px` }"
  >
    <aside class="sidebar">
      <div class="conversation-actions">
        <button
          class="new-conversation-button"
          type="button"
          @click="newConversation()"
        >
          <NewChatIcon :size="14" />新建会话
        </button>
      </div>
      <div class="conversation-list">
        <div v-if="!conversations.length" class="empty-conversations">
          <MessageSquarePlus :size="24" /><span>新建一个会话开始</span>
        </div>
        <section
          v-for="group in conversationGroups.workspaceGroups"
          :key="group.workspace.id"
          class="workspace-conversation-group"
        >
          <WorkspaceHoverCard :workspace="group.workspace">
            <div class="workspace-group-header">
              <button
                class="workspace-group-toggle"
                type="button"
                :aria-expanded="
                  !collapsedWorkspaceIds.includes(group.workspace.id)
                "
                @click="toggleWorkspaceGroup(group.workspace.id)"
              >
                <Folder
                  v-if="collapsedWorkspaceIds.includes(group.workspace.id)"
                  :size="15"
                  class="workspace-group-folder"
                />
                <FolderOpen
                  v-else
                  :size="15"
                  class="workspace-group-folder is-open"
                />
                <strong>{{ group.workspace.name }}</strong>
              </button>
              <button
                class="workspace-group-add"
                type="button"
                v-tooltip.bottom="'在此工作区新建会话'"
                aria-label="在此工作区新建会话"
                @click.stop="newConversation(group.workspace.id)"
              >
                <Plus :size="14" />
              </button>
            </div>
          </WorkspaceHoverCard>
          <div
            v-if="!collapsedWorkspaceIds.includes(group.workspace.id)"
            class="workspace-group-conversations"
          >
            <div
              v-for="conversation in visibleWorkspaceConversations(group)"
              :key="conversation.id"
              class="project-item conversation-item"
              :class="{
                active: conversation.id === activeConversationId,
                'menu-open':
                  conversationMenu?.conversationId === conversation.id,
              }"
              role="button"
              tabindex="0"
              @click="selectConversation(conversation.id)"
              @keydown.enter.prevent="selectConversation(conversation.id)"
              @keydown.space.prevent="selectConversation(conversation.id)"
            >
              <span
                v-if="conversationIsRunning(conversation.id)"
                class="conversation-runtime-status is-running"
                v-tooltip.bottom="'正在处理'"
                aria-label="正在处理"
                tabindex="0"
              ></span>
              <span
                v-else-if="conversationHasCompletedUnread(conversation.id)"
                class="conversation-runtime-status is-completed"
                v-tooltip.bottom="'后台任务已完成'"
                aria-label="后台任务已完成"
                tabindex="0"
              ></span>
              <span class="project-item-copy"
                ><strong>{{ conversation.title }}</strong></span
              >
              <span class="conversation-time">{{
                formatConversationRelativeTime(conversation.updatedAt)
              }}</span>
              <button
                class="conversation-menu-trigger"
                type="button"
                aria-label="会话操作"
                v-tooltip.bottom="'会话操作'"
                @click.stop="openConversationMenu(conversation, $event)"
              >
                <Ellipsis :size="18" />
              </button>
            </div>
            <button
              v-if="
                group.conversations.length >
                COLLAPSED_WORKSPACE_CONVERSATION_LIMIT
              "
              class="workspace-conversations-overflow"
              type="button"
              :aria-expanded="
                expandedWorkspaceConversationIds.includes(group.workspace.id)
              "
              @click="toggleWorkspaceConversations(group.workspace.id)"
            >
              {{
                expandedWorkspaceConversationIds.includes(group.workspace.id)
                  ? "收起"
                  : `展开其余 ${group.conversations.length - COLLAPSED_WORKSPACE_CONVERSATION_LIMIT} 个会话`
              }}
            </button>
          </div>
        </section>
        <section
          v-if="conversationGroups.recentConversations.length"
          class="recent-conversation-group"
        >
          <div class="sidebar-section-title">最近</div>
          <div
            v-for="conversation in conversationGroups.recentConversations"
            :key="conversation.id"
            class="project-item conversation-item"
            :class="{
              active: conversation.id === activeConversationId,
              'menu-open': conversationMenu?.conversationId === conversation.id,
            }"
            role="button"
            tabindex="0"
            @click="selectConversation(conversation.id)"
            @keydown.enter.prevent="selectConversation(conversation.id)"
            @keydown.space.prevent="selectConversation(conversation.id)"
          >
            <span
              v-if="conversationIsRunning(conversation.id)"
              class="conversation-runtime-status is-running"
              v-tooltip.bottom="'正在处理'"
              aria-label="正在处理"
              tabindex="0"
            ></span>
            <span
              v-else-if="conversationHasCompletedUnread(conversation.id)"
              class="conversation-runtime-status is-completed"
              v-tooltip.bottom="'后台任务已完成'"
              aria-label="后台任务已完成"
              tabindex="0"
            ></span>
            <span class="project-item-copy"
              ><strong>{{ conversation.title }}</strong></span
            >
            <span class="conversation-time">{{
              formatConversationRelativeTime(conversation.updatedAt)
            }}</span>
            <button
              class="conversation-menu-trigger"
              type="button"
              aria-label="会话操作"
              v-tooltip.bottom="'会话操作'"
              @click.stop="openConversationMenu(conversation, $event)"
            >
              <Ellipsis :size="18" />
            </button>
          </div>
        </section>
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-footer-actions">
          <button
            class="icon-button"
            type="button"
            v-tooltip.right="'ZVC 设置'"
            aria-label="ZVC 设置"
            @click="
              settingsOpen = true;
              capabilitiesOpen = false;
            "
          >
            <Settings :size="16" />
          </button>
          <button
            class="icon-button sidebar-collapse-button"
            type="button"
            v-tooltip.right="'收起侧栏'"
            aria-label="收起侧栏"
            @click="sidebarOpen = false"
          >
            <PanelLeftIcon :size="16" />
          </button>
        </div>
      </div>
    </aside>

    <div
      v-if="sidebarOpen"
      class="sidebar-resize-handle"
      :style="{ left: `${sidebarWidth}px` }"
      aria-hidden="true"
      @pointerdown="handleSidebarResizePointerDown"
      @pointermove="handleSidebarResizePointerMove"
      @pointerup="finishSidebarResize"
      @pointercancel="finishSidebarResize"
    ></div>

    <main class="main-panel">
      <header class="topbar">
        <button
          v-if="!sidebarOpen"
          class="icon-button"
          type="button"
          v-tooltip.right="'展开会话栏'"
          aria-label="展开会话栏"
          @click="sidebarOpen = true"
        >
          <PanelLeftIcon :size="18" />
        </button>
        <div class="project-heading">
          <strong>{{
            activeConversation?.title || "ZTools Vibe Coding"
          }}</strong>
        </div>
        <div class="topbar-actions">
          <button
            v-if="activeWorkspace"
            class="icon-button"
            type="button"
            v-tooltip.bottom="'打开工作区'"
            aria-label="打开工作区"
            @click="bridge.openWorkspace(activeWorkspace.id)"
          >
            <FolderOpen :size="18" />
          </button>
        </div>
      </header>

      <div v-if="activeConversation" class="workspace">
        <section
          ref="chatScroller"
          class="chat-scroll"
          @scroll="handleChatScroll"
        >
          <div ref="chatContent" class="chat-content">
            <div v-if="hasOlderMessages" class="history-loader">
              <button type="button" @click="loadOlderMessages">加载更早</button>
            </div>
            <div
              v-if="
                !messages.filter((message) =>
                  ['user', 'assistant'].includes(message.role),
                ).length
              "
              class="welcome-state"
            >
              <h1>今天想完成什么？</h1>
              <p>
                这是一个全能 AI
                助手。你可以问问题、搜索资料，也可以按需开启插件开发能力。
              </p>
              <div class="starter-grid">
                <button
                  type="button"
                  @click="
                    input = '帮我总结这段内容的重点，并列出可执行的下一步。'
                  "
                >
                  总结一段内容
                </button>
                <button
                  type="button"
                  @click="
                    input = '搜索今天值得关注的科技新闻，并附上来源链接。'
                  "
                >
                  搜索最新资料
                </button>
                <button type="button" @click="enablePluginDevelopment()">
                  开发 ZTools 插件
                </button>
              </div>
            </div>

            <template
              v-for="(message, index) in displayedMessages"
              :key="message.id"
            >
              <ContextCompaction
                v-if="message.kind === 'context-compaction'"
                :marker="message"
                :data-chat-anchor-key="String(message.id)"
              />
              <article
                v-else-if="
                  (message.role === 'user' || message.role === 'assistant') &&
                  message.source !== 'tool-context'
                "
                class="message"
                :class="`message-${message.role}`"
                :data-chat-anchor-key="String(message.id)"
              >
                <div class="message-body">
                  <ReasoningPanel
                    v-if="message.reasoning"
                    :reasoning="message.reasoning"
                    :is-streaming="message.reasoningStatus === 'streaming'"
                    :is-thinking="
                      message.reasoningStatus === 'streaming' &&
                      !message.content
                    "
                  />
                  <ImageGallery :attachments="getMessageImages(message)" />
                  <MessageText
                    v-if="message.role === 'user' && message.content"
                    :content="message.content"
                  />
                  <MarkdownContent
                    v-else-if="message.content"
                    :content="message.content"
                    :streaming="
                      message.role === 'assistant' &&
                      message.status === 'streaming'
                    "
                  />
                  <div
                    v-if="getMessageToolCalls(message).length"
                    class="tool-call-list"
                  >
                    <ToolCall
                      v-for="(call, callIndex) in getMessageToolCalls(message)"
                      :key="call.id || callIndex"
                      :call="call"
                      @approve="approveTool"
                      @reject="rejectTool"
                    />
                  </div>
                </div>
                <AssistantTurnActions
                  v-if="isCompletedTurnTail(message, index)"
                  :text="message.content || ''"
                  :time-label="formatMessageTime(getMessageTime(message))"
                  @branch="forkConversationFromMessage(message)"
                />
                <div
                  v-else-if="formatMessageTime(getMessageTime(message))"
                  class="message-meta"
                >
                  <time class="message-time">{{
                    formatMessageTime(getMessageTime(message))
                  }}</time>
                </div>
              </article>
            </template>
            <div v-if="error" class="inline-error">
              <Circle :size="15" />{{ error }}
            </div>
            <div
              v-if="busy || compacting"
              class="conversation-running-status"
              role="status"
              aria-live="polite"
            >
              <span>{{ runningStatusLabel }}</span>
              <span
                v-if="busy && hasTurnTokenStats"
                class="conversation-token-stats"
                role="img"
                :aria-label="turnTokenStatsAriaLabel"
                v-tooltip.top.instant="turnTokenStatsAriaLabel"
                >{{ turnTokenStatsLabel }}</span
              >
              <time v-if="busy && activeTurnElapsedSeconds >= 15">{{
                activeTurnDuration
              }}</time>
            </div>
          </div>
        </section>

        <div v-if="!autoScrollMessages" class="chat-to-bottom-slot">
          <button
            class="chat-to-bottom"
            type="button"
            v-tooltip.top.instant="'回到底部'"
            aria-label="回到底部"
            @click="scrollToBottom(true)"
          >
            <ChevronDown :size="16" />
          </button>
        </div>

        <aside
          v-if="tasks.length"
          ref="taskStrip"
          class="task-strip"
          aria-label="任务"
        >
          <button
            class="task-strip-header"
            type="button"
            :aria-expanded="!tasksCollapsed"
            @click="tasksCollapsed = !tasksCollapsed"
          >
            <ListTodo :size="16" class="task-strip-icon" />
            <strong>任务</strong>
            <span class="task-strip-progress">{{ taskProgressLabel }}</span>
            <ChevronUp
              v-if="tasksCollapsed"
              :size="16"
              class="task-strip-chevron"
            />
            <ChevronDown v-else :size="16" class="task-strip-chevron" />
          </button>
          <div v-if="!tasksCollapsed" class="task-list">
            <div
              v-for="task in tasks"
              :key="task.content"
              class="task-line"
              :class="task.status"
              v-tooltip="{ label: task.content, side: 'bottom', maxWidth: 360 }"
            >
              <span class="task-status-glyph" aria-hidden="true"
                ><Check v-if="task.status === 'completed'" :size="12" /><span
                  v-else
                ></span
              ></span>
              <span class="task-content">{{ task.content }}</span>
            </div>
          </div>
        </aside>

        <footer ref="composerSeat" class="composer-wrap">
          <div v-if="showWorkspacePicker" class="new-conversation-workspace">
            <WorkspacePicker
              :workspaces="workspaces"
              :active-workspace="activeWorkspace"
              @select="bindWorkspace"
              @create="openCreate"
              @import="importWorkspace"
            />
          </div>
          <QueueDock
            :messages="displayedPendingMessages"
            :running="busy && !compacting"
            @edit="editQueuedMessage"
            @remove="deletePendingMessage"
            @steer="promotePendingMessage"
          />
          <div
            class="composer"
            :class="{ 'is-image-dragging': composerDraggingImage }"
            @dragover.prevent="composerDraggingImage = true"
            @dragleave="composerDraggingImage = false"
            @drop="handleComposerDrop"
          >
            <ImageGallery
              :attachments="inputAttachments"
              removable
              @remove="removeComposerImage"
            />
            <textarea
              ref="composerInput"
              v-model="input"
              rows="1"
              :placeholder="
                selectedModelOption
                  ? activeWorkspace
                    ? '描述需求，或继续处理这个工作区…'
                    : '问任何问题，或描述你想完成的任务…'
                  : '请先在 ZTools 设置中添加 AI 模型…'
              "
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
              @keydown="handleComposerKeydown"
              @paste="handleComposerPaste"
            />
            <input
              ref="attachmentInput"
              class="composer-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              @change="handleImageSelection"
            />
            <div class="composer-footer">
              <div class="tool-menu-wrap composer-leading">
                <button
                  class="composer-tool-button"
                  type="button"
                  v-tooltip.top="'添加图片'"
                  @click="openImagePicker"
                >
                  <ImagePlus :size="16" />图片
                </button>
                <button
                  class="composer-tool-button capability-button"
                  type="button"
                  @click="toggleCapabilities"
                >
                  <Wrench :size="16" />{{
                    enabledTools.length + enabledSkills.length
                  }}
                  项能力<ChevronDown :size="14" />
                </button>
                <button
                  class="composer-context-button"
                  type="button"
                  :disabled="busy || compacting"
                  v-tooltip="{
                    label: contextState.lastCompactedAt
                      ? `压缩上下文 · 上次 ${formatMessageTime(contextState.lastCompactedAt)}`
                      : '压缩上下文',
                    side: 'top',
                  }"
                  aria-label="压缩上下文"
                  @click="compactContextNow"
                >
                  <Archive :size="15" />
                </button>
              </div>
              <div class="composer-trailing">
                <ModelReasoningPicker
                  :model-options="modelOptions"
                  :model-value="selectedModel"
                  :reasoning-options="selectedReasoningEffortOptions"
                  :reasoning-value="selectedReasoningEffort"
                  @update:model-value="selectedModel = $event"
                  @update:reasoning-value="selectedReasoningEffort = $event"
                />
                <ContextMeter
                  :used-tokens="contextMeter.usedTokens"
                  :context-window="contextMeter.contextWindow"
                  :breakdown="contextMeter.breakdown"
                />
                <div
                  v-if="activeSessionRunning && composerHasContent"
                  class="submission-mode-wrap"
                  @pointerdown.stop
                >
                  <button
                    class="send-mode-toggle"
                    type="button"
                    v-tooltip.top="'选择发送方式'"
                    aria-label="选择发送方式"
                    :aria-expanded="submissionModeOpen"
                    @click="submissionModeOpen = !submissionModeOpen"
                  >
                    <ChevronUp :size="14" />
                  </button>
                  <div v-if="submissionModeOpen" class="submission-mode-menu">
                    <button
                      type="button"
                      :class="{
                        active:
                          effectiveBusySubmissionMode === QUEUED_PLACEMENT,
                      }"
                      @click="selectBusySubmissionMode(QUEUED_PLACEMENT)"
                    >
                      <ListTodo :size="15" /><span
                        ><strong>排队发送</strong
                        ><small>当前 Turn 完成后执行</small></span
                      ><Check
                        v-if="effectiveBusySubmissionMode === QUEUED_PLACEMENT"
                        :size="14"
                      />
                    </button>
                    <button
                      type="button"
                      :class="{
                        active:
                          effectiveBusySubmissionMode === STEERING_PLACEMENT,
                      }"
                      :disabled="compacting"
                      @click="selectBusySubmissionMode(STEERING_PLACEMENT)"
                    >
                      <Send :size="15" /><span
                        ><strong>插话发送</strong
                        ><small>{{
                          compacting
                            ? "压缩期间不可插话"
                            : "在下一个安全步骤注入"
                        }}</small></span
                      ><Check
                        v-if="
                          effectiveBusySubmissionMode === STEERING_PLACEMENT
                        "
                        :size="14"
                      />
                    </button>
                  </div>
                </div>
                <button
                  class="send-button"
                  :class="{ stop: primaryActionStopsSession }"
                  type="button"
                  v-tooltip="{ label: primaryComposerActionLabel, side: 'top' }"
                  :aria-label="primaryComposerActionLabel"
                  :disabled="!primaryActionStopsSession && !canSend"
                  @click="
                    primaryActionStopsSession ? stopGeneration() : sendMessage()
                  "
                >
                  <Square
                    v-if="primaryActionStopsSession"
                    :size="15"
                    fill="currentColor"
                  />
                  <Send v-else :size="17" />
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>

      <div v-else class="no-project-state">
        <MessageSquarePlus :size="36" />
        <h1>开始一个新的 AI 会话</h1>
        <p>在左侧创建会话，然后选择模型并开始提问。</p>
        <div>
          <button
            class="button-primary"
            type="button"
            @click="newConversation()"
          >
            <MessageSquarePlus :size="16" />新建会话
          </button>
        </div>
      </div>
    </main>

    <Teleport to="body">
      <div
        v-if="settingsOpen"
        class="modal-backdrop"
        @mousedown.self="settingsOpen = false"
      >
        <section
          class="modal small-modal"
          role="dialog"
          aria-modal="true"
          aria-label="ZVC 设置"
        >
          <header class="modal-header">
            <div><h2>ZVC 设置</h2></div>
            <button
              class="icon-button"
              type="button"
              v-tooltip.bottom="'关闭'"
              aria-label="关闭"
              @click="settingsOpen = false"
            >
              <X :size="19" />
            </button>
          </header>
          <div class="modal-body settings-body">
            <label class="settings-row">
              <span><strong>SSE 事件合并间隔</strong></span>
              <select
                :value="streamBatchIntervalMs"
                aria-label="SSE 事件合并间隔"
                @change="setStreamBatchIntervalMs($event.target.value)"
              >
                <option
                  v-for="interval in STREAM_BATCH_INTERVAL_OPTIONS"
                  :key="interval"
                  :value="interval"
                >
                  {{ interval ? `${interval} 毫秒` : "即时" }}
                </option>
              </select>
            </label>
            <label class="settings-row">
              <span
                ><strong>自动压缩上下文触发阈值</strong
                ><small>达到上下文窗口比例后自动压缩</small></span
              >
              <select
                :value="autoCompactionThresholdPercent"
                aria-label="自动压缩上下文触发阈值"
                @change="setAutoCompactionThresholdPercent($event.target.value)"
              >
                <option
                  v-for="percent in AUTO_COMPACTION_THRESHOLD_OPTIONS"
                  :key="percent"
                  :value="percent"
                >
                  {{ percent }}%
                </option>
              </select>
            </label>
            <label class="settings-row">
              <span
                ><strong>工具最大并发数</strong
                ><small
                  >只读工具可并行执行，有副作用工具仍按顺序执行</small
                ></span
              >
              <select
                :value="toolConcurrencyLimit"
                aria-label="工具最大并发数"
                @change="setToolConcurrencyLimit($event.target.value)"
              >
                <option
                  v-for="limit in TOOL_CONCURRENCY_LIMIT_OPTIONS"
                  :key="limit"
                  :value="limit"
                >
                  {{ limit }} 个
                </option>
              </select>
            </label>
          </div>
        </section>
      </div>

      <div
        v-if="capabilitiesOpen"
        class="capability-popover-layer"
        @mousedown.self="capabilitiesOpen = false"
      >
        <section class="capability-popover" role="dialog" aria-label="会话能力">
          <div class="capability-popover-header">
            <div><strong>会话能力</strong><small>当前会话独立保存</small></div>
            <button
              class="icon-button"
              type="button"
              v-tooltip.bottom="'关闭能力面板'"
              aria-label="关闭能力面板"
              @click="capabilitiesOpen = false"
            >
              <X :size="17" />
            </button>
          </div>
          <div class="capability-popover-body">
            <label class="plugin-development-toggle"
              ><input
                type="checkbox"
                :checked="pluginDevelopmentEnabled"
                @change="togglePluginDevelopment($event.target.checked)"
              /><span class="checkbox-mark"><Check :size="14" /></span
              ><Wrench :size="18" /><span class="plugin-development-copy"
                ><strong>开启插件开发能力</strong
                ><small>自动启用开发 Skill、本地工具和 Web 工具</small></span
              ></label
            >
            <div class="capability-section skill-section">
              <div class="capability-section-title">
                <strong>Skills</strong
                ><small
                  >{{ enabledSkills.length }}/{{
                    selectableSkills.length
                  }}</small
                >
              </div>
              <div v-if="!selectableSkills.length" class="skills-empty">
                用户 Skill 目录为空
              </div>
              <label
                v-for="skill in selectableSkills"
                :key="skill.id"
                class="capability-row"
                ><input
                  type="checkbox"
                  :checked="skillIsEnabled(skill)"
                  @change="toggleSkill(skill.id, $event.target.checked)"
                /><span class="checkbox-mark"><Check :size="13" /></span
                ><span class="capability-copy"
                  ><strong>{{ skill.name }}</strong
                  ><small
                    v-tooltip="{
                      label: skill.description,
                      side: 'bottom',
                      maxWidth: 360,
                      overflowOnly: true,
                    }"
                    >{{ skill.description }}</small
                  ></span
                ></label
              >
            </div>
            <div class="capability-section tools-section-heading">
              <div class="capability-section-title">
                <strong>Tools</strong
                ><small>{{ enabledTools.length }}/{{ ALL_TOOLS.length }}</small>
              </div>
            </div>
            <div
              v-for="group in capabilityGroups"
              :key="group.id"
              class="capability-section tool-group-section"
            >
              <div class="tool-group-header">
                <button
                  class="tool-group-check"
                  type="button"
                  role="checkbox"
                  :aria-checked="
                    group.enabled > 0 && group.enabled < group.tools.length
                      ? 'mixed'
                      : group.enabled === group.tools.length
                  "
                  v-tooltip.bottom="`启用全部 ${group.label}`"
                  :aria-label="`启用全部 ${group.label}`"
                  @click="
                    toggleGroup(group, group.enabled !== group.tools.length)
                  "
                >
                  <span
                    class="checkbox-mark"
                    :class="{
                      checked: group.enabled === group.tools.length,
                      mixed:
                        group.enabled > 0 && group.enabled < group.tools.length,
                    }"
                    ><Check :size="13"
                  /></span>
                </button>
                <component
                  :is="capabilityIcon(group.id)"
                  :size="20"
                  class="tool-group-icon"
                />
                <button
                  class="tool-group-title"
                  type="button"
                  @click="toggleCapabilityGroup(group.id)"
                >
                  <span
                    ><strong>{{ group.label }}</strong
                    ><small
                      v-tooltip="{
                        label: group.description,
                        side: 'bottom',
                        maxWidth: 360,
                        overflowOnly: true,
                      }"
                      >{{ group.description }}</small
                    ></span
                  ><em>({{ group.enabled }}/{{ group.tools.length }})</em>
                </button>
                <button
                  class="icon-button group-collapse"
                  type="button"
                  v-tooltip.bottom="
                    collapsedCapabilityGroups[group.id] ? '展开' : '收起'
                  "
                  :aria-label="
                    collapsedCapabilityGroups[group.id] ? '展开' : '收起'
                  "
                  @click="toggleCapabilityGroup(group.id)"
                >
                  <ChevronDown
                    v-if="collapsedCapabilityGroups[group.id]"
                    :size="17"
                  /><ChevronUp v-else :size="17" />
                </button>
              </div>
              <div
                v-if="!collapsedCapabilityGroups[group.id]"
                class="tool-group-tools"
              >
                <label
                  v-for="tool in group.tools"
                  :key="tool.function.name"
                  class="tool-capability-row"
                  ><input
                    type="checkbox"
                    :checked="enabledToolNames.includes(tool.function.name)"
                    @change="
                      toggleTool(tool.function.name, $event.target.checked)
                    "
                  /><span class="tool-switch"><span></span></span
                  ><span class="capability-copy"
                    ><strong>{{ formatToolName(tool.function.name) }}</strong
                    ><small
                      v-tooltip="{
                        label: tool.function.description,
                        side: 'bottom',
                        maxWidth: 360,
                        overflowOnly: true,
                      }"
                      >{{ tool.function.description }}</small
                    ></span
                  ></label
                >
              </div>
            </div>
            <label class="auto-approve-toggle capability-approval"
              ><input
                type="checkbox"
                :checked="autoApproveTools"
                @change="setAutoApproveTools($event.target.checked)"
              /><span>自动批准工具调用</span></label
            >
          </div>
        </section>
      </div>
    </Teleport>

    <div
      v-if="createOpen"
      class="modal-backdrop"
      @mousedown.self="createOpen = false"
    >
      <section
        class="modal small-modal"
        role="dialog"
        aria-modal="true"
        aria-label="创建新工作区"
      >
        <header class="modal-header">
          <div>
            <h2>创建新工作区</h2>
            <p>目录将创建在当前插件数据目录的 workspace/ 子目录下。</p>
          </div>
          <button
            class="icon-button"
            type="button"
            v-tooltip.bottom="'关闭'"
            aria-label="关闭"
            @click="createOpen = false"
          >
            <X :size="19" />
          </button>
        </header>
        <div class="modal-body">
          <label
            >工作区名称<input
              id="workspace-name"
              v-model="workspaceName"
              placeholder="例如：网站重构"
              @keydown.enter="createWorkspace"
          /></label>
        </div>
        <footer class="modal-footer">
          <button
            class="button-secondary"
            type="button"
            @click="createOpen = false"
          >
            取消</button
          ><button
            class="button-primary"
            type="button"
            :disabled="!workspaceName.trim()"
            @click="createWorkspace"
          >
            创建工作区
          </button>
        </footer>
      </section>
  </div>

  <div
    v-if="ztoolsVersionCheckPending || isZToolsVersionUnsupported"
    class="ztools-version-gate"
    role="alert"
    aria-live="assertive"
  >
    <section class="ztools-version-gate-card">
      <h1 v-if="ztoolsVersionCheckPending">正在检查 ZTools 版本</h1>
      <template v-else>
        <h1>ZTools 版本不受支持</h1>
        <p>
          当前版本：{{ ztoolsVersion || "未知" }}<br />
          请升级 ZTools 至 {{ MIN_ZTOOLS_VERSION }} 或更高版本后再使用。
        </p>
      </template>
    </section>
  </div>

    <Teleport to="body">
      <div
        v-if="conversationMenu"
        class="conversation-menu-layer"
        @mousedown.self="closeConversationMenu"
      >
        <div
          class="conversation-menu"
          role="menu"
          :style="{
            left: `${conversationMenu.left}px`,
            top: `${conversationMenu.top}px`,
          }"
          @mousedown.stop
        >
          <button
            type="button"
            role="menuitem"
            @click="handleConversationMenuAction('rename')"
          >
            <Pencil :size="18" /><span>重命名</span>
          </button>
          <button
            type="button"
            role="menuitem"
            @click="handleConversationMenuAction('fork')"
          >
            <GitFork :size="18" /><span>分叉会话</span>
          </button>
          <button
            type="button"
            role="menuitem"
            @click="handleConversationMenuAction('archive')"
          >
            <Archive :size="18" /><span>归档会话</span>
          </button>
        </div>
      </div>

      <div
        v-if="conversationRenameTarget"
        class="modal-backdrop"
        @mousedown.self="closeConversationRename"
      >
        <section
          class="modal small-modal"
          role="dialog"
          aria-modal="true"
          aria-label="重命名会话"
        >
          <header class="modal-header">
            <div>
              <h2>重命名会话</h2>
              <p>为这个会话设置一个便于识别的名称。</p>
            </div>
            <button
              class="icon-button"
              type="button"
              v-tooltip.bottom="'关闭'"
              aria-label="关闭"
              @click="closeConversationRename"
            >
              <X :size="19" />
            </button>
          </header>
          <div class="modal-body">
            <label
              >会话名称<input
                id="conversation-rename-input"
                v-model="conversationRenameDraft"
                maxlength="100"
                :disabled="conversationRenaming"
                @compositionstart="renameIsComposing = true"
                @compositionend="renameIsComposing = false"
                @keydown="handleConversationRenameKeydown"
            /></label>
            <p
              v-if="conversationRenameError"
              class="conversation-rename-error"
              role="alert"
            >
              {{ conversationRenameError }}
            </p>
          </div>
          <footer class="modal-footer">
            <button
              class="button-secondary"
              type="button"
              :disabled="conversationRenaming"
              @click="closeConversationRename"
            >
              取消</button
            ><button
              class="button-primary"
              type="button"
              :disabled="
                conversationRenaming || !conversationRenameDraft.trim()
              "
              @click="renameConversation"
            >
              重命名
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>
