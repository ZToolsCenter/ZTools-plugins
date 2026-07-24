<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";

const props = defineProps<{
  source: string;
}>();

const canvasRef = useTemplateRef<HTMLCanvasElement>("canvas");
const pageShellRef = useTemplateRef<HTMLElement>("pageShell");
const pageNumber = ref(1);
const pageCount = ref(0);
const errorMessage = ref("");
const isLoading = ref(false);

type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
};

type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  cleanup(): Promise<unknown>;
};

type PdfPage = {
  cleanup(): boolean;
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    transform?: number[] | null;
  }): PdfRenderTask;
};

type PdfRenderTask = {
  promise: Promise<void>;
  cancel(): void;
};

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(source: { data: Uint8Array; wasmUrl?: string }): PdfLoadingTask;
};

let pdfDocument: PdfDocument | null = null;
let loadingTask: PdfLoadingTask | null = null;
let renderTask: PdfRenderTask | null = null;
let lastPageSize = { width: 0, height: 0 };
let lastPageShellWidth = 0;
let renderToken = 0;
let resizeObserver: ResizeObserver | null = null;
let resizeFrame: number | undefined;
let pdfjsPromise: Promise<PdfJs> | undefined;

function debugPdf(...args: unknown[]) {
  console.info("[local-search-neo:pdf]", ...args);
}

watch(
  () => props.source,
  () => {
    void loadPdf();
  },
  { immediate: true },
);

onMounted(() => {
  const pageShell = pageShellRef.value;
  if (!pageShell || typeof ResizeObserver === "undefined") return;

  lastPageShellWidth = pageShell.clientWidth;
  resizeObserver = new ResizeObserver(scheduleResizeRender);
  resizeObserver.observe(pageShell);
});

onUnmounted(() => {
  renderToken += 1;
  if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
  resizeObserver?.disconnect();
  disposePdf();
});

async function loadPdf() {
  const token = ++renderToken;
  debugPdf("load start", { token, source: props.source });
  isLoading.value = true;
  errorMessage.value = "";
  pageNumber.value = 1;
  pageCount.value = 0;
  prepareBlankPage();
  disposePdf({ keepCanvas: true });

  try {
    const pdfjs = await loadPdfjs();
    debugPdf("pdfjs loaded", { token });
    const data = window.services.readBinaryFile(props.source);
    debugPdf("pdf data loaded", { token, bytes: data.byteLength });
    const task = pdfjs.getDocument({
      data,
      wasmUrl: getPdfjsWasmUrl(),
    });
    loadingTask = task;
    debugPdf("loading task created", { token });

    const document = await task.promise;
    debugPdf("document loaded", { pages: document.numPages, source: props.source });
    if (token !== renderToken) {
      await safeDestroyLoadingTask(task);
      return;
    }

    pdfDocument = document;
    pageCount.value = document.numPages;
    await renderPage(token);
  } catch (error) {
    debugPdf("load failed", { token, error });
    if (token !== renderToken) return;
    errorMessage.value = error instanceof Error ? error.message : "PDF 加载失败";
  } finally {
    if (token === renderToken) isLoading.value = false;
  }
}

function getPdfjsWasmUrl() {
  return new URL("pdfjs/wasm/", window.location.href).href;
}

async function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    debugPdf("create pdfjs promise");
    pdfjsPromise = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      const pdf = pdfjs as unknown as PdfJs;
      pdf.GlobalWorkerOptions.workerSrc = worker.default;
      debugPdf("worker configured", { workerSrc: worker.default });
      return pdf;
    });
  }

  return pdfjsPromise;
}

async function renderPage(token = ++renderToken, options: { keepCurrentCanvas?: boolean } = {}) {
  debugPdf("render start", { token, page: pageNumber.value });
  await nextTick();
  const document = pdfDocument;
  const canvas = canvasRef.value;
  const pageShell = pageShellRef.value;
  if (!document || !canvas || !pageShell) {
    debugPdf("render skipped", {
      hasDocument: !!document,
      hasCanvas: !!canvas,
      hasPageShell: !!pageShell,
    });
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";
  cancelRenderTask();
  lastPageShellWidth = pageShell.clientWidth;

  try {
    const page = await document.getPage(pageNumber.value);
    debugPdf("page loaded", { token, page: pageNumber.value });
    if (token !== renderToken) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(240, pageShell.clientWidth - 24);
    const scale = Math.min(2, Math.max(0.4, availableWidth / baseViewport.width));
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const renderCanvas = options.keepCurrentCanvas
      ? window.document.createElement("canvas")
      : canvas;
    const context = renderCanvas.getContext("2d");
    if (!context) throw new Error("无法创建 PDF 渲染上下文");

    setupCanvasPage(renderCanvas, viewport.width, viewport.height, outputScale);
    if (!options.keepCurrentCanvas) {
      fillCanvasWhite(renderCanvas, viewport.width, viewport.height, outputScale);
    }
    lastPageSize = { width: viewport.width, height: viewport.height };

    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    debugPdf("render page", {
      page: pageNumber.value,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      canvasWidth: renderCanvas.width,
      canvasHeight: renderCanvas.height,
      outputScale,
      offscreen: options.keepCurrentCanvas,
    });
    const task = page.render({
      canvasContext: context,
      transform,
      viewport,
    });
    renderTask = task;
    await task.promise;
    debugPdf("render resolved", { token, page: pageNumber.value });
    if (token !== renderToken) return;

    if (options.keepCurrentCanvas) {
      copyCanvas(renderCanvas, canvas, viewport.width, viewport.height);
    }

    renderTask = null;
    errorMessage.value = "";
  } catch (error) {
    debugPdf("render failed", { token, error });
    if (token !== renderToken) return;
    renderTask = null;
    errorMessage.value = error instanceof Error ? error.message : "PDF 渲染失败";
  } finally {
    if (token === renderToken) isLoading.value = false;
  }
}

function scheduleResizeRender() {
  if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);

  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = undefined;
    renderAfterResize();
  });
}

function renderAfterResize() {
  const pageShell = pageShellRef.value;
  if (!pdfDocument || !pageShell) return;

  const width = pageShell.clientWidth;
  if (Math.abs(width - lastPageShellWidth) < 2) return;

  lastPageShellWidth = width;
  void renderPage(undefined, { keepCurrentCanvas: true });
}

function goPreviousPage() {
  if (pageNumber.value <= 1) return;
  pageNumber.value -= 1;
  void renderPage(undefined, { keepCurrentCanvas: true });
}

function goNextPage() {
  if (pageNumber.value >= pageCount.value) return;
  pageNumber.value += 1;
  void renderPage(undefined, { keepCurrentCanvas: true });
}

function disposePdf(options: { keepCanvas?: boolean } = {}) {
  cancelRenderTask();
  void pdfDocument?.cleanup();
  pdfDocument = null;
  if (loadingTask) {
    void safeDestroyLoadingTask(loadingTask);
    loadingTask = null;
  }
  if (!options.keepCanvas) clearCanvas();
}

async function safeDestroyLoadingTask(task: PdfLoadingTask) {
  try {
    await task.destroy();
  } catch {
    // PDF.js may reject destroy() when the task has already settled or been cancelled.
  }
}

function cancelRenderTask() {
  if (!renderTask) return;

  try {
    renderTask.cancel();
  } catch {
    // Ignore cancellation races between rapid page/document switches.
  }

  renderTask = null;
}

function prepareBlankPage() {
  const canvas = canvasRef.value;
  const pageShell = pageShellRef.value;
  if (!canvas) return;

  const fallbackWidth = pageShell ? Math.max(240, pageShell.clientWidth - 24) : 420;
  const width = lastPageSize.width || fallbackWidth;
  const height = lastPageSize.height || width * 1.414;
  setBlankCanvas(canvas, width, height);
}

function setBlankCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const outputScale = window.devicePixelRatio || 1;
  setupCanvasPage(canvas, width, height, outputScale);
  fillCanvasWhite(canvas, width, height, outputScale);
}

function setupCanvasPage(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  outputScale: number,
) {
  canvas.width = Math.floor(width * outputScale);
  canvas.height = Math.floor(height * outputScale);
  canvas.style.width = `${Math.floor(width)}px`;
  canvas.style.height = `${Math.floor(height)}px`;
}

function fillCanvasWhite(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  outputScale: number,
) {
  const context = canvas.getContext("2d");
  if (!context) return;

  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function copyCanvas(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  width: number,
  height: number,
) {
  setupCanvasPage(target, width, height, 1);
  const context = target.getContext("2d");
  if (!context) return;

  target.width = source.width;
  target.height = source.height;
  target.style.width = source.style.width;
  target.style.height = source.style.height;
  context.drawImage(source, 0, 0);
}

function clearCanvas() {
  const canvas = canvasRef.value;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  canvas.removeAttribute("width");
  canvas.removeAttribute("height");
  canvas.style.width = "";
  canvas.style.height = "";
}
</script>

<template>
  <div class="pdf-preview">
    <div class="pdf-toolbar">
      <button
        type="button"
        class="pdf-page-button"
        :disabled="pageNumber <= 1 || isLoading"
        title="上一页"
        aria-label="上一页"
        @click="goPreviousPage"
      >
        <span class="pdf-page-icon previous" aria-hidden="true"></span>
      </button>
      <span class="pdf-page-count">{{ pageNumber }} / {{ pageCount || "-" }}</span>
      <button
        type="button"
        class="pdf-page-button"
        :disabled="pageNumber >= pageCount || isLoading"
        title="下一页"
        aria-label="下一页"
        @click="goNextPage"
      >
        <span class="pdf-page-icon next" aria-hidden="true"></span>
      </button>
    </div>

    <div ref="pageShell" class="pdf-page-shell">
      <canvas ref="canvas" class="pdf-canvas"></canvas>
      <div v-if="errorMessage" class="pdf-status">{{ errorMessage }}</div>
    </div>
  </div>
</template>

<style scoped>
.pdf-preview {
  display: grid;
  grid-template-rows: 30px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: #0f1012;
}

.pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-bottom: 1px solid #282a2d;
  color: #c3c8cf;
  font-size: 12px;
}

.pdf-page-button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 22px;
  padding: 0;
  color: #e5e7eb;
  background: #34373b;
  border: 1px solid #555b63;
  border-radius: 4px;
  cursor: pointer;
}

.pdf-page-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pdf-page-button:focus,
.pdf-page-button:focus-visible {
  outline: none;
  box-shadow: none;
}

.pdf-page-icon {
  width: 7px;
  height: 7px;
  border-top: 1.5px solid currentColor;
  border-left: 1.5px solid currentColor;
}

.pdf-page-icon.previous {
  transform: translateX(2px) rotate(-45deg);
}

.pdf-page-icon.next {
  transform: translateX(-2px) rotate(135deg);
}

.pdf-page-count {
  min-width: 54px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pdf-page-shell {
  position: relative;
  overflow: auto;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  text-align: center;
}

.pdf-canvas {
  display: inline-block;
  background: #ffffff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
}

.pdf-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #a6abb2;
  pointer-events: none;
}

@media (prefers-color-scheme: light) {
  .pdf-preview {
    background: #f8fafc;
  }

  .pdf-toolbar {
    color: #4f5b6a;
    border-bottom-color: #d9dee7;
  }

  .pdf-page-button {
    color: #1f2937;
    background: #ffffff;
    border-color: #c8d0da;
  }

  .pdf-canvas {
    box-shadow: 0 8px 24px rgb(15 23 42 / 16%);
  }

  .pdf-status {
    color: #697386;
  }
}
</style>
