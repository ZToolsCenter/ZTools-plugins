import { useAppContext } from '../context/AppContext';
import { getWeekStart, formatDate } from '../utils/dateUtils';

export function useCalendar() {
  const { state, dispatch } = useAppContext();

  const navigatePrev = () => {
    const date = new Date(state.currentDate);
    if (state.viewMode === 'week') {
      date.setDate(date.getDate() - 7);
    } else {
      date.setMonth(date.getMonth() - 1);
    }
    dispatch({ type: 'SET_CURRENT_DATE', payload: { date: formatDate(date) } });
  };

  const navigateNext = () => {
    const date = new Date(state.currentDate);
    if (state.viewMode === 'week') {
      date.setDate(date.getDate() + 7);
    } else {
      date.setMonth(date.getMonth() + 1);
    }
    dispatch({ type: 'SET_CURRENT_DATE', payload: { date: formatDate(date) } });
  };

  const goToToday = () => {
    dispatch({ 
      type: 'SET_CURRENT_DATE', 
      payload: { date: formatDate(new Date()) } 
    });
  };

  const getCurrentWeek = () => {
    const date = new Date(state.currentDate);
    const weekStart = getWeekStart(date);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      days.push(formatDate(day));
    }
    return days;
  };

  const getCurrentMonth = () => {
    const date = new Date(state.currentDate);
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const firstDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const days = [];
    
    const prevMonth = new Date(year, month, 0);
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const day = new Date(prevMonth);
      day.setDate(day.getDate() - i);
      days.push({ date: formatDate(day), isCurrentMonth: false });
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      const day = new Date(year, month, i);
      days.push({ date: formatDate(day), isCurrentMonth: true });
    }
    
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const day = new Date(year, month + 1, i);
      days.push({ date: formatDate(day), isCurrentMonth: false });
    }
    
    return days;
  };

  return {
    navigatePrev,
    navigateNext,
    goToToday,
    getCurrentWeek,
    getCurrentMonth,
    currentDate: state.currentDate,
    viewMode: state.viewMode
  };
}
