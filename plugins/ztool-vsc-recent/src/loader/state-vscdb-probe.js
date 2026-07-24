"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStateVscdbProbe = createStateVscdbProbe;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const VSCDB_KEY = 'history.recentlyOpenedPathsList';
function defaultDbPath() {
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
function createStateVscdbProbe(dbPathOverride) {
    const dbPath = dbPathOverride ?? defaultDbPath();
    return {
        name: 'state.vscdb',
        async read() {
            if (!fs.existsSync(dbPath))
                return null;
            let buf;
            try {
                buf = fs.readFileSync(dbPath);
            }
            catch {
                return null;
            }
            // 按需加载 sql.js
            const initSqlJs = require('sql.js');
            const SQL = await initSqlJs({
                // sql.js 需要 wasm 文件，与主 JS 同目录
                locateFile: (file) => path.join(path.dirname(require.resolve('sql.js')), file),
            });
            let db;
            try {
                db = new SQL.Database(new Uint8Array(buf));
            }
            catch {
                return null;
            }
            try {
                const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
                stmt.bind([VSCDB_KEY]);
                if (!stmt.step()) {
                    stmt.free();
                    return [];
                }
                const row = stmt.getAsObject();
                stmt.free();
                const text = typeof row.value === 'string'
                    ? row.value
                    : Buffer.from(row.value).toString('utf-8');
                const parsed = JSON.parse(text);
                return Array.isArray(parsed?.entries) ? parsed.entries : [];
            }
            catch {
                return null;
            }
            finally {
                db.close();
            }
        },
    };
}
