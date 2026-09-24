import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarNav } from './CalendarNav';

describe('CalendarNav', () => {
  it('renders prev and next buttons', () => {
    const { container } = render(
      <CalendarNav
        currentDate="2026-07-08"
        viewMode="week"
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
      />
    );
    expect(container.querySelector('.lucide-chevron-left')).toBeInTheDocument();
    expect(container.querySelector('.lucide-chevron-right')).toBeInTheDocument();
  });

  it('renders today button', () => {
    render(
      <CalendarNav
        currentDate="2026-07-08"
        viewMode="week"
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
      />
    );
    expect(screen.getByText('今天')).toBeInTheDocument();
  });

  it('displays week range in week mode', () => {
    render(
      <CalendarNav
        currentDate="2026-07-08"
        viewMode="week"
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
      />
    );
    expect(screen.getByText(/月/)).toBeInTheDocument();
  });

  it('displays month in month mode', () => {
    render(
      <CalendarNav
        currentDate="2026-07-08"
        viewMode="month"
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
      />
    );
    expect(screen.getByText('七月')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('calls onPrev when prev button is clicked', () => {
    const handlePrev = jest.fn();
    const { container } = render(
      <CalendarNav
        currentDate="2026-07-08"
        viewMode="week"
        onPrev={handlePrev}
        onNext={() => {}}
        onToday={() => {}}
      />
    );
    fireEvent.click(container.querySelector('.nav-btn')!);
    expect(handlePrev).toHaveBeenCalledTimes(1);
  });

  it('calls onNext when next button is clicked', () => {
    const handleNext = jest.fn();
    const { container } = render(
      <CalendarNav
        currentDate="2026-07-08"
        viewMode="week"
        onPrev={() => {}}
        onNext={handleNext}
        onToday={() => {}}
      />
    );
    const navBtns = container.querySelectorAll('.nav-btn');
    fireEvent.click(navBtns[navBtns.length - 1]);
    expect(handleNext).toHaveBeenCalledTimes(1);
  });

  it('calls onToday when today button is clicked', () => {
    const handleToday = jest.fn();
    render(
      <CalendarNav
        currentDate="2026-07-08"
        viewMode="week"
        onPrev={() => {}}
        onNext={() => {}}
        onToday={handleToday}
      />
    );
    fireEvent.click(screen.getByText('今天'));
    expect(handleToday).toHaveBeenCalledTimes(1);
  });

  it('renders with correct container class', () => {
    const { container } = render(
      <CalendarNav
        currentDate="2026-07-08"
        viewMode="week"
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
      />
    );
    expect(container.querySelector('.cal-nav')).toBeInTheDocument();
  });
});
