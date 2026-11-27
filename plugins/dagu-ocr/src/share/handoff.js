// 把当前图片交给「大古快传」插件：写交接文件 → 跳转 → 确认对方确实接手。上传本身由大古快传负责。

// 宿主的 redirect 找不到目标插件时只弹一条系统通知，照样返回成功，所以不能靠返回值判断。
// 跳转成功时宿主会让本插件视图退出（onPluginOut）：主窗口收到后把交接编号写进 ACK_KEY；
// 大古快传读到交接文件时也会留下确认文件。两个信号出现任何一个才算交接成功。
export const PENDING_KEY = 'dagu-ocr-share-pending';
export const ACK_KEY = 'dagu-ocr-share-ack';
export const HANDOFF_TIMEOUT_MS = 3000;
const HANDOFF_POLL_MS = 30;

// 跳转失败时保留在当前界面，用户还可以改用保存或复制。
const MISSING_TRANSFER = '没有找到「大古快传」：在 ZTools 插件中心安装后，可把截图分享到本地目录或 SSH 服务器';
const NO_NODE = '分享需要在 ZTools 中安装「大古快传」后使用';
const PREPARE_FAILED = '准备分享文件失败';

function base64Of(dataUrl) {
  return String(dataUrl).split(',')[1] || '';
}

function createNonce() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// 主窗口在 onPluginOut 时调用：把待确认的交接编号写成确认标记，覆盖层读到后才知道跳转成功了。
export function acknowledgeHandoff(storage) {
  try {
    const nonce = storage?.getItem(PENDING_KEY);
    if (!nonce) return false;
    storage.setItem(ACK_KEY, nonce);
    return true;
  } catch {
    return false;
  }
}

function clearHandoffKeys(storage) {
  try {
    storage?.removeItem(PENDING_KEY);
    storage?.removeItem(ACK_KEY);
  } catch {
    // 清理失败不影响结果。
  }
}

// 轮询等待两个确认信号中的任何一个。storage 不可用时无法确认，按「已确认」处理。
export function waitForHandoff({ storage, nonce, acked = () => false, timeoutMs = HANDOFF_TIMEOUT_MS, pollMs = HANDOFF_POLL_MS } = {}) {
  if (!storage) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(deadline);
      resolve(value);
    };
    const check = () => {
      let marked = false;
      try {
        marked = storage.getItem(ACK_KEY) === nonce;
      } catch {
        // 读不到就继续等，直到超时。
      }
      if (marked || acked()) finish(true);
    };
    const timer = setInterval(check, pollMs);
    const deadline = setTimeout(() => finish(false), timeoutMs);
    check();
  });
}

// prepare / discard / acked 是 preload 暴露的窄接口：写交接文件、跳转失败时把它删掉、查询对方的确认文件。
export async function handoffToTransfer({ host, prepare, discard, acked, dataUrl, storage, timeoutMs, pollMs }) {
  if (typeof prepare !== 'function') return { ok: false, message: NO_NODE };
  let share;
  try {
    share = prepare(base64Of(dataUrl));
  } catch (error) {
    console.warn('[capture] 写入分享文件失败:', error);
    return { ok: false, message: PREPARE_FAILED };
  }
  if (!share?.token) return { ok: false, message: PREPARE_FAILED };

  const usable = storage?.getItem && storage?.setItem ? storage : null;
  const nonce = createNonce();
  let redirectFailed = false;
  try {
    if (usable) {
      clearHandoffKeys(usable);
      usable.setItem(PENDING_KEY, nonce);
    }
    if (typeof host?.redirect !== 'function') redirectFailed = true;
    else host.redirect(share.label, share.token);
  } catch (error) {
    console.warn('[capture] 跳转到大古快传失败:', error);
    redirectFailed = true;
  }
  const accepted = !redirectFailed && await waitForHandoff({
    storage: usable,
    nonce,
    acked: () => Boolean(acked?.(share.fileName)),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(pollMs ? { pollMs } : {})
  });
  clearHandoffKeys(usable);
  if (accepted) return { ok: true };
  if (typeof discard === 'function') discard(share.fileName);
  return { ok: false, message: MISSING_TRANSFER };
}
