import { useEffect, useState } from 'react'
import { getIDEs, saveIDEs, getQuickFillPresets, getAppDataPath, getDefaultShell, type IDEItem } from '../store'
import './index.css'

const emptyForm = (): IDEItem => ({ code: '', name: '', command: '', dbPath: '', shell: '' })

export default function Settings({ onBack, editIDE }: { onBack?: () => void; editIDE?: IDEItem }) {
  const [ides, setIDEs] = useState<IDEItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<IDEItem>(emptyForm())
  const [editingIdx, setEditingIdx] = useState(-1)
  const defaultShell = getDefaultShell()
  const appData = getAppDataPath()

  useEffect(() => {
    setIDEs(getIDEs())
  }, [])

  useEffect(() => {
    if (!editIDE) return
    const idx = ides.findIndex(i => i.code === editIDE.code)
    if (idx >= 0) {
      setForm({ ...editIDE })
      setEditingIdx(idx)
      setShowForm(true)
    }
  }, [editIDE])

  const doRegister = (list: IDEItem[]) => {
    list.forEach(ide => {
      if (!ide.code) return
      try { window.ztools.setFeature({ code: ide.code, explain: `打开 ${ide.name || ide.code} 最近项目`, cmds: [ide.code], icon: 'logo.png' }) }
      catch {}
    })
  }

  const save = () => {
    if (!form.code.trim()) { alert('请输入别名'); return }
    if (!form.command.trim()) { alert('请输入启动命令'); return }
    if (!form.dbPath.trim()) { alert('请输入历史文件路径'); return }
    const entry: IDEItem = { code: form.code.trim(), name: form.name.trim() || form.code.trim(), command: form.command.trim(), dbPath: form.dbPath.trim(), shell: form.shell.trim() }
    let list
    if (editingIdx >= 0) {
      list = ides.map((item, i) => i === editingIdx ? entry : item)
    } else {
      list = [...ides, entry]
    }
    setIDEs(list)
    saveIDEs(list)
    doRegister(list)
    setForm(emptyForm())
    setEditingIdx(-1)
    setShowForm(false)
  }

  const del = (idx: number) => {
    const removed = ides[idx]
    const list = ides.filter((_, i) => i !== idx)
    setIDEs(list)
    saveIDEs(list)
    try { if (removed?.code) window.ztools.removeFeature(removed.code) } catch {}
    doRegister(list)
  }

  const startEdit = (idx: number) => {
    const ide = ides[idx]
    setForm({ code: ide.code, name: ide.name, command: ide.command, dbPath: ide.dbPath, shell: ide.shell || defaultShell })
    setEditingIdx(idx)
    setShowForm(true)
  }

  const startAdd = () => {
    setForm(emptyForm())
    setEditingIdx(-1)
    setShowForm(true)
  }

  const fill = (preset: any) => {
    setForm({ code: preset.code, name: preset.name, command: preset.command, dbPath: preset.dbPath, shell: preset.shell || '' })
  }

  const isEditing = editingIdx >= 0
  const defaults = getQuickFillPresets()

  return (
    <div className='settings'>
      <div className='top-bar'>
        {onBack && <button className='btn-back' onClick={onBack}>← 返回</button>}
        <h2>ideOpen <span className='subtitle'>配置 IDE</span></h2>
      </div>

      <button className='btn-toggle' onClick={() => {
        if (showForm) { setShowForm(false); setEditingIdx(-1); setForm(emptyForm()) }
        else startAdd()
      }}>
        {showForm ? '收起' : '+ 新增配置'}
      </button>

      {showForm && (
        <div className='add-form'>
          {!isEditing && (
            <div className='quick-fill'>
              <span className='qf-label'>快速填入:</span>
              {defaults.map(p => (
                <button key={p.code} className='btn-qf' onClick={() => fill(p)}>{p.name}</button>
              ))}
            </div>
          )}
          <label><span>别名</span> <input placeholder='例如 vsc' value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></label>
          <label><span>名称</span> <input placeholder='例如 VS Code' value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label><span>启动命令</span> <input placeholder='例如 code' value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} /></label>
          <label><span>执行 shell</span> <input placeholder='留空使用系统默认' value={form.shell} onChange={e => setForm({ ...form, shell: e.target.value })} /></label>
          <label><span>历史文件路径</span> <input placeholder='state.vscdb 或 storage.json 的完整路径' value={form.dbPath} onChange={e => setForm({ ...form, dbPath: e.target.value })} /></label>
          <button className='btn-submit' onClick={save}>{isEditing ? '保存' : '添加'}</button>
        </div>
      )}

      {ides.length === 0 && (
        <p className='empty-hint'>还没有配置，点「+ 新增配置」添加</p>
      )}

      {ides.length > 0 && (
        <table className='ide-table'>
          <thead>
            <tr>
              <th>别名</th>
              <th>名称</th>
              <th>启动命令</th>
              <th>shell</th>
              <th>历史文件路径</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ides.map((ide, idx) => (
              <tr key={idx}>
                <td><code>{ide.code}</code></td>
                <td>{ide.name}</td>
                <td>{ide.command}</td>
                <td>{ide.shell || '-'}</td>
                <td className='td-path' title={ide.dbPath}>{ide.dbPath}</td>
                <td className='td-actions'>
                  <button className='btn-edit' onClick={() => startEdit(idx)}>编辑</button>
                  <button className='btn-remove' onClick={() => del(idx)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
