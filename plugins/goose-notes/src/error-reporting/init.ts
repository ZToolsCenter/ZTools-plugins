import {
  captureException,
  createTransport,
  init,
} from "@sentry/browser";
import {
  GOOSE_NOTE_PROJECT,
  resolveErrorReportingConfig,
  shouldReportErrors,
} from "./config";

const FLUSH_MS = 2000;

type EnvelopeResult = { statusCode: number };

type QueuedRequest = {
  url: string;
  body: string | Uint8Array;
  resolve: (value: EnvelopeResult) => void;
  reject: (error: unknown) => void;
};

let queue: QueuedRequest[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function readRuntimeConfig() {
  try {
    const raw = window.gooseErrorReporting?.readConfig?.();
    return resolveErrorReportingConfig(raw, GOOSE_NOTE_PROJECT);
  } catch {
    return resolveErrorReportingConfig(null, GOOSE_NOTE_PROJECT);
  }
}

async function postEnvelope(url: string, body: string | Uint8Array) {
  const send = window.gooseErrorReporting?.sendEnvelope;
  if (typeof send === "function") {
    const result = await send(url, body);
    return { statusCode: result?.statusCode ?? 0 };
  }
  // file:// 的 fetch 是 null origin，会被 CORS 挡；没有 preload 就放弃。
  if (typeof location !== "undefined" && location.protocol === "file:") {
    throw new Error("file:// cannot POST Sentry envelope without preload");
  }
  const payload =
    typeof body === "string"
      ? body
      : new Blob([new Uint8Array(body)]);
  const response = await fetch(url, {
    method: "POST",
    body: payload,
    keepalive: true,
    credentials: "omit",
  });
  return { statusCode: response.status };
}

async function flushQueue() {
  const batch = queue;
  queue = [];
  for (const item of batch) {
    try {
      const result = await postEnvelope(item.url, item.body);
      item.resolve({ statusCode: result.statusCode || 200 });
    } catch (error) {
      item.reject(error);
    }
  }
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_MS);
}

function makeQueuedTransport(
  options: Parameters<typeof createTransport>[0] & { url: string },
) {
  return createTransport(options, (request) => {
    return new Promise<EnvelopeResult>((resolve, reject) => {
      queue.push({
        url: options.url,
        body: request.body,
        resolve,
        reject,
      });
      scheduleFlush();
    });
  });
}

export function reportGooseNoteError(
  error: unknown,
  extra?: Record<string, unknown>,
) {
  if (!started) return;
  try {
    captureException(error, extra ? { extra } : undefined);
  } catch {
    // 上报失败不能再炸业务
  }
}

export function initGooseNoteErrorReporting() {
  if (started || typeof window === "undefined") return;
  const config = readRuntimeConfig();
  if (!shouldReportErrors(config) || !config.dsn) return;

  try {
    init({
      dsn: config.dsn,
      environment: config.environment,
      initialScope: {
        tags: { project: GOOSE_NOTE_PROJECT },
      },
      transport: makeQueuedTransport,
    });
    window.__gooseNoteReportError = reportGooseNoteError;
    started = true;
  } catch (error) {
    console.warn("[error-reporting] Sentry.init failed", error);
  }
}
