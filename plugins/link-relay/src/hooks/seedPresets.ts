/**
 * 出厂预设首启实例化：把 src/assets/config.json 的模板转成 store 的 CreateDTO。
 * - 模板字段与 store 三张表的 CreateDTO 对齐；模板不写 id/createdAt（由 store 生成）。
 * - groupKey 仅用于把映射挂到本次新建的分组：调用方先 create 分组拿到 id，
 *   再用 idOf(groupKey) 解析出每行 groupId。
 * - sourcePath 的 %ENV%/~ 在实例化时经 api/dir.expandPath 展开为绝对路径；
 *   宿主调用仍只允许出现在 api 层，这里只调用 dirApi，不直接碰 window.services。
 */
import type { GroupCreateDTO } from '../store/types/group';
import type { MappingCreateDTO } from '../store/types/mapping';
import { expandPath } from '../api/dir';
import presetConfig from '../assets/config.json';

/** config.json 中分组模板（key 为实例化期的临时关联键） */
export interface PresetGroupTpl {
  key: string;
  name: string;
}

/** config.json 中映射模板：MappingCreateDTO 字段 + groupKey 关联键 */
export interface PresetMappingTpl extends MappingCreateDTO {
  groupKey: string;
}

interface PresetConfig {
  version: number;
  groups: PresetGroupTpl[];
  mappings: PresetMappingTpl[];
}

const config = presetConfig as PresetConfig;

/** 分组 CreateDTO 列表（仅 name，enabled/id/createdAt 由 groupStore 生成） */
export function presetGroupDTOs(): GroupCreateDTO[] {
  return config.groups.map((g) => ({ name: g.name }));
}

/** 保留 key 的分组模板，供调用方建立 groupKey -> 新建分组 id 的映射 */
export function presetGroupKeys(): PresetGroupTpl[] {
  return config.groups.map((g) => ({ key: g.key, name: g.name }));
}

/**
 * 映射 CreateDTO 列表。
 * @param idOf 由 groupKey 解析出已创建分组的真实 id（未匹配则归入未分组 ''）
 */
export function presetMappingDTOs(idOf: (groupKey: string) => string): MappingCreateDTO[] {
  return config.mappings.map((m) => {
    const { groupKey, ...dto } = m;
    return {
      ...dto,
      groupId: idOf(groupKey),
      sourcePath: expandPath(m.sourcePath),
      exeNames: m.exeNames ?? [],
      cachePatterns: m.cachePatterns ?? [],
    };
  });
}
