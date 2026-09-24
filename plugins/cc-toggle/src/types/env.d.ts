/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

export {};

// Vite 自定义环境变量
declare global {
  interface ImportMetaEnv {
    /** 开发目标：ztools（默认）| browser */
    VITE_DEV_TARGET?: string;
  }

  interface Window {
    ztoolsCctoggle?: import('./ztools-cctoggle').ZtoolsCctoggle;
  }
}
