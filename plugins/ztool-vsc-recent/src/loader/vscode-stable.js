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
exports.defaultProbes = defaultProbes;
exports.loadRecentDetailed = loadRecentDetailed;
exports.loadRecent = loadRecent;
const fs = __importStar(require("fs"));
const uri_mapper_1 = require("../uri-mapper");
const state_vscdb_probe_1 = require("./state-vscdb-probe");
const storage_json_probe_1 = require("./storage-json-probe");
const workspace_storage_probe_1 = require("./workspace-storage-probe");
/**
 * 默认 probe 顺序：workspaceStorage 主, state.vscdb 次, storage.json 兜底。
 */
function defaultProbes() {
    return [
        (0, workspace_storage_probe_1.createWorkspaceStorageProbe)(),
        (0, state_vscdb_probe_1.createStateVscdbProbe)(),
        (0, storage_json_probe_1.createStorageJsonProbe)(),
    ];
}
async function loadRecentDetailed(probes = defaultProbes(), existsCheck = fs.existsSync) {
    const diag = {
        probes: [],
        mappedCount: 0,
        finalCount: 0,
        droppedNonexistent: 0,
    };
    const allRaw = [];
    for (const p of probes) {
        try {
            const entries = await p.read();
            diag.probes.push({ name: p.name, rawCount: entries === null ? null : entries.length });
            if (entries)
                allRaw.push(...entries);
        }
        catch (e) {
            diag.probes.push({
                name: p.name,
                rawCount: null,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    const mapped = (0, uri_mapper_1.mapEntries)(allRaw);
    diag.mappedCount = mapped.length;
    if (mapped.length > 0)
        diag.examplePath = mapped[0].rawPath;
    // dedupe by id, preserve first-seen order
    const seen = new Set();
    const candidates = [];
    for (const item of mapped) {
        if (seen.has(item.id))
            continue;
        seen.add(item.id);
        candidates.push(item);
    }
    // parallel existence checks (remote always passes)
    const existsResults = await Promise.all(candidates.map(item => item.kind === 'remote' ? Promise.resolve(true) : Promise.resolve(existsCheck(item.rawPath))));
    const out = [];
    for (let i = 0; i < candidates.length; i++) {
        if (existsResults[i]) {
            out.push({ ...candidates[i], exists: true });
        }
        else {
            diag.droppedNonexistent++;
        }
    }
    diag.finalCount = out.length;
    return { items: out, diag };
}
async function loadRecent(probes = defaultProbes(), existsCheck = fs.existsSync) {
    const { items } = await loadRecentDetailed(probes, existsCheck);
    return items;
}
