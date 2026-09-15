import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomLegend } from './BottomLegend';

describe('BottomLegend', () => {
  it('renders all legend items', () => {
    render(<BottomLegend onShowShortcuts={() => {}} />);
    expect(screen.getByText('右键右滑 完成')).toBeInTheDocument();
    expect(screen.getByText('右键左滑 删除')).toBeInTheDocument();
    expect(screen.getByText('双击编辑')).toBeInTheDocument();
    expect(screen.getByText('拖拽分配日期')).toBeInTheDocument();
  });

  it('renders shortcut button', () => {
    render(<BottomLegend onShowShortcuts={() => {}} />);
    expect(screen.getByText('快捷键')).toBeInTheDocument();
  });

  it('calls onShowShortcuts when shortcut button is clicked', () => {
    const onShowShortcuts = jest.fn();
    render(<BottomLegend onShowShortcuts={onShowShortcuts} />);
    fireEvent.click(screen.getByText('快捷键'));
    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
  });
});
