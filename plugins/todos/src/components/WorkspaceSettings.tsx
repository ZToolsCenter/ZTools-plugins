import React, { useState } from 'react';
import { WorkspaceConfig } from '../types';
import { COLOR_SCHEMES } from '../constants/colorSchemes';
import './WorkspaceSettings.css';

interface WorkspaceSettingsProps {
  configs: WorkspaceConfig[];
  onUpdate: (configs: WorkspaceConfig[]) => void;
  layoutMode: 'split' | 'pool-only';
  onChangeLayoutMode: (mode: 'split' | 'pool-only') => void;
  onClose: () => void;
}

export function WorkspaceSettings({ configs, onUpdate, layoutMode, onChangeLayoutMode, onClose }: WorkspaceSettingsProps) {
  const [editingConfig, setEditingConfig] = useState<WorkspaceConfig | null>(null);
  const [newName, setNewName] = useState('');
  const [selectedScheme, setSelectedScheme] = useState('teal');

  const handleAdd = () => {
    if (configs.length >= 5) {
      alert('最多支持5个组');
      return;
    }
    const newConfig: WorkspaceConfig = {
      id: `workspace-${Date.now()}`,
      name: '新组',
      colorScheme: 'teal',
      order: configs.length
    };
    onUpdate([...configs, newConfig]);
  };

  const handleDelete = (id: string) => {
    if (configs.length <= 1) {
      alert('至少保留一个组');
      return;
    }
    onUpdate(configs.filter(c => c.id !== id));
  };

  const handleEdit = (config: WorkspaceConfig) => {
    setEditingConfig(config);
    setNewName(config.name);
    setSelectedScheme(config.colorScheme);
  };

  const handleSaveEdit = () => {
    if (!editingConfig) return;
    onUpdate(configs.map(c =>
      c.id === editingConfig.id
        ? { ...c, name: newName, colorScheme: selectedScheme }
        : c
    ));
    setEditingConfig(null);
  };

  const getSchemeColor = (schemeId: string) => {
    const scheme = COLOR_SCHEMES.find(s => s.id === schemeId);
    return scheme?.primary || '#0F766E';
  };

  return (
    <div className="workspace-settings-overlay" onClick={onClose}>
      <div className="workspace-settings" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>工作空间设置</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {editingConfig ? (
          <div className="edit-form">
            <h3>编辑组</h3>
            <div className="form-group">
              <label>名称</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="输入组名称"
              />
            </div>
            <div className="form-group">
              <label>配色方案</label>
              <div className="color-scheme-grid">
                {COLOR_SCHEMES.map(scheme => (
                  <button
                    key={scheme.id}
                    className={`scheme-option ${selectedScheme === scheme.id ? 'selected' : ''}`}
                    onClick={() => setSelectedScheme(scheme.id)}
                  >
                    <span className="scheme-color" style={{ backgroundColor: scheme.primary }}></span>
                    <span className="scheme-name">{scheme.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-actions">
              <button className="cancel-btn" onClick={() => setEditingConfig(null)}>取消</button>
              <button className="save-btn" onClick={handleSaveEdit}>保存</button>
            </div>
          </div>
        ) : (
          <>
            <div className="workspace-list">
              {configs.map(config => (
                <div key={config.id} className="workspace-item">
                  <span className="workspace-color" style={{ backgroundColor: getSchemeColor(config.colorScheme) }}></span>
                  <span className="workspace-name">{config.name}</span>
                  <button className="edit-btn" onClick={() => handleEdit(config)}>编辑</button>
                  <button className="delete-btn" onClick={() => handleDelete(config.id)}>删除</button>
                </div>
              ))}
            </div>
            <button className="add-btn" onClick={handleAdd} disabled={configs.length >= 5}>
              + 添加新组
            </button>

            <div className="settings-divider"></div>

            <div className="layout-section">
              <h3>布局模式</h3>
              <div className="layout-options">
                <button
                  className={`layout-option ${layoutMode === 'split' ? 'active' : ''}`}
                  onClick={() => onChangeLayoutMode('split')}
                >
                  <span className="layout-icon">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <rect x="1" y="3" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <rect x="15" y="3" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                  </span>
                  <span className="layout-label">日历 + 待办</span>
                </button>
                <button
                  className={`layout-option ${layoutMode === 'pool-only' ? 'active' : ''}`}
                  onClick={() => onChangeLayoutMode('pool-only')}
                >
                  <span className="layout-icon">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                  </span>
                  <span className="layout-label">仅待办池</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
