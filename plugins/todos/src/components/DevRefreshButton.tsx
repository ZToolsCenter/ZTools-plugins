import React from 'react';
import { useAppContext } from '../context/AppContext';
import { generateMockData, isDevMode } from '../utils/mockData';
import './DevRefreshButton.css';

export function DevRefreshButton() {
  const { dispatch } = useAppContext();

  if (!isDevMode) return null;

  const handleRefresh = () => {
    const mockData = generateMockData();
    dispatch({ type: 'LOAD_DATA', payload: { data: { workspaces: mockData } } });
  };

  return (
    <button className="dev-refresh-btn" onClick={handleRefresh} title="恢复演示数据">
      ↻
    </button>
  );
}
