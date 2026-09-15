export interface ErrorDetailsContext {
  appVersion: string;
  target: string;
  platform: string;
  currentView: string;
  timestamp?: string;
}

export interface CapturedError {
  error: unknown;
  timestamp: string;
}

let latestCapturedError: CapturedError | null = null;

function redactSensitiveText(value: string): string {
  return value
    .replace(/((?:authorization\s*[:=]\s*)?bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/((?:["'])(?:api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|token|authorization|password|secret)(?:["'])\s*:\s*)(?:"[^"]*"|'[^']*'|[^,}\s]+)/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(process\.env\.[A-Z0-9_]+\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]');
}

function normalizedError(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: redactSensitiveText(error.message || String(error)),
      stack: redactSensitiveText(error.stack || ''),
    };
  }
  return { name: 'Error', message: redactSensitiveText(String(error)), stack: '' };
}

export function getSafeErrorMessage(error: unknown, maxLength = 240): string {
  const message = normalizedError(error).message.trim() || 'Unknown error';
  if (maxLength <= 3) return message.slice(0, Math.max(0, maxLength));
  return message.length > maxLength ? `${message.slice(0, maxLength - 3)}...` : message;
}

export function recordCapturedError(error: unknown, timestamp = new Date().toISOString()): void {
  latestCapturedError = { error, timestamp };
}

export function getLatestCapturedError(): CapturedError | null {
  return latestCapturedError;
}

export function errorFingerprint(error: unknown): string {
  const normalized = normalizedError(error);
  return `${normalized.name}:${normalized.message}`;
}

export function formatErrorDetails(error: unknown, context: ErrorDetailsContext): string {
  const normalized = normalizedError(error);
  return [
    `App version: ${context.appVersion}`,
    `Target: ${context.target}`,
    `Platform: ${context.platform}`,
    `Current view: ${context.currentView}`,
    `Error name: ${normalized.name}`,
    `Message: ${normalized.message}`,
    `Stack: ${normalized.stack}`,
    `Timestamp: ${context.timestamp || new Date().toISOString()}`,
  ].join('\n');
}

export function createErrorRateLimiter(options: {
  dedupeMs?: number;
  maxEvents?: number;
  windowMs?: number;
} = {}) {
  const dedupeMs = options.dedupeMs ?? 5_000;
  const maxEvents = options.maxEvents ?? 3;
  const windowMs = options.windowMs ?? 10_000;
  const lastReportedAt = new Map<string, number>();
  const reportedAt: number[] = [];

  return {
    shouldReport(fingerprint: string, now = Date.now()): boolean {
      const previous = lastReportedAt.get(fingerprint);
      if (previous !== undefined && now - previous < dedupeMs) return false;

      while (reportedAt.length > 0 && now - reportedAt[0] >= windowMs) reportedAt.shift();
      if (reportedAt.length >= maxEvents) return false;

      lastReportedAt.set(fingerprint, now);
      reportedAt.push(now);
      return true;
    },
  };
}
