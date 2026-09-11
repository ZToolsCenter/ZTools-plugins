<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch, nextTick } from "vue";
import { ZButton, ZTag, useToast, useColorScheme } from "ztools-ui";
import katex from "katex";
import "katex/dist/katex.min.css";
import EngineStatusCard from "../components/EngineStatusCard.vue";
import OcrImageViewer from "../components/OcrImageViewer.vue";
import { useNativeEngine } from "../composables/useNativeEngine";
import { useLatexEngine } from "../composables/useLatexEngine";
import { useSegmentIndicator } from "../composables/useSegmentIndicator";

/**
 * 识别子页（合并文字 OCR 与公式识别）：左右结构。
 *
 * 左侧：图片舞台（拖拽/粘贴/选图）。
 *   - 文字模式：复用 OcrImageViewer（canvas 绘图 + 透明文字层 + 全屏预览），
 *     通过 hideResult 隐藏其内置列表，改由右侧统一渲染。
 *   - 公式模式：普通 <img> 预览。
 * 右侧：结果面板。
 *   - 顶部：模式切换（文字 / 公式）+ 引擎状态标签 + 操作按钮。
 *   - 文字：识别行列表，与左侧图上文字双向高亮联动，点击复制。
 *   - 公式：KaTeX 渲染预览 + LaTeX 源码 + 三种复制形式。
 *
 * 切换模式时保留同一张图片与各自的识别结果（互不干扰），可对同一图片
 * 分别进行文字识别与公式识别。切换到某模式时自动触发一次识别；若该模式已
 * 有缓存结果则直接展示，不重复识别。引擎未就绪期间选图，模型下载完成后
 * 自动补识别当前模式。
 */

const props = withDefaults(
  defineProps<{
    /** 进入时预填的待识别图片（data URI 或本地 path）。 */
    initialImage?: string;
    /** 初始模式（由父组件根据入口 action.code 决定）。 */
    initialMode?: "text" | "formula";
    /**
     * 进入即自动截屏（screen-ocr / screen-latex feature）。
     * 为 true 时，组件挂载后引擎就绪即自动调系统截图；引擎未就绪则等下载完成后
     * 由 watcher 触发。截图结果留在本页展示，不再弹独立窗口。
     */
    autoCapture?: boolean;
    /**
     * 文字识别成功后自动上抛 translate 事件，由父组件切到「翻译」tab 预填并翻译
     * （screen-ocr-translate / ocr-translate feature）。
     * 门控 translateFired 确保同一张图只联动一次；换新图（resetResults）后重置，
     * 允许再次联动。OCR 空结果 / 失败不上抛。
     */
    translateAfterOcr?: boolean;
  }>(),
  { initialImage: "", initialMode: "text", autoCapture: false, translateAfterOcr: false },
);

// 响应式暗色标记：宿主切换主题时同步，用于避免 :global(html.dark) 在 scoped 下不生效。
const { isDark } = useColorScheme();

/**
 * 模式变化时上报父组件：公式模式下底部悬浮导航栏会移到左下角，
 * 避免遮挡右下角的三个复制按钮（见 SettingLayout 的 dockAlign）。
 * immediate：组件每次按 :key 重建时同步当前模式，保证 dock 位置正确。
 *
 * 识别成功后上抛 history 事件：由 Manage 统一写入历史记录单例（dbStorage），
 * 不在子组件内直接依赖 dbStorage。
 */
const emit = defineEmits<{
  (e: "mode-change", mode: "text" | "formula"): void;
  (e: "history", item: HistoryEmitItem): void;
  (e: "translate", text: string): void;
  /**
   * 文字识别成功后上抛当前识别文本（供父组件在用户手动切到翻译 tab 时带入）。
   * 与 translate 事件不同：translate 仅 translateAfterOcr 联动场景触发且只一次，
   * text-result 在每次文字识别成功（含重识别、切渠道重识别）后都同步最新结果。
   * 空结果不上抛。
   */
  (e: "text-result", text: string): void;
}>();

const { success, error } = useToast();
const { nativeReady, checkNative } = useNativeEngine();
const { latexReady, checkLatex } = useLatexEngine();

// ─── 渠道选择（文字：微信 OCR / AI 识图；公式：本地引擎 / AI 公式识别）─────
// 模式按钮右侧内嵌 sparkle 图标作为 AI 渠道开关：高亮=已启用 AI，点击在
// AI / 非 AI 渠道间切换；未配置 AI 模型时置灰不可点。dbStorage 持久化上次渠道。
// AI 渠道走宿主 ztools.ai 视觉模型，不依赖本机引擎（engineReady 视为就绪）；
// 返回整段文本无坐标，文字渠道下图片叠层隐藏（viewerLines 传空，见下）。
type TextProviderName = "ocr" | "ai-ocr";
type FormulaProviderName = "latex" | "ai-latex-ocr";

const textProviderLabels: Record<TextProviderName, string> = {
  ocr: "微信 OCR",
  "ai-ocr": "AI 识图",
};
const formulaProviderLabels: Record<FormulaProviderName, string> = {
  latex: "本地引擎",
  "ai-latex-ocr": "AI 公式识别",
};

// AI 渠道配置状态（是否已选模型）；微信 OCR / 本地引擎恒可用。
const providerConfigured = ref<Record<"ai-ocr" | "ai-latex-ocr", boolean>>({
  "ai-ocr": false,
  "ai-latex-ocr": false,
});
function refreshProviderStatus() {
  try {
    const ao = window.services.getOcrSettings("ai-ocr");
    const alo = window.services.getOcrSettings("ai-latex-ocr");
    providerConfigured.value = {
      "ai-ocr": !!ao.model,
      "ai-latex-ocr": !!alo.model,
    };
  } catch (_) {
    /* preload 异常：保持默认，不阻塞 */
  }
}

// 上次使用的渠道持久化（dbStorage）：切渠道后留存，下次进入自动复用；
// 失效（AI 渠道未配模型）时回落默认（微信 OCR / 本地引擎）。
const LAST_TEXT_PROVIDER_KEY = "ocr.textProvider";
const LAST_FORMULA_PROVIDER_KEY = "ocr.formulaProvider";
function loadLastTextProvider(): TextProviderName | null {
  try {
    const v = window.ztools.dbStorage.getItem<string>(LAST_TEXT_PROVIDER_KEY);
    if (v && v in textProviderLabels) {
      const p = v as TextProviderName;
      if (p === "ocr" || providerConfigured.value["ai-ocr"]) return p;
    }
  } catch (_) {
    /* dbStorage 不可用：回落默认 */
  }
  return null;
}
function loadLastFormulaProvider(): FormulaProviderName | null {
  try {
    const v = window.ztools.dbStorage.getItem<string>(LAST_FORMULA_PROVIDER_KEY);
    if (v && v in formulaProviderLabels) {
      const p = v as FormulaProviderName;
      if (p === "latex" || providerConfigured.value["ai-latex-ocr"]) return p;
    }
  } catch (_) {
    /* dbStorage 不可用：回落默认 */
  }
  return null;
}
function saveLastTextProvider(p: TextProviderName): void {
  try {
    window.ztools.dbStorage.setItem(LAST_TEXT_PROVIDER_KEY, p);
  } catch (_) {
    /* 写入失败忽略 */
  }
}
function saveLastFormulaProvider(p: FormulaProviderName): void {
  try {
    window.ztools.dbStorage.setItem(LAST_FORMULA_PROVIDER_KEY, p);
  } catch (_) {
    /* 写入失败忽略 */
  }
}

/**
 * 切换文字模式 AI 识图开关：未配置 AI 模型时提示并保持原渠道；
 * 已配置则在 微信 OCR ↔ AI 识图 间切换，watch(textProvider) 会触发重识别。
 */
function toggleTextAi(): void {
  if (!providerConfigured.value["ai-ocr"]) {
    error("请先在设置中配置 AI 识图模型");
    return;
  }
  textProvider.value = textProvider.value === "ai-ocr" ? "ocr" : "ai-ocr";
}

/**
 * 切换公式模式 AI 公式识别开关：未配置 AI 模型时提示并保持原渠道；
 * 已配置则在 本地引擎 ↔ AI 公式识别 间切换，watch(formulaProvider) 会触发重识别。
 */
function toggleFormulaAi(): void {
  if (!providerConfigured.value["ai-latex-ocr"]) {
    error("请先在设置中配置 AI 公式识别模型");
    return;
  }
  formulaProvider.value =
    formulaProvider.value === "ai-latex-ocr" ? "latex" : "ai-latex-ocr";
}

// setup 期初始化渠道：先刷新配置状态，再回填上次渠道；失效回落默认。
// 在 setup 期完成，确保挂载时渠道已是最终值，避免 initialImage 首次识别用错渠道。
refreshProviderStatus();
const textProvider = ref<TextProviderName>(loadLastTextProvider() || "ocr");
const formulaProvider = ref<FormulaProviderName>(
  loadLastFormulaProvider() || "latex",
);

// ─── 模式 ────────────────────────────────────────────────────────────
const mode = ref<"text" | "formula">(props.initialMode);

function switchMode(next: "text" | "formula") {
  if (mode.value === next) return;
  mode.value = next;
  // 切换后自动识别当前模式：若该模式已有缓存结果则直接展示（命中缓存不重识别），
  // 否则触发一次识别；引擎未就绪时静默跳过，由引擎引导卡引导下载，
  // 就绪后由 nativeReady/latexReady watcher 补识别。
  autoRecognize();
}

// 引擎就绪态按模式 + 渠道映射：AI 渠道不依赖本机引擎，视为就绪。
const engineReady = computed(() => {
  if (mode.value === "text")
    return textProvider.value === "ai-ocr" ? true : nativeReady.value;
  return formulaProvider.value === "ai-latex-ocr" ? true : latexReady.value;
});

// 模式切换条滑动高亮：文字=0、公式=1
const modeIndex = computed(() => (mode.value === "text" ? 0 : 1));
const {
  containerRef: modeSwitchRef,
  setItemRef: setModeItemRef,
  pos: modeIndicator,
  noAnim: modeNoAnim,
} = useSegmentIndicator(modeIndex);

// ─── 图片与识别状态 ──────────────────────────────────────────────────
// imageSrc 用于预览（data URI / URL）；recognizeSrc 才是真正传给识别服务的源。
const imageSrc = ref("");
const recognizeSrc = ref("");
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// 文字 OCR 结果
const ocrLoading = ref(false);
const ocrError = ref("");
const ocrLines = ref<OcrLine[]>([]);
const ocrDone = ref(false); // 标记是否已识别过（区分空结果与未识别）
// AI 文字渠道返回整段文本无坐标，叠层隐藏：传给 OcrImageViewer 的 lines 在
// AI 渠道下置空，只显示原图；微信 OCR 渠道保留坐标高亮联动。
const viewerLines = computed(() =>
  textProvider.value === "ai-ocr" ? [] : ocrLines.value,
);

/**
 * AI 识图结果编辑/展示模式。
 * AI 渠道返回整段文本无坐标也无真实置信度（伪 OcrLine rate 恒为 1），
 * 故右侧改用可编辑的整段文本呈现，并支持两种模式按需切换：
 * - aiEditMode：false=展示（行列表，无置信度，单击复制该行）；
 *               true=编辑（textarea 双向绑定 aiText，复制全部以编辑后为准）。
 * - aiText：可编辑的整段识别文本，识别成功时回填。
 * - aiDisplayLines：展示模式按行拆分（去掉末尾多余换行避免出现空行）。
 * 切渠道 / 换图时随 resetTextResult 一并重置。
 */
const aiEditMode = ref(false);
const aiText = ref("");
const aiDisplayLines = computed(() => {
  const t = aiText.value;
  if (!t) return [];
  // 去掉末尾连续换行后再拆行，避免列表尾部出现可点击的空行。
  return t.replace(/(\r?\n)+$/, "").split(/\r?\n/);
});

/**
 * 识别并翻译联动门控：translateAfterOcr 下首次文字识别成功才上抛一次 translate，
 * 切回本 tab 对同一图重识别不二次跳翻译；换新图经 resetResults 重置后可再次联动。
 */
const translateFired = ref(false);

// 公式识别结果
const latexLoading = ref(false);
const latexError = ref("");
const latex = ref("");
const latexDone = ref(false);

const loading = computed(() =>
  mode.value === "text" ? ocrLoading.value : latexLoading.value,
);
const errorText = computed(() =>
  mode.value === "text" ? ocrError.value : latexError.value,
);

// 文字模式：列表↔图上高亮联动的当前悬停索引（-1 表示无）
const hoveredIndex = ref(-1);
function onViewerHover(i: number) {
  hoveredIndex.value = i;
}

// 把 File 读成 data URL
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function pickImage() {
  fileInput.value?.click();
}

async function setImageFromFile(file: File) {
  if (!file.type.startsWith("image/")) {
    error("请选择图片文件");
    return;
  }
  const dataUrl = await readFileAsDataURL(file);
  setImage(dataUrl);
  autoRecognize();
}

/**
 * 设置新图片：清空两种模式的结果与 done 标记。
 * data URI / http(s) URL 直接展示；本地 path 经 preload 转 data URI 后展示。
 */
function setImage(src: string) {
  recognizeSrc.value = src;
  if (/^data:/i.test(src) || /^https?:\/\//i.test(src)) {
    imageSrc.value = src;
  } else {
    try {
      imageSrc.value = window.services.readFileAsDataURL(src);
    } catch {
      imageSrc.value = "";
    }
  }
  resetResults();
}

/**
 * 设置图片 / 切换模式后自动识别当前模式。
 * - 引擎未就绪时静默跳过（由引擎引导卡引导下载，就绪后由 watcher 补识别）。
 * - 当前模式若已识别过（*Done 为 true）则复用缓存结果，避免对同一张图片重复识别。
 */
function autoRecognize() {
  if (!recognizeSrc.value || !engineReady.value) return;
  if (mode.value === "text" && ocrDone.value) return;
  if (mode.value === "formula" && latexDone.value) return;
  nextTick(() => recognize());
}

/** 截图识别：调系统截图，截完设为图片并自动识别当前模式。 */
function captureScreen() {
  window.ztools.screenCapture((imgBase64: string) => {
    if (!imgBase64) return; // 用户取消截屏：留在本页，可手动操作
    const dataUri = imgBase64.startsWith("data:")
      ? imgBase64
      : "data:image/png;base64," + imgBase64;
    setImage(dataUri);
    autoRecognize();
  });
}

/**
 * 自动截图流程（screen-ocr / screen-latex 入口）专用标志与触发器。
 * autoCaptureDone：标记本次进入的自动截图已触发过，防止引擎就绪态抖动
 *   （ready→checking→ready）反复弹出截图框；用户取消截图后也不再自动重弹，
 *   可手动点「截图识别」按钮重试。
 */
const autoCaptureDone = ref(false);

/**
 * 进入即自动截图：仅当 autoCapture 开启、尚未触发、当前模式引擎已就绪时调一次截图。
 * 引擎未就绪时跳过，由 nativeReady/latexReady watcher 在下载完成后补触发。
 */
function maybeAutoCapture() {
  if (!props.autoCapture || autoCaptureDone.value) return;
  if (!engineReady.value) return;
  autoCaptureDone.value = true;
  captureScreen();
}

/** 清空文字模式结果（切渠道 / 换图时调用）。 */
function resetTextResult() {
  ocrLines.value = [];
  ocrError.value = "";
  ocrDone.value = false;
  translateFired.value = false;
  aiEditMode.value = false;
  aiText.value = "";
}
/** 清空公式模式结果（切渠道 / 换图时调用）。 */
function resetFormulaResult() {
  latex.value = "";
  latexError.value = "";
  latexDone.value = false;
}
/** 清空两种模式的结果与 done 标记（换新图时调用）。 */
function resetResults() {
  resetTextResult();
  resetFormulaResult();
}

async function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  await setImageFromFile(file);
  target.value = "";
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) setImageFromFile(file);
}
function onDragOver() {
  dragOver.value = true;
}
function onDragLeave() {
  dragOver.value = false;
}

async function onPaste(e: ClipboardEvent) {
  const item = Array.from(e.clipboardData?.items || []).find((i) =>
    i.type.startsWith("image/"),
  );
  const file = item?.getAsFile();
  if (file) await setImageFromFile(file);
}

// ─── 识别执行 ────────────────────────────────────────────────────────
/**
 * 文字识别成功后的统一处理：填 ocrLines、提示、上抛历史与联动翻译。
 * 微信 OCR 渠道传入带坐标的真实 lines；AI 渠道传入按文本拆出的伪 lines（无坐标）。
 */
function applyOcrLines(lines: OcrLine[]) {
  ocrLines.value = lines;
  if (lines.length === 0) {
    error("未识别到文字");
    // 空结果不上抛 text-result，避免清空翻译框
    return;
  }
  success(`识别完成，共 ${lines.length} 行`);
  // 同步当前识别文本给父组件：供用户手动切到翻译 tab 时带入翻译输入框。
  // AI 渠道以 aiText 为准（可被用户编辑），微信 OCR 渠道拼装各行文本。
  const text =
    textProvider.value === "ai-ocr"
      ? aiText.value
      : lines.map((l) => l.text).join("\n");
  emit("text-result", text);
  // 上抛历史记录：只有真正调识别服务成功才留一笔（命中缓存不会进此分支）
  emit("history", {
    kind: "ocr-text",
    thumbnail: imageSrc.value,
    title: lines[0]?.text ? lines[0].text.slice(0, 40) : "（未识别到文字）",
    payload: {
      kind: "ocr-text",
      imageSrc: imageSrc.value,
      lines: lines.map((l) => ({ ...l })),
    },
  });
  // 识别并翻译联动：translateAfterOcr 下首次成功才上抛一次（门控 translateFired），
  // 父组件切到「翻译」tab 预填识别文字并触发翻译。换新图重置门控后可再次联动。
  if (props.translateAfterOcr && !translateFired.value) {
    translateFired.value = true;
    emit("translate", text);
  }
}

async function recognizeText() {
  if (!recognizeSrc.value) return;
  // AI 渠道不依赖本机引擎；微信 OCR 渠道需引擎就绪。
  if (textProvider.value === "ocr" && !nativeReady.value) return;
  // 并发保护：onMounted 的 checkNative 会让 ready 态瞬时抖动（ready→checking→ready），
  // 从而二次触发引擎就绪 watcher；此处避免对同一图片并发识别。
  if (ocrLoading.value) return;
  ocrLoading.value = true;
  ocrError.value = "";
  ocrLines.value = [];
  try {
    if (textProvider.value === "ai-ocr") {
      // AI 识图：返回整段文本，按行拆成伪 OcrLine（无坐标），复用列表/复制/联动逻辑。
      // 同时回填 aiText 供右侧编辑/展示模式使用（rate 恒为 1 不展示置信度）。
      const out = await window.services.ocrAi(recognizeSrc.value);
      const text = (out && out.text) || "";
      aiText.value = text;
      applyOcrLines(
        text
          ? text.split(/\r?\n/).map((t) => ({
              text: t,
              rate: 1,
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              boxPoints: [] as OcrLine["boxPoints"],
            }))
          : [],
      );
    } else {
      const result = await window.services.ocrImageDetail(recognizeSrc.value);
      if (result.ok) applyOcrLines(result.lines ?? []);
      else {
        ocrError.value = result.error || "识别失败";
        error(ocrError.value);
      }
    }
  } catch (err: any) {
    ocrError.value = err?.message ? String(err.message) : String(err);
    error(ocrError.value);
  } finally {
    ocrDone.value = true;
    ocrLoading.value = false;
  }
}

/**
 * 公式识别成功后的统一处理：填 latex、提示、上抛历史记录。
 * 本地引擎与 AI 渠道结果同为 LaTeX 源码，处理一致。
 */
function applyLatexResult(ltx: string) {
  latex.value = ltx;
  if (!ltx) {
    error("未识别到公式");
    return;
  }
  success("公式识别完成");
  // 上抛历史记录：只有真正调识别服务成功才留一笔（命中缓存不会进此分支）
  emit("history", {
    kind: "ocr-formula",
    thumbnail: imageSrc.value,
    title: ltx.slice(0, 40),
    payload: {
      kind: "ocr-formula",
      imageSrc: imageSrc.value,
      latex: ltx,
    },
  });
}

async function recognizeFormula() {
  if (!recognizeSrc.value) return;
  // AI 渠道不依赖本机引擎；本地引擎需就绪。
  if (formulaProvider.value === "latex" && !latexReady.value) return;
  // 并发保护：与 recognizeText 同理，防止引擎就绪态抖动引发的重复识别。
  if (latexLoading.value) return;
  latexLoading.value = true;
  latexError.value = "";
  latex.value = "";
  try {
    if (formulaProvider.value === "ai-latex-ocr") {
      const out = await window.services.latexAi(recognizeSrc.value);
      applyLatexResult(out.latex || "");
    } else {
      const result = await window.services.latexRecognizeDetail(
        recognizeSrc.value,
      );
      if (result.ok) applyLatexResult(result.latex || "");
      else {
        latexError.value = result.error || "识别失败";
        error(latexError.value);
      }
    }
  } catch (err: any) {
    latexError.value = err?.message ? String(err.message) : String(err);
    error(latexError.value);
  } finally {
    latexDone.value = true;
    latexLoading.value = false;
  }
}

/** 统一的「识别」入口：按当前模式派发；已识别过则重新识别（覆盖结果）。 */
async function recognize() {
  if (mode.value === "text") await recognizeText();
  else await recognizeFormula();
}

// ─── 复制 ────────────────────────────────────────────────────────────
function copyLine(text: string) {
  window.ztools.copyText(text);
  success("已复制该行");
}

function copyAllText() {
  // AI 渠道复制编辑后的整段文本；微信 OCR 渠道拼装各行文本。
  const text =
    textProvider.value === "ai-ocr"
      ? aiText.value
      : ocrLines.value.map((l) => l.text).join("\n");
  if (!text) return;
  window.ztools.copyText(text);
  success("已复制全部文字");
}

function copyLatex(kind: "raw" | "inline" | "display") {
  if (!latex.value) return;
  let text = latex.value;
  if (kind === "inline") text = "$" + latex.value + "$";
  else if (kind === "display") text = "$$" + latex.value + "$$";
  window.ztools.copyText(text);
  success(
    kind === "raw"
      ? "已复制 LaTeX 源码"
      : kind === "inline"
        ? "已复制 $…$ 形式"
        : "已复制 $$…$$ 形式",
  );
}

// ─── KaTeX 渲染 ─────────────────────────────────────────────────────
// 用 computed + v-html：切换模式导致预览 div 重新挂载时，Vue 会自动按当前
// 缓存的 latex 重新写入 innerHTML，无需依赖 latex 值变化触发 watcher
// （切走再切回时 latex 不变，watch 不会触发，纯手动 innerHTML 会留下空 div）。
const latexHtml = computed(() => {
  const val = latex.value;
  if (!val) return "";
  try {
    return katex.renderToString(val, {
      displayMode: true,
      throwOnError: false,
      output: "html",
    });
  } catch (e: any) {
    return (
      '<span class="katex-error">渲染失败：' +
      (e?.message || String(e)) +
      "</span>"
    );
  }
});

// ─── 外部 initialImage 自动识别 ──────────────────────────────────────
// 引擎未就绪时仅载入图片（不识别），就绪后由下方 watcher 按当前模式补识别。
async function applyInitial(image: string, targetMode: "text" | "formula") {
  if (!image) return;
  mode.value = targetMode;
  setImage(image);
  autoRecognize();
}

// 模式变化上报父组件：immediate 保证每次重建即同步初始模式。
watch(
  mode,
  (m) => emit("mode-change", m),
  { immediate: true },
);

watch(
  () => props.initialImage,
  (image) => {
    if (image) applyInitial(image, props.initialMode);
  },
  { immediate: true },
);

// 文字引擎就绪后补识别：覆盖「下载期间选图」与「切到文字模式时引擎仍在下载」两种场景。
// 另覆盖 autoCapture（screen-ocr 入口）：引擎未就绪时截图被搁置，就绪后自动补截图。
// AI 渠道不依赖本机引擎（engineReady 恒就绪），由 setup 期 autoRecognize 直接触发；
// 此 watcher 跳过 AI 渠道，避免引擎下载完成时对 AI 渠道误触发重识别。
watch(nativeReady, (ready) => {
  if (!ready || mode.value !== "text" || textProvider.value === "ai-ocr")
    return;
  if (recognizeSrc.value && !ocrDone.value) {
    nextTick(() => recognizeText());
  } else if (props.autoCapture && !autoCaptureDone.value) {
    maybeAutoCapture();
  }
});

// 公式引擎就绪后补识别：与文字引擎对称，含 autoCapture（screen-latex 入口）补截图。
// AI 渠道同理跳过。
watch(latexReady, (ready) => {
  if (
    !ready ||
    mode.value !== "formula" ||
    formulaProvider.value === "ai-latex-ocr"
  )
    return;
  if (recognizeSrc.value && !latexDone.value) {
    nextTick(() => recognizeFormula());
  } else if (props.autoCapture && !autoCaptureDone.value) {
    maybeAutoCapture();
  }
});

// 切换渠道：持久化上次渠道，并立即按当前图片重识别当前模式
// （参考 Translate 切 provider 不 debounce 立即 run）。
// 已有图片但引擎未就绪时跳过，就绪后由上方 watcher 补识别。
watch(textProvider, () => {
  saveLastTextProvider(textProvider.value);
  if (recognizeSrc.value && engineReady.value) {
    resetTextResult();
    nextTick(() => recognizeText());
  }
});
watch(formulaProvider, () => {
  saveLastFormulaProvider(formulaProvider.value);
  if (recognizeSrc.value && engineReady.value) {
    resetFormulaResult();
    nextTick(() => recognizeFormula());
  }
});

onMounted(() => {
  window.addEventListener("paste", onPaste);
  checkNative();
  checkLatex();
  // 截图识别 feature（screen-ocr / screen-latex）进入即自动截屏：
  // 引擎已就绪则立即截图，否则由上方 nativeReady/latexReady watcher 在就绪后触发。
  maybeAutoCapture();
});

// keep-alive 缓存后切 tab 触发 onActivated/onDeactivated（而非重新挂载）：
//   - activated：重绑 paste 监听（deactivated 时已移除）、重新 check 引擎状态
//     （长时间切走后 ready 可能已过期），不再重复触发自动截图（autoCaptureDone
//     在缓存实例中保留为 true，未触发过的由引擎就绪 watcher 补截图）。
//   - deactivated：暂停 paste 监听，避免非可见时仍响应剪贴板。
onActivated(() => {
  window.addEventListener("paste", onPaste);
  checkNative();
  checkLatex();
  // 重读 AI 渠道配置状态（用户可能在设置页改了模型），与 Translate onMounted 一致。
  refreshProviderStatus();
});

onDeactivated(() => {
  window.removeEventListener("paste", onPaste);
});

onUnmounted(() => {
  window.removeEventListener("paste", onPaste);
  window.services.ocrDispose();
  window.services.latexDispose();
});
</script>

<template>
  <div class="recognize">
    <!-- 主体：左右结构 -->
    <div
      class="stage"
      :class="{ 'drag-over': dragOver }"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- 左：图片预览 + 底部操作按钮 -->
      <div class="pane pane-image">
        <div class="image-canvas">
          <OcrImageViewer
            v-if="mode === 'text'"
            :image-src="imageSrc"
            :lines="viewerLines"
            :loading="ocrLoading"
            :hide-result="true"
            empty-text="选择图片或截图识别，也可拖入 / 粘贴图片"
            @copy="copyLine"
            @hover="onViewerHover"
          />
          <template v-else>
            <img
              v-if="imageSrc"
              :src="imageSrc"
              alt="公式图片"
              class="formula-img"
            />
            <div v-else class="empty">
              <div class="empty-icon">🖼️</div>
              <div class="empty-text">
                选择图片或截图识别，也可拖入 / 粘贴图片
              </div>
            </div>
            <div v-if="latexLoading" class="loading-overlay">识别中…</div>
          </template>
        </div>

        <!-- 底部操作：选择图片（左）· 截图识别（右） -->
        <div class="image-actions">
          <ZButton size="small" type="text" @click="pickImage">
            <template #icon>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
              >
                <!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE -->
                <path
                  fill="currentColor"
                  d="M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm0-2h14V5H5zm0 0V5zm2-2h10q.3 0 .45-.275t-.05-.525l-2.75-3.675q-.15-.2-.4-.2t-.4.2L11.25 16L9.4 13.525q-.15-.2-.4-.2t-.4.2l-2 2.675q-.2.25-.05.525T7 17m2.563-7.438Q10 9.125 10 8.5t-.437-1.062T8.5 7t-1.062.438T7 8.5t.438 1.063T8.5 10t1.063-.437"
                />
              </svg>
            </template>
            选择图片
          </ZButton>
          <ZButton size="small" type="text" @click="captureScreen">
            <template #icon>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
              >
                <!-- Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE -->
                <path
                  fill="currentColor"
                  d="M7 17V1H5v4H1v2h4v10a2 2 0 0 0 2 2h10v4h2v-4h4v-2m-6-2h2V7a2 2 0 0 0-2-2H9v2h8z"
                />
              </svg>
            </template>
            截图识别
          </ZButton>
        </div>
      </div>

      <!-- 右：结果面板 -->
      <div class="pane pane-result">
        <!-- 模式切换：独占一行撑满 -->
        <div
          class="mode-switch"
          :class="{ dark: isDark }"
          role="tablist"
          aria-label="识别模式"
          ref="modeSwitchRef"
        >
          <!-- 滑动高亮指示条：吸附到当前模式按钮 -->
          <span
            class="mode-indicator"
            :class="{ 'no-anim': modeNoAnim }"
            :style="{
              transform: `translateX(${modeIndicator.x}px)`,
              width: modeIndicator.w ? `${modeIndicator.w}px` : '0px'
            }"
          ></span>
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: mode === 'text' }"
            :aria-selected="mode === 'text'"
            :ref="(el) => setModeItemRef(el, 0)"
            @click="switchMode('text')"
          >
            <span class="mode-label">文字</span>
            <!-- AI 渠道开关：图标高亮表示当前已启用 AI 识图；
                 未配置 AI 模型时禁用；点击切换 微信 OCR ↔ AI 识图。 -->
            <span
              class="ai-chip"
              :class="{
                active: textProvider === 'ai-ocr',
                disabled: !providerConfigured['ai-ocr'],
              }"
              :title="
                !providerConfigured['ai-ocr']
                  ? '未配置 AI 识图模型，请先在设置中配置'
                  : textProvider === 'ai-ocr'
                    ? '已启用 AI 识图，点击关闭改用微信 OCR'
                    : 'AI 识图就绪，点击启用'
              "
              @click.stop="toggleTextAi"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <!-- Icon from Material Symbols (auto_awesome / sparkle) - https://github.com/google/material-design-icons/blob/master/LICENSE -->
                <path
                  fill="currentColor"
                  d="m19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"
                />
              </svg>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: mode === 'formula' }"
            :aria-selected="mode === 'formula'"
            :ref="(el) => setModeItemRef(el, 1)"
            @click="switchMode('formula')"
          >
            <span class="mode-label">公式</span>
            <!-- AI 渠道开关：图标高亮表示当前已启用 AI 公式识别；
                 未配置 AI 模型时禁用；点击切换 本地引擎 ↔ AI 公式识别。 -->
            <span
              class="ai-chip"
              :class="{
                active: formulaProvider === 'ai-latex-ocr',
                disabled: !providerConfigured['ai-latex-ocr'],
              }"
              :title="
                !providerConfigured['ai-latex-ocr']
                  ? '未配置 AI 公式识别模型，请先在设置中配置'
                  : formulaProvider === 'ai-latex-ocr'
                    ? '已启用 AI 公式识别，点击关闭改用本地引擎'
                    : 'AI 公式识别就绪，点击启用'
              "
              @click.stop="toggleFormulaAi"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <!-- Icon from Material Symbols (auto_awesome / sparkle) - https://github.com/google/material-design-icons/blob/master/LICENSE -->
                <path
                  fill="currentColor"
                  d="m19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"
                />
              </svg>
            </span>
          </button>
        </div>

        <!-- 引擎未就绪引导（按当前模式） -->
        <div v-if="!engineReady" class="engine-guide">
          <EngineStatusCard
            :show-actions="false"
            style="width: 100%;height: 100%;justify-content: center;"
            :engine-kind="mode === 'text' ? 'wechat' : 'latex'"
            @downloaded="mode === 'text' ? checkNative() : checkLatex()"
          />
        </div>

        <!-- 结果区 -->
        <template v-else>
          <!-- 文字模式结果 -->
          <div v-if="mode === 'text'" class="result-body">
            <div v-if="ocrLoading" class="result-empty">识别中…</div>
            <div v-else-if="ocrError" class="result-empty error">
              {{ ocrError }}
            </div>
            <div
              v-else-if="ocrDone && ocrLines.length === 0"
              class="result-empty"
            >
              未识别到文字
            </div>
            <div v-else-if="!ocrDone" class="result-empty placeholder">
              选择图片或截图后自动识别，结果将在此显示
            </div>
            <template v-else>
              <!-- 微信 OCR：带置信度的行列表，与图上文字双向高亮联动 -->
              <template v-if="textProvider !== 'ai-ocr'">
                <div class="result-head">
                  <span class="result-title"
                    >识别明细（{{ ocrLines.length }} 行）</span
                  >
                  <ZButton size="small" @click="copyAllText">复制全部</ZButton>
                </div>
                <div class="line-list">
                  <div
                    v-for="(line, i) in ocrLines"
                    :key="i"
                    class="result-line"
                    :class="{ active: hoveredIndex === i }"
                    @mouseenter="hoveredIndex = i"
                    @mouseleave="hoveredIndex = -1"
                    @click="copyLine(line.text)"
                  >
                    <span class="result-rate"
                      >{{ (line.rate * 100).toFixed(0) }}%</span
                    >
                    <span class="result-text">{{ line.text }}</span>
                  </div>
                </div>
              </template>
              <!-- AI 识图：不展示置信度，提供展示/编辑模式图标切换 -->
              <div v-else class="ai-result" :class="{ dark: isDark }">
                <div class="result-head">
                  <span class="result-title"
                    >识别结果（{{ aiDisplayLines.length }} 行）</span
                  >
                  <div class="result-head-actions">
                    <!-- 展示模式（eye）· 编辑模式（pencil）图标切换组 -->
                    <div
                      class="mode-toggle"
                      role="group"
                      aria-label="结果模式"
                    >
                      <button
                        type="button"
                        class="mode-toggle-btn"
                        :class="{ active: !aiEditMode }"
                        title="展示模式"
                        aria-label="展示模式"
                        @click="aiEditMode = false"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <!-- Icon from Material Symbols (visibility) - https://github.com/google/material-design-icons/blob/master/LICENSE -->
                          <path
                            fill="currentColor"
                            d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="mode-toggle-btn"
                        :class="{ active: aiEditMode }"
                        title="编辑模式"
                        aria-label="编辑模式"
                        @click="aiEditMode = true"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <!-- Icon from Material Symbols (edit) - https://github.com/google/material-design-icons/blob/master/LICENSE -->
                          <path
                            fill="currentColor"
                            d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                          />
                        </svg>
                      </button>
                    </div>
                    <ZButton size="small" @click="copyAllText"
                      >复制全部</ZButton
                    >
                  </div>
                </div>
                <!-- 展示模式：行列表（无置信度），单击复制该行 -->
                <div v-if="!aiEditMode" class="line-list">
                  <div
                    v-for="(line, i) in aiDisplayLines"
                    :key="i"
                    class="result-line"
                    @click="copyLine(line)"
                  >
                    <span class="result-text">{{ line }}</span>
                  </div>
                </div>
                <!-- 编辑模式：可编辑整段文本，复制全部以编辑后为准 -->
                <textarea
                  v-else
                  class="ai-text-edit"
                  v-model="aiText"
                  spellcheck="false"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  placeholder="可编辑识别结果，切换到展示模式查看行列表"
                ></textarea>
              </div>
            </template>
          </div>

          <!-- 公式模式结果 -->
          <div v-else class="result-body">
            <div v-if="latexLoading" class="result-empty">识别中…</div>
            <div v-else-if="latexError" class="result-empty error">
              {{ latexError }}
            </div>
            <div v-else-if="latexDone && !latex" class="result-empty">
              未识别到公式
            </div>
            <div v-else-if="!latexDone" class="result-empty placeholder">
              选择图片或截图后自动识别，结果将在此显示
            </div>
            <template v-else>
              <div class="formula-layout" :class="{ dark: isDark }">
                <!-- 上半：渲染预览（随下方源码实时渲染） -->
                <div class="result-section formula-half">
                  <div class="section-title">渲染预览</div>
                  <div class="katex-preview" v-html="latexHtml"></div>
                </div>
                <!-- 下半：LaTeX 源码，可编辑 -->
                <div class="result-section formula-half">
                  <div class="section-title">LaTeX 源码</div>
                  <textarea
                    class="latex-source"
                    v-model="latex"
                    spellcheck="false"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    placeholder="可编辑 LaTeX 源码，上方预览实时渲染"
                  ></textarea>
                </div>
              </div>
              <div class="copy-actions">
                <ZButton @click="copyLatex('raw')">复制源码</ZButton>
                <ZButton @click="copyLatex('inline')">复制 $…$</ZButton>
                <ZButton @click="copyLatex('display')">复制 $$…$$</ZButton>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="file-input"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.recognize {
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  height: 100%;
}

/* ── 主体左右结构 ── */
.stage {
  flex: 1;
  display: flex;
  gap: 14px;
  min-height: 0;
  padding: 14px;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.stage.drag-over {
  border-color: var(--primary-color, #1976d2);
  background: var(--hover-bg, rgba(25, 118, 210, 0.05));
}

/* 左：图片预览 + 底部操作 */
.pane-image {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 200px;
  position: relative;
}

.image-canvas {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
}

.formula-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 14px;
  border-radius: 8px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
}

.empty-icon {
  font-size: 40px;
  opacity: 0.6;
}

.empty-text {
  font-size: 13px;
  color: var(--text-secondary, #999);
  text-align: center;
}

/* 底部操作按钮：选择图片（左对齐）· 截图识别（右对齐） */
.image-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  position: absolute;
  top: 0;
  width: 100%;

  .zt-button {
    height: 34.8px;
    color: #666666;
  }
}

/* 右：结果面板 */
.pane-result {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
  background: var(--pane-bg, transparent);
  overflow: hidden;
}

/* 模式切换：独占一行撑满 */
.mode-switch {
  position: relative;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--sub-bar-bg, rgba(0, 0, 0, 0.05));
  border-radius: 9px;
}

/* 滑动高亮指示条：吸附到当前模式按钮，背景即原 active 底色 */
.mode-indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  border-radius: 7px;
  background: var(--sub-item-active-bg, #fff);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  pointer-events: none;
  z-index: 0;
  transition:
    transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.mode-indicator.no-anim {
  transition: none;
}

/* scoped 下 :global 失效，改用 .dark 类驱动暗色高亮（不刺眼） */
.mode-switch.dark .mode-indicator {
  background: var(--sub-item-active-bg, rgba(255, 255, 255, 0.08));
  box-shadow: none;
}

.mode-btn {
  flex: 1;
  /* 文字与右侧 AI 图标横向居中排列 */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  /* 置于指示条之上，使文字始终清晰 */
  position: relative;
  z-index: 1;
  transition: color 0.15s;
  white-space: nowrap;
}

/* 激活态：仅着色 + 加粗，背景由 .mode-indicator 滑动提供 */
.mode-btn.active {
  color: var(--primary-color, #1976d2);
  font-weight: 600;
}

/* AI 渠道开关：嵌在模式按钮文字右侧，sparkle 图标。
   - active：当前已启用 AI 渠道，主色 + 浅色底；
   - 默认态：灰色，hover 主色 + 浅底；
   - disabled：未配置 AI 模型，置灰不可点。 */
.ai-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  color: var(--text-secondary, #999);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    color 0.15s,
    background 0.15s;
}

.ai-chip:not(.active):not(.disabled):hover {
  color: var(--primary-color, #1976d2);
  background: var(--hover-bg, rgba(0, 0, 0, 0.08));
}

.ai-chip.active {
  color: var(--primary-color, #1976d2);
  background: color-mix(in srgb, var(--primary-color, #1976d2), transparent 85%);
}

.ai-chip.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色 hover 背景 */
.mode-switch.dark .ai-chip:not(.active):not(.disabled):hover {
  background: var(--hover-bg, rgba(255, 255, 255, 0.08));
}

/* 引擎引导 */
.engine-guide {
  flex: 1;
  overflow-y: auto;
}

/* 结果区 */
.result-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.result-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-secondary, #999);
  font-size: 14px;
  text-align: center;
}

.result-empty.error {
  color: #e53935;
}

.result-empty.placeholder {
  opacity: 0.7;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.result-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #666);
}

.line-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.result-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.result-line:hover,
.result-line.active {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}

.result-rate {
  color: var(--text-secondary, #999);
  font-size: 12px;
  min-width: 34px;
  flex-shrink: 0;
}

.result-text {
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}

/* AI 识图结果容器（展示/编辑模式） */
.ai-result {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.result-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 展示模式（eye，左）· 编辑模式（pencil，右）图标切换组 */
.mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--sub-bar-bg, rgba(0, 0, 0, 0.05));
  border-radius: 6px;
}

.mode-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #999);
  border-radius: 5px;
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s;
}

.mode-toggle-btn:hover {
  color: var(--primary-color, #1976d2);
}

.mode-toggle-btn.active {
  color: var(--primary-color, #1976d2);
  background: var(--sub-item-active-bg, #fff);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色切换组 */
.ai-result.dark .mode-toggle {
  background: var(--sub-bar-bg, rgba(255, 255, 255, 0.08));
}

.ai-result.dark .mode-toggle-btn.active {
  background: var(--sub-item-active-bg, rgba(255, 255, 255, 0.08));
  box-shadow: none;
}

/* AI 展示模式行列表：撑满并内部滚动 */
.ai-result .line-list {
  flex: 1;
  min-height: 0;
}

/* 编辑模式：整段可编辑文本 */
.ai-text-edit {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 12px;
  background: var(--code-bg, #f5f5f5);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e5e6eb);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  color: var(--text-color, #333);
  outline: none;
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色编辑框 */
.ai-result.dark .ai-text-edit {
  background: var(--code-bg, #2a2a2a);
  color: var(--text-color, #f3f4f6);
  border-color: var(--border-color, #374151);
}

/* 公式结果 */
.result-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 渲染预览与源码上下两半，各占一半高度撑满 */
.formula-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.formula-half {
  flex: 1 1 0;
  min-height: 0;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #666);
}

.katex-preview {
  flex: 1 1 0;
  min-height: 0;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e5e6eb);
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色渲染预览 */
.formula-layout.dark .katex-preview {
  background: #2a2a2a;
  border-color: var(--border-color, #374151);
  color: var(--text-color, #f3f4f6);
}

.katex-error {
  color: #e53935;
  font-size: 13px;
}

.latex-source {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 12px;
  background: var(--code-bg, #f5f5f5);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e5e6eb);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  color: var(--text-color, #333);
  outline: none;
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色 LaTeX 源码框 */
.formula-layout.dark .latex-source {
  background: var(--code-bg, #2a2a2a);
  color: var(--text-color, #f3f4f6);
  border-color: var(--border-color, #374151);
}

.copy-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.file-input {
  display: none;
}
</style>
