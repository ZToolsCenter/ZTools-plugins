import { useSettingsStore } from "@/store/useSettingsStore";

/**
 * 自适应布局 Hook
 * 提供基于字体大小的布局缩放功能
 */
export function useAdaptiveLayout() {
  const { fontSize } = useSettingsStore();

  // 获取当前缩放因子
  const getScaleFactor = (): number => {
    switch (fontSize) {
      case "small":
        return 0.85;
      case "medium":
        return 1;
      case "large":
        return 1.15;
      default:
        return 1;
    }
  };

  // 计算缩放后的间距
  const getScaledSpacing = (baseSpacing: number): number => {
    const scaleFactor = getScaleFactor();

    return baseSpacing * scaleFactor;
  };

  // 计算缩放后的尺寸
  const getScaledSize = (baseSize: number): number => {
    const scaleFactor = getScaleFactor();

    return baseSize * scaleFactor;
  };

  // 计算缩放后的字体大小
  const getScaledFontSize = (baseFontSize: number): number => {
    const scaleFactor = getScaleFactor();

    return baseFontSize * scaleFactor;
  };

  // 获取响应式样式类名
  const getResponsiveClass = (
    type: "spacing" | "radius" | "gap",
    size:
      | "xs"
      | "sm"
      | "md"
      | "lg"
      | "xl"
      | "2xl"
      | "3xl"
      | "4xl"
      | "5xl"
      | "6xl",
  ): string => {
    switch (type) {
      case "spacing":
        return `spacing-${size}`;
      case "radius":
        return `rounded-${size}`;
      case "gap":
        return `gap-${size}`;
      default:
        return "";
    }
  };

  // 应用缩放样式到元素
  const applyScalingStyles = (element: HTMLElement) => {
    const scaleFactor = getScaleFactor();

    element.style.setProperty("--scale-factor", scaleFactor.toString());
  };

  // 布局容器样式
  const getContainerStyles = (): React.CSSProperties => {
    return {
      "--scale-factor": getScaleFactor(),
    } as React.CSSProperties;
  };

  // 组件间距样式
  const getComponentSpacingStyles = (
    size: "xs" | "sm" | "md" | "lg" | "xl" = "md",
  ): React.CSSProperties => {
    const scaleFactor = getScaleFactor();

    return {
      padding: `calc(var(--spacing-${size}) * ${scaleFactor})`,
      margin: `calc(var(--spacing-${size}) * ${scaleFactor})`,
      gap: `calc(var(--spacing-${size}) * ${scaleFactor})`,
      borderRadius: `calc(var(--radius-${size}) * ${scaleFactor})`,
    } as React.CSSProperties;
  };

  // 自适应布局类名
  const getAdaptiveLayoutClasses = (baseClasses: string = ""): string => {
    return `adaptive-layout-${fontSize} ${baseClasses}`.trim();
  };

  return {
    fontSize,
    scaleFactor: getScaleFactor(),
    getScaledSpacing,
    getScaledSize,
    getScaledFontSize,
    getResponsiveClass,
    applyScalingStyles,
    getContainerStyles,
    getComponentSpacingStyles,
    getAdaptiveLayoutClasses,
    // 便捷方法
    spacing: {
      xs: getScaledSpacing(4),
      sm: getScaledSpacing(8),
      md: getScaledSpacing(16),
      lg: getScaledSpacing(24),
      xl: getScaledSpacing(32),
      "2xl": getScaledSpacing(40),
      "3xl": getScaledSpacing(48),
      "4xl": getScaledSpacing(64),
      "5xl": getScaledSpacing(80),
      "6xl": getScaledSpacing(96),
    },
    sizes: {
      xs: getScaledSize(12),
      sm: getScaledSize(16),
      md: getScaledSize(20),
      lg: getScaledSize(24),
      xl: getScaledSize(28),
      "2xl": getScaledSize(32),
      "3xl": getScaledSize(36),
      "4xl": getScaledSize(40),
      "5xl": getScaledSize(48),
      "6xl": getScaledSize(56),
    },
    fontSizes: {
      xs: getScaledFontSize(12),
      sm: getScaledFontSize(14),
      base: getScaledFontSize(15),
      lg: getScaledFontSize(16),
      xl: getScaledFontSize(18),
      "2xl": getScaledFontSize(20),
      "3xl": getScaledFontSize(24),
      "4xl": getScaledFontSize(28),
      "5xl": getScaledFontSize(32),
      "6xl": getScaledFontSize(36),
      "7xl": getScaledFontSize(40),
      "8xl": getScaledFontSize(48),
      "9xl": getScaledFontSize(56),
    },
  };
}
