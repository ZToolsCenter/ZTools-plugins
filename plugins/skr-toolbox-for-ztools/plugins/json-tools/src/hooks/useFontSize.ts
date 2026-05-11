import { useEffect } from "react";

import { useSettingsStore } from "@/store/useSettingsStore";
import { generateFontSizeCSSVariables } from "@/styles/fontSize";

/**
 * 全局字体大小管理器
 * 监听字体大小设置的变化，并动态应用相应的CSS变量
 */
export function useFontSizeManager() {
  const fontSize = useSettingsStore((state) => state.fontSize);

  useEffect(() => {
    // 创建或更新样式元素
    let styleElement = document.getElementById(
      "dynamic-font-size-styles",
    ) as HTMLStyleElement;

    if (!styleElement) {
      styleElement = document.createElement("style");
      styleElement.id = "dynamic-font-size-styles";
      document.head.appendChild(styleElement);
    }

    // 生成并应用字体大小CSS变量
    const css = generateFontSizeCSSVariables(fontSize);

    styleElement.textContent = css;

    // 可选：在字体大小改变时触发自定义事件
    window.dispatchEvent(
      new CustomEvent("fontSizeChanged", { detail: { fontSize } }),
    );

    return () => {
      // 清理函数（如果需要的话）
      if (styleElement) {
        styleElement.remove();
      }
    };
  }, [fontSize]);

  return { fontSize };
}

/**
 * 字体大小切换Hook
 * 提供字体大小切换的便捷方法
 */
export function useFontSizeToggle() {
  const fontSize = useSettingsStore((state) => state.fontSize);
  const setFontSize = useSettingsStore((state) => state.setFontSize);

  const cycleFontSize = () => {
    const sizes: Array<"small" | "medium" | "large"> = [
      "small",
      "medium",
      "large",
    ];
    const currentIndex = sizes.indexOf(fontSize);
    const nextIndex = (currentIndex + 1) % sizes.length;

    setFontSize(sizes[nextIndex]);
  };

  return {
    fontSize,
    setFontSize,
    cycleFontSize,
    isSmall: fontSize === "small",
    isMedium: fontSize === "medium",
    isLarge: fontSize === "large",
  };
}
