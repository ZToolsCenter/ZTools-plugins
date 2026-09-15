import { getUToolsApi } from "./env";

/**
 * 速记小窗（独立 browser 窗口）自身的窗口控制封装。
 *
 * 关键约束（见项目 memory utools-createbrowserwindow-api）：
 * createBrowserWindow 返回的 win 只在「创建者侧」（主窗 preload）可用，且不含实例事件。
 * 因此子窗口不能直接调 win.setAlwaysOnTop / win.close，必须通过 utools.sendToParent
 * 把请求发回主窗 preload，由持有 win 的一方执行。失焦隐藏则由子窗内 web 原生 blur 触发。
 */
const send = (channel: string, ...args: unknown[]) => {
  const utools = getUToolsApi();
  if (utools && typeof utools.sendToParent === "function") {
    utools.sendToParent(channel, ...args);
    return true;
  }
  return false;
};

export const quickNoteWindow = {
  /**
   * 收起小窗。请求主窗把窗口「隐藏」（常驻后台，下次唤起秒显，不销毁），
   * 兜底 window.close()。主窗侧 quicknote:close → hideQuickNoteWindow。
   */
  close(): void {
    if (!send("quicknote:close")) {
      try {
        window.close();
      } catch {
        /* noop */
      }
    }
  },

  /** 通知主窗某条笔记已被小窗改动，主窗据此从 db 重读该页（防跨窗脏写）。 */
  notifyNoteUpdated(pageId: string): void {
    send("quicknote:note-updated", pageId);
  },

  /** 请求父窗把小窗高度设为 height（自动调整高度模式用；宽度不变）。 */
  setHeight(height: number): void {
    send("quicknote:set-height", Math.round(height));
  },

  /**
   * 用户拖动边框停下后调用：请求主窗用 win.getSize() 读取真实窗口尺寸并写回
   * dbStorage（持久化），下次开窗沿用。子窗渲染进程的 window.outerWidth 在 uTools
   * frameless 窗口里 resize 后并不可靠，故由持有 win 的主窗权威读取，不传具体数值。
   */
  persistSize(): void {
    send("quicknote:persist-size");
  },

  /**
   * 用户拖动窗口移动停下后调用：把子窗当前屏幕坐标（screenX/screenY）上报父窗，
   * 由父窗直接写回 dbStorage。移动不触发 resize，且关窗时父窗 getBounds() 在窗口
   * 销毁瞬间可能取到旧值，故移动停下就主动上报，确保最后位置可靠落库。
   */
  persistPosition(x: number, y: number): void {
    send("quicknote:persist-position", { x: Math.round(x), y: Math.round(y) });
  },

  /**
   * B 插件保存：通过 utools.redirect 把草稿内容回传 A 插件落库。
   * A 插件 pluginName="鹅的笔记"，feature cmds=["速记入库"]。
   * blocks 直接传 PartialBlock[] 原值，A 侧落库时自行 normalize。
   */
  redirectSaveToMainApp(blocks: unknown): boolean {
    const ut = getUToolsApi();
    if (!ut || typeof ut.redirect !== "function") return false;
    try {
      ut.redirect(["鹅的笔记", "速记入库"], JSON.stringify(blocks));
      return true;
    } catch {
      return false;
    }
  },

  /**
   * 请求隐藏（与 close 同走 quicknote:close → 主窗 hideQuickNoteWindow）：
   * 窗口常驻后台、下次秒显。保留此导出名以维持外部调用兼容性。
   */
  hide(): void {
    if (!send("quicknote:close")) {
      try {
        window.close();
      } catch {
        /* noop */
      }
    }
  },
};
