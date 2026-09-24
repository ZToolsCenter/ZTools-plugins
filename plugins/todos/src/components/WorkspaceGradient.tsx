import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { COLOR_SCHEMES } from '../constants/colorSchemes';
import './WorkspaceGradient.css';

export function WorkspaceGradient() {
  const { state } = useAppContext();
  const { currentWorkspace, workspaceConfigs } = state;
  const [isDark, setIsDark] = useState(document.documentElement.dataset.theme === 'dark');

  // Listen for theme changes
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          setIsDark(document.documentElement.dataset.theme === 'dark');
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, []);

  // Find the current workspace config
  const currentConfig = workspaceConfigs.find(c => c.id === currentWorkspace);
  
  // Get the color scheme for the current workspace
  const colorScheme = currentConfig 
    ? COLOR_SCHEMES.find(s => s.id === currentConfig.colorScheme)
    : COLOR_SCHEMES[0]; // Default to teal

  const lightColor = colorScheme?.light || '#6EE7B7';

  // Create gradient: lighter workspace color → white (light mode) or black (dark mode)
  const gradientEndColor = isDark ? '#1C1917' : '#F7F5F0';

  return (
    <div className="workspace-gradient-container">
      <div 
        className="workspace-gradient"
        style={{
          background: `linear-gradient(225deg, ${lightColor}70, ${gradientEndColor}00)`
        }}
      />
    </div>
  );
}