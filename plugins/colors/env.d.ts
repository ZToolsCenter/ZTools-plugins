/// <reference types="@ztools-center/ztools-api-types" />
// src/shims.d.ts

// CSS 相关
declare module "*.css";
declare module "*.module.css";
declare module "*.scss";
declare module "*.sass";
declare module "*.less";

// 图片 & 字体
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.gif";
declare module "*.svg";
declare module "*.webp";
declare module "*.woff";
declare module "*.woff2";

// Vue 单文件组件（有时需要）
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineAssistantComponent;
  export default component;
}

// 通用兜底（谨慎使用）
declare module "*";
