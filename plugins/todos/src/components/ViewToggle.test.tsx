import { render, screen, fireEvent } from '@testing-library/react';
import { ViewToggle } from './ViewToggle';

describe('ViewToggle', () => {
  it('renders week and month options', () => {
    render(<ViewToggle viewMode="week" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '周' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '月' })).toBeInTheDocument();
  });

  it('marks the current view as pressed', () => {
    render(<ViewToggle viewMode="month" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the selected view', () => {
    const handleChange = jest.fn();
    render(<ViewToggle viewMode="week" onChange={handleChange} />);
    fireEvent.click(screen.getByRole('button', { name: '月' }));
    expect(handleChange).toHaveBeenCalledWith('month');
  });

  it('renders with correct container class', () => {
    const { container } = render(<ViewToggle viewMode="week" onChange={() => {}} />);
    expect(container.firstChild).toHaveClass('view-toggle');
  });
});
