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
exports.createStorageJsonProbe = createStorageJsonProbe;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function defaultJsonPath() {
    const platform = process.platform;
    if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'storage.json');
    }
    if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'storage.json');
    }
    return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'storage.json');
}
function createStorageJsonProbe(jsonPathOverride) {
    const jsonPath = jsonPathOverride ?? defaultJsonPath();
    return {
        name: 'storage.json',
        async read() {
            if (!fs.existsSync(jsonPath))
                return null;
            let parsed;
            try {
                const text = fs.readFileSync(jsonPath, 'utf-8');
                parsed = JSON.parse(text);
            }
            catch {
                return null;
            }
            const out = [];
            const bw = parsed.backupWorkspaces;
            if (bw) {
                for (const f of bw.folders ?? []) {
                    if (f.folderUri)
                        out.push({ folderUri: f.folderUri });
                }
                for (const w of bw.workspaces ?? []) {
                    const cp = w.configURIPath ?? w.configPath;
                    if (cp && w.id)
                        out.push({ workspace: { id: w.id, configPath: cp } });
                }
            }
            const ws = parsed.windowsState;
            if (ws?.openedWindows) {
                for (const win of ws.openedWindows) {
                    if (win.folder)
                        out.push({ folderUri: win.folder });
                    if (win.workspace)
                        out.push({ workspace: win.workspace });
                }
            }
            return out;
        },
    };
}
