/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />
import type { NativeDirStatus } from './api/dir';
import type { NativeMigrateApi } from './api/migrate';

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

/**
 * window.services —— preload（Node 侧）注入的能力契约。
 * 前端只允许通过 src/api 层访问，视图/store/hooks 不直接触碰 window.services。
 * 数据（分组/映射/日志）全部在前端三张 pinia 表中，preload 不再持有配置，故此处只有「无状态能力」。
 */
export interface ServicesApi extends NativeMigrateApi {
  /** 检测「源 → 目标」链接状态（kebab-case 状态，api/dir 负责归一化为 store 的 camelCase） */
  checkDirStatus(source: string, target: string): NativeDirStatus;
  /** 展开路径中的 %ENV% / ~ */
  expandEnv(path: string): string;
  /** 目标盘可用空间（字节） */
  getDiskFreeSpace(path: string): number;
  /** 字节数格式化 */
  formatSize(bytes: number): string;
  /** 关联进程是否运行中 */
  isProcessRunning(exeNames: string[]): boolean;
}

declare global {
  interface Window {
    services?: ServicesApi;
  }
}

export {};
