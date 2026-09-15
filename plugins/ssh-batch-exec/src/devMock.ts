/**
 * 浏览器开发模式（npm run dev）下的极简 mock，仅用于 UI 调试；
 * 在 ZTools 中运行时 window.ztools 已存在，不会启用。
 */
const memDb = new Map<string, any>();

export function installDevMock(): void {
  if ((window as any).ztools) return;
  console.warn("[dev] 未检测到 window.ztools，启用浏览器 mock（仅 UI 调试）");

  (window as any).ztools = {
    getAppName: () => "ZTools(dev)",
    getAppVersion: () => "0.0.0-dev",
    isDev: () => true,
    showNotification: (body: string) => alert(body),
    copyText: async (text: string) => {
      try {
        await navigator.clipboard?.writeText(text);
      } catch (_) {
        /* 浏览器调试时页面未聚焦会拒绝写入，忽略即可；真实环境走 ZTools 剪贴板 API */
      }
    },
    setExpendHeight: () => {},
    onPluginEnter: () => {},
    onPluginOut: () => {},
    onPluginDetach: () => {},
    showOpenDialog: () => [],
    dbStorage: {
      _s: new Map<string, any>(),
      getItem(k: string) {
        return this._s.get(k);
      },
      setItem(k: string, v: unknown) {
        this._s.set(k, v);
      },
      removeItem(k: string) {
        this._s.delete(k);
      },
    },
    db: {
      promises: {
        // 模拟 PouchDB 语义：更新已存在文档必须携带最新 _rev，否则抛 409 冲突
        // 用于验证 putDoc 的 upsert 兜底（log:last 固定 _id 反复覆盖、编辑既有文档）
        put: async (doc: any) => {
          const existing = memDb.get(doc._id);
          if (existing && existing._rev !== doc._rev) {
            const err: any = new Error("Document update conflict");
            err.name = "conflict";
            err.status = 409;
            throw err;
          }
          const rev = String((existing ? Number(existing._rev) || 0 : 0) + 1);
          const stored = JSON.parse(JSON.stringify({ ...doc, _rev: rev }));
          memDb.set(doc._id, stored);
          return { ok: true, id: doc._id, rev };
        },
        get: async (id: string) => {
          const doc = memDb.get(id);
          return doc ? JSON.parse(JSON.stringify(doc)) : null;
        },
        remove: async (docOrId: any) => {
          memDb.delete(typeof docOrId === "string" ? docOrId : docOrId._id);
          return { ok: true };
        },
        allDocs: async (prefix: string) =>
          [...memDb.values()].filter((d) => d._id.startsWith(prefix)),
      },
    },
  };

  (window as any).services = {
    async execOnServer(
      server: any,
      command: string,
      opts: any,
      onOutput?: (text: string) => void
    ) {
      const start = Date.now();
      const trace: string[] = [];
      const mark = (stage: string) => trace.push(`+${Date.now() - start}ms ${stage}`);
      const onStage = opts?.onStage;
      const name = server?.name || server?.host || "?";
      mark("connecting");
      onStage?.("connecting");
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));
      mark("handshake");
      onStage?.("handshake");
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));
      mark("ready");
      onStage?.("ready");
      mark("exec");
      onStage?.("exec");
      const stdout = `$ ${command}\n[mock] ${name}: 命令执行完成\n`;
      // 模拟 git 等工具把进度信息写到 stderr 的常见情况，便于调试排错视图
      const stderr = `[mock] ${name}: remote: Counting objects: 100% (3/3), done.\n`;
      onOutput?.(stdout + stderr);
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
      mark("exit:code=0");
      mark("close");
      return { ok: true, exitCode: 0, stdout, stderr, error: "", duration: Date.now() - start, trace };
    },
    async testConnection() {
      return { ok: true, message: "连接成功（mock）" };
    },
    cancelRun() {
      return 0;
    },
    readPrivateKey() {
      return { ok: false, message: "浏览器 mock 不支持读取私钥文件" };
    },
  };
}
