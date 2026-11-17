import { preflightEnglishAgreementInput } from "./englishAgreementEngine";
import InlineEnglishAgreementWorker from "./englishAgreementWorker?worker&inline";
import type { EnglishAgreementAnalysis, EnglishAgreementAnalyzer, EnglishAgreementInput } from "./englishAgreementTypes";
import type {
  EnglishAgreementWorkerPort,
  EnglishAgreementWorkerRequest,
  EnglishAgreementWorkerResponse
} from "./englishAgreementWorkerProtocol";

const DEFAULT_TIMEOUT_MS = 8_000;

export class EnglishAgreementAbortError extends Error {
  constructor(message = "English agreement analysis was cancelled.") {
    super(message);
    this.name = "EnglishAgreementAbortError";
  }
}

export class EnglishAgreementTimeoutError extends Error {
  constructor() {
    super("English agreement analysis timed out.");
    this.name = "EnglishAgreementTimeoutError";
  }
}

export interface EnglishAgreementAnalyzeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EnglishAgreementServiceOptions {
  /** Browser worker factory; called lazily and never used by the SSR fallback. */
  workerFactory?: () => EnglishAgreementWorkerPort;
  /** Must remain a dynamic import so the main editor bundle does not load Wink. */
  loadAnalyzer?: () => Promise<{ analyzeEnglishAgreementWithWink: EnglishAgreementAnalyzer }>;
  isServer?: () => boolean;
  defaultTimeoutMs?: number;
}

export interface EnglishAgreementService {
  analyze(input: EnglishAgreementInput, options?: EnglishAgreementAnalyzeOptions): Promise<EnglishAgreementAnalysis>;
  dispose(): void;
}

interface PendingRequest {
  id: number;
  input: EnglishAgreementInput;
  resolve(value: EnglishAgreementAnalysis): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
  settled: boolean;
}

function messageError(response: Extract<EnglishAgreementWorkerResponse, { type: "failure" }>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function isAnalysis(value: unknown): value is EnglishAgreementAnalysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EnglishAgreementAnalysis>;
  return candidate.scope === "simple-present-subject-verb-agreement"
    && ["suggestions", "no-supported-edit", "abstained"].includes(candidate.disposition ?? "")
    && typeof candidate.reason === "string"
    && typeof candidate.outputText === "string"
    && Array.isArray(candidate.edits);
}

/**
 * Creates a lazy advisory analyzer. `no-supported-edit` means only that the
 * bounded SVA rule found no edit; it never proves whole-text correctness or
 * authorizes skipping the model, fact checks, AST checks, or user diff review.
 */
export function createEnglishAgreementService(options: EnglishAgreementServiceOptions = {}): EnglishAgreementService {
  const workerFactory = options.workerFactory ?? (() => new InlineEnglishAgreementWorker() as unknown as EnglishAgreementWorkerPort);
  const loadAnalyzer = options.loadAnalyzer ?? (() => import.meta.env.SSR
    ? import("./englishAgreementWink")
    : Promise.reject(new Error("Main-thread English agreement fallback is available only during SSR/Node rendering.")));
  // `window` is absent in WorkerGlobalScope too. Use Vite's compile-time SSR
  // flag so a nested classic worker follows the Worker path, not the SSR fallback.
  const isServer = options.isServer ?? (() => import.meta.env.SSR);
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  let analyzerPromise: ReturnType<typeof loadAnalyzer> | undefined;
  let worker: EnglishAgreementWorkerPort | undefined;
  let active: PendingRequest | undefined;
  let nextId = 1;
  let disposed = false;
  const queue: PendingRequest[] = [];
  const serverRequests = new Set<PendingRequest>();

  const clearPending = (request: PendingRequest): void => {
    if (request.timer) clearTimeout(request.timer);
    request.timer = undefined;
    if (request.signal && request.abortListener) {
      request.signal.removeEventListener("abort", request.abortListener);
    }
    request.abortListener = undefined;
  };

  const finish = (request: PendingRequest, result: EnglishAgreementAnalysis): void => {
    if (request.settled) return;
    request.settled = true;
    clearPending(request);
    serverRequests.delete(request);
    if (active === request) active = undefined;
    request.resolve(result);
  };

  const fail = (request: PendingRequest, error: Error): void => {
    if (request.settled) return;
    request.settled = true;
    clearPending(request);
    serverRequests.delete(request);
    const queuedIndex = queue.indexOf(request);
    if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
    if (active === request) active = undefined;
    request.reject(error);
  };

  const terminateWorker = (): void => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = undefined;
  };

  const pump = (): void => {
    if (disposed || active || queue.length === 0) return;
    const request = queue.shift()!;
    if (request.settled) {
      pump();
      return;
    }
    active = request;
    try {
      worker ??= workerFactory();
      const currentWorker = worker;
      currentWorker.onmessage = (event) => {
        const response = event.data;
        if (!response || response.id !== request.id) return;
        if (response.type === "failure") {
          fail(request, messageError(response));
        } else if (response.type === "result" && isAnalysis(response.analysis)) {
          finish(request, response.analysis);
        } else {
          fail(request, new Error("English agreement Worker returned an invalid response."));
        }
        pump();
      };
      currentWorker.onerror = () => {
        terminateWorker();
        fail(request, new Error("English agreement Worker failed."));
        pump();
      };
      currentWorker.onmessageerror = () => {
        terminateWorker();
        fail(request, new Error("English agreement Worker returned an unreadable message."));
        pump();
      };
      const message: EnglishAgreementWorkerRequest = { type: "analyze", id: request.id, input: request.input };
      currentWorker.postMessage(message);
    } catch (error) {
      terminateWorker();
      fail(request, error instanceof Error ? error : new Error("Could not start English agreement Worker."));
      pump();
    }
  };

  const runOnServer = (request: PendingRequest): void => {
    serverRequests.add(request);
    analyzerPromise ??= loadAnalyzer();
    void analyzerPromise.then(({ analyzeEnglishAgreementWithWink }) => {
      if (request.settled || disposed) return;
      finish(request, analyzeEnglishAgreementWithWink(request.input));
    }).catch((error: unknown) => {
      if (request.settled) return;
      fail(request, error instanceof Error ? error : new Error("English agreement analyzer failed to load."));
    });
  };

  const cancel = (request: PendingRequest, error: Error): void => {
    if (request.settled) return;
    const wasActive = active === request;
    fail(request, error);
    if (wasActive) terminateWorker();
    pump();
  };

  const analyze = (input: EnglishAgreementInput, analyzeOptions: EnglishAgreementAnalyzeOptions = {}) => {
    if (disposed) return Promise.reject(new EnglishAgreementAbortError("English agreement service has been disposed."));
    if (analyzeOptions.signal?.aborted) return Promise.reject(new EnglishAgreementAbortError());
    const preflight = preflightEnglishAgreementInput(input);
    if (preflight) return Promise.resolve(preflight);

    return new Promise<EnglishAgreementAnalysis>((resolve, reject) => {
      const request: PendingRequest = {
        id: nextId++, input, resolve, reject, signal: analyzeOptions.signal, settled: false
      };
      const timeoutMs = analyzeOptions.timeoutMs ?? defaultTimeoutMs;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        request.timer = setTimeout(() => cancel(request, new EnglishAgreementTimeoutError()), timeoutMs);
      }
      if (request.signal) {
        request.abortListener = () => cancel(request, new EnglishAgreementAbortError());
        request.signal.addEventListener("abort", request.abortListener, { once: true });
      }

      if (isServer()) runOnServer(request);
      else {
        queue.push(request);
        pump();
      }
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    terminateWorker();
    if (active) fail(active, new EnglishAgreementAbortError("English agreement service was disposed."));
    for (const request of [...queue, ...serverRequests]) {
      fail(request, new EnglishAgreementAbortError("English agreement service was disposed."));
    }
    queue.length = 0;
  };

  return { analyze, dispose };
}

const defaultService = createEnglishAgreementService();

/** Runs the optional advisory analysis; callers must retain the normal model and validation path. */
export function analyzeEnglishAgreement(
  input: EnglishAgreementInput,
  options?: EnglishAgreementAnalyzeOptions
): Promise<EnglishAgreementAnalysis> {
  return defaultService.analyze(input, options);
}
