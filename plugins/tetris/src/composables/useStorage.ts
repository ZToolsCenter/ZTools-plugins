// ============================================================
//  ZTOOLS-AWARE STORAGE COMPOSABLE
// ============================================================

// Check if ztools storage is available
declare global {
  interface Window {
    ztools?: {
      dbStorage?: {
        getItem(key: string): string | null;
        setItem(key: string, value: string): void;
        removeItem(key: string): void;
      };
    };
  }
}

const hasDbStorage = ():
  boolean => {
  return typeof window !== 'undefined' &&
    window.ztools?.dbStorage !== undefined;
};

function getItem(key: string): unknown {
  if (hasDbStorage()) {
    const val = window.ztools?.dbStorage?.getItem(key);
    if (val !== null && val !== undefined) {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
  }
  const val = localStorage.getItem(key);
  if (val === null) return null;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

function setItem(key: string, value: unknown): void {
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  localStorage.setItem(key, str);
  if (hasDbStorage()) {
    window.ztools?.dbStorage?.setItem(key, str);
  }
}

function removeItem(key: string): void {
  localStorage.removeItem(key);
  if (hasDbStorage()) {
    window.ztools?.dbStorage?.removeItem(key);
  }
}

export function useStorage() {
  return { getItem, setItem, removeItem };
}
