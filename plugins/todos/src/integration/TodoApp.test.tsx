import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';

let pluginEnterCallback: ((action: { code: string }) => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  pluginEnterCallback = null;

  (window as any).ztools = {
    onPluginEnter: jest.fn((cb: (action: { code: string }) => void) => {
      pluginEnterCallback = cb;
    }),
    onPluginOut: jest.fn(),
  };
});

function enterPlugin() {
  act(() => {
    pluginEnterCallback!({ code: 'todo' });
  });
}

describe('TodoApp Integration', () => {
  it('should add a task', async () => {
    render(<App />);
    enterPlugin();

    const textarea = screen.getByPlaceholderText(/输入任务名称/);
    fireEvent.change(textarea, { target: { value: 'Test Task' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });
  });

  it('should complete a task', async () => {
    render(<App />);
    enterPlugin();

    const textarea = screen.getByPlaceholderText(/输入任务名称/);
    fireEvent.change(textarea, { target: { value: 'Test Task' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getByText('Test Task').closest('.task-item')).toHaveClass('completed');
    });
  });

  it('should delete a task', async () => {
    render(<App />);
    enterPlugin();

    const textarea = screen.getByPlaceholderText(/输入任务名称/);
    fireEvent.change(textarea, { target: { value: 'Test Task' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle('删除');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.queryByText('Test Task')).not.toBeInTheDocument();
    });
  });

  it('should search tasks', async () => {
    render(<App />);
    enterPlugin();

    const textarea = screen.getByPlaceholderText(/输入任务名称/);
    fireEvent.change(textarea, { target: { value: 'Test Task' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('搜索任务...');
    fireEvent.change(searchInput, { target: { value: 'Test' } });

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });
  });

  it('should switch workspace', async () => {
    render(<App />);
    enterPlugin();

    const workspaceBtn = screen.getByText('工作');
    fireEvent.click(workspaceBtn);

    await waitFor(() => {
      expect(screen.getByText('生活')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('生活'));

    await waitFor(() => {
      expect(screen.getByText('生活').closest('.workspace-btn')).toBeInTheDocument();
    });
  });

  it('should switch view mode', async () => {
    render(<App />);
    enterPlugin();

    fireEvent.click(screen.getByText('月'));

    await waitFor(() => {
      expect(screen.getByText('月').closest('.view-btn')).toHaveClass('active');
    });
  });

  it('should drag task to calendar', async () => {
    render(<App />);
    enterPlugin();

    const textarea = screen.getByPlaceholderText(/输入任务名称/);
    fireEvent.change(textarea, { target: { value: 'Test Task' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    const task = screen.getByText('Test Task');
    const calendar = document.querySelector('.calendar-view') as HTMLElement;

    const mockDataTransfer = {
      setData: jest.fn(),
      getData: jest.fn(),
      effectAllowed: '',
    };

    act(() => {
      const dragStartEvent = new Event('dragstart', { bubbles: true });
      Object.defineProperty(dragStartEvent, 'dataTransfer', { value: mockDataTransfer });
      task.dispatchEvent(dragStartEvent);
    });

    act(() => {
      const dragOverEvent = new Event('dragover', { bubbles: true });
      Object.defineProperty(dragOverEvent, 'dataTransfer', { value: mockDataTransfer });
      calendar.dispatchEvent(dragOverEvent);
    });

    act(() => {
      const dropEvent = new Event('drop', { bubbles: true });
      Object.defineProperty(dropEvent, 'dataTransfer', { value: mockDataTransfer });
      calendar.dispatchEvent(dropEvent);
    });

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });
  });
});
