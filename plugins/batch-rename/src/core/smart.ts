import type { FileItem } from './session'

export const SMART_BATCH_SIZE = 50
export const SMART_FILE_LIMIT = 500

export function buildSmartMessages(files: FileItem[], prompt: string) {
  return [
    { role: 'system' as const, content: '你是批量文件重命名助手。仅根据给出的文件名和元数据生成目标文件名，不执行文件操作。只返回 JSON 数组，每项格式为 {"id":数字,"name":"完整文件名"}。必须逐项覆盖输入，id 不得重复，保留每个文件的原扩展名，不包含路径。' },
    { role: 'user' as const, content: JSON.stringify({ instruction: prompt, files: files.map((file, id) => ({
      id, name: file.currentName, size: file.size, createdAt: file.createdAt, modifiedAt: file.modifiedAt
    })) }) }
  ]
}

export function parseSmartNames(content: unknown, files: FileItem[]): Record<string, string> {
  if (typeof content !== 'string') throw new Error('模型没有返回文本')
  const body = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let entries: unknown
  try { entries = JSON.parse(body) } catch { throw new Error('模型返回的不是有效 JSON') }
  if (!Array.isArray(entries) || entries.length !== files.length) throw new Error('模型返回的文件数量与请求不一致')
  const names: Record<string, string> = {}
  const seen = new Set<number>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new Error('模型返回项格式无效')
    const { id, name } = entry as Record<string, unknown>
    if (!Number.isInteger(id) || (id as number) < 0 || (id as number) >= files.length || seen.has(id as number)) {
      throw new Error('模型返回了重复或无效的文件编号')
    }
    const file = files[id as number]
    if (typeof name !== 'string' || !name.trim() || name !== name.trim() ||
      name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name) || !name.endsWith(file.extension)) {
      throw new Error(`文件 ${file.currentName} 的建议名称无效或扩展名已改变`)
    }
    seen.add(id as number)
    names[file.id] = name
  }
  return names
}
