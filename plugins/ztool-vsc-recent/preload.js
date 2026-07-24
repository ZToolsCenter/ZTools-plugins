"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_stable_1 = require("./src/loader/vscode-stable");
const vscode_stable_2 = require("./src/launcher/vscode-stable");
window.recentApi = {
    platform: process.platform,
    list: () => (0, vscode_stable_1.loadRecent)(),
    open: (item) => (0, vscode_stable_2.openInVSCode)(item),
    diagnose: () => (0, vscode_stable_1.loadRecentDetailed)(),
    configureWindowsExecutable: async () => (0, vscode_stable_2.configureWindowsCodeExecutable)(),
};
// fuse.js 转发给前端（前端不能 require）。fuse.js v7 commonjs 入口暴露 default。
const FuseModule = require('fuse.js');
window.Fuse = FuseModule.default ?? FuseModule;
