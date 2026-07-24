import type { TerminalConfig } from '../types';

/***********************终端配置基础能力*********************/

function trimExecutablePath(value: string): string {
  return value.trim();
}

export function getTerminalDuplicateKey(path: string): string {
  return trimExecutablePath(path).toLowerCase();
}

export function getTerminalDisplayName(path: string): string {
  const trimmedPath = trimExecutablePath(path);
  if (!trimmedPath) {
    return '';
  }

  return trimmedPath.split(/[/\\]/).pop()?.replace(/\.\w+$/, '') || trimmedPath;
}

export function createTerminalConfig(path: string): TerminalConfig {
  const normalizedPath = trimExecutablePath(path);
  return {
    id: crypto.randomUUID(),
    name: getTerminalDisplayName(normalizedPath),
    path: normalizedPath,
  };
}

export function normalizeTerminalConfig(value: unknown): TerminalConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const legacyPath = typeof record.id === 'string' ? trimExecutablePath(record.id) : '';
  const explicitPath = typeof record.path === 'string' ? trimExecutablePath(record.path) : '';
  const normalizedPath = explicitPath || legacyPath;

  if (!normalizedPath) {
    return null;
  }

  return {
    id: typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : crypto.randomUUID(),
    name: typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : getTerminalDisplayName(normalizedPath),
    path: normalizedPath,
  };
}

export function normalizeTerminalConfigs(value: unknown): TerminalConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const terminalMap = new Map<string, TerminalConfig>();
  value.forEach((item) => {
    const normalized = normalizeTerminalConfig(item);
    if (!normalized) {
      return;
    }

    const duplicateKey = getTerminalDuplicateKey(normalized.path);
    if (!duplicateKey || terminalMap.has(duplicateKey)) {
      return;
    }

    terminalMap.set(duplicateKey, normalized);
  });

  return Array.from(terminalMap.values());
}

/***********************终端选择解析*********************/

export function resolveTerminalCommand(
  terminalId: string | undefined,
  customTerminals?: TerminalConfig[],
): string {
  const normalizedId = terminalId?.trim();
  if (!normalizedId) {
    return 'cmd';
  }

  const matchedTerminal = customTerminals?.find(item => item.id === normalizedId);
  return matchedTerminal?.path || normalizedId;
}
