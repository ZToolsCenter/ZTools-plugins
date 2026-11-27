import { useEffect } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';
import { AppProvider, useAppContext } from '../context/AppContext';

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<AppProvider>{ui}</AppProvider>);
};

function LayoutModeSetter({ mode }: { mode: 'split' | 'pool-only' }) {
  const { dispatch } = useAppContext();

  useEffect(() => {
    dispatch({ type: 'SET_LAYOUT_MODE', payload: { layoutMode: mode } });
  }, [dispatch, mode]);

  return null;
}

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

  it('hides the week / month toggle in pool-only layout', () => {
    const { container } = render(
      <AppProvider>
        <LayoutModeSetter mode="pool-only" />
        <Header />
      </AppProvider>
    );

    expect(container.querySelector('.view-toggle')).toBeNull();
    expect(screen.queryByRole('button', { name: '周' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '月' })).not.toBeInTheDocument();
  });

  it('renders with correct container class', () => {
    const { container } = renderWithProvider(<Header />);
    expect(container.querySelector('.header')).toBeInTheDocument();
  });
});
