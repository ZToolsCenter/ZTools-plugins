// 截图预抓帧：触发瞬间就向宿主申请画面，与覆盖层窗口创建/加载并行。
// 覆盖层直接取用这一帧，省掉「先出窗口、再采集」的串行等待。

import { captureDisplay } from './desktop-capture.js';

const PRIME_KEY_PREFIX = 'dagu-ocr-capture-';
// 主窗口隐藏后画面才会稳定，稍等一下再采集，避免把主窗口拍进冻帧。
const PRIME_DELAY_MS = 60;
// 覆盖层异常退出时兜底清理，避免大图长期占用 localStorage。
const PRIME_TTL_MS = 30000;

export function createPrimeKey() {
  return `${PRIME_KEY_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localStorageOf(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

// 返回抓到的帧；失败时写入标记，让覆盖层立刻自己采集而不是干等。
export async function primeCaptureFrame({ win, display, key, delayMs = PRIME_DELAY_MS }) {
  const store = localStorageOf(win);
  if (!store || !key) return null;
  const cleanUp = () => {
    try {
      store.removeItem(key);
    } catch {
      // 存储不可用时忽略。
    }
  };
  const write = (payload) => {
    try {
      store.setItem(key, JSON.stringify(payload));
      setTimeout(cleanUp, PRIME_TTL_MS);
      return true;
    } catch (error) {
      console.warn('[capture] 预抓帧写入失败:', error);
      return false;
    }
  };
  try {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const startedAt = Date.now();
    const capture = await captureDisplay(win, display);
    const dataUrl = String(capture?.dataUrl || '');
    if (!dataUrl) throw new Error('未获取到屏幕画面');
    if (!write({ dataUrl, pixelSize: capture.pixelSize, captureMs: Date.now() - startedAt })) {
      cleanUp();
      write({ failed: true });
    }
    return capture;
  } catch (error) {
    console.warn('[capture] 预抓帧失败，覆盖层将自行采集:', error);
    write({ failed: true });
    return null;
  }
}

// 覆盖层侧读取预抓帧：拿到即删除；主窗口标记失败时立即返回，不消耗超时。
export async function readPrimedFrame({ win, key, timeoutMs = 3000, intervalMs = 20 }) {
  const store = localStorageOf(win);
  if (!store || !key) return null;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let raw = null;
    try {
      raw = store.getItem(key);
    } catch {
      return null;
    }
    if (raw) {
      try {
        store.removeItem(key);
      } catch {
        // 清理失败不影响本次使用。
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.dataUrl) return parsed;
      } catch {
        if (raw.startsWith('data:')) return { dataUrl: raw };
      }
      return null;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
