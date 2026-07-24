import { renderHook, act } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function createKeyboardEvent(key: string, options: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    ...options
  });
}

describe('useKeyboardShortcuts', () => {
  it('should call onSave when Ctrl+S is pressed', () => {
    const onSave = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSave }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('s', { ctrlKey: true }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('should call onSave when Cmd+S is pressed (macOS)', () => {
    const onSave = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSave }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('s', { metaKey: true }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('should call onDelete when Ctrl+D is pressed', () => {
    const onDelete = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onDelete }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('d', { ctrlKey: true }));
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('should call onDelete when Cmd+D is pressed (macOS)', () => {
    const onDelete = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onDelete }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('d', { metaKey: true }));
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('should call onSearch when Ctrl+F is pressed', () => {
    const onSearch = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSearch }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('f', { ctrlKey: true }));
    });

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('should call onSearch when Cmd+F is pressed (macOS)', () => {
    const onSearch = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSearch }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('f', { metaKey: true }));
    });

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('should call onToggleView when Ctrl+E is pressed', () => {
    const onToggleView = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onToggleView }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('e', { ctrlKey: true }));
    });

    expect(onToggleView).toHaveBeenCalledTimes(1);
  });

  it('should call onToggleView when Cmd+E is pressed (macOS)', () => {
    const onToggleView = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onToggleView }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('e', { metaKey: true }));
    });

    expect(onToggleView).toHaveBeenCalledTimes(1);
  });

  it('should call onEscape when Escape is pressed', () => {
    const onEscape = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onEscape }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('Escape'));
    });

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('should not call onEscape for other keys', () => {
    const onEscape = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onEscape }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('Enter'));
    });

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('should not call handlers when modifier key is missing', () => {
    const onSave = jest.fn();
    const onDelete = jest.fn();
    const onSearch = jest.fn();
    const onToggleView = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSave, onDelete, onSearch, onToggleView }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('s'));
      window.dispatchEvent(createKeyboardEvent('d'));
      window.dispatchEvent(createKeyboardEvent('f'));
      window.dispatchEvent(createKeyboardEvent('e'));
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
    expect(onToggleView).not.toHaveBeenCalled();
  });

  it('should prevent default browser behavior for Ctrl+S', () => {
    const onSave = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSave }));

    const event = createKeyboardEvent('s', { ctrlKey: true });
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should prevent default browser behavior for Ctrl+F', () => {
    const onSearch = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSearch }));

    const event = createKeyboardEvent('f', { ctrlKey: true });
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should not prevent default for Escape', () => {
    const onEscape = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onEscape }));

    const event = createKeyboardEvent('Escape');
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('should clean up event listener on unmount', () => {
    const onSave = jest.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ onSave }));

    unmount();

    act(() => {
      window.dispatchEvent(createKeyboardEvent('s', { ctrlKey: true }));
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('should handle multiple shortcuts simultaneously', () => {
    const onSave = jest.fn();
    const onSearch = jest.fn();
    const onEscape = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSave, onSearch, onEscape }));

    act(() => {
      window.dispatchEvent(createKeyboardEvent('s', { ctrlKey: true }));
      window.dispatchEvent(createKeyboardEvent('f', { ctrlKey: true }));
      window.dispatchEvent(createKeyboardEvent('Escape'));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
