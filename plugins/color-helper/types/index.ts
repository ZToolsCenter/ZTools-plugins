// 颜色数据模型
//
// 与 data/*.json 的实际形状一一对应(已逐一核对, 见各注释)。
// 注意: tsconfig 开启了 resolveJsonModule, JSON 推断为字面量类型,
// 因此结构不符不会在编译期报错 —— 必须靠这里的接口约束住,
// 各页面通过 `as unknown as Xxx[]` 显式声明形状后再消费。

/** 渐变色预设 —— data/gradients-*.json 的实际形状: 颜色数组的数组(无 name/angle/category) */
export type GradientPreset = string[];

/** Material Design 色板 —— data/ui-material-design.json: 14 槽(10 主色 + A100~A400, 部分色系无强调色时为空串) */
export interface MaterialColorCategory {
  title: string;
  colors: string[];
}

/** 通用 UI 色板 —— data/ui-ant-design.json / ui-open-color.json / ui-fluent.json */
export interface UIColorCategory {
  title: string;
  colors: string[];
  /** 仅 ant-design 提供, 作者标注(如"平稳、中态"), 界面暂未展示 */
  description?: string;
}

/** Flat UI 色板 —— data/ui-flat-ui.json: 每槽为一组色阶(6 个字符串), 不是单个色值 */
export interface FlatUIColorCategory {
  title: string;
  colors: string[][];
}

/** 中国传统色分组 —— data/traditional-china.json: { title, colors: [{name,color}] } */
export interface ChinaColorCategory {
  title: string;
  colors: Array<{ name: string; color: string }>;
}

/** 日本传统色条目 —— data/traditional-japan.json: 扁平列表, 额外带日语假名 */
export interface JapanColorItem {
  name: string;
  color: string;
  jname: string;
}

/** 官方 getPath 允许的路径名 */
export type PlatformPathName =
  | 'home' | 'appData' | 'userData' | 'cache' | 'temp' | 'exe' | 'module'
  | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
  | 'logs' | 'pepperFlashSystemPlugin';

// 平台 API 类型声明
//
// 手写声明, 权威依据是官方 ztools.api.d.ts (@ztools-center/ztools-api-types)。
// 只声明本项目实际用到的成员, 未用到的部分请直接对照官方 d.ts。
//
// 改动前请先核对官方 d.ts 与宿主实现, 不要凭印象改签名。
declare global {
  /** 官方 DbDoc: 文档必须带 _id, _rev 由平台维护 */
  interface PlatformDbDoc { _id: string; _rev?: string; [k: string]: any }

  /** 官方 DbReturn —— db.put / db.remove 的同步返回 */
  interface PlatformDbReturn {
    id: string;
    rev?: string;
    ok?: boolean;
    error?: boolean;
    name?: string;
    message?: string;
  }

  /** onPluginEnter 回调的 action */
  interface PlatformEnterAction {
    code: string;
    type: string;
    payload: any;
    option?: any;
  }

  interface Window {
    platform?: {
      onPluginEnter: (callback: (action: PlatformEnterAction) => void) => void;
      /** 回调参数是 processExit(进程是否退出) */
      onPluginOut: (callback: (processExit: boolean) => void) => void;
      dbStorage: {
        getItem: (key: string) => any;
        setItem: (key: string, value: any) => void;
        removeItem: (key: string) => void;
      };
      copyText: (text: string) => boolean;
      /** img 可以是 base64 dataURL、Uint8Array 或图片路径 */
      copyImage: (img: string | Uint8Array) => boolean;
      /** 第一参是通知正文, featureName 用于标识来源功能 */
      showNotification: (body: string, featureName?: string) => void;
      setSubInput: (
        onChange: (input: { text: string }) => void,
        placeholder?: string,
        isFocus?: boolean,
      ) => boolean;
      removeSubInput: () => boolean;
      hideMainWindow: (isRestorePreWindow?: boolean) => boolean;
      showMainWindow: () => boolean;
      outPlugin: (isKill?: boolean) => boolean;
      /** 宿主侧为异步弹窗, 返回值可能为 undefined, 调用方需容错 */
      showSaveDialog: (options: {
        title?: string;
        defaultPath?: string;
        buttonLabel?: string;
        filters?: Array<{ extensions: string[]; name: string }>;
        properties?: string[];
      }) => string | undefined;
      /** 宿主侧为异步弹窗, 返回值可能为 undefined, 调用方需容错 */
      showOpenDialog: (options: {
        title?: string;
        defaultPath?: string;
        buttonLabel?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        properties?: string[];
      }) => string[] | undefined;
      shellShowItemInFolder: (fullPath: string) => void;
      getPath: (name: PlatformPathName) => string;
      screenColorPick: (callback: (color: { hex: string; rgb: string }) => void) => void;
      /** imgBase64 是 data URL; bounds 仅 Windows / Linux 有值, macOS 为 undefined */
      screenCapture: (
        callback: (imgBase64: string, bounds?: { x: number; y: number; width: number; height: number }) => void,
      ) => void;
      db: {
        put: (doc: PlatformDbDoc) => PlatformDbReturn;
        get: (id: string) => PlatformDbDoc | null;
        remove: (doc: string | PlatformDbDoc) => PlatformDbReturn;
        allDocs: (key?: string) => PlatformDbDoc[];
      };
      /** model 留空时由宿主选用用户已配置的默认模型 */
      ai: (option: {
        model?: string;
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content?: string }>;
      }) => Promise<{ role: string; content?: string; reasoning_content?: string; abort?: () => void }>;
      /** 列出用户已配置的模型, 其 id / value 可回传给 ai() 的 model */
      allAiModels: () => Promise<Array<{ id: string; label: string; description: string; icon: string; cost: number }>>;
    };
    services?: {
      saveColorCard: (buffer: ArrayBuffer) => Promise<void>;
    };
    __platformNavigate?: ((path: string, state?: any) => void) | null;
    __platformSetInitialData?: ((data: any) => void) | null;
  }
}

export {};
