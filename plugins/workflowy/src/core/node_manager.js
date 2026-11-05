const { getSettings, saveSettings, defaultCaptureTarget } = require('./settings');
const { validateTaskboxId, humanizeRefName } = require('../utils/helpers');
const RECENT_MOVE_TARGET_LIMIT = 5;

const normalizeRefType = (ref, refType) => {
    if (refType === 'uuid' || refType === 'target') return refType;
    return validateTaskboxId(ref).type || 'target';
};

const getSavedTargets = () => {
    const settings = getSettings();
    return Array.isArray(settings.savedTargets) ? settings.savedTargets : [];
};

const getCaptureTarget = () => {
    const settings = getSettings();
    return settings.captureTarget || { ...defaultCaptureTarget };
};

const getRecentMoveTargets = () => {
    const settings = getSettings();
    return Array.isArray(settings.recentMoveTargets) ? settings.recentMoveTargets : [];
};

const getNodes = () => {
    const captureTarget = getCaptureTarget();
    return getSavedTargets().map(target => ({
        id: target.ref,
        entryId: target.id,
        name: target.name,
        type: target.refType,
        isCapture: target.ref === captureTarget.ref
    }));
};

const getDefaultNode = () => {
    const captureTarget = getCaptureTarget();
    return {
        id: captureTarget.ref,
        name: captureTarget.name,
        type: captureTarget.refType,
        refType: captureTarget.refType
    };
};

const syncCaptureNameIfNeeded = (originalRef, updatedName) => {
    const captureTarget = getCaptureTarget();
    if (captureTarget.ref !== originalRef) return null;
    return {
        ...captureTarget,
        name: updatedName
    };
};

const normalizeTargetForStorage = (ref, name, refType) => {
    const normalizedRef = String(ref || '').trim();
    const validation = validateTaskboxId(normalizedRef);
    if (!validation.valid) return { success: false, message: validation.message };

    return {
        success: true,
        target: {
            ref: normalizedRef,
            refType: normalizeRefType(normalizedRef, refType || validation.type),
            name: String(name || '').trim() || humanizeRefName(normalizedRef)
        }
    };
};

const getQuickMoveTargets = (options = {}) => {
    const excludeRef = String(options.excludeRef || '').trim();
    const captureTarget = getCaptureTarget();
    const sourceTargets = [
        ...getRecentMoveTargets().map(target => ({ ...target, source: 'recent' })),
        ...getSavedTargets().map(target => ({ ...target, source: 'saved' })),
        captureTarget ? { ...captureTarget, source: 'capture' } : null
    ].filter(Boolean);

    const seen = new Set();
    return sourceTargets
        .map(target => {
            const normalized = normalizeTargetForStorage(target.ref, target.name, target.refType);
            return normalized.success
                ? { success: true, target: { ...normalized.target, source: target.source } }
                : normalized;
        })
        .filter(result => result.success)
        .map(result => result.target)
        .filter(target => {
            if (!target.ref || target.ref === excludeRef || seen.has(target.ref)) return false;
            seen.add(target.ref);
            return true;
        });
};

const rememberMoveTarget = (ref, name, refType) => {
    const normalized = normalizeTargetForStorage(ref, name, refType);
    if (!normalized.success) return normalized;

    const target = normalized.target;
    const nextTargets = [
        target,
        ...getRecentMoveTargets().filter(item => item.ref !== target.ref)
    ].slice(0, RECENT_MOVE_TARGET_LIMIT);

    saveSettings({ recentMoveTargets: nextTargets });
    return { success: true, target };
};

const TargetManager = {
    addSavedTarget(ref, name, refType) {
        const normalizedRef = String(ref || '').trim();
        const validation = validateTaskboxId(normalizedRef);
        if (!validation.valid) return { success: false, message: validation.message };

        const savedTargets = getSavedTargets();
        if (savedTargets.some(target => target.ref === normalizedRef)) {
            return { success: false, message: '引用已存在' };
        }

        saveSettings({
            savedTargets: [
                ...savedTargets,
                {
                    ref: normalizedRef,
                    refType: normalizeRefType(normalizedRef, refType || validation.type),
                    name: String(name || '').trim() || humanizeRefName(normalizedRef)
                }
            ]
        });
        return { success: true, type: normalizeRefType(normalizedRef, refType || validation.type) };
    },

    deleteSavedTarget(entryId) {
        const savedTargets = getSavedTargets();
        const nextTargets = savedTargets.filter(target => target.id !== entryId);
        if (nextTargets.length === savedTargets.length) return { success: false, message: '入口不存在' };

        saveSettings({ savedTargets: nextTargets });
        return { success: true };
    },

    updateSavedTargetName(entryId, newName) {
        const savedTargets = getSavedTargets();
        const target = savedTargets.find(item => item.id === entryId);
        if (!target) return { success: false, message: '入口不存在' };

        const trimmedName = String(newName || '').trim() || humanizeRefName(target.ref);
        const nextTargets = savedTargets.map(item => item.id === entryId ? { ...item, name: trimmedName } : item);
        const captureTarget = syncCaptureNameIfNeeded(target.ref, trimmedName);

        saveSettings({
            savedTargets: nextTargets,
            ...(captureTarget ? { captureTarget } : {})
        });
        return { success: true };
    },

    setCaptureTarget(ref, name, refType) {
        const normalizedRef = String(ref || '').trim();
        const validation = validateTaskboxId(normalizedRef);
        if (!validation.valid) return { success: false, message: validation.message };

        saveSettings({
            captureTarget: {
                ref: normalizedRef,
                refType: normalizeRefType(normalizedRef, refType || validation.type),
                name: String(name || '').trim() || humanizeRefName(normalizedRef)
            }
        });
        return { success: true };
    },

    setCaptureTargetByEntry(entryId) {
        const target = getSavedTargets().find(item => item.id === entryId);
        if (!target) return { success: false, message: '入口不存在' };
        return this.setCaptureTarget(target.ref, target.name, target.refType);
    }
};

const NodeManager = {
    add: (id, name, type) => TargetManager.addSavedTarget(id, name, type),
    delete: (entryId) => TargetManager.deleteSavedTarget(entryId),
    updateName: (entryId, newName) => TargetManager.updateSavedTargetName(entryId, newName),
    setDefault: (entryId) => TargetManager.setCaptureTargetByEntry(entryId),
    setDaily: () => true
};

module.exports = {
    RECENT_MOVE_TARGET_LIMIT,
    getSavedTargets,
    getCaptureTarget,
    getRecentMoveTargets,
    getNodes,
    getDefaultNode,
    getQuickMoveTargets,
    rememberMoveTarget,
    TargetManager,
    NodeManager
};
