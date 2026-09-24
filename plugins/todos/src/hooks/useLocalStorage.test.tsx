import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from './useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return initial value when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
    
    expect(result.current[0]).toBe('initial');
  });

  it('should return stored value from localStorage', () => {
    localStorage.setItem('test-key', JSON.stringify('stored'));
    
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
    
    expect(result.current[0]).toBe('stored');
  });

  it('should update localStorage when value changes', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
    
    act(() => {
      result.current[1]('updated');
    });
    
    expect(result.current[0]).toBe('updated');
    expect(JSON.parse(localStorage.getItem('test-key')!)).toBe('updated');
  });

  it('should handle object values', () => {
    const initialValue = { name: 'test', count: 0 };
    const { result } = renderHook(() => useLocalStorage('obj-key', initialValue));
    
    expect(result.current[0]).toEqual(initialValue);
    
    act(() => {
      result.current[1]({ name: 'updated', count: 1 });
    });
    
    expect(result.current[0]).toEqual({ name: 'updated', count: 1 });
    expect(JSON.parse(localStorage.getItem('obj-key')!)).toEqual({ name: 'updated', count: 1 });
  });

  it('should handle JSON parse errors gracefully', () => {
    localStorage.setItem('bad-key', 'not-valid-json');
    const spy = jest.spyOn(console, 'error').mockImplementation();
    
    const { result } = renderHook(() => useLocalStorage('bad-key', 'fallback'));
    
    expect(result.current[0]).toBe('fallback');
    spy.mockRestore();
  });

  it('should handle localStorage setItem errors gracefully', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    const mockSetItem = jest.fn().mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    
    // Mock localStorage.setItem to throw
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = mockSetItem;
    
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
    
    act(() => {
      result.current[1]('updated');
    });
    
    // Should not throw, just log error
    expect(result.current[0]).toBe('updated');
    
    Storage.prototype.setItem = originalSetItem;
    spy.mockRestore();
  });

  it('should use function updater pattern', () => {
    const { result } = renderHook(() => useLocalStorage('count-key', 0));
    
    act(() => {
      result.current[1](prev => prev + 1);
    });
    
    expect(result.current[0]).toBe(1);
  });
});
