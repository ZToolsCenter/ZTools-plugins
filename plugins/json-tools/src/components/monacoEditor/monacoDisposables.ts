import { IDisposable } from "monaco-editor";

/**
 * Monaco 资源生命周期管理器
 *
 * 集中管理所有需要 dispose 的 Monaco 资源（事件监听器、编辑器实例、模型等），
 * 确保组件卸载时统一释放，防止内存泄漏。
 *
 * 设计参考 VS Code 的 DisposableStore 模式，支持：
 * - 自动收集 IDisposable 资源
 * - 防御性 dispose（try-catch 包裹，单个失败不影响其余）
 * - 可复用：dispose() 清理当前资源后自动重置，兼容 React StrictMode 的 mount/unmount/remount 周期
 */
export class DisposableStore {
  private disposables: IDisposable[] = [];
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private disposed = false;

  /**
   * 注册一个 IDisposable 资源，返回同一引用方便链式调用
   */
  add<T extends IDisposable>(disposable: T): T {
    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * 注册 setTimeout ID，dispose 时自动 clearTimeout
   */
  addTimeout(id: ReturnType<typeof setTimeout>): void {
    this.timeouts.push(id);
  }

  /**
   * 释放所有已注册的资源并重置 store 状态
   *
   * 关键设计：dispose 后自动重置为可用状态，兼容 React StrictMode
   * 的 mount → unmount → remount 生命周期。
   * 如果 store 在 unmount 时被 dispose 后不可复用，
   * remount 时所有 add() 会立即 dispose 新注册的监听器，导致功能失效。
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // 先清理 timeout，防止回调中使用已释放的资源
    for (const id of this.timeouts) {
      clearTimeout(id);
    }
    this.timeouts = [];

    // 再 dispose 所有 Monaco 资源（逆序释放，模拟栈语义）
    for (let i = this.disposables.length - 1; i >= 0; i--) {
      try {
        this.disposables[i].dispose();
      } catch {
        /* 单个失败不影响其余资源释放 */
      }
    }
    this.disposables = [];

    // 重置为可用状态，允许 StrictMode remount 时重新注册资源
    this.disposed = false;
  }
}
