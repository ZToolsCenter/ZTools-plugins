import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomLegend } from './BottomLegend';

describe('BottomLegend', () => {
  it('renders all legend items', () => {
    render(<BottomLegend onShowShortcuts={() => {}} />);
    expect(screen.getByText('右上 完成')).toBeInTheDocument();
    expect(screen.getByText('右下 删除')).toBeInTheDocument();
    expect(screen.getByText('双击编辑')).toBeInTheDocument();
    expect(screen.getByText('拖拽分配日期')).toBeInTheDocument();
  });

  it('renders shortcut button', () => {
    render(<BottomLegend onShowShortcuts={() => {}} />);
    expect(screen.getByText('快捷键')).toBeInTheDocument();
  });

  it('shows the drag variants while dragging a completed or calendar task', () => {
    render(
      <BottomLegend
        onShowShortcuts={() => {}}
        dragHint={{ complete: 'undo', remove: 'unschedule' }}
      />
    );
    expect(screen.getByText('右上 取消完成')).toBeInTheDocument();
    expect(screen.getByText('右下 移除当天')).toBeInTheDocument();
    expect(screen.queryByText('右上 完成')).not.toBeInTheDocument();
    expect(screen.queryByText('右下 删除')).not.toBeInTheDocument();
  });

  it('calls onShowShortcuts when shortcut button is clicked', () => {
    const onShowShortcuts = jest.fn();
    render(<BottomLegend onShowShortcuts={onShowShortcuts} />);
    fireEvent.click(screen.getByText('快捷键'));
    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
  });
});
