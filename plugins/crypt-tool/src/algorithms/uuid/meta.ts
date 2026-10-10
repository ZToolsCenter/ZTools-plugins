import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'uuid',
  category: 'tools',
  label: 'UUID',
  title: 'UUID 生成器',
  reversible: false,
  cmds: ['uuid', 'uuidgen'],
  defaultEnabled: true,
  teach: {
    summary:
      'UUID（通用唯一识别码）是 128 位标识符，用于分布式系统中无中心化生成唯一 ID。v4 为完全随机，v7 基于时间戳（UUIDv7，RFC 9562 草案）支持时间排序，适合数据库主键场景。'
  }
}
