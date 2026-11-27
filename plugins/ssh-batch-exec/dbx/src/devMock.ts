// 作者：木子
// 浏览器开发模式（npm run dev）下的 DBX Bridge mock；DBX 工作台中不会启用。

const memDb = new Map<string, any>();
const eventHandlers = new Set<(event: unknown) => void>();
let running = false;

function emit(event: unknown): void {
  eventHandlers.forEach((handler) => handler(event));
}

async function mockRequest(method: string, params: any = {}): Promise<any> {
  switch (method) {
    case "ping":
      return { ok: true };
    case "index": {
      const prefix = String(params.prefix || "");
      return [...memDb.values()]
        .filter((doc) => String(doc._id).startsWith(prefix))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    }
    case "detail":
      return memDb.get(String(params.id || "")) || null;
    case "add": {
      const doc = params.doc;
      if (!doc?._id) throw new Error("记录缺少 _id");
      if (memDb.has(doc._id)) throw new Error("记录已存在: " + doc._id);
      memDb.set(doc._id, JSON.parse(JSON.stringify(doc)));
      return doc;
    }
    case "edit": {
      const doc = params.doc;
      if (!doc?._id || !memDb.has(doc._id)) throw new Error("记录不存在: " + doc._id);
      memDb.set(doc._id, JSON.parse(JSON.stringify(doc)));
      return doc;
    }
    case "del": {
      const ok = memDb.delete(String(params.id || ""));
      return { ok };
    }
    case "get":
      return Object.prototype.hasOwnProperty.call(params, "defaultValue")
        ? params.defaultValue
        : null;
    case "set":
      return params.value;
    case "ssh/testConnection":
      await delay(300);
      return { ok: true, message: "连接成功（mock）" };
    case "ssh/exec":
      return mockExec(params);
    case "ssh/cancelRun":
      running = false;
      return { cancelled: 1 };
    default:
      throw new Error("未知方法: " + method);
  }
}

async function mockExec(params: any) {
  const runId = String(params.runId || "");
  const execId = String(params.execId || "");
  const command = String(params.command || "");
  const name = params.server?.name || params.server?.host || "?";
  const startedAt = Date.now();
  const trace: string[] = [];
  const stage = (value: string) => {
    trace.push(`+${Date.now() - startedAt}ms ${value}`);
    emit({ type: "stage", runId, execId, stage: value, at: Date.now() });
  };

  stage("connecting");
  await delay(180);
  stage("handshake");
  await delay(180);
  stage("ready");
  stage("exec");
  const stdout = `$ ${command}\n[mock] ${name}: 命令执行完成\n`;
  const stderr = `[mock] ${name}: remote: Counting objects: 100% (3/3), done.\n`;
  emit({ type: "output", runId, execId, stream: "stdout", text: stdout, at: Date.now() });
  emit({ type: "output", runId, execId, stream: "stderr", text: stderr, at: Date.now() });
  await delay(420);
  stage("exit:code=0");
  stage("close");
  running = false;
  return {
    ok: true,
    exitCode: 0,
    stdout,
    stderr,
    error: "",
    duration: Date.now() - startedAt,
    trace,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function installDevMock(): void {
  const win = window as unknown as { dbxPlugin?: any };
  if (win.dbxPlugin) return;
  console.warn("[dev] 未检测到 window.dbxPlugin，启用浏览器 mock（仅 UI 调试）");

  win.dbxPlugin = {
    ready: Promise.resolve(),
    request: mockRequest,
    onEvent(handler: (event: unknown) => void) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    async copy(text: string) {
      try {
        await navigator.clipboard?.writeText(text);
      } catch (_) {
        /* 浏览器调试时页面未聚焦会拒绝写入，忽略即可 */
      }
    },
  };

  void running;
}
