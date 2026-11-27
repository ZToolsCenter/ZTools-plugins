// 大古快传的配置存取，与大古截图的密钥同一套规则：
// - 偏好（目标、下载目录、上次使用的目标、是否同步密钥）存成一个文档，放进 ZTools 的 dbStorage，没有时退回本地存储；
// - 密码单独存：本机副本始终写入，打开「同步密钥」后另外写一份随 ZTools 备份同步的副本。

import { normalizeConfig, pickPasswords, withPasswords } from './targets.js';
import { loadSecrets, saveSecrets } from '../shared/synced-secrets.js';

export const CONFIG_KEY = 'dagu-transfer/config';
export const SECRET_KEYS = Object.freeze({ local: 'dagu-transfer.secrets', synced: 'dagu-transfer/secrets' });

export function createConfigStore({ kv, key = CONFIG_KEY, secretKeys = SECRET_KEYS } = {}) {
  return {
    // 读出偏好，并把密码并到各个 SSH 目标上。
    async load() {
      const preferences = normalizeConfig(await kv.load(key));
      const secrets = await loadSecrets({ kv, keys: secretKeys, sync: preferences.syncSecrets, fallback: {} });
      return withPasswords(preferences, secrets.passwords);
    },
    // 只写偏好。流程记住「上次使用的目标」时用它：传进来的对象里即使带着密码，也不会被写进去。
    save(config) {
      return kv.save(key, normalizeConfig(config));
    },
    // 配置页「保存设置」：偏好和密码一起写入，密码按「同步密钥」开关决定要不要同步副本。
    async saveSettings(config) {
      const preferences = normalizeConfig(config);
      // 只保留合法目标的密码：填坏了的目标在归一化时已被丢弃，它的密码不该留下来。
      const entered = new Map(
        (Array.isArray(config?.targets) ? config.targets : [])
          .filter((target) => target && typeof target === 'object')
          .map((target) => [target.id, target])
      );
      const secrets = {
        passwords: pickPasswords({
          targets: preferences.targets.map((target) => ({ ...target, password: entered.get(target.id)?.password }))
        })
      };
      const saved = await kv.save(key, preferences);
      await saveSecrets({ kv, keys: secretKeys, secrets, sync: preferences.syncSecrets });
      return saved;
    }
  };
}
