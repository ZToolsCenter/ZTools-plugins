/**
 * pinia 插件：把 store state 自动快照到宿主文档库（ztools.db），创建时自动水合。
 *
 * 用到的官方能力：
 * - 插件签名 `pinia.use(({ store, options }) => ...)`，每个 store 创建时执行一次；
 * - `store.$subscribe(cb, { detached: true, flush: 'sync' })` 监听状态变更（官方示例即用于持久化）；
 * - `store.$patch(saved)` 水合；
 * - 声明合并 `DefineStoreOptionsBase`，让 setup store 第三参可写 `{ persist: {...} }`；
 * - 声明合并 `PiniaCustomProperties`，为每个 store 注入 `$persist()` / `$hydrate()`。
 *
 * 读写快慢分离：
 * - 读（水合）同步：一次小文档读取，换取首帧不出现空表；
 * - 写（落库）异步 + 防抖：交互路径不阻塞 UI；
 * - 退出兜底同步：宿主 onPluginOut（含进程被杀）时走同步写，避免丢掉防抖窗口内的最后一次改动。
 *
 * 快照模式：一个 store 一个文档，_id = 'store:{key}'（key 默认 store.$id）。
 * 无宿主（pnpm dev 浏览器）时由 api/db 退化为内存 Map，零磁盘 IO。
 */
import type { PiniaPlugin, StateTree, StoreGeneric, _ActionsTree, _GettersTree } from 'pinia';
import * as dbApi from '../../api/db';

/** 快照文档集合名（_id 前缀） */
const COLLECTION = 'store';

/** 默认写库防抖毫秒：合并同一批变更，避免每改一个字段就写一次库 */
const DEFAULT_DEBOUNCE = 200;

/**
 * 已接管持久化的 store 的「同步 flush」函数集合。
 * pinia 4 没有 $onDisposed 钩子，且本应用的 store 与实例同生命周期，因此不做注销清理。
 */
const flushers = new Set<() => void>();

/** 单个 store 的持久化配置 */
export interface PersistOptions {
  /** 快照文档 key，默认 store.$id */
  key?: string;
  /** 只持久化这些 state 字段，缺省全量 */
  pick?: string[];
  /** 写库防抖毫秒，0 表示立即写 */
  debounce?: number;
  /** 水合前钩子 */
  beforeHydrate?: (store: StoreGeneric) => void;
  /** 水合后钩子 */
  afterHydrate?: (store: StoreGeneric) => void;
}

/** 插件全局配置 */
export interface ZtoolsPersistOptions {
  /** 未声明 persist 的 store 是否也持久化，默认 false（显式 opt-in） */
  auto?: boolean;
  /** 各 store 共用的默认配置 */
  defaults?: Omit<PersistOptions, 'key'>;
}

declare module 'pinia' {
  /** 让 defineStore 的 options（含 setup store 第三参）支持 persist 配置 */
  export interface DefineStoreOptionsBase<S extends StateTree, Store> {
    /** true = 全量持久化；对象 = 精细配置；false / 缺省 = 不持久化 */
    persist?: boolean | PersistOptions;
  }

  /** 插件为每个 store 注入的方法 */
  export interface PiniaCustomProperties<
    Id extends string = string,
    S extends StateTree = StateTree,
    G = _GettersTree<S>,
    A = _ActionsTree,
  > {
    /** 立即把当前 state 快照异步写库（取消防抖） */
    $persist: () => Promise<void>;
    /** 从库同步重新水合 state（等价「刷新」） */
    $hydrate: () => void;
  }
}

/** 把所有受管 store 的待写快照同步落库（宿主退出 / 进程被杀前调用） */
export function flushPersistedStores(): void {
  for (const flush of flushers) flush();
}

/** reactive 代理 → 纯 JSON 对象（宿主文档库只接受可 JSON 化的数据） */
function snapshot(state: StateTree, pick?: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of pick && pick.length > 0 ? pick : Object.keys(state)) {
    if (key in state) picked[key] = state[key];
  }
  return JSON.parse(JSON.stringify(picked)) as Record<string, unknown>;
}

/** 创建持久化插件：`pinia.use(createZtoolsPersist())` */
export function createZtoolsPersist(config: ZtoolsPersistOptions = {}): PiniaPlugin {
  return ({ store, options: storeOptions }) => {
    const declared = storeOptions.persist;
    if (declared === false) return;
    if (!declared && !config.auto) return;

    const settings: PersistOptions = {
      ...config.defaults,
      ...(typeof declared === 'object' ? declared : {}),
    };
    const key = settings.key ?? store.$id;
    const wait = settings.debounce ?? DEFAULT_DEBOUNCE;

    let timer: ReturnType<typeof setTimeout> | null = null;
    /** 水合期间的 $patch 会触发订阅，用该标记避免把刚读出来的数据又写回去 */
    let hydrating = false;

    const cancelTimer = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    /** 异步写库：交互路径 */
    const persist = (): Promise<void> => {
      cancelTimer();
      return dbApi.putDoc(COLLECTION, key, snapshot(store.$state, settings.pick));
    };

    /** 同步写库：退出路径，进程被杀也来得及落地 */
    const persistSync = (): void => {
      cancelTimer();
      dbApi.putDocSync(COLLECTION, key, snapshot(store.$state, settings.pick));
    };

    /** 水合：同步读库并 $patch 回 state */
    const hydrate = (): void => {
      hydrating = true;
      settings.beforeHydrate?.(store);
      try {
        const saved = dbApi.getDocSync<StateTree>(COLLECTION, key);
        if (saved) store.$patch(saved);
      } finally {
        hydrating = false;
        settings.afterHydrate?.(store);
      }
    };

    // detached：插件级订阅不随组件卸载而注销
    // flush: 'sync'：回调与变更同步执行，水合期的 hydrating 守卫才有效（否则会把刚读出的数据又写回一次）
    store.$subscribe(
      () => {
        if (hydrating) return;
        cancelTimer();
        if (wait <= 0) {
          void persist();
          return;
        }
        timer = setTimeout(() => {
          timer = null;
          void persist();
        }, wait);
      },
      { detached: true, flush: 'sync' }
    );

    hydrate();
    flushers.add(persistSync);

    return { $persist: persist, $hydrate: hydrate };
  };
}
