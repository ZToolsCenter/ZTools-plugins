/**
 * store 层出口 —— 在此组装 pinia、插件与宿主生命周期钩子，main.ts 只需 `use(pinia)`。
 *
 * 导出：
 * - pinia：全应用唯一实例，已注册 ztoolsPersist（自动持久化到宿主文档库）
 * - flushPersistedStores：退出前同步 flush 待写快照
 * - useMappingStore / useGroupStore / useLogStore：三张表的 store
 * - types：三张表的实体与 CRUD 入参（VO / CreateDTO / UpdateDTO / QueryDTO / 枚举）
 */
import { createPinia, type Pinia } from 'pinia';
import * as envApi from '../api/env';
import { createZtoolsPersist, flushPersistedStores } from './plugins/ztoolsPersist';

/** 全应用唯一 pinia 实例：插件集中在此组装 */
export const pinia: Pinia = createPinia();

// 自动持久化：store 声明 { persist: {...} } 即接入 ztools.db（dev 无宿主时退化为内存）
pinia.use(createZtoolsPersist());

// 退出插件（含进程被杀）前同步 flush，避免丢掉防抖窗口（200ms）内的最后一次改动
envApi.onOut(() => flushPersistedStores());

export { useMappingStore } from './mappingStore';
export { useGroupStore } from './groupStore';
export { useLogStore } from './logStore';
export { createZtoolsPersist, flushPersistedStores } from './plugins/ztoolsPersist';
export type { PersistOptions, ZtoolsPersistOptions } from './plugins/ztoolsPersist';
export * from './types';
