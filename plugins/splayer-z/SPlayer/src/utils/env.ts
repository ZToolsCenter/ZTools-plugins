// 构建时常量声明 (用于 Tree Shaking)
declare global {
  const __ZTOOLS__: boolean;
  const __ELECTRON__: boolean;
}

/** 系统判断 */
export const userAgent = window.navigator.userAgent;

/** 是否为 ZTools 插件环境 */
export const isZToolsPlugin =
  (typeof __ZTOOLS__ !== 'undefined' && __ZTOOLS__) ||
  (typeof window !== 'undefined' && typeof (window as any).ztools !== 'undefined');

/** 是否为 Electron 环境 */
export const isElectron = !isZToolsPlugin && (
  (typeof __ELECTRON__ !== 'undefined' && __ELECTRON__) ||
  userAgent.includes("Electron") ||
  typeof window?.electron !== "undefined"
);

/** 构建目标 */
export const buildTarget = isZToolsPlugin ? 'ztools' : isElectron ? 'electron' : 'web';

/** 是否为开发环境 */
export const isDev = import.meta.env.MODE === "development" || import.meta.env.DEV;

/** 是否为 Windows 系统 */
export const isWin = userAgent.includes("Windows");
/** 是否为 macOS 系统 */
export const isMac = userAgent.includes("Macintosh");
/** 是否为 Linux 系统 */
export const isLinux = userAgent.includes("Linux");

/** 是否为移动端 */
export const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  userAgent,
);

/** 是否为 DEV 构建 */
export const isDevBuild = import.meta.env.VITE_BUILD_TYPE === "dev";
