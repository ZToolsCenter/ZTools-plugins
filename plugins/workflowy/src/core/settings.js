const { normalizeNodes, isUuidId } = require('../utils/helpers');
const {
    DEFAULT_OSS_PATH_PREFIX,
    DEFAULT_OSS_IMAGE_TAG,
    normalizeOssSettings
} = require('../api/oss');
const {
    DEFAULT_MARKDOWN_FILE_ICON,
    DEFAULT_MARKDOWN_FILE_TAG,
    normalizeMarkdownFileIcon,
    normalizeMarkdownFileTag
} = require('../utils/attachments');
const {
    resolveDbStorage,
    getStorageItem,
    setStorageItem
} = require('./storage');

const SETTINGS_KEY = 'settings';
const TARGET_SCHEMA_VERSION = 2;
const TARGET_UNIFICATION_NOTICE = 'target_unification_migrated';
const LEGACY_DATE_CACHE_NOTICE = 'legacy_date_cache_cleared';
const DEFAULT_WEB_TAG = 'web';
const SETTINGS_EXPORT_FORMAT = 'utools-workflowy-inbox-settings';
const SETTINGS_EXPORT_VERSION = 1;
const SETTINGS_EXPORT_FILE_PREFIX = 'utools-workflowy-inbox-settings';
const LEGACY_DATE_CACHE_PREFIXES = ['wf_daily_', 'wf_year_', 'wf_month_'];

// In-memory cache to avoid repeated storage reads
let settingsCache = null;

const defaultCaptureTarget = Object.freeze({
    ref: 'inbox',
    refType: 'target',
    name: 'Inbox'
});

const defaultSettings = {
    schemaVersion: TARGET_SCHEMA_VERSION,
    apiKey: '',
    separator: ' - ',
    useTimestamp: true,
    timestampMode: 'per_entry',
    enableLinkTitleFetch: true,
    webTagEnabled: true,
    webTag: DEFAULT_WEB_TAG,
    // 'parent': a single bare clipboard link becomes the parent of the typed
    // note. 'fill': legacy behavior, uTools auto-fills the link into the
    // input. 'off': never read the clipboard for staging.
    prefillPolicy: 'parent',
    createPosition: 'bottom',
    defaultTag: '',
    ossEnabled: false,
    ossRegion: '',
    ossEndpoint: '',
    ossBucket: '',
    ossAccessKeyId: '',
    ossAccessKeySecret: '',
    ossPathPrefix: DEFAULT_OSS_PATH_PREFIX,
    ossCustomDomain: '',
    ossImageTagEnabled: true,
    ossImageTag: DEFAULT_OSS_IMAGE_TAG,
    ossMarkdownViewerEnabled: false,
    ossMarkdownViewerReady: false,
    ossFileIconEnabled: true,
    ossFileIcon: DEFAULT_MARKDOWN_FILE_ICON,
    ossFileTagEnabled: true,
    ossFileTag: DEFAULT_MARKDOWN_FILE_TAG,
    tags: [],
    nodes: [],
    captureTarget: { ...defaultCaptureTarget },
    savedTargets: [],
    recentMoveTargets: [],
    pendingNotices: []
};

const cloneDefaultCaptureTarget = () => ({ ...defaultCaptureTarget });

const titleCaseTargetName = (value) => String(value || '')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const fallbackTargetName = (ref) => {
    if (!ref) return 'Untitled';
    if (isUuidId(ref)) return '未命名节点';
    return titleCaseTargetName(ref) || ref;
};

const inferRefType = (ref, refType) => {
    if (refType === 'uuid' || refType === 'target') return refType;
    return isUuidId(ref) ? 'uuid' : 'target';
};

const buildEntryId = (index, ref) => {
    const slug = String(ref || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24) || 'item';
    return `target_${index + 1}_${slug}`;
};

const uniqueItems = (values) => {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).filter(value => {
        if (typeof value !== 'string' || !value.trim() || seen.has(value)) return false;
        seen.add(value);
        return true;
    });
};

// Deep clone to prevent caller mutation from corrupting settings
// Uses JSON round-trip as the simplest portable deep-copy for plain objects/arrays/primitives
const deepClone = (value) => {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
};

const clearLegacyDateCacheKeys = () => {
    const utoolsDb = globalThis?.window?.ztools?.db;
    if (!utoolsDb || typeof utoolsDb.allDocs !== 'function' || typeof utoolsDb.remove !== 'function') {
        return false;
    }

    const docs = utoolsDb.allDocs(LEGACY_DATE_CACHE_PREFIXES);
    if (!Array.isArray(docs) || docs.length === 0) return false;

    docs.forEach((doc) => {
        if (!doc?._id) return;
        try {
            utoolsDb.remove(doc);
        } catch (error) {
            // Ignore partial cleanup failures; this is a best-effort migration.
        }
    });
    return true;
};

const normalizeSimpleTag = (value, fallback = '') => {
    const normalized = String(value || '').trim().replace(/^#+/g, '').toLowerCase();
    return normalized || fallback;
};

const normalizeSavedTargets = (savedTargets) => {
    const usedIds = new Set();
    return (Array.isArray(savedTargets) ? savedTargets : []).map((target, index) => {
        const ref = String(target?.ref || target?.id || '').trim();
        if (!ref) return null;

        let entryId = String(target?.id || '').trim();
        if (!entryId || usedIds.has(entryId)) entryId = buildEntryId(index, ref);
        while (usedIds.has(entryId)) entryId = `${entryId}_dup`;
        usedIds.add(entryId);

        return {
            id: entryId,
            ref,
            refType: inferRefType(ref, target?.refType),
            name: String(target?.name || '').trim() || fallbackTargetName(ref),
            pinned: !!target?.pinned
        };
    }).filter(Boolean);
};

const normalizeCaptureTarget = (captureTarget, savedTargets) => {
    const ref = String(captureTarget?.ref || '').trim();
    if (ref) {
        return {
            ref,
            refType: inferRefType(ref, captureTarget?.refType),
            name: String(captureTarget?.name || '').trim() || fallbackTargetName(ref)
        };
    }

    const firstSaved = savedTargets[0];
    if (firstSaved) {
        return {
            ref: firstSaved.ref,
            refType: firstSaved.refType,
            name: firstSaved.name
        };
    }

    return cloneDefaultCaptureTarget();
};

const extractLegacyNodes = (stored) => {
    if (Array.isArray(stored?.nodes) && stored.nodes.length > 0) {
        return normalizeNodes(stored.nodes);
    }

    const nodes = [];
    if (Array.isArray(stored?.taskboxes)) {
        stored.taskboxes.forEach((taskbox, index) => {
            if (taskbox && taskbox.id) {
                nodes.push({
                    id: taskbox.id,
                    name: taskbox.name || `任务箱 ${index + 1}`,
                    isDefault: index === 0
                });
            }
        });
    }
    if (stored?.parentId && stored.parentId !== 'None' && !nodes.some(node => node.id === stored.parentId)) {
        nodes.push({ id: stored.parentId, name: '收集箱', isDefault: nodes.length === 0 });
    }
    if (nodes.length === 0) {
        nodes.push({ id: 'inbox', name: '我的收集箱', isDefault: true });
    }
    return normalizeNodes(nodes);
};

const migrateNodesToTargets = (stored) => {
    const legacyNodes = extractLegacyNodes(stored);
    const defaultNode = legacyNodes.find(node => node.isDefault) || legacyNodes[0];

    const captureTarget = defaultNode?.useDaily
        ? { ref: 'today', refType: 'target', name: 'Today' }
        : {
            ref: defaultNode?.id || defaultCaptureTarget.ref,
            refType: inferRefType(defaultNode?.id || defaultCaptureTarget.ref, defaultNode?.type),
            name: String(defaultNode?.name || '').trim() || fallbackTargetName(defaultNode?.id || defaultCaptureTarget.ref)
        };

    const savedTargets = legacyNodes.map((node, index) => ({
        id: buildEntryId(index, node.id),
        ref: node.id,
        refType: inferRefType(node.id, node.type),
        name: String(node.name || '').trim() || fallbackTargetName(node.id),
        pinned: false
    }));

    return {
        schemaVersion: TARGET_SCHEMA_VERSION,
        nodes: legacyNodes,
        captureTarget,
        savedTargets,
        pendingNotices: uniqueItems([...(stored?.pendingNotices || []), TARGET_UNIFICATION_NOTICE])
    };
};

const detectLegacySchema = (stored) => {
    if (!stored || typeof stored !== 'object') return false;
    return !(
        Number(stored.schemaVersion) >= TARGET_SCHEMA_VERSION
        && stored.captureTarget
        && Array.isArray(stored.savedTargets)
    );
};

const normalizeSettingsShape = (input) => {
    const merged = { ...defaultSettings, ...(input || {}) };
    const normalizedOss = normalizeOssSettings(merged);

    if (typeof merged.tags === 'string') {
        merged.tags = merged.tags.split(',').map(tag => tag.trim()).filter(Boolean);
    }
    if (!['per_entry', 'group_today'].includes(merged.timestampMode)) {
        merged.timestampMode = defaultSettings.timestampMode;
    }
    if (merged.createPosition !== 'top' && merged.createPosition !== 'bottom') {
        merged.createPosition = defaultSettings.createPosition;
    }

    merged.tags = uniqueItems(merged.tags);
    merged.pendingNotices = uniqueItems(merged.pendingNotices);
    merged.nodes = Array.isArray(merged.nodes) && merged.nodes.length > 0 ? normalizeNodes(merged.nodes) : [];
    merged.savedTargets = normalizeSavedTargets(merged.savedTargets);
    merged.captureTarget = normalizeCaptureTarget(merged.captureTarget, merged.savedTargets);
    merged.recentMoveTargets = normalizeSavedTargets(merged.recentMoveTargets).slice(0, 5);
    merged.webTagEnabled = merged.webTagEnabled !== false;
    merged.webTag = normalizeSimpleTag(merged.webTag, DEFAULT_WEB_TAG);
    if (!['parent', 'fill', 'off'].includes(merged.prefillPolicy)) {
        merged.prefillPolicy = defaultSettings.prefillPolicy;
    }
    merged.ossEnabled = normalizedOss.ossEnabled;
    merged.ossRegion = normalizedOss.ossRegion;
    merged.ossEndpoint = normalizedOss.ossEndpoint;
    merged.ossBucket = normalizedOss.ossBucket;
    merged.ossAccessKeyId = normalizedOss.ossAccessKeyId;
    merged.ossAccessKeySecret = normalizedOss.ossAccessKeySecret;
    merged.ossPathPrefix = normalizedOss.ossPathPrefix;
    merged.ossCustomDomain = normalizedOss.ossCustomDomain;
    merged.ossImageTagEnabled = normalizedOss.ossImageTagEnabled;
    merged.ossImageTag = normalizedOss.ossImageTag;
    merged.ossMarkdownViewerEnabled = merged.ossMarkdownViewerEnabled === true;
    merged.ossMarkdownViewerReady = merged.ossMarkdownViewerReady === true;
    merged.ossFileIconEnabled = merged.ossFileIconEnabled !== false;
    merged.ossFileIcon = normalizeMarkdownFileIcon(merged.ossFileIcon);
    merged.ossFileTagEnabled = merged.ossFileTagEnabled !== false;
    merged.ossFileTag = normalizeMarkdownFileTag(merged.ossFileTag);
    merged.schemaVersion = TARGET_SCHEMA_VERSION;

    const cleaned = { ...merged };
    delete cleaned.taskboxes;
    delete cleaned.parentId;
    return cleaned;
};

const applyOneTimeSettingsMaintenance = (settings) => {
    const notices = Array.isArray(settings?.pendingNotices) ? settings.pendingNotices : [];
    if (notices.includes(LEGACY_DATE_CACHE_NOTICE)) return settings;

    clearLegacyDateCacheKeys();
    const next = normalizeSettingsShape({
        ...settings,
        pendingNotices: [...notices, LEGACY_DATE_CACHE_NOTICE]
    });
    setStorageItem(SETTINGS_KEY, next);
    return next;
};

const persistMigratedSettings = (migratedSettings, baseStored) => {
    const next = normalizeSettingsShape({ ...(baseStored || {}), ...(migratedSettings || {}) });
    setStorageItem(SETTINGS_KEY, next);
    return next;
};

const getSettings = () => {
    if (settingsCache !== null) {
        return settingsCache;
    }

    const stored = getStorageItem(SETTINGS_KEY);
    const detectedMigrated = detectLegacySchema(stored);

    let normalized;
    if (detectedMigrated) {
        const migrated = migrateNodesToTargets(stored || {});
        normalized = persistMigratedSettings(migrated, stored);
    } else {
        normalized = normalizeSettingsShape(stored);
    }

    // Legacy cleanup runs every time to ensure old cache keys are removed
    // applyOneTimeSettingsMaintenance handles the one-time notice check internally
    settingsCache = applyOneTimeSettingsMaintenance(normalized);
    return settingsCache;
};

const saveSettings = (newPartial) => {
    // Guard against undefined/null argument - must be an object
    const safePartial = (newPartial == null) ? {} : newPartial;

    // Clear cache to force fresh read
    settingsCache = null;

    const current = getSettings();
    // Deep-clone newPartial to prevent caller mutation from corrupting settings
    const updated = { ...current, ...deepClone(safePartial) };

    if ('nodes' in (safePartial) || 'taskboxes' in (safePartial) || 'parentId' in (safePartial)) {
        updated = { ...updated, ...migrateNodesToTargets(updated) };
    }

    const normalized = normalizeSettingsShape(updated);
    try {
        setStorageItem(SETTINGS_KEY, normalized);
    } catch (error) {
        // Restore cache to prevent repeated storage reads on every subsequent getSettings call
        settingsCache = current;
        throw error;
    }

    // Update cache with new normalized settings
    settingsCache = normalized;
    return normalized;
};

// Force refresh settings cache (call after external changes or in tests)
const refreshSettingsCache = () => {
    settingsCache = null;
    return getSettings();
};

// Clear settings cache - primarily for testing
const clearSettingsCache = () => {
    settingsCache = null;
};

const buildSettingsExportData = (settings = getSettings()) => ({
    format: SETTINGS_EXPORT_FORMAT,
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: normalizeSettingsShape(settings)
});

const padDatePart = (value) => String(value).padStart(2, '0');

const buildSettingsExportFilename = (date = new Date()) => {
    const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const yyyy = safeDate.getFullYear();
    const mm = padDatePart(safeDate.getMonth() + 1);
    const dd = padDatePart(safeDate.getDate());
    const hh = padDatePart(safeDate.getHours());
    const mi = padDatePart(safeDate.getMinutes());
    const ss = padDatePart(safeDate.getSeconds());
    return `${SETTINGS_EXPORT_FILE_PREFIX}-${yyyy}-${mm}-${dd}-${hh}${mi}${ss}.json`;
};

const buildSettingsExportText = (settings = getSettings()) => (
    `${JSON.stringify(buildSettingsExportData(settings), null, 2)}\n`
);

const parseSettingsImportData = (input) => {
    let parsed = input;
    if (typeof input === 'string') {
        const text = input.trim();
        if (!text) throw new Error('配置 JSON 不能为空');
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            throw new Error('配置 JSON 格式错误');
        }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('配置数据必须是 JSON 对象');
    }

    const isWrappedExport = parsed.format === SETTINGS_EXPORT_FORMAT
        || Object.prototype.hasOwnProperty.call(parsed, 'settings');
    if (isWrappedExport) {
        if (parsed.format && parsed.format !== SETTINGS_EXPORT_FORMAT) {
            throw new Error('配置导入格式不受支持');
        }
        if (Object.prototype.hasOwnProperty.call(parsed, 'version')
            && Number(parsed.version) !== SETTINGS_EXPORT_VERSION) {
            throw new Error(`配置导入版本不受支持：${parsed.version}`);
        }
    }
    const rawSettings = isWrappedExport ? parsed.settings : parsed;
    if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
        throw new Error('未找到可导入的配置内容');
    }

    return normalizeSettingsShape(rawSettings);
};

const importSettingsData = (input) => {
    const normalized = parseSettingsImportData(input);
    resolveDbStorage();
    setStorageItem(SETTINGS_KEY, normalized);
    // Update cache with imported settings
    settingsCache = normalized;
    return normalized;
};

module.exports = {
    TARGET_SCHEMA_VERSION,
    TARGET_UNIFICATION_NOTICE,
    LEGACY_DATE_CACHE_NOTICE,
    LEGACY_DATE_CACHE_PREFIXES,
    clearLegacyDateCacheKeys,
    DEFAULT_WEB_TAG,
    SETTINGS_EXPORT_FORMAT,
    SETTINGS_EXPORT_VERSION,
    SETTINGS_EXPORT_FILE_PREFIX,
    defaultCaptureTarget,
    defaultSettings,
    detectLegacySchema,
    migrateNodesToTargets,
    persistMigratedSettings,
    getSettings,
    saveSettings,
    refreshSettingsCache,
    clearSettingsCache,
    buildSettingsExportData,
    buildSettingsExportFilename,
    buildSettingsExportText,
    parseSettingsImportData,
    importSettingsData
};
