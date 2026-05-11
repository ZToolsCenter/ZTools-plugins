import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

import { Json5LanguageDef } from "@/components/monacoEditor/MonacoLanguageDef.tsx";
import { registerBase64HoverProvider } from "@/components/monacoEditor/decorations/base64Decoration.ts";
import { registerUnicodeHoverProvider } from "@/components/monacoEditor/decorations/unicodeDecoration.ts";
import { registerUrlHoverProvider } from "@/components/monacoEditor/decorations/urlDecoration.ts";

/**
 * Monaco编辑器全局初始化状态管理
 *
 * 这个模块负责Monaco编辑器的全局初始化，包括：
 * 1. Monaco编辑器核心初始化
 * 2. JSON5语言支持注册
 * 3. Base64、Unicode、URL悬停提供者的全局注册
 * 4. 图片URL正则表达式定义（供其他模块使用）
 *
 * 通过集中管理这些初始化逻辑，避免了在每个编辑器实例创建时重复注册，
 * 提高了性能并减少了内存占用。
 */

// 全局Monaco初始化状态
let isInitialized = false;
let baseProviderRegistered = false;


/**
 * 初始化Monaco编辑器全局配置
 * @returns 初始化后的Monaco实例
 */
export const initMonacoGlobally = async () => {
  if (isInitialized) return;

  console.log("Initializing Monaco editor globally");

  // 配置Monaco加载器
  loader.config({ monaco });

  // 初始化Monaco实例
  const monacoInstance = await loader.init();

  // 注册JSON5语言支持
  if (
    !monacoInstance.languages.getLanguages().some((lang) => lang.id === "json5")
  ) {
    monacoInstance.languages.register({ id: "json5" });
    monacoInstance.languages.setMonarchTokensProvider(
      "json5",
      Json5LanguageDef,
    );
  }

  isInitialized = true;

  return monacoInstance;
};

/**
 * 注册Base64、Unicode、URL全局悬停提供者
 * 这些提供者将在所有JSON和JSON5编辑器中共享使用
 */
export const registerGlobalBase64Provider = () => {
  if (baseProviderRegistered) return;

  // 注册全局Base64悬停提供者
  registerBase64HoverProvider();

  // 注册全局Unicode悬停提供者
  registerUnicodeHoverProvider();

  // 注册全局URL悬停提供者
  registerUrlHoverProvider();

  baseProviderRegistered = true;
};
