import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RawEntry, SourceProbe } from '../types';

const VSCDB_KEY = 'history.recentlyOpenedPathsList';

function defaultDbPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'state.vscdb');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'state.vscdb');
  }
  // linux & others
  return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'state.vscdb');
}

export function createStateVscdbProbe(dbPathOverride?: string): SourceProbe {
  const dbPath = dbPathOverride ?? defaultDbPath();
  return {
    name: 'state.vscdb',
    async read(): Promise<RawEntry[] | null> {
      if (!fs.existsSync(dbPath)) return null;
      let buf: Buffer;
      try {
        buf = fs.readFileSync(dbPath);
      } catch {
        return null;
      }
      // 按需加载 sql.js
      const initSqlJs = require('sql.js') as (config?: { locateFile?: (f: string) => string }) => Promise<any>;
      const SQL = await initSqlJs({
        // sql.js 需要 wasm 文件，与主 JS 同目录
        locateFile: (file: string) => path.join(path.dirname(require.resolve('sql.js')), file),
      });
      let db: any;
      try {
        db = new SQL.Database(new Uint8Array(buf));
      } catch {
        return null;
      }
      try {
        const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
        stmt.bind([VSCDB_KEY]);
        if (!stmt.step()) {
          stmt.free();
          return [];
        }
        const row = stmt.getAsObject() as { value: string | Uint8Array };
        stmt.free();
        const text = typeof row.value === 'string'
          ? row.value
          : Buffer.from(row.value).toString('utf-8');
        const parsed = JSON.parse(text);
        return Array.isArray(parsed?.entries) ? parsed.entries : [];
      } catch {
        return null;
      } finally {
        db.close();
      }
    },
  };
}
