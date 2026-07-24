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
exports.mapEntries = mapEntries;
const path = __importStar(require("path"));
const url_utils_1 = require("./url-utils");
/**
 * 把 VSCode 形态的 RawEntry[] 转为 UI 形态的 RecentItem[]。
 * 单文件历史 (fileUri) 被丢弃；解析失败的条目静默丢弃。
 */
function mapEntries(entries) {
    const out = [];
    for (const e of entries) {
        try {
            const item = mapOne(e);
            if (item)
                out.push(item);
        }
        catch {
            // 单条解析异常，丢弃
        }
    }
    return out;
}
function mapOne(e) {
    if (e.fileUri)
        return null;
    if (e.workspace?.configPath) {
        const uri = e.workspace.configPath;
        if (uri.startsWith('file:')) {
            const p = (0, url_utils_1.fileUriToPath)(uri);
            const title = e.label ?? path.basename(p).replace(/\.code-workspace$/, '');
            return {
                id: (0, url_utils_1.normalizeId)(p),
                kind: 'workspace',
                title,
                subtitle: (0, url_utils_1.prettyPath)(p),
                rawPath: p,
                exists: false, // 由 loader 阶段填充
            };
        }
        return null;
    }
    if (e.folderUri) {
        const uri = e.folderUri;
        if (uri.startsWith('file:')) {
            const p = (0, url_utils_1.fileUriToPath)(uri);
            return {
                id: (0, url_utils_1.normalizeId)(p),
                kind: 'folder',
                title: e.label ?? path.basename(p),
                subtitle: (0, url_utils_1.prettyPath)(p),
                rawPath: p,
                exists: false,
            };
        }
        // remote: vscode-remote://, vscode-vfs://, etc.
        const m = uri.match(/^[^:]+:\/\/([^/]+)(\/.*)?$/);
        const host = m?.[1] ?? uri;
        return {
            id: (0, url_utils_1.normalizeId)(uri, { isRemote: true }),
            kind: 'remote',
            title: e.label ?? host,
            subtitle: uri,
            rawPath: uri,
            exists: true,
        };
    }
    return null;
}
