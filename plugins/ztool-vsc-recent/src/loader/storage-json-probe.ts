import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RawEntry, SourceProbe } from '../types';

interface StorageJson {
  backupWorkspaces?: {
    folders?: Array<{ folderUri?: string }>;
    workspaces?: Array<{ id?: string; configURIPath?: string; configPath?: string }>;
  };
  windowsState?: {
    lastActiveWindow?: { folder?: string };
    openedWindows?: Array<{ folder?: string; workspace?: { id: string; configPath: string } }>;
  };
}

function defaultJsonPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'storage.json');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'storage.json');
  }
  return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'storage.json');
}

export function createStorageJsonProbe(jsonPathOverride?: string): SourceProbe {
  const jsonPath = jsonPathOverride ?? defaultJsonPath();
  return {
    name: 'storage.json',
    async read(): Promise<RawEntry[] | null> {
      if (!fs.existsSync(jsonPath)) return null;
      let parsed: StorageJson;
      try {
        const text = fs.readFileSync(jsonPath, 'utf-8');
        parsed = JSON.parse(text) as StorageJson;
      } catch {
        return null;
      }
      const out: RawEntry[] = [];

      const bw = parsed.backupWorkspaces;
      if (bw) {
        for (const f of bw.folders ?? []) {
          if (f.folderUri) out.push({ folderUri: f.folderUri });
        }
        for (const w of bw.workspaces ?? []) {
          const cp = w.configURIPath ?? w.configPath;
          if (cp && w.id) out.push({ workspace: { id: w.id, configPath: cp } });
        }
      }

      const ws = parsed.windowsState;
      if (ws?.openedWindows) {
        for (const win of ws.openedWindows) {
          if (win.folder) out.push({ folderUri: win.folder });
          if (win.workspace) out.push({ workspace: win.workspace });
        }
      }
      return out;
    },
  };
}
