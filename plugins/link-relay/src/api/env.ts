/**
 * 宿主环境与 UI 交互能力 —— 封装 ztools 基础 API（平台 / 主题 / 通知 / 窗口 / 系统路径 / Shell）。
 * 无宿主（pnpm dev 浏览器）时全部退化为安全默认值，保证开发态可直接跑通。
 */

/** 运行平台 */
export type Platform = 'win32' | 'darwin' | 'linux' | 'unknown';

/** 可读取的系统路径名（宿主 getPath 支持的常用子集） */
export type SystemPathName = 'home' | 'appData' | 'userData' | 'cache' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'logs';

/** 取宿主对象，无宿主返回 null */
function host() {
  return typeof ztools !== 'undefined' ? ztools : null;
}

/** 是否运行在 ZTools 宿主内 */
export function isHost(): boolean {
  return host() !== null;
}

/** 是否开发模式（vite dev 或宿主 isDev） */
export function isDev(): boolean {
  return import.meta.env.DEV || (host()?.isDev() ?? false);
}

/** 当前平台（决定 junction / symlink 等链接策略） */
export function platform(): Platform {
  const api = host();
  if (!api) return 'unknown';
  if (api.isWindows()) return 'win32';
  if (api.isMacOS()) return 'darwin';
  if (api.isLinux()) return 'linux';
  return 'unknown';
}

/** 是否深色主题 */
export function isDark(): boolean {
  return host()?.isDarkColors() ?? false;
}

/** 宿主版本号 */
export function appVersion(): string {
  return host()?.getAppVersion() ?? '';
}

/** 读取系统路径（home / appData / userData / cache / temp / desktop…），无宿主返回空串 */
export function systemPath(name: SystemPathName): string {
  return host()?.getPath(name) ?? '';
}

/** 系统通知 */
export function notify(message: string): void {
  host()?.showNotification(message);
}

/** 设置插件视图高度（首页高度自适应用） */
export function setViewHeight(height: number): void {
  host()?.setExpendHeight(height);
}

/** 插件进入事件：首屏取数的触发点 */
export function onEnter(callback: (code: string) => void): void {
  host()?.onPluginEnter((action) => callback(action.code));
}

/** 插件退出事件（isKill=true 为杀进程）：退出前 flush 待写快照的触发点 */
export function onOut(callback: (isKill: boolean) => void): void {
  host()?.onPluginOut(callback);
}

/** 用系统默认程序打开目录或文件 */
export function openPath(fullPath: string): void {
  if (fullPath) host()?.shellOpenPath(fullPath);
}

/** 在文件管理器中定位目录或文件 */
export function showInFolder(fullPath: string): void {
  if (fullPath) host()?.shellShowItemInFolder(fullPath);
}
