const {
    getStorageItem,
    setStorageItem
} = require('./storage');

const PENDING_CAPTURES_KEY = 'wf_pending_captures';
const MAX_PENDING_CAPTURES = 50;

const trimString = (value) => String(value || '').trim();

const normalizeTargetRef = (value) => {
    const text = trimString(value);
    return text === 'None' ? '' : text;
};

const normalizePendingCapture = (record = {}) => {
    const text = trimString(record.text);
    if (!text) return null;

    const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
    const updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;
    const attempts = Number.isFinite(record.attempts) && record.attempts > 0
        ? Math.floor(record.attempts)
        : 1;

    return {
        id: trimString(record.id) || `pending_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
        text,
        targetParentId: normalizeTargetRef(record.targetParentId),
        targetParentName: trimString(record.targetParentName),
        sourceMode: trimString(record.sourceMode) || 'add',
        createdAt,
        updatedAt,
        attempts,
        lastError: trimString(record.lastError)
    };
};

const loadPendingCaptures = () => {
    const stored = getStorageItem(PENDING_CAPTURES_KEY);
    if (!Array.isArray(stored)) return [];
    return stored
        .map(normalizePendingCapture)
        .filter(Boolean)
        .sort((left, right) => right.updatedAt - left.updatedAt);
};

const persistPendingCaptures = (records) => {
    const next = (Array.isArray(records) ? records : [])
        .map(normalizePendingCapture)
        .filter(Boolean)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_PENDING_CAPTURES);
    setStorageItem(PENDING_CAPTURES_KEY, next);
    return next;
};

const enqueuePendingCapture = ({
    text,
    targetParentId,
    targetParentName,
    sourceMode,
    error
} = {}) => {
    const normalized = normalizePendingCapture({
        text,
        targetParentId,
        targetParentName,
        sourceMode,
        lastError: error,
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
    if (!normalized) return null;

    const records = loadPendingCaptures();
    const existing = records.find(item => (
        item.text === normalized.text
        && item.targetParentId === normalized.targetParentId
    ));
    const record = existing
        ? {
            ...existing,
            targetParentName: normalized.targetParentName || existing.targetParentName,
            sourceMode: normalized.sourceMode || existing.sourceMode,
            lastError: normalized.lastError || existing.lastError,
            updatedAt: Date.now(),
            attempts: existing.attempts + 1
        }
        : normalized;

    persistPendingCaptures([record, ...records.filter(item => item.id !== record.id)]);
    return record;
};

const markPendingCaptureFailed = (id, error) => {
    const records = loadPendingCaptures();
    const existing = records.find(item => item.id === id);
    if (!existing) return null;

    const updated = {
        ...existing,
        lastError: trimString(error) || existing.lastError,
        updatedAt: Date.now(),
        attempts: existing.attempts + 1
    };
    persistPendingCaptures([updated, ...records.filter(item => item.id !== id)]);
    return updated;
};

const getPendingCapture = (id) => loadPendingCaptures().find(item => item.id === id) || null;

const listPendingCaptures = () => loadPendingCaptures();

const removePendingCapture = (id) => {
    if (!trimString(id)) return loadPendingCaptures();
    return persistPendingCaptures(loadPendingCaptures().filter(item => item.id !== id));
};

const removePendingCapturesByText = (text, targetParentId) => {
    const normalizedText = trimString(text);
    if (!normalizedText) return loadPendingCaptures();
    const normalizedTarget = normalizeTargetRef(targetParentId);
    return persistPendingCaptures(loadPendingCaptures().filter(item => (
        item.text !== normalizedText || item.targetParentId !== normalizedTarget
    )));
};

module.exports = {
    PENDING_CAPTURES_KEY,
    MAX_PENDING_CAPTURES,
    normalizeTargetRef,
    normalizePendingCapture,
    loadPendingCaptures,
    listPendingCaptures,
    getPendingCapture,
    enqueuePendingCapture,
    markPendingCaptureFailed,
    removePendingCapture,
    removePendingCapturesByText
};
