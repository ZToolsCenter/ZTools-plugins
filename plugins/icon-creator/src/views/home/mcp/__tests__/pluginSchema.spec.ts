import { describe, expect, it } from 'vitest'
// 测试文件位于 src/views/home/mcp/__tests__/，上跳 5 级即项目根目录；
// 通过 Vite 的 ?raw 导入把根目录契约文件以文本形式载入（项目未安装 @types/node，不引入 node:fs）。
import pluginManifestRaw from '../../../../../public/plugin.json?raw'
import userGuideRaw from '../../../../../USER_GUIDE.md?raw'
import { listOperationNames } from '../mcpOperations'

/** 本测试关注的 plugin.json 结构片段（其余字段忽略，按需裁剪以便断言缺失字段时报错可读）。 */
interface CommandDispatcherManifest {
  tools?: Record<string, {
    inputSchema?: {
      properties?: {
        operation?: { description?: string }
      }
    }
  }>
}

/**
 * 从 schema 描述文本解析“完整操作名列表：……。”段落中的操作名清单。
 * @param description plugin.json 中 operation 属性的 description 全文
 * @returns 操作名数组（保持原文顺序，去除空白项）
 */
function parseSchemaOperationNames(description: string): string[] {
  const marker = '完整操作名列表：'
  const start = description.indexOf(marker)
  if (start < 0) {
    throw new Error('plugin.json 的 operation.description 中找不到“完整操作名列表：”标记')
  }
  // 以“。”截断列表句子，再按逗号切分并逐项去空白
  const sentence = description.slice(start + marker.length).split('。')[0]
  return sentence.split(',').map((item) => item.trim()).filter(Boolean)
}

/**
 * 从 USER_GUIDE.md 全文解析“### 完整操作名列表”小节的操作名清单。
 * @param markdown 用户指南全文
 * @returns 小节标题后首个非空行按逗号切分得到的操作名数组
 */
function parseGuideOperationNames(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => line.trim() === '### 完整操作名列表')
  if (headingIndex < 0) {
    throw new Error('USER_GUIDE.md 中找不到“### 完整操作名列表”小节标题')
  }
  const listLine = lines.slice(headingIndex + 1).find((line) => line.trim() !== '')
  if (!listLine) {
    throw new Error('USER_GUIDE.md 的“### 完整操作名列表”小节下没有清单内容')
  }
  return listLine.split(',').map((item) => item.trim()).filter(Boolean)
}

/**
 * 双向比较两组操作名集合，返回可读差异描述。
 * @param sourceName 源集合的可读名称（用于差异文案）
 * @param source 源操作名数组
 * @param targetName 目标集合的可读名称
 * @param target 目标操作名数组
 * @returns 空数组表示两个集合完全一致，否则每项描述一个缺失或多余的 操作名
 */
function diffOperationNames(
  sourceName: string,
  source: string[],
  targetName: string,
  target: string[]
): string[] {
  const targetSet = new Set(target)
  const sourceSet = new Set(source)
  return [
    ...source.filter((name) => !targetSet.has(name)).map((name) => `${sourceName} 有而 ${targetName} 缺: ${name}`),
    ...target.filter((name) => !sourceSet.has(name)).map((name) => `${targetName} 有而 ${sourceName} 缺: ${name}`)
  ]
}

/** 读取 plugin.json 中 command_dispatcher 的 operation 描述文本，缺失时抛出可读错误。 */
function readSchemaOperationDescription(): string {
  const manifest = JSON.parse(pluginManifestRaw) as CommandDispatcherManifest
  const description = manifest.tools?.command_dispatcher?.inputSchema?.properties?.operation?.description
  if (!description) {
    throw new Error('plugin.json 中找不到 tools.command_dispatcher.inputSchema.properties.operation.description')
  }
  return description
}

describe('plugin.json schema / USER_GUIDE 与操作注册表一致性', () => {
  it('注册表与 plugin.json schema 的操作名集合双向一致', () => {
    const registryNames = listOperationNames().map((item) => item.name)
    const schemaNames = parseSchemaOperationNames(readSchemaOperationDescription())

    const diff = diffOperationNames('注册表', registryNames, 'plugin.json schema', schemaNames)
    expect(diff, `操作注册表与 plugin.json schema 不一致：\n${diff.join('\n')}`).toEqual([])
  })

  it('注册表、schema、USER_GUIDE 三方清单一致', () => {
    const registryNames = listOperationNames().map((item) => item.name)
    const guideNames = parseGuideOperationNames(userGuideRaw)
    const schemaNames = parseSchemaOperationNames(readSchemaOperationDescription())

    const diff = [
      ...diffOperationNames('注册表', registryNames, 'USER_GUIDE', guideNames),
      ...diffOperationNames('plugin.json schema', schemaNames, 'USER_GUIDE', guideNames)
    ]
    expect(diff, `操作清单三方比对不一致：\n${diff.join('\n')}`).toEqual([])
  })

  it('schema 与 USER_GUIDE 清单自身无重复操作名', () => {
    const schemaNames = parseSchemaOperationNames(readSchemaOperationDescription())
    const guideNames = parseGuideOperationNames(userGuideRaw)

    expect(new Set(schemaNames).size, 'plugin.json schema 的操作名清单存在重复项').toBe(schemaNames.length)
    expect(new Set(guideNames).size, 'USER_GUIDE 的操作名清单存在重复项').toBe(guideNames.length)
  })

  it('注册表中每个操作名都携带非空描述', () => {
    for (const item of listOperationNames()) {
      expect(typeof item.description, `操作 ${item.name} 的 description 应为字符串`).toBe('string')
      expect(item.description.trim().length, `操作 ${item.name} 的 description 不应为空`).toBeGreaterThan(0)
    }
  })
})
