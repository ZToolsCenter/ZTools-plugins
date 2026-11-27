import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSettings } from './WorkspaceSettings';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

describe('WorkspaceSettings', () => {
  const mockOnUpdate = jest.fn();
  const mockOnClose = jest.fn();
  const mockOnChangeLayoutMode = jest.fn();
  const mockOnChangeColorMode = jest.fn();
  const defaultLayoutMode = 'split';
  const defaultColorMode = 'random';

  beforeEach(() => {
    mockOnUpdate.mockClear();
    mockOnClose.mockClear();
    mockOnChangeLayoutMode.mockClear();
    mockOnChangeColorMode.mockClear();
  });

  const renderSettings = (overrides: Partial<React.ComponentProps<typeof WorkspaceSettings>> = {}) =>
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
        layoutMode={defaultLayoutMode}
        onChangeLayoutMode={mockOnChangeLayoutMode}
        colorMode={defaultColorMode}
        onChangeColorMode={mockOnChangeColorMode}
        {...overrides}
      />
    );

  it('renders workspace list', () => {
    renderSettings();

    expect(screen.getByText('工作空间设置')).toBeInTheDocument();
    expect(screen.getByText('工作')).toBeInTheDocument();
    expect(screen.getByText('生活')).toBeInTheDocument();
    expect(screen.getByText('学习')).toBeInTheDocument();
  });

  it('adds new workspace when add button is clicked', () => {
    renderSettings();

    fireEvent.click(screen.getByText('+ 添加新组'));
    expect(mockOnUpdate).toHaveBeenCalled();
  });

  it('deletes workspace when delete button is clicked', () => {
    renderSettings();

    const deleteButtons = screen.getAllByText('删除');
    fireEvent.click(deleteButtons[0]);
    expect(mockOnUpdate).toHaveBeenCalled();
  });

  it('switches the task color mode', () => {
    renderSettings();

    expect(screen.getByText('任务颜色')).toBeInTheDocument();
    fireEvent.click(screen.getByText('按完成状态'));
    expect(mockOnChangeColorMode).toHaveBeenCalledWith('status');

    fireEvent.click(screen.getByText('按任务配色'));
    expect(mockOnChangeColorMode).toHaveBeenCalledWith('random');
  });

  it('marks the active color mode', () => {
    renderSettings({ colorMode: 'status' });

    expect(screen.getByText('按完成状态').closest('.layout-option')).toHaveClass('active');
    expect(screen.getByText('按任务配色').closest('.layout-option')).not.toHaveClass('active');
  });

  it('closes when overlay is clicked', () => {
    renderSettings();

    fireEvent.click(screen.getByText('工作空间设置').closest('.workspace-settings-overlay')!);
    expect(mockOnClose).toHaveBeenCalled();
  });
});
