import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutPanel } from './KeyboardShortcutPanel';

describe('KeyboardShortcutPanel', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it('renders nothing when not visible', () => {
    const { container } = render(
      <KeyboardShortcutPanel visible={false} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders panel content when visible', () => {
    render(
      <KeyboardShortcutPanel visible={true} onClose={mockOnClose} />
    );
    expect(screen.getByRole('heading', { name: '操作指引' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '手势操作' })).toBeInTheDocument();
  });

  it('calls onClose when overlay is clicked', () => {
    render(
      <KeyboardShortcutPanel visible={true} onClose={mockOnClose} />
    );
    const overlay = screen.getByTestId('shortcut-panel-overlay');
    fireEvent.click(overlay);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    render(
      <KeyboardShortcutPanel visible={true} onClose={mockOnClose} />
    );
    const closeButton = screen.getByText('关闭 (Esc)');
    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});