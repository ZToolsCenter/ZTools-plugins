'use strict'

/* eslint-disable @typescript-eslint/no-require-imports -- Electron 插件 preload 由 CommonJS 运行时加载。 */

const { ipcRenderer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_TEMPLATES = new Set(['vue-vite', 'react-vite'])
const PROJECT_NAME_PATTERN = /^[a-z0-9-]+$/

/**
 * 将捕获的异常转换为界面可展示的错误文本。
 * @param {unknown} error 捕获的异常值
 * @returns {string} 可展示的错误文本
 */
function formatError(error) {
  return error instanceof Error ? error.message : '创建项目失败'
}

/**
 * 定位开发目录或市场 ASAR 配套目录中的物理模板路径。
 * @param {'vue-vite'|'react-vite'} template 模板名称
 * @returns {string|null} 模板物理路径，不存在时返回 null
 */
function resolveTemplateDir(template) {
  const candidates = [path.join(`${__dirname}.unpacked`, template), path.join(__dirname, template)]

  // 优先读取市场安装时生成的物理目录，开发态再读取源码目录。
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

/**
 * 用表单元数据替换模板内的插件配置占位符。
 * @param {string} projectDir 已复制完成的新项目目录
 * @param {{name:string,title:string,description?:string,platform?:string[],author?:string}} params 插件元数据
 * @returns {Promise<string>} 更新后的 plugin.json 绝对路径
 */
async function updateProjectMetadata(projectDir, params) {
  const pluginJsonPath = path.join(projectDir, 'src-ztools', 'plugin.json')
  const packageJsonPath = path.join(projectDir, 'package.json')

  // 先写入插件展示信息，再注入平台字段以保持合法 JSON。
  let pluginJson = await fs.promises.readFile(pluginJsonPath, 'utf-8')
  pluginJson = pluginJson
    .replace(/\{\{PLUGIN_NAME\}\}/g, params.name)
    .replace(/\{\{PLUGIN_TITLE\}\}/g, params.title)
    .replace(/\{\{DESCRIPTION\}\}/g, params.description || '')
    .replace(/\{\{AUTHOR\}\}/g, params.author || '')
  if (Array.isArray(params.platform) && params.platform.length > 0) {
    const parsedPlugin = JSON.parse(pluginJson)
    parsedPlugin.platform = params.platform
    pluginJson = JSON.stringify(parsedPlugin, null, 2)
  }
  await fs.promises.writeFile(pluginJsonPath, pluginJson, 'utf-8')

  // package.json 只替换项目标识与描述占位符。
  let packageJson = await fs.promises.readFile(packageJsonPath, 'utf-8')
  packageJson = packageJson
    .replace(/\{\{PROJECT_NAME\}\}/g, params.name)
    .replace(/\{\{DESCRIPTION\}\}/g, params.description || '')
  await fs.promises.writeFile(packageJsonPath, packageJson, 'utf-8')

  return pluginJsonPath
}

/**
 * 从插件自带模板创建并导入一个开发项目。
 * @param {{template:'vue-vite'|'react-vite',projectPath:string,name:string,title:string,description?:string,platform?:string[],author?:string}} params 创建项目所需参数
 * @returns {Promise<{success:boolean,pluginName?:string,error?:string}>} 创建及导入结果
 */
async function scaffoldDevProject(params) {
  let projectDir = ''
  let projectCreated = false

  try {
    // 在接触目标文件系统前阻止未知模板及越界项目名。
    if (!PROJECT_TEMPLATES.has(params?.template)) {
      throw new Error(`不支持的项目模板: ${params?.template || ''}`)
    }
    if (!PROJECT_NAME_PATTERN.test(params?.name || '')) {
      throw new Error('应用 ID 仅允许小写字母、数字和中划线')
    }
    if (!params?.projectPath || !params?.title) {
      throw new Error('项目位置和插件标题不能为空')
    }

    const templateDir = resolveTemplateDir(params.template)
    if (!templateDir) {
      throw new Error(`模板 "${params.template}" 不存在`)
    }

    projectDir = path.join(params.projectPath, params.name)
    try {
      await fs.promises.access(projectDir)
      throw new Error(`目录 "${projectDir}" 已存在`)
    } catch (error) {
      if (error instanceof Error && !('code' in error)) throw error
      if (error?.code !== 'ENOENT') throw error
    }

    // 只向确认不存在的目标目录复制，避免覆盖用户已有工程。
    await fs.promises.cp(templateDir, projectDir, { recursive: true, errorOnExist: true })
    projectCreated = true
    const pluginJsonPath = await updateProjectMetadata(projectDir, params)

    // 复用宿主现有登记能力，保持开发项目注册表行为一致。
    const result = await ipcRenderer.invoke(
      'internal:upsert-dev-project-by-config-path',
      pluginJsonPath
    )
    if (!result?.success) {
      throw new Error(result?.error || '导入创建的项目失败')
    }
    return { success: true, pluginName: result.pluginName || params.name }
  } catch (error) {
    // 创建后的任一步失败都移除半成品；预先存在的目录从未被写入。
    if (projectCreated && projectDir) {
      await fs.promises.rm(projectDir, { recursive: true, force: true })
    }
    return { success: false, error: formatError(error) }
  }
}

window.ztoolsDeveloperPlugin = Object.freeze({ scaffoldDevProject })
