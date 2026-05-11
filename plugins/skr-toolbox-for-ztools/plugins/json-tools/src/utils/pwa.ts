// PWA 相关工具函数

// 检测是否为 PWA 模式
export const isPWA = () => {
  // 检测 display-mode
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const isFullscreen = window.matchMedia("(display-mode: fullscreen)").matches;
  const isMinimalUI = window.matchMedia("(display-mode: minimal-ui)").matches;

  // iOS 设备检测
  const isIOSStandalone = (window.navigator as any).standalone === true;

  // 检测是否从 PWA 启动（通过检查启动方式）
  const isFromPWA = window.matchMedia(
    "(display-mode: window-controls-overlay)",
  ).matches;

  // 检查是否在 PWA 环境中（通过检查 URL 协议或启动方式）
  const isPWAEnvironment =
    document.referrer.includes("android-app://") ||
    window.location.protocol === "file:" ||
    sessionStorage.getItem("pwa-launched") === "true";

  return (
    isStandalone ||
    isFullscreen ||
    isMinimalUI ||
    isIOSStandalone ||
    isFromPWA ||
    isPWAEnvironment
  );
};

// 检测是否为 iOS 设备
export const isIOS = () => {
  return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
};

// 检测是否为 Android 设备
export const isAndroid = () => {
  return /android/.test(window.navigator.userAgent.toLowerCase());
};

// 获取 PWA 安装状态
export const getInstallStatus = () => {
  if (isPWA()) {
    return "installed";
  }
  if (isIOS()) {
    return "ios-prompt";
  }
  if (isAndroid()) {
    return "android-prompt";
  }

  return "browser";
};
