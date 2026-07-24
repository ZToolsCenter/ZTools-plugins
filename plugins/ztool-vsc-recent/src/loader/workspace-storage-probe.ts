import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RawEntry, SourceProbe } from '../types';

interface WorkspaceJson {
  folder?: string;
  workspace?: string;
}

function defaultRoot(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
  }
  return path.join(os.homedir(), '.config', 'Code', 'User', 'workspaceStorage');
}

interface DirEntry {
  hash: string;
  raw: RawEntry;
  mtimeMs: number;
}

async function readOneDir(root: string, hash: string): Promise<DirEntry | null> {
  const dir = path.join(root, hash);
  try {
    const stat = await fsp.stat(dir);
    if (!stat.isDirectory()) return null;

    const wsJsonPath = path.join(dir, 'workspace.json');
    let text: string;
    try {
      text = await fsp.readFile(wsJsonPath, 'utf-8');
    } catch {
      return null;
    }
    const parsed = JSON.parse(text) as WorkspaceJson;

    let raw: RawEntry | null = null;
    if (parsed.folder) {
      raw = { folderUri: parsed.folder };
    } else if (parsed.workspace) {
      raw = { workspace: { id: hash, configPath: parsed.workspace } };
    }
    if (!raw) return null;

    return { hash, raw, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function createWorkspaceStorageProbe(rootOverride?: string): SourceProbe {
  const root = rootOverride ?? defaultRoot();
  return {
    name: 'workspaceStorage',
    async read(): Promise<RawEntry[] | null> {
      if (!fs.existsSync(root)) return null;
      let dirs: string[];
      try {
        dirs = await fsp.readdir(root);
      } catch {
        return null;
      }

      const results = await Promise.all(dirs.map(h => readOneDir(root, h)));
      const collected = results.filter((e): e is DirEntry => e !== null);
      collected.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return collected.map(c => c.raw);
    },
  };
}
