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
exports.createWorkspaceStorageProbe = createWorkspaceStorageProbe;
const fs = __importStar(require("fs"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function defaultRoot() {
    const platform = process.platform;
    if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage');
    }
    if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
    }
    return path.join(os.homedir(), '.config', 'Code', 'User', 'workspaceStorage');
}
async function readOneDir(root, hash) {
    const dir = path.join(root, hash);
    try {
        const stat = await fs_1.promises.stat(dir);
        if (!stat.isDirectory())
            return null;
        const wsJsonPath = path.join(dir, 'workspace.json');
        let text;
        try {
            text = await fs_1.promises.readFile(wsJsonPath, 'utf-8');
        }
        catch {
            return null;
        }
        const parsed = JSON.parse(text);
        let raw = null;
        if (parsed.folder) {
            raw = { folderUri: parsed.folder };
        }
        else if (parsed.workspace) {
            raw = { workspace: { id: hash, configPath: parsed.workspace } };
        }
        if (!raw)
            return null;
        return { hash, raw, mtimeMs: stat.mtimeMs };
    }
    catch {
        return null;
    }
}
function createWorkspaceStorageProbe(rootOverride) {
    const root = rootOverride ?? defaultRoot();
    return {
        name: 'workspaceStorage',
        async read() {
            if (!fs.existsSync(root))
                return null;
            let dirs;
            try {
                dirs = await fs_1.promises.readdir(root);
            }
            catch {
                return null;
            }
            const results = await Promise.all(dirs.map(h => readOneDir(root, h)));
            const collected = results.filter((e) => e !== null);
            collected.sort((a, b) => b.mtimeMs - a.mtimeMs);
            return collected.map(c => c.raw);
        },
    };
}
