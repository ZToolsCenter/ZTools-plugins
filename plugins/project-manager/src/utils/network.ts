export const DEFAULT_NETWORK_TIMEOUT_MS = 15_000;
export const DEFAULT_AI_TIMEOUT_MS = 60_000;

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as { name?: unknown };
  return record.name === 'AbortError';
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
  const upstreamSignal = options.signal ?? init.signal ?? undefined;
  const controller = new AbortController();

  let timedOut = false;
  let timeoutId: number | undefined;

  const abortFromUpstream = () => {
    controller.abort(
      upstreamSignal?.reason instanceof DOMException
        ? upstreamSignal.reason
        : new DOMException('The request was aborted.', 'AbortError'),
    );
  };

  if (upstreamSignal?.aborted) {
    abortFromUpstream();
  } else if (upstreamSignal) {
    upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException(`The request timed out after ${timeoutMs}ms.`, 'AbortError'));
    }, timeoutMs);
  }

  try {
    return await globalThis.fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new DOMException(`The request timed out after ${timeoutMs}ms.`, 'AbortError');
    }
    throw error;
  } finally {
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
    }
    if (upstreamSignal) {
      upstreamSignal.removeEventListener('abort', abortFromUpstream);
    }
  }
}
