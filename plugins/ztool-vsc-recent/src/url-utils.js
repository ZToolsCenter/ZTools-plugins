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
exports.fileUriToPath = fileUriToPath;
exports.prettyPath = prettyPath;
exports.normalizeId = normalizeId;
const url = __importStar(require("url"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/**
 * 把 file:///c%3A/x 解码为系统路径；非 file: 协议原样返回。
 */
function fileUriToPath(uri) {
    if (!uri.startsWith('file:'))
        return uri;
    try {
        return url.fileURLToPath(uri);
    }
    catch {
        // On Windows, fileURLToPath throws for POSIX-style paths like file:///home/x.
        // Extract the path portion manually and convert slashes to backslashes.
        try {
            const parsed = new URL(uri);
            const decoded = decodeURIComponent(parsed.pathname);
            return decoded.replace(/\//g, path.sep);
        }
        catch {
            return uri;
        }
    }
}
/**
 * home 目录前缀替换为 ~。Windows 下保留反斜杠原样。
 */
function prettyPath(p) {
    const home = os.homedir();
    if (p.toLowerCase().startsWith(home.toLowerCase())) {
        return '~' + p.slice(home.length);
    }
    return p;
}
/**
 * 生成去重 ID。
 * 本地路径：path.normalize + 全小写（Windows 大小写不敏感且 / \ 等价）。
 * Remote URI：原样（区分大小写）。
 */
function normalizeId(p, opts = {}) {
    if (opts.isRemote)
        return p;
    const normalized = path.normalize(p);
    // Windows + macOS 默认大小写不敏感；POSIX (Linux) 大小写敏感，不能 lowercase 否则会 collide
    // /home/Alice/x 与 /home/alice/x 这样的不同文件。
    const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
    return caseInsensitive ? normalized.toLowerCase() : normalized;
}
