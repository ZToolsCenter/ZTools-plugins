import React from 'react';
import { WorkspaceConfig } from '../types';
import { COLOR_SCHEMES } from '../constants/colorSchemes';

interface WorkspaceSwitcherProps {
  configs: WorkspaceConfig[];
  currentWorkspace: string;
  onChange: (workspace: string) => void;
}

export function WorkspaceSwitcher({ configs, currentWorkspace, onChange }: WorkspaceSwitcherProps) {
  const sortedConfigs = [...configs].sort((a, b) => a.order - b.order);

  const getColorForScheme = (schemeId: string) => {
    const scheme = COLOR_SCHEMES.find(s => s.id === schemeId);
    return scheme?.primary || '#0F766E';
  };

  return (
    <nav className="workspace-tabs">
      {sortedConfigs.map(config => (
        <button
          key={config.id}
          className={`ws-tab ${currentWorkspace === config.id ? 'active' : ''}`}
          data-ws={config.id}
          onClick={() => onChange(config.id)}
        >
          <span
            className="ws-square"
            style={{ backgroundColor: getColorForScheme(config.colorScheme) }}
          ></span>
          {config.name}
        </button>
      ))}
    </nav>
  );
}
