import { expect, it, vi } from "vitest";
import {
  createEnglishAgreementService,
  EnglishAgreementAbortError,
  EnglishAgreementTimeoutError
} from "../../src/core/ai/englishAgreementService";
import type { EnglishAgreementAnalysis, EnglishAgreementInput } from "../../src/core/ai/englishAgreementTypes";
import type { EnglishAgreementWorkerPort } from "../../src/core/ai/englishAgreementWorkerProtocol";

const input: EnglishAgreementInput = { text: "A lantern shine at night." };
const sample: EnglishAgreementAnalysis = {
  scope: "simple-present-subject-verb-agreement",
  disposition: "suggestions",
  reason: "Simple-present agreement suggestion.",
  outputText: "A lantern shines at night.",
  edits: [{ from: 10, to: 15, source: "shine", replacement: "shines", subject: "lantern", lemma: "shine" }]
};

function fakeWorker(respond = true, postedMessages: Parameters<EnglishAgreementWorkerPort["postMessage"]>[0][] = []): EnglishAgreementWorkerPort {
  const worker: EnglishAgreementWorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      postedMessages.push(message);
      if (!respond) return;
      queueMicrotask(() => worker.onmessage?.({
        data: { type: "result", id: message.id, analysis: sample }
      } as MessageEvent));
    },
    terminate: vi.fn()
  };
  return worker;
}

it("loads the browser worker lazily and returns its advisory result", async () => {
  const worker = fakeWorker();
  const workerFactory = vi.fn(() => worker);
  const loadAnalyzer = vi.fn(async () => ({ analyzeEnglishAgreementWithWink: () => sample }));
  const service = createEnglishAgreementService({ workerFactory, loadAnalyzer, isServer: () => false });

  const tooLong = await service.analyze({ text: "a".repeat(257) });
  expect(tooLong.disposition).toBe("abstained");
  expect(workerFactory).not.toHaveBeenCalled();
  const unsupportedLanguage = await service.analyze({ text: "这是中文句子。" });
  expect(unsupportedLanguage.disposition).toBe("abstained");
  expect(workerFactory).not.toHaveBeenCalled();

  const result = await service.analyze(input);

  expect(workerFactory).toHaveBeenCalledTimes(1);
  expect(loadAnalyzer).not.toHaveBeenCalled();
  expect(result).toEqual(sample);
  service.dispose();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it("uses the browser Worker in a worker-like runtime without a window", async () => {
  expect(typeof window).toBe("undefined");
  const worker = fakeWorker();
  const workerFactory = vi.fn(() => worker);
  const loadAnalyzer = vi.fn(async () => ({ analyzeEnglishAgreementWithWink: () => sample }));
  const service = createEnglishAgreementService({ workerFactory, loadAnalyzer, isServer: () => false });

  await expect(service.analyze(input)).resolves.toEqual(sample);

  expect(workerFactory).toHaveBeenCalledTimes(1);
  expect(loadAnalyzer).not.toHaveBeenCalled();
  service.dispose();
});

it("preflights a long reference without creating the worker and forwards valid references unchanged", async () => {
  const postedMessages: Parameters<EnglishAgreementWorkerPort["postMessage"]>[0][] = [];
  const worker = fakeWorker(true, postedMessages);
  const workerFactory = vi.fn(() => worker);
  const service = createEnglishAgreementService({ workerFactory, isServer: () => false });
  const tooLong = await service.analyze({ text: input.text, referenceText: "r".repeat(257) });

  expect(tooLong.disposition).toBe("abstained");
  expect(workerFactory).not.toHaveBeenCalled();
  const unsupportedReference = await service.analyze({ ...input, referenceText: "中文参考" });
  expect(unsupportedReference.disposition).toBe("abstained");
  expect(workerFactory).not.toHaveBeenCalled();

  const referenceText = "A lantern needs light.";
  const pending = service.analyze({ ...input, referenceText });
  expect(workerFactory).toHaveBeenCalledTimes(1);
  await pending;
  service.dispose();
  expect(postedMessages[0]?.input.referenceText).toBe(referenceText);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it("uses the same lazy analyzer through dynamic import in SSR and Node", async () => {
  const workerFactory = vi.fn(() => { throw new Error("worker must not be created in SSR"); });
  const analyzeEnglishAgreementWithWink = vi.fn(() => sample);
  const loadAnalyzer = vi.fn(async () => ({ analyzeEnglishAgreementWithWink }));
  const service = createEnglishAgreementService({ workerFactory, loadAnalyzer, isServer: () => true });

  expect(loadAnalyzer).not.toHaveBeenCalled();
  const result = await service.analyze(input);

  expect(result).toEqual(sample);
  expect(loadAnalyzer).toHaveBeenCalledTimes(1);
  expect(analyzeEnglishAgreementWithWink).toHaveBeenCalledWith(input);
  expect(workerFactory).not.toHaveBeenCalled();
  service.dispose();
});

it("rejects when a browser worker is unavailable rather than treating failure as a no-edit result", async () => {
  const loadAnalyzer = vi.fn(async () => ({ analyzeEnglishAgreementWithWink: () => sample }));
  const service = createEnglishAgreementService({
    workerFactory: () => { throw new Error("worker unavailable"); }, loadAnalyzer, isServer: () => false
  });

  await expect(service.analyze(input)).rejects.toThrow("worker unavailable");
  expect(loadAnalyzer).not.toHaveBeenCalled();
});

it("terminates and rejects outstanding work on timeout", async () => {
  vi.useFakeTimers();
  const worker = fakeWorker(false);
  const service = createEnglishAgreementService({ workerFactory: () => worker, isServer: () => false });
  try {
    const pending = service.analyze(input, { timeoutMs: 25 });
    const rejected = expect(pending).rejects.toBeInstanceOf(EnglishAgreementTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  } finally {
    service.dispose();
    vi.useRealTimers();
  }
});

it("terminates active work on cancellation and permits a clean later request", async () => {
  const firstWorker = fakeWorker(false);
  const secondWorker = fakeWorker(true);
  const workers = [firstWorker, secondWorker];
  const service = createEnglishAgreementService({ workerFactory: () => workers.shift()!, isServer: () => false });
  const controller = new AbortController();
  const pending = service.analyze(input, { signal: controller.signal });
  const rejected = expect(pending).rejects.toBeInstanceOf(EnglishAgreementAbortError);
  controller.abort();

  await rejected;
  expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
  await expect(service.analyze(input)).resolves.toEqual(sample);
  service.dispose();
  expect(secondWorker.terminate).toHaveBeenCalledTimes(1);
});

it("removes an aborted queued request without terminating the active worker", async () => {
  const worker = fakeWorker(false);
  const service = createEnglishAgreementService({ workerFactory: () => worker, isServer: () => false });
  const first = service.analyze(input);
  const controller = new AbortController();
  const queued = service.analyze(input, { signal: controller.signal });
  controller.abort();

  await expect(queued).rejects.toBeInstanceOf(EnglishAgreementAbortError);
  expect(worker.terminate).not.toHaveBeenCalled();
  service.dispose();
  await expect(first).rejects.toBeInstanceOf(EnglishAgreementAbortError);
});
