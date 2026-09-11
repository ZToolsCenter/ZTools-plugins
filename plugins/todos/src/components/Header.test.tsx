import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';
import { AppProvider } from '../context/AppContext';

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<AppProvider>{ui}</AppProvider>);
};

describe('Header', () => {
  it('renders logo', () => {
    renderWithProvider(<Header />);
    expect(screen.getByText('Todos')).toBeInTheDocument();
  });

  it('renders workspace switcher', () => {
    renderWithProvider(<Header />);
    expect(screen.getByText('工作')).toBeInTheDocument();
    expect(screen.getByText('生活')).toBeInTheDocument();
    expect(screen.getByText('学习')).toBeInTheDocument();
  });

  it('renders view toggle', () => {
    const { container } = renderWithProvider(<Header />);
    expect(container.querySelector('.view-toggle')).toBeInTheDocument();
    expect(container.querySelector('.view-btn')).toBeInTheDocument();
  });

  it('renders with correct container class', () => {
    const { container } = renderWithProvider(<Header />);
    expect(container.querySelector('.header')).toBeInTheDocument();
  });
});
