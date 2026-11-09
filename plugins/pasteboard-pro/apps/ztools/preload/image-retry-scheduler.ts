import type { MirrorImageRetrySummary } from "./mirror-image-retry-types";

export const MAX_AUTOMATIC_IMAGE_RETRY_ROUNDS = 5;
export const IMAGE_RETRY_INITIAL_DELAY_MS = 1_000;
export const IMAGE_RETRY_MAX_DELAY_MS = 16_000;

export class ImageRetryCancelledError extends Error {
  constructor() { super("Clipboard image retry was cancelled"); this.name = "ImageRetryCancelledError"; }
}

export type ImageRetrySchedulerOptions<Result> = Readonly<{
  run(isCurrent: () => boolean): Promise<Result>;
  retryEmptyResult?(result: Result): boolean;
  readSummary(): Promise<MirrorImageRetrySummary>;
  isRetryable(error: unknown): boolean;
  reportError(error: unknown): void;
  schedule(callback: () => void, delayMs: number): () => void;
}>;

/** One primary-owner session; timers only request the same serialized mirror. */
export function createImageRetryScheduler<Result>(options: ImageRetrySchedulerOptions<Result>) {
  let generation = 0;
  let suspensionDepth = 0;
  let disposed = false;
  let cancelTimer: (() => void) | undefined;
  let inFlight: Promise<Result> | undefined;
  let automaticRounds = 0;
  let requestedGeneration: number | undefined;
  let timerTicket = 0;
  let fastRounds = 0;

  const active = (token: number) => !disposed && suspensionDepth === 0 && token === generation;

  function cancelCurrentTimer(): void {
    timerTicket += 1;
    cancelTimer?.();
    cancelTimer = undefined;
  }

  function cancelPending(): void {
    generation += 1;
    cancelCurrentTimer();
    requestedGeneration = undefined;
    fastRounds = 0;
  }

  function arm(delayMs: number, token: number): void {
    if (!active(token) || cancelTimer !== undefined) return;
    const ticket = ++timerTicket;
    cancelTimer = options.schedule(() => {
      if (!active(token) || ticket !== timerTicket) return;
      cancelTimer = undefined;
      void run().catch((error: unknown) => {
        if (active(token)) options.reportError(error);
      });
    }, delayMs);
  }

  function run(): Promise<Result> {
    if (inFlight !== undefined) return inFlight;
    const token = generation;
    const execution = Promise.resolve().then(async () => {
      let result: Result | undefined;
      let failure: unknown;
      let failed = false;
      let needsRetry = false;
      try {
        result = await options.run(() => active(token));
      } catch (error) {
        failed = true;
        failure = error;
      }
      if (active(token) && (!failed || options.isRetryable(failure))) {
        try {
          needsRetry = (await options.readSummary()).total > 0;
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          } else if (active(token)) {
            // A journal read error must not replace the original mirror error.
            options.reportError(error);
          }
        }
      }
      inFlight = undefined;
      if (requestedGeneration !== undefined && active(requestedGeneration)) {
        const requested = requestedGeneration;
        requestedGeneration = undefined;
        arm(0, requested);
      } else if (active(token)) {
        if (needsRetry && automaticRounds < MAX_AUTOMATIC_IMAGE_RETRY_ROUNDS) {
          const delay = Math.min(IMAGE_RETRY_MAX_DELAY_MS,
            IMAGE_RETRY_INITIAL_DELAY_MS * 2 ** automaticRounds);
          automaticRounds += 1;
          arm(delay, token);
        } else if (!needsRetry && !failed && fastRounds > 0 && options.retryEmptyResult?.(result as Result)) {
          fastRounds -= 1;
          arm(250, token);
        }
      }
      if (failed) throw failure;
      return result as Result;
    });
    inFlight = execution;
    return execution;
  }

  function begin(fast: boolean): Promise<Result> {
    if (disposed || suspensionDepth > 0) {
      return Promise.reject(new Error("Clipboard image retry owner is unavailable"));
    }
    automaticRounds = 0;
    fastRounds = fast ? 3 : 0;
    cancelCurrentTimer();
    if (inFlight !== undefined) {
      requestedGeneration = generation;
      return inFlight;
    }
    return run();
  }

  function suspend(): () => void {
    suspensionDepth += 1;
    cancelPending();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      suspensionDepth -= 1;
    };
  }

  function dispose(): void {
    disposed = true;
    cancelPending();
  }

  return { request: () => begin(false), requestFast: () => begin(true), suspend, dispose };
}
