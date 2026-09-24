import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSettings } from './WorkspaceSettings';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

describe('WorkspaceSettings', () => {
  const mockOnUpdate = jest.fn();
  const mockOnClose = jest.fn();
  const mockOnChangeLayoutMode = jest.fn();
  const defaultLayoutMode = 'split';

  beforeEach(() => {
    mockOnUpdate.mockClear();
    mockOnClose.mockClear();
    mockOnChangeLayoutMode.mockClear();
  });

  it('renders workspace list', () => {
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
        layoutMode={defaultLayoutMode}
        onChangeLayoutMode={mockOnChangeLayoutMode}
      />
    );

    expect(screen.getByText('工作空间设置')).toBeInTheDocument();
    expect(screen.getByText('工作')).toBeInTheDocument();
    expect(screen.getByText('生活')).toBeInTheDocument();
    expect(screen.getByText('学习')).toBeInTheDocument();
  });

  it('adds new workspace when add button is clicked', () => {
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
        layoutMode={defaultLayoutMode}
        onChangeLayoutMode={mockOnChangeLayoutMode}
      />
    );

    fireEvent.click(screen.getByText('+ 添加新组'));
    expect(mockOnUpdate).toHaveBeenCalled();
  });

  it('deletes workspace when delete button is clicked', () => {
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
        layoutMode={defaultLayoutMode}
        onChangeLayoutMode={mockOnChangeLayoutMode}
      />
    );

    const deleteButtons = screen.getAllByText('删除');
    fireEvent.click(deleteButtons[0]);
    expect(mockOnUpdate).toHaveBeenCalled();
  });

  it('closes when overlay is clicked', () => {
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
        layoutMode={defaultLayoutMode}
        onChangeLayoutMode={mockOnChangeLayoutMode}
      />
    );

    fireEvent.click(screen.getByText('工作空间设置').closest('.workspace-settings-overlay')!);
    expect(mockOnClose).toHaveBeenCalled();
  });
});
