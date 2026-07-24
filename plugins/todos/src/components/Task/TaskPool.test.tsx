import { render, screen, fireEvent } from '@testing-library/react';
import { TaskPool } from './TaskPool';
import { AppProvider } from '../../context/AppContext';

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<AppProvider>{ui}</AppProvider>);
};

describe('TaskPool', () => {
  it('renders empty state when no tasks exist', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByText('暂无任务')).toBeInTheDocument();
    expect(screen.getByText('在下方输入框中添加新任务')).toBeInTheDocument();
  });

  it('renders pool header', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByText('待办池')).toBeInTheDocument();
  });

  it('renders search input', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByPlaceholderText('搜索任务...')).toBeInTheDocument();
  });

  it('renders textarea for adding tasks', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByPlaceholderText(/输入任务名称/)).toBeInTheDocument();
  });

  it('renders task count as zero initially', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByText('0 项任务')).toBeInTheDocument();
  });

  it('renders empty state icon', () => {
    const { container } = renderWithProvider(<TaskPool />);
    expect(container.querySelector('.lucide-file-text')).toBeInTheDocument();
  });
});
