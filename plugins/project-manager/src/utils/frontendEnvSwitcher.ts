export type FrontendEnvGroupType = 'env' | 'proxy';

export interface FrontendEnvCandidate {
  id: string;
  value: string;
  active: boolean;
  lineIndex: number;
}

export interface FrontendEnvGroup {
  id: string;
  type: FrontendEnvGroupType;
  key: string;
  filePath: string;
  fileName: string;
  candidates: FrontendEnvCandidate[];
}

export interface FrontendEnvSwitchTarget {
  type: FrontendEnvGroupType;
  key: string;
  value: string;
}

export interface FrontendEnvScanFileEntry {
  name: string;
  isDirectory: boolean;
}

export interface FrontendEnvProjectFileSystem {
  readDir(path: string): Promise<FrontendEnvScanFileEntry[]>;
  readTextFile(path: string): Promise<string>;
}

interface ParsedEnvLine {
  indent: string;
  commented: boolean;
  key: string;
  body: string;
  value: string;
}

interface ParsedProxyTargetLine {
  indent: string;
  commented: boolean;
  body: string;
  value: string;
}

const ENV_KEY_PREFIX = 'VITE_';
const VITE_CONFIG_FILE_NAMES = new Set([
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
]);

/***********************文件类型判断*********************/

export function isEnvFileName(fileName: string): boolean {
  return /^\.env(?:\..+)?$/.test(fileName);
}

export function isViteConfigFileName(fileName: string): boolean {
  return VITE_CONFIG_FILE_NAMES.has(fileName);
}

/***********************通用文本工具*********************/

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function getLineEnding(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function createCandidateId(filePath: string, type: FrontendEnvGroupType, key: string, lineIndex: number): string {
  return `${filePath}:${type}:${key}:${lineIndex}`;
}

function joinProjectPath(projectPath: string, fileName: string): string {
  return `${projectPath.replace(/[\\/]+$/, '')}/${fileName}`;
}

/***********************环境变量扫描*********************/

function parseEnvLine(line: string): ParsedEnvLine | null {
  const match = line.match(/^(\s*)(#\s*)?((VITE_[A-Z0-9_]+)\s*=.*)$/);
  if (!match) {
    return null;
  }

  const body = match[3];
  const key = match[4];
  const valueMatch = body.match(/^[^=]+=(.*)$/);
  const value = valueMatch ? valueMatch[1].trim() : '';

  return {
    indent: match[1],
    commented: Boolean(match[2]),
    key,
    body,
    value,
  };
}

export function scanEnvFile(filePath: string, content: string): FrontendEnvGroup[] {
  const groups = new Map<string, FrontendEnvCandidate[]>();
  const lines = splitLines(content);

  lines.forEach((line, lineIndex) => {
    const parsed = parseEnvLine(line);
    if (!parsed || !parsed.key.startsWith(ENV_KEY_PREFIX)) {
      return;
    }

    const candidates = groups.get(parsed.key) || [];
    candidates.push({
      id: createCandidateId(filePath, 'env', parsed.key, lineIndex),
      value: parsed.value,
      active: !parsed.commented,
      lineIndex,
    });
    groups.set(parsed.key, candidates);
  });

  return [...groups.entries()]
    .filter(([, candidates]) => candidates.length >= 2)
    .map(([key, candidates]) => ({
      id: `${filePath}:env:${key}`,
      type: 'env' as const,
      key,
      filePath,
      fileName: getFileName(filePath),
      candidates,
    }));
}

/***********************Vite代理扫描*********************/

function countBraceDelta(line: string): number {
  let delta = 0;
  for (const char of line) {
    if (char === '{') delta += 1;
    if (char === '}') delta -= 1;
  }
  return delta;
}

function parseProxyBlockKey(line: string): string | null {
  const match = line.match(/^\s*(?:(['"`])([^'"`]+)\1|\[([A-Za-z_$][\w$]*)\]|([A-Za-z_$][\w$]*))\s*:\s*\{/);
  const rawKey = match?.[2] || match?.[3] || match?.[4] || null;
  if (!rawKey) {
    return null;
  }

  // Vite 代理路径通常写成 '/api'，面板里展示为 api 便于快速识别。
  return rawKey.startsWith('/') ? rawKey.replace(/^\/+/, '') || rawKey : rawKey;
}

function parseProxyTargetLine(line: string): ParsedProxyTargetLine | null {
  const match = line.match(/^(\s*)(\/\/\s*)?(target\s*:\s*(['"`])([^'"`]+)\4\s*,?.*)$/);
  if (!match) {
    return null;
  }

  return {
    indent: match[1],
    commented: Boolean(match[2]),
    body: match[3],
    value: match[5],
  };
}

function findObjectBlockEnd(lines: string[], startIndex: number): number {
  let depth = countBraceDelta(lines[startIndex]);
  for (let lineIndex = startIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    depth += countBraceDelta(lines[lineIndex]);
    if (depth <= 0) {
      return lineIndex;
    }
  }

  return lines.length - 1;
}

function collectProxyTargetCandidates(
  filePath: string,
  key: string,
  lines: string[],
  blockStart: number,
  blockEnd: number,
): FrontendEnvCandidate[] {
  const candidates: FrontendEnvCandidate[] = [];
  let depth = countBraceDelta(lines[blockStart]);

  for (let lineIndex = blockStart + 1; lineIndex < blockEnd; lineIndex += 1) {
    if (depth === 1) {
      const parsed = parseProxyTargetLine(lines[lineIndex]);
      if (parsed) {
        candidates.push({
          id: createCandidateId(filePath, 'proxy', key, lineIndex),
          value: parsed.value,
          active: !parsed.commented,
          lineIndex,
        });
      }
    }

    depth += countBraceDelta(lines[lineIndex]);
  }

  return candidates;
}

function scanProxyObject(filePath: string, lines: string[], proxyStart: number, proxyEnd: number): FrontendEnvGroup[] {
  const groups: FrontendEnvGroup[] = [];

  for (let index = proxyStart + 1; index < proxyEnd; index += 1) {
    const key = parseProxyBlockKey(lines[index]);
    if (!key) {
      continue;
    }

    const blockEnd = findObjectBlockEnd(lines, index);
    const candidates = collectProxyTargetCandidates(filePath, key, lines, index, blockEnd);
    if (candidates.length > 0) {
      groups.push({
        id: `${filePath}:proxy:${key}`,
        type: 'proxy',
        key,
        filePath,
        fileName: getFileName(filePath),
        candidates,
      });
    }

    index = blockEnd;
  }

  return groups;
}

export function scanViteProxyFile(filePath: string, content: string): FrontendEnvGroup[] {
  const lines = splitLines(content);
  const groups: FrontendEnvGroup[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (parseProxyBlockKey(lines[index]) !== 'server') {
      continue;
    }

    const serverEnd = findObjectBlockEnd(lines, index);
    for (let serverIndex = index + 1; serverIndex < serverEnd; serverIndex += 1) {
      const serverKey = parseProxyBlockKey(lines[serverIndex]);
      if (!serverKey) {
        continue;
      }

      const blockEnd = findObjectBlockEnd(lines, serverIndex);
      if (serverKey === 'proxy') {
        groups.push(...scanProxyObject(filePath, lines, serverIndex, blockEnd));
      }

      serverIndex = blockEnd;
    }

    index = serverEnd;
  }

  return groups;
}

/***********************项目环境扫描*********************/

export async function scanFrontendEnvProject(
  projectPath: string,
  fileSystem: FrontendEnvProjectFileSystem,
): Promise<FrontendEnvGroup[]> {
  let entries: FrontendEnvScanFileEntry[] = [];
  try {
    entries = await fileSystem.readDir(projectPath);
  } catch {
    return [];
  }

  const groups: FrontendEnvGroup[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }

    const filePath = joinProjectPath(projectPath, entry.name);
    if (isEnvFileName(entry.name)) {
      const content = await fileSystem.readTextFile(filePath).catch(() => '');
      if (!content) {
        continue;
      }
      groups.push(...scanEnvFile(filePath, content));
      continue;
    }

    if (isViteConfigFileName(entry.name)) {
      const content = await fileSystem.readTextFile(filePath).catch(() => '');
      if (!content) {
        continue;
      }
      groups.push(...scanViteProxyFile(filePath, content));
    }
  }

  return groups;
}

/***********************候选切换*********************/

function switchEnvCandidate(content: string, target: FrontendEnvSwitchTarget): string {
  const lines = splitLines(content);
  const group = scanEnvFile('', content).find(item => item.key === target.key);
  const matched = group?.candidates.some(item => item.value === target.value);
  if (!group || !matched) {
    throw new Error(`Environment candidate not found: ${target.key}=${target.value}`);
  }

  for (const candidate of group.candidates) {
    const parsed = parseEnvLine(lines[candidate.lineIndex]);
    if (!parsed) {
      throw new Error(`Environment candidate line changed: ${target.key}`);
    }

    lines[candidate.lineIndex] = parsed.value === target.value
      ? `${parsed.indent}${parsed.body}`
      : `${parsed.indent}# ${parsed.body}`;
  }

  return lines.join(getLineEnding(content));
}

function switchProxyCandidate(content: string, target: FrontendEnvSwitchTarget): string {
  const lines = splitLines(content);
  const group = scanViteProxyFile('', content).find(item => item.key === target.key);
  const matched = group?.candidates.some(item => item.value === target.value);
  if (!group || !matched) {
    throw new Error(`Proxy candidate not found: ${target.key} -> ${target.value}`);
  }

  for (const candidate of group.candidates) {
    const parsed = parseProxyTargetLine(lines[candidate.lineIndex]);
    if (!parsed) {
      throw new Error(`Proxy candidate line changed: ${target.key}`);
    }

    lines[candidate.lineIndex] = parsed.value === target.value
      ? `${parsed.indent}${parsed.body}`
      : `${parsed.indent}// ${parsed.body}`;
  }

  return lines.join(getLineEnding(content));
}

export function switchFrontendEnvCandidate(content: string, target: FrontendEnvSwitchTarget): string {
  return target.type === 'env'
    ? switchEnvCandidate(content, target)
    : switchProxyCandidate(content, target);
}
