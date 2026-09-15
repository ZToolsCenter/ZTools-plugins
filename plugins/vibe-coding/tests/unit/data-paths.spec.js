import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createPluginDataPaths } = require('../../public/data-paths.js')

test('默认将全部受管文件写入宿主分配的插件数据目录', () => {
  const pluginDataRoot = path.resolve('/tmp/ztools-data/plugins-data/ztools-vibe-coding')
  const paths = createPluginDataPaths((name) => {
    assert.equal(name, 'pluginData')
    return pluginDataRoot
  }, {})

  assert.deepEqual(paths, {
    pluginDataRoot,
    workspaceRoot: path.join(pluginDataRoot, 'workspace'),
    skillRoot: path.join(pluginDataRoot, 'skill'),
    toolBinaryRoot: path.join(pluginDataRoot, 'bin'),
    toolOutputRoot: path.join(pluginDataRoot, 'tool-output'),
    sessionRoot: path.join(pluginDataRoot, 'sessions'),
  })
})

test('测试环境可分别覆盖工作区、Skill 和工具目录', () => {
  const root = path.resolve('/tmp/zvc-plugin-data')
  const paths = createPluginDataPaths(() => root, {
    ZVC_WORKSPACE_ROOT: path.resolve('/tmp/zvc-workspaces'),
    ZVC_SKILL_ROOT: path.resolve('/tmp/zvc-skills'),
    ZVC_TOOL_BINARY_ROOT: path.resolve('/tmp/zvc-bin'),
    ZVC_TOOL_OUTPUT_ROOT: path.resolve('/tmp/zvc-output'),
  })

  assert.equal(paths.workspaceRoot, path.resolve('/tmp/zvc-workspaces'))
  assert.equal(paths.skillRoot, path.resolve('/tmp/zvc-skills'))
  assert.equal(paths.toolBinaryRoot, path.resolve('/tmp/zvc-bin'))
  assert.equal(paths.toolOutputRoot, path.resolve('/tmp/zvc-output'))
  assert.equal(paths.sessionRoot, path.join(root, 'sessions'))
})

test('宿主未提供插件数据目录时拒绝退回公共用户目录', () => {
  assert.throws(() => createPluginDataPaths(() => ''), /插件数据目录不可用/)
})
