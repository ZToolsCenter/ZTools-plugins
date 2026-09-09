import {
  createErrorRateLimiter,
  errorFingerprint,
  recordCapturedError,
} from './errorDetails';

export type GlobalErrorSource = 'vue' | 'window.error' | 'unhandledrejection';

export interface GlobalErrorCaptureController {
  capture(error: unknown, source: GlobalErrorSource): void;
  stop(): void;
}

export function installGlobalErrorCapture(
  report: (error: unknown, source: GlobalErrorSource) => void,
): GlobalErrorCaptureController {
  const limiter = createErrorRateLimiter();

  function capture(error: unknown, source: GlobalErrorSource): void {
    if (!limiter.shouldReport(errorFingerprint(error))) return;
    recordCapturedError(error);
    console.error(`[GlobalError:${source}]`, error);
    try {
      report(error, source);
    } catch (reportError) {
      console.error('[GlobalError:reporter]', reportError);
    }
  }

  const handleWindowError = (event: ErrorEvent) => {
    capture(event.error || event.message, 'window.error');
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    capture(event.reason, 'unhandledrejection');
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  function stop(): void {
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }

  return { capture, stop };
}
