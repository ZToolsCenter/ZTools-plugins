import { useEffect, useRef } from "react";

// 默认下拉菜单超时时间
export const DEFAULT_DROPDOWN_TIMEOUT = 300;

/**
 * 创建用于管理下拉菜单超时的hook
 * 提供创建超时、清除特定超时和清除所有超时的功能
 */
export const useDropdownTimeout = () => {
  const timeoutRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  /**
   * 创建一个新的超时
   * @param key 超时的唯一标识符
   * @param callback 超时后执行的回调函数
   * @param delay 延迟时间(毫秒)
   */
  const createTimeout = (key: string, callback: () => void, delay: number) => {
    if (timeoutRef.current[key]) {
      clearTimeout(timeoutRef.current[key]);
    }
    timeoutRef.current[key] = setTimeout(callback, delay);
  };

  /**
   * 清除指定标识符的超时
   * @param key 超时的唯一标识符
   */
  const clearTimeoutByKey = (key: string) => {
    if (timeoutRef.current[key]) {
      clearTimeout(timeoutRef.current[key]);
      delete timeoutRef.current[key];
    }
  };

  /**
   * 清除所有超时
   */
  const clearTimeouts = () => {
    Object.values(timeoutRef.current).forEach((timeout) => {
      clearTimeout(timeout);
    });
    timeoutRef.current = {};
  };

  // 组件卸载时自动清除所有超时
  useEffect(() => {
    return () => {
      clearTimeouts();
    };
  }, []);

  return { createTimeout, clearTimeoutByKey, clearTimeouts };
}; 