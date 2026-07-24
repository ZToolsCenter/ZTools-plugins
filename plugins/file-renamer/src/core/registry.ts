import type { PluginActionDefinition } from './types';

/**
 * 内部注册表类，管理所有可用的插件。
 * 提供集中式的注册和查找功能。
 */
class PluginRegistry {
  /** 内部Map，按唯一ID存储插件 */
  private plugins: Map<string, PluginActionDefinition> = new Map();

  /**
   * 在注册表中注册一个新插件。
   * @param plugin - 要注册的插件定义
   */
  register(plugin: PluginActionDefinition) {
    if (this.plugins.has(plugin.id)) {
      console.warn(`Plugin with id ${plugin.id} is already registered.`);
      return;
    }
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * 通过唯一标识符获取插件。
   * @param id - 要查找的插件ID
   * @returns 找到则返回插件定义，否则返回undefined
   */
  get(id: string): PluginActionDefinition | undefined {
    return this.plugins.get(id);
  }

  /**
   * 获取所有已注册的插件。
   * @returns 所有已注册插件定义的数组
   */
  getAll(): PluginActionDefinition[] {
    return Array.from(this.plugins.values());
  }
}

/** 插件注册表的单例实例 */
export const registry = new PluginRegistry();
