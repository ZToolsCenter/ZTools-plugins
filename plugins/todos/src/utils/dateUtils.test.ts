import {
  formatDate,
  formatWeekRange,
  formatMonth,
  isOverdue,
  isToday,
  getWeekStart,
  generateId,
} from './dateUtils';

describe('dateUtils', () => {
  describe('formatDate', () => {
    it('should format date as YYYY-MM-DD', () => {
      const date = new Date(2024, 0, 15); // 2024-01-15
      expect(formatDate(date)).toBe('2024-01-15');
    });

    it('should pad single digit month and day', () => {
      const date = new Date(2024, 2, 5); // 2024-03-05
      expect(formatDate(date)).toBe('2024-03-05');
    });

    it('should handle December correctly', () => {
      const date = new Date(2024, 11, 31); // 2024-12-31
      expect(formatDate(date)).toBe('2024-12-31');
    });
  });

  describe('formatWeekRange', () => {
    it('should format week range correctly', () => {
      const monday = new Date(2024, 0, 15); // 2024-01-15 (Monday)
      expect(formatWeekRange(monday)).toBe('1月15-21日');
    });

    it('should handle week spanning different days', () => {
      const monday = new Date(2024, 1, 5); // 2024-02-05 (Monday)
      expect(formatWeekRange(monday)).toBe('2月5-11日');
    });
  });

  describe('formatMonth', () => {
    it('should format month correctly', () => {
      const date = new Date(2024, 0, 15); // January 2024
      expect(formatMonth(date)).toBe('2024年1月');
    });

    it('should handle December', () => {
      const date = new Date(2024, 11, 25); // December 2024
      expect(formatMonth(date)).toBe('2024年12月');
    });
  });

  describe('isOverdue', () => {
    it('should return true for past dates', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = formatDate(yesterday);
      expect(isOverdue(dateStr)).toBe(true);
    });

    it('should return false for today', () => {
      const today = formatDate(new Date());
      expect(isOverdue(today)).toBe(false);
    });

    it('should return false for future dates', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = formatDate(tomorrow);
      expect(isOverdue(dateStr)).toBe(false);
    });
  });

  describe('isToday', () => {
    it('should return true for today', () => {
      const today = formatDate(new Date());
      expect(isToday(today)).toBe(true);
    });

    it('should return false for other dates', () => {
      expect(isToday('2020-01-01')).toBe(false);
    });
  });

  describe('getWeekStart', () => {
    it('should return Monday for a weekday', () => {
      const wednesday = new Date(2024, 0, 17); // Wednesday
      const weekStart = getWeekStart(wednesday);
      expect(weekStart.getDay()).toBe(1); // Monday
      expect(weekStart.getDate()).toBe(15);
    });

    it('should return Monday for Sunday', () => {
      const sunday = new Date(2024, 0, 14); // Sunday
      const weekStart = getWeekStart(sunday);
      expect(weekStart.getDay()).toBe(1);
      expect(weekStart.getDate()).toBe(8);
    });

    it('should return same day for Monday', () => {
      const monday = new Date(2024, 0, 15); // Monday
      const weekStart = getWeekStart(monday);
      expect(weekStart.getDay()).toBe(1);
      expect(weekStart.getDate()).toBe(15);
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    it('should generate valid UUID format', () => {
      const id = generateId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      expect(id).toMatch(uuidRegex);
    });
  });
});
