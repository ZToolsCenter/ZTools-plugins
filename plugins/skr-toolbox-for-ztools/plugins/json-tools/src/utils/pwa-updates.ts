// PWA 更新管理工具

export interface UpdateStatus {
  isUpdateAvailable: boolean;
  isOfflineReady: boolean;
  version?: string;
  error?: string;
}

export interface PWAUpdateManagerOptions {
  checkInterval?: number; // 检查更新的间隔（毫秒）
  autoUpdate?: boolean; // 是否自动更新
}

class PWAUpdateManager {
  private registration: ServiceWorkerRegistration | null = null;
  private updateCallbacks: Set<(status: UpdateStatus) => void> = new Set();
  private checkTimer: number | null = null;
  private isUpdating = false;
  private options: Required<PWAUpdateManagerOptions>;

  constructor(options: PWAUpdateManagerOptions = {}) {
    this.options = {
      checkInterval: options.checkInterval || 30 * 60 * 1000, // 默认 30 分钟
      autoUpdate: options.autoUpdate || false,
      ...options,
    };
  }

  private async checkForUpdates(): Promise<boolean> {
    if (!this.registration || this.isUpdating) {
      return false;
    }

    try {
      await this.registration.update();

      // 如果有新的 service worker 在等待
      if (this.registration.waiting) {
        this.notifyUpdateAvailable();

        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  private notifyUpdateAvailable() {
    const status: UpdateStatus = {
      isUpdateAvailable: true,
      isOfflineReady: true,
    };

    this.updateCallbacks.forEach((callback) => {
      try {
        callback(status);
      } catch (error) {
        // 静默处理回调错误
      }
    });

    // 触发自定义事件
    window.dispatchEvent(
      new CustomEvent("pwa-update-available", {
        detail: status,
      }),
    );
  }

  private setupUpdateListener() {
    if (!this.registration) return;

    // 监听新的 service worker
    this.registration.addEventListener("updatefound", () => {
      const newWorker = this.registration!.installing;

      if (newWorker) {
        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            this.notifyUpdateAvailable();
          }
        });
      }
    });
  }

  public async init(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    try {
      // 获取当前激活的 service worker 注册
      this.registration =
        (await navigator.serviceWorker.getRegistration()) || null;

      if (!this.registration) {
        return;
      }

      this.setupUpdateListener();

      // 定期检查更新
      if (this.options.checkInterval > 0) {
        this.startPeriodicCheck();
      }

      // 监听 controller 变化（当新的 service worker 激活时）
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });

      // 监听在线/离线状态
      window.addEventListener("online", () => {
        this.checkForUpdates();
      });
    } catch (error) {
      // 静默处理初始化错误
    }
  }

  public startPeriodicCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    this.checkTimer = window.setInterval(() => {
      this.checkForUpdates();
    }, this.options.checkInterval);
  }

  public stopPeriodicCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  public async checkNow(): Promise<boolean> {
    return this.checkForUpdates();
  }

  public async applyUpdate(): Promise<void> {
    if (!this.registration || !this.registration.waiting) {
      return;
    }

    this.isUpdating = true;

    try {
      // 发送消息告诉 waiting service worker 跳过等待
      this.registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (error) {
      this.isUpdating = false;
      throw error;
    }
  }

  public onUpdate(callback: (status: UpdateStatus) => void): () => void {
    this.updateCallbacks.add(callback);

    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  public getRegistration(): ServiceWorkerRegistration | null {
    return this.registration;
  }

  public isUpdatePending(): boolean {
    return !!this.registration?.waiting;
  }

  public destroy() {
    this.stopPeriodicCheck();
    this.updateCallbacks.clear();
    this.registration = null;
  }
}

// 创建单例实例
let pwaUpdateManager: PWAUpdateManager | null = null;

export function usePWAUpdate(
  options?: PWAUpdateManagerOptions,
): PWAUpdateManager {
  if (!pwaUpdateManager) {
    pwaUpdateManager = new PWAUpdateManager(options);
    pwaUpdateManager.init();
  }

  return pwaUpdateManager;
}

// 导出类供直接使用
export { PWAUpdateManager };
