import { loadRecent, loadRecentDetailed } from './src/loader/vscode-stable';
import {
  configureWindowsCodeExecutable,
  openInVSCode,
  type WindowsCodeConfigurationResult,
} from './src/launcher/vscode-stable';
import type { RecentItem, OpenResult } from './src/types';
import type { LoadDiagnostic } from './src/loader/vscode-stable';

// 类型补丁，前端可用
declare global {
  interface Window {
    recentApi: {
      platform: NodeJS.Platform;
      list(): Promise<RecentItem[]>;
      open(item: RecentItem): Promise<OpenResult>;
      diagnose(): Promise<{ items: RecentItem[]; diag: LoadDiagnostic }>;
      configureWindowsExecutable(): Promise<WindowsCodeConfigurationResult>;
    };
    Fuse: any;
  }
}

(window as any).recentApi = {
  platform: process.platform,
  list: () => loadRecent(),
  open: (item: RecentItem) => openInVSCode(item),
  diagnose: () => loadRecentDetailed(),
  configureWindowsExecutable: async () => configureWindowsCodeExecutable(),
};

// fuse.js 转发给前端（前端不能 require）。fuse.js v7 commonjs 入口暴露 default。
const FuseModule = require('fuse.js');
(window as any).Fuse = FuseModule.default ?? FuseModule;
