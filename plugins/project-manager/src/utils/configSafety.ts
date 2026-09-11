export const CONFIG_FILE_NAME = 'data.json';

export function isSafeConfigFilename(filename: string): boolean {
  const value = String(filename || '');
  return Boolean(value)
    && value === value.split(/[\\/]/).pop()
    && !/[\\/:\0]/.test(value)
    && value !== '.'
    && value !== '..'
    && !/^[A-Za-z]:/.test(value);
}

export function assertSafeConfigFilename(filename: string): string {
  if (!isSafeConfigFilename(filename)) {
    throw new Error(`Invalid config filename: ${filename}`);
  }
  return filename;
}

export function configBackupFilename(filename: string): string {
  return `${assertSafeConfigFilename(filename)}.bak`;
}

export function isPersistedDataShape(value: unknown): value is {
  projects: unknown[];
  settings: Record<string, unknown>;
  customNodes?: unknown[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.projects)
    && Boolean(data.settings)
    && typeof data.settings === 'object'
    && !Array.isArray(data.settings)
    && (data.customNodes === undefined || Array.isArray(data.customNodes));
}

export function parsePersistedData(content: string): unknown {
  const value = JSON.parse(content);
  if (!isPersistedDataShape(value)) throw new Error('Invalid persisted data shape');
  return value;
}
