// 颜色格式类型
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'hsv';

// 颜色对象接口
export interface ColorObject {
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
  hsv: { h: number; s: number; v: number };
}

// 收藏的颜色项
export interface CollectedColor {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

// 渐变色配置
export interface GradientConfig {
  colors: string[];
  angle: number;
  type: 'linear' | 'radial';
}

// 渐变预设
export interface GradientPreset {
  name: string;
  colors: string[];
  angle?: number;
  category: string;
}

// UI色卡分类
export interface UIColorCategory {
  name: string;
  colors: string[];
}

// 传统色分类
export interface TraditionalColorCategory {
  name: string;
  title: string;
  colors: Array<{
    name: string;
    color: string;
    pinyin?: string;
  }>;
}

// 平台 API 类型声明
declare global {
  interface Window {
    platform?: {
      onPluginEnter: (callback: (action: { code: string; type: string; payload: any }) => void) => void;
      onPluginOut: (callback: () => void) => void;
      dbStorage: {
        getItem: (key: string) => any;
        setItem: (key: string, value: any) => void;
        removeItem: (key: string) => void;
      };
      copyText: (text: string) => void;
      copyImage: (base64: string) => void;
      showNotification: (title: string, body: string) => void;
      setSubInput: (callback: (data: { text: string }) => void, placeholder: string, isFocus: boolean) => void;
      removeSubInput: () => void;
      hideMainWindow: () => void;
      outPlugin: () => void;
      showSaveDialog: (options: {
        title: string;
        defaultPath: string;
        buttonLabel: string;
        filters: Array<{ extensions: string[]; name: string }>;
      }) => string | undefined;
      showOpenDialog: (options: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        properties?: string[];
      }) => string[] | undefined;
      shellShowItemInFolder: (path: string) => void;
      getPath: (name: string) => string;
      pickColor: () => string;
      screenColorPick: (callback: (result: { hex: string }) => void) => void;
      screenCapture: (callback: (data: string) => void) => void;
      db: {
        put: (doc: any) => any;
        get: (id: string) => any;
        remove: (id: string) => any;
      };
    };
    services?: {
      saveColorCard: (buffer: ArrayBuffer) => Promise<void>;
    };
    __platformNavigate?: ((path: string, state?: any) => void) | null;
    __platformSetInitialData?: ((data: any) => void) | null;
  }
}

export {};
