const {
    getStorageItem,
    setStorageItem
} = require('./storage');
const {
    normalizeAttachmentKind,
    buildPendingUploadRecord
} = require('../utils/attachments');

const RECENT_ATTACHMENTS_KEY = 'wf_recent_attachments';
const MAX_RECENT_ATTACHMENTS = 50;

const trimString = (value) => String(value || '').trim();

const normalizeRecentAttachment = (record = {}) => buildPendingUploadRecord({
    uploaded: {
        objectKey: record.objectKey,
        url: record.url,
        rawUrl: record.rawUrl,
        viewerUrl: record.viewerUrl,
        contentType: record.contentType,
        size: record.size
    },
    prepared: {
        name: record.name,
        displayName: record.displayName,
        originalSize: record.originalSize,
        size: record.size,
        kind: record.kind
    },
    payload: {
        id: record.id,
        kind: normalizeAttachmentKind(record.kind),
        name: record.name,
        displayName: record.displayName,
        size: record.originalSize || record.size,
        source: record.source
    },
    context: {
        uploadedAt: record.uploadedAt,
        targetParentId: record.targetParentId,
        targetParentName: record.targetParentName,
        sourceMode: record.sourceMode,
        captureText: record.captureText,
        status: record.status,
        lastError: record.lastError,
        workflowyNodeId: record.workflowyNodeId,
        savedAt: record.savedAt
    }
});

const loadRecentAttachments = () => {
    const stored = getStorageItem(RECENT_ATTACHMENTS_KEY);
    if (!Array.isArray(stored)) return [];
    return stored
        .map(normalizeRecentAttachment)
        .sort((left, right) => (right.uploadedAt || 0) - (left.uploadedAt || 0));
};

const persistRecentAttachments = (records) => {
    const next = (Array.isArray(records) ? records : [])
        .map(normalizeRecentAttachment)
        .sort((left, right) => (right.uploadedAt || 0) - (left.uploadedAt || 0))
        .slice(0, MAX_RECENT_ATTACHMENTS);
    setStorageItem(RECENT_ATTACHMENTS_KEY, next);
    return next;
};

const upsertRecentAttachment = (record) => {
    const normalized = normalizeRecentAttachment(record);
    const current = loadRecentAttachments().filter(item => item.id !== normalized.id);
    return persistRecentAttachments([normalized, ...current]);
};

const updateRecentAttachment = (id, patch = {}) => {
    if (!trimString(id)) return null;

    // Single read pattern - load once, update in-place, persist once
    const records = loadRecentAttachments();
    let updatedRecord = null;
    const next = records.map(item => {
        if (item.id !== id) return item;
        updatedRecord = normalizeRecentAttachment({ ...item, ...patch, id: item.id });
        return updatedRecord;
    });

    // Only persist if something was actually updated
    if (updatedRecord) {
        persistRecentAttachments(next);
    }
    return updatedRecord;
};

const getRecentAttachment = (id) => loadRecentAttachments().find(item => item.id === id) || null;

const listRecentAttachments = (options = {}) => {
    const includeDeleted = options.includeDeleted === true;
    const records = loadRecentAttachments();
    return includeDeleted ? records : records.filter(item => item.status !== 'deleted');
};

const markRecentAttachmentSaved = (id, patch = {}) => updateRecentAttachment(id, {
    ...patch,
    status: 'saved',
    lastError: '',
    savedAt: Date.now()
});

const markRecentAttachmentSaveFailed = (id, patch = {}) => updateRecentAttachment(id, {
    ...patch,
    status: 'save_failed'
});

const markRecentAttachmentDeleted = (id) => updateRecentAttachment(id, {
    status: 'deleted',
    lastError: ''
});

const removeRecentAttachment = (id) => {
    if (!trimString(id)) return [];
    return persistRecentAttachments(loadRecentAttachments().filter(item => item.id !== id));
};

const clearResolvedRecentAttachments = () => persistRecentAttachments(
    loadRecentAttachments().filter(item => !['saved', 'deleted'].includes(item.status))
);

module.exports = {
    RECENT_ATTACHMENTS_KEY,
    MAX_RECENT_ATTACHMENTS,
    normalizeRecentAttachment,
    loadRecentAttachments,
    listRecentAttachments,
    getRecentAttachment,
    upsertRecentAttachment,
    updateRecentAttachment,
    markRecentAttachmentSaved,
    markRecentAttachmentSaveFailed,
    markRecentAttachmentDeleted,
    removeRecentAttachment,
    clearResolvedRecentAttachments
};
