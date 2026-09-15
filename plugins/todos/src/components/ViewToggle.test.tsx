import { render, screen, fireEvent } from '@testing-library/react';
import { ViewToggle } from './ViewToggle';

describe('ViewToggle', () => {
  it('renders toggle button', () => {
    const { container } = render(<ViewToggle isExpanded={false} onToggle={() => {}} />);
    expect(container.querySelector('.lucide-maximize-2')).toBeInTheDocument();
  });

  it('renders minimize icon when expanded', () => {
    const { container } = render(<ViewToggle isExpanded={true} onToggle={() => {}} />);
    expect(container.querySelector('.lucide-minimize-2')).toBeInTheDocument();
  });

  it('calls onToggle when clicked', () => {
    const handleToggle = jest.fn();
    const { container } = render(<ViewToggle isExpanded={false} onToggle={handleToggle} />);
    fireEvent.click(container.querySelector('.view-btn')!);
    expect(handleToggle).toHaveBeenCalled();
  });

  it('renders with correct container class', () => {
    const { container } = render(<ViewToggle isExpanded={false} onToggle={() => {}} />);
    expect(container.firstChild).toHaveClass('view-toggle');
  });
});
