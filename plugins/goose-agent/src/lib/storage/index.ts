/**
 * 存储封装（ADR 0004：`ga:` / `goose-agent-*`，禁止 note 前缀）。
 */

export {
  STORAGE_PREFIX,
  STORAGE_NS_PREFIX,
  FORBIDDEN_STORAGE_PREFIXES,
  toPhysicalKey,
  toLogicalKey,
  assertAllowedStorageKey,
} from "./prefix";

export {
  createKeyedStorage,
  createZustandStorage,
  type ZustandStateStorage,
} from "./create-storage";
