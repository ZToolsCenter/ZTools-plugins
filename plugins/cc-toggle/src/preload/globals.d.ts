// preload 环境全局声明（tsconfig.preload 独立于前端，未引入 @types/node）
// preload 运行于 Node + Electron 预加载上下文，使用 CommonJS require

declare function require(moduleName: string): any;
