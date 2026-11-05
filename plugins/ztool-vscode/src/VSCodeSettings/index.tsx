import { useState, useEffect } from 'react'
import type { VSCodeConfig } from '../types'
import './index.css'

export default function VSCodeSettings() {
  const [config, setConfig] = useState<VSCodeConfig>({
    codeExecutable: '',
    vscdbPath: '',
    workspaceStorageRoot: '',
    storageJsonPath: '',
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const savedConfig = window.services.getVSCodeConfig()
    setConfig(savedConfig)
  }, [])

  const handleBrowseCodeExe = async () => {
    try {
      const result = await window.ztools.showOpenDialog({
        title: '选择 Visual Studio Code 的 Code.exe',
        buttonLabel: '选择 Code.exe',
        filters: [{ name: '可执行文件', extensions: ['exe'] }],
        properties: ['openFile'],
      })
      if (result && result.length > 0) {
        setConfig({ ...config, codeExecutable: result[0] })
      }
    } catch (e) {
      window.ztools.showNotification('选择文件失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleBrowseVscdb = async () => {
    try {
      const result = await window.ztools.showOpenDialog({
        title: '选择 state.vscdb 文件',
        buttonLabel: '选择 vscdb',
        filters: [{ name: 'VSCode 数据库', extensions: ['vscdb'] }],
        properties: ['openFile'],
      })
      if (result && result.length > 0) {
        setConfig({ ...config, vscdbPath: result[0] })
      }
    } catch (e) {
      window.ztools.showNotification('选择文件失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleBrowseWorkspaceStorage = async () => {
    try {
      const result = await window.ztools.showOpenDialog({
        title: '选择 workspaceStorage 目录',
        buttonLabel: '选择目录',
        properties: ['openDirectory'],
      })
      if (result && result.length > 0) {
        setConfig({ ...config, workspaceStorageRoot: result[0] })
      }
    } catch (e) {
      window.ztools.showNotification('选择目录失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleBrowseStorageJson = async () => {
    try {
      const result = await window.ztools.showOpenDialog({
        title: '选择 storage.json 文件',
        buttonLabel: '选择 storage.json',
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
        properties: ['openFile'],
      })
      if (result && result.length > 0) {
        setConfig({ ...config, storageJsonPath: result[0] })
      }
    } catch (e) {
      window.ztools.showNotification('选择文件失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleSave = () => {
    try {
      window.services.saveVSCodeConfig(config)
      setSaved(true)
      window.ztools.showNotification('配置已保存')
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      window.ztools.showNotification('保存失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleReset = () => {
    setConfig({ codeExecutable: '', vscdbPath: '', workspaceStorageRoot: '', storageJsonPath: '' })
  }

  return (
    <div className="settings-container">
      <h2 className="settings-title">VSCode 启动器配置</h2>
      
      <div className="settings-form">
        <div className="settings-field">
          <label className="settings-label">
            Code.exe 路径
            <span className="settings-hint">（Windows 用户如无法自动检测可手动指定）</span>
          </label>
          <div className="settings-input-group">
            <input
              type="text"
              className="settings-input"
              value={config.codeExecutable}
              onChange={(e) => setConfig({ ...config, codeExecutable: e.target.value })}
              placeholder="留空则自动检测"
            />
            <button className="settings-button" onClick={handleBrowseCodeExe}>
              浏览...
            </button>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label">
            state.vscdb 路径
            <span className="settings-hint">（VSCode 数据库，优先级中等）</span>
          </label>
          <div className="settings-input-group">
            <input
              type="text"
              className="settings-input"
              value={config.vscdbPath}
              onChange={(e) => setConfig({ ...config, vscdbPath: e.target.value })}
              placeholder="留空使用默认路径"
            />
            <button className="settings-button" onClick={handleBrowseVscdb}>
              浏览...
            </button>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label">
            workspaceStorage 目录
            <span className="settings-hint">（最新项目数据，优先级最高）</span>
          </label>
          <div className="settings-input-group">
            <input
              type="text"
              className="settings-input"
              value={config.workspaceStorageRoot}
              onChange={(e) => setConfig({ ...config, workspaceStorageRoot: e.target.value })}
              placeholder="留空使用默认路径"
            />
            <button className="settings-button" onClick={handleBrowseWorkspaceStorage}>
              浏览...
            </button>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label">
            storage.json 路径
            <span className="settings-hint">（备用数据源，优先级最低）</span>
          </label>
          <div className="settings-input-group">
            <input
              type="text"
              className="settings-input"
              value={config.storageJsonPath}
              onChange={(e) => setConfig({ ...config, storageJsonPath: e.target.value })}
              placeholder="留空使用默认路径"
            />
            <button className="settings-button" onClick={handleBrowseStorageJson}>
              浏览...
            </button>
          </div>
        </div>

        <div className="settings-actions">
          <button className="settings-button-primary" onClick={handleSave}>
            {saved ? '✓ 已保存' : '保存配置'}
          </button>
          <button className="settings-button-secondary" onClick={handleReset}>
            重置
          </button>
        </div>
      </div>

      <div className="settings-info">
        <h3>数据源说明</h3>
        <ul>
          <li><strong>workspaceStorage</strong>：包含最新的项目数据，按修改时间排序（优先级最高）</li>
          <li><strong>state.vscdb</strong>：VSCode 全局数据库，包含历史记录（优先级中等）</li>
          <li><strong>storage.json</strong>：备用数据源，包含备份工作区（优先级最低）</li>
        </ul>
        <p>系统会按优先级依次读取这些数据源，合并后去重，确保获取最完整的项目列表。</p>
      </div>
    </div>
  )
}
