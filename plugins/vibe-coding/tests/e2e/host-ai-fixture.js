/**
 * 在隔离的 ZTools 宿主数据中添加测试供应商和模型。
 * @param {(electronApp: unknown, urlFragment: string, source: string) => Promise<unknown>} executeInContents 设置页脚本执行函数。
 * @param {unknown} electronApp Electron 应用实例。
 * @param {string} settingsUrlFragment 设置插件 URL 片段。
 * @param {{name: string, apiUrl: string, apiKey: string, models: Array<Record<string, unknown>>}} input 测试供应商配置。
 * @returns {Promise<Record<string, unknown>>} 宿主供应商保存结果。
 * @throws {Error} 宿主拒绝配置或内部 AI 管理接口不可用时抛出。
 */
export async function addHostAiProvider(executeInContents, electronApp, settingsUrlFragment, input) {
  const payload = {
    name: String(input.name || 'ZVC E2E'),
    apiUrl: String(input.apiUrl || ''),
    apiKey: String(input.apiKey || ''),
    selectedModels: (Array.isArray(input.models) ? input.models : []).map((model) => ({
      modelId: String(model.modelId || ''),
      contextWindow: Number(model.contextWindow) || 262144,
      inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities : ['text'],
      reasoning: model.reasoning || {
        protocol: 'auto',
        efforts: { high: 'high' },
        defaultEffort: 'high',
        responseField: 'auto',
      },
    })),
  }
  // 凭据只进入本次测试的临时宿主目录，不写入插件状态或测试产物。
  const result = await executeInContents(
    electronApp,
    settingsUrlFragment,
    `window.ztools.internal.aiProviders.add(${JSON.stringify(payload)})`,
  )
  if (!result?.success) throw new Error(`宿主 AI 供应商配置失败：${result?.error || '未知错误'}`)
  return result
}

/**
 * 从 ZVC 可见的宿主模型中读取指定远端模型的不透明选择标识。
 * @param {(electronApp: unknown, urlFragment: string, source: string) => Promise<unknown>} executeInContents 插件页脚本执行函数。
 * @param {unknown} electronApp Electron 应用实例。
 * @param {string} pluginUrl 插件 URL 片段。
 * @param {string} modelId 远端模型 ID。
 * @returns {Promise<string>} 宿主生成的稳定模型标识。
 * @throws {Error} 目标模型不存在时抛出。
 */
export async function readHostModelKey(executeInContents, electronApp, pluginUrl, modelId) {
  const modelKey = await executeInContents(
    electronApp,
    pluginUrl,
    `(async () => {
      const models = await window.zvcBridge.getHostModels()
      return models.find((model) => model.modelId === ${JSON.stringify(modelId)})?.value || ''
    })()`,
  )
  if (!modelKey) throw new Error(`未找到宿主模型：${modelId}`)
  return String(modelKey)
}
