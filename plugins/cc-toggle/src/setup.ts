// @ts-nocheck ztools API 类型需逐步适配
import { refreshOnEnter } from './composables/useProviders';
import { useQuickSwitch } from './composables/useQuickSwitch';

export function setupDynamicCommands() {
  if (typeof ztools === 'undefined' || typeof ztools.onPluginEnter !== 'function') return;

  const quickSwitch = useQuickSwitch();

  ztools.onPluginEnter(({ code, type, payload }) => {
    // 设置插件视图高度（原 ztools pluginSetting.height）
    try {
      ztools.setExpendHeight(600);
    } catch (e) {}

    // 快速切换命令：ccs_switch_{appType}，打开插件并切到对应 Agent 页签
    if (code && code.startsWith('ccs_switch_')) {
      quickSwitch.executeSwitch(code);
      return;
    }

    if (!window.ztoolsCctoggle) return;

    // 进入插件：全量重注册快速切换命令（先清后注册，幂等）
    quickSwitch.reconcile();

    // 进入插件：重新应用已激活供应商并刷新列表
    refreshOnEnter();
  });
}
