// ZTools ccToggle - widgets/widget-events.ts
// 主窗口 ↔ 小组件 事件总线：通道常量注册表
// 新增需要实时同步的"数据变更"时，在此注册通道并在主窗口发布 / 小组件订阅

// 底层固定 IPC 通道（承载所有业务事件，按 channel 字段分发）
export const WIDGET_BUS_CHANNEL = 'cctoggle:event';

export const WidgetEvent = {
  /** 供应商已切换（主窗口 switchProvider 成功后广播） */
  PROVIDER_SWITCHED: 'cctoggle:provider-switched',
  /** 供应商已更新（主窗口 saveProvider 成功后广播，如开启/修改余额配置） */
  PROVIDER_UPDATED: 'cctoggle:provider-updated',
  /** 余额已刷新（主窗口 queryBalance 成功后广播） */
  BALANCE_REFRESHED: 'cctoggle:balance-refreshed'
};
