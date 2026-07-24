import { useEffect, useRef, useState } from "react";

import {
  initMonacoGlobally,
  registerGlobalBase64Provider,
} from "@/components/monacoEditor/decorations/decorationInit.ts";

/**
 * Monaco 编辑器懒初始化状态
 *
 * 单例模式：全局只初始化一次，多次调用共享同一个 Promise。
 * 避免路由切换或组件重建时重复初始化。
 */
let initPromise: Promise<void> | null = null;

function ensureMonacoInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initMonacoGlobally()
      .then(() => {
        registerGlobalBase64Provider();
      })
      .catch((error) => {
        console.error("Monaco 初始化失败:", error);
        // 重置以便重试
        initPromise = null;
        throw error;
      });
  }
  return initPromise;
}

/**
 * React Hook：延迟初始化 Monaco 编辑器
 *
 * 组件挂载时触发 Monaco 初始化，初始化完成后 monacoReady = true。
 * 使用全局单例保证只初始化一次。
 *
 * @returns monacoReady - Monaco 是否已初始化完成
 */
export function useMonacoInit(): boolean {
  const [monacoReady, setMonacoReady] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    ensureMonacoInitialized().then(() => {
      if (mounted.current) {
        setMonacoReady(true);
      }
    });

    return () => {
      mounted.current = false;
    };
  }, []);

  return monacoReady;
}
