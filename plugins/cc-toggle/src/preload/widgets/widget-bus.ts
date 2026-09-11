// ZTools ccToggle - widgets/widget-bus.ts
// 小组件侧事件总线订阅器：订阅主窗口广播的业务事件
// 主窗口侧发布见 WidgetManager.broadcast（遍历窗口句柄发送）

import { WIDGET_BUS_CHANNEL } from './widget-events';

const { ipcRenderer } = require('electron') as {
  ipcRenderer: { on: (ch: string, cb: (event: any, ...args: any[]) => void) => void };
};

const handlers: Record<string, Array<(data?: any) => void>> = {};
let bound = false;

function ensureBound(): void {
  if (bound) return;
  bound = true;
  ipcRenderer.on(WIDGET_BUS_CHANNEL, function (_event: any, channel: string, data: any) {
    const list = handlers[channel];
    if (!list) return;
    list.slice().forEach(function (cb) {
      try {
        cb(data);
      } catch (e) {}
    });
  });
}

/** 订阅某个业务事件通道（如 PROVIDER_SWITCHED），回调收 data */
export function onWidgetEvent(channel: string, cb: (data?: any) => void): void {
  ensureBound();
  (handlers[channel] = handlers[channel] || []).push(cb);
}
