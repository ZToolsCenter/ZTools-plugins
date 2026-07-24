import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

describe('WorkspaceSwitcher', () => {
  it('renders workspace buttons', () => {
    render(
      <WorkspaceSwitcher
        configs={DEFAULT_WORKSPACE_CONFIGS}
        currentWorkspace="work"
        onChange={() => {}}
      />
    );
    expect(screen.getByText('工作')).toBeInTheDocument();
    expect(screen.getByText('生活')).toBeInTheDocument();
    expect(screen.getByText('学习')).toBeInTheDocument();
  });

  it('calls onChange when workspace is clicked', () => {
    const handleChange = jest.fn();
    render(
      <WorkspaceSwitcher
        configs={DEFAULT_WORKSPACE_CONFIGS}
        currentWorkspace="work"
        onChange={handleChange}
      />
    );
    fireEvent.click(screen.getByText('生活'));
    expect(handleChange).toHaveBeenCalledWith('life');
  });

  it('highlights current workspace', () => {
    render(
      <WorkspaceSwitcher
        configs={DEFAULT_WORKSPACE_CONFIGS}
        currentWorkspace="life"
        onChange={() => {}}
      />
    );
    const lifeTab = screen.getByText('生活').closest('.ws-tab');
    expect(lifeTab).toHaveClass('active');
  });

  it('displays colored squares for each workspace', () => {
    render(
      <WorkspaceSwitcher
        configs={DEFAULT_WORKSPACE_CONFIGS}
        currentWorkspace="work"
        onChange={() => {}}
      />
    );
    const squares = document.querySelectorAll('.ws-square');
    expect(squares.length).toBe(3);
  });
});
