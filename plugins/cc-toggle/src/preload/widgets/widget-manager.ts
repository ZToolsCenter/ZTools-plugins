// ZTools ccToggle - widgets/widget-manager.ts
// 桌面小组件管理器：窗口生命周期
// 小组件设置不持久化（会话级，存于小组件窗口内存）；置顶通过 sendToParent 通知主窗口应用

import { WIDGET_BUS_CHANNEL } from './widget-events';

interface WidgetDef {
  id: string;
  title: string;
  html: string;
  preload: string;
  defaultSize: { width: number; height: number };
}

const WIDGETS: WidgetDef[] = [
  {
    id: 'status',
    title: '当前供应商余额',
    html: 'preload/widgets/status/status.html',
    preload: 'preload/widgets/status/status-preload.js',
    defaultSize: { width: 260, height: 190 }
  }
];

// 本 preload 实例创建的窗口句柄（key: widgetId，内存态）
const _wins: Record<string, any> = {};
// 孤儿窗口清理轮询定时器
const _timers: Record<string, any> = {};

export class WidgetManager {
  static listWidgets(): Array<{ id: string; title: string }> {
    return WIDGETS.map(function (w) {
      return { id: w.id, title: w.title };
    });
  }

  static getStates(): Record<string, { open: boolean }> {
    const out: Record<string, { open: boolean }> = {};
    WIDGETS.forEach(function (w) {
      out[w.id] = { open: WidgetManager.isOpen(w.id) };
    });
    return out;
  }

  static isOpen(id: string): boolean {
    const win = _wins[id];
    // 已销毁的窗口即时视为关闭（不等 2s 轮询清理），避免 × 关闭后按钮状态滞后
    return !!win && !(win.isDestroyed && win.isDestroyed());
  }

  static open(id: string): { success: boolean; error?: string } {
    const def = WIDGETS.find(function (w) {
      return w.id === id;
    });
    if (!def) return { success: false, error: 'unknown widget: ' + id };

    // 已存在则聚焦
    if (_wins[id]) {
      try {
        _wins[id].show();
        if (_wins[id].focus) _wins[id].focus();
      } catch (e) {}
      return { success: true };
    }

    try {
      const win = ztools.createBrowserWindow(
        def.html,
        {
          width: def.defaultSize.width,
          height: def.defaultSize.height,
          show: true,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          thickFrame: false,
          hasShadow: false,
          roundedCorners: false,
          alwaysOnTop: false,
          skipTaskbar: true,
          // 固定尺寸：Windows 透明窗口开启 resizable 会导致透明失效，圆角外露出不透明底
          resizable: false,
          movable: true,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          webPreferences: { preload: def.preload, zoomFactor: 1 }
        },
        function () {
          // 清理自关闭的孤儿窗口
          if (_timers[id]) clearInterval(_timers[id]);
          _timers[id] = setInterval(function () {
            try {
              const w = _wins[id];
              if (!w) return;
              if (w.isDestroyed && w.isDestroyed()) {
                delete _wins[id];
                if (_timers[id]) {
                  clearInterval(_timers[id]);
                  delete _timers[id];
                }
              }
            } catch (e) {}
          }, 2000);
        }
      );
      // createBrowserWindow 失败返回 null（见 ZTools API 文档）
      if (!win) return { success: false, error: 'createBrowserWindow 返回 null' };
      _wins[id] = win;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e && e.message ? e.message : String(e) };
    }
  }

  static close(id: string): { success: boolean; error?: string } {
    if (_timers[id]) {
      clearInterval(_timers[id]);
      delete _timers[id];
    }
    const win = _wins[id];
    if (win) {
      try {
        win.close();
      } catch (e) {}
      delete _wins[id];
    }
    return { success: true };
  }

  static toggle(id: string): { success: boolean; error?: string } {
    if (WidgetManager.isOpen(id)) return WidgetManager.close(id);
    return WidgetManager.open(id);
  }

  /** 应用置顶状态（由主窗口收到小组件 sendToParent 通知后调用） */
  static setAlwaysOnTop(id: string, value: boolean): void {
    const win = _wins[id];
    if (win && win.setAlwaysOnTop) {
      try {
        win.setAlwaysOnTop(!!value);
      } catch (e) {}
    }
  }

  /** 主窗口 → 小组件 事件广播：向所有存活的窗口发送业务事件（见 widget-events.ts） */
  static broadcast(channel: string, data?: any): void {
    Object.keys(_wins).forEach(function (id) {
      const w = _wins[id];
      if (!w || (w.isDestroyed && w.isDestroyed())) return;
      try {
        w.webContents.send(WIDGET_BUS_CHANNEL, channel, data);
      } catch (e) {}
    });
  }
}
