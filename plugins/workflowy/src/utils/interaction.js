const {
    normalizeOssSettings,
    getMissingOssFields,
    isOssConfigured
} = require('../api/oss');

const { t } = require('./i18n');

const RECOVERY_ATTACHMENT_STATUSES = new Set(['uploaded', 'save_failed']);
const RECENT_ATTACHMENT_STATUS_PRIORITY = {
    save_failed: 0,
    uploaded: 1,
    saved: 2,
    deleted: 3
};

const trimString = (value) => String(value || '').trim();

const getRecentAttachmentStatusLabel = (status) => {
    switch (status) {
        case 'saved':
            return t('saved');
        case 'save_failed':
            return t('saveFailed');
        case 'deleted':
            return t('deleted');
        default:
            return t('pending');
    }
};

const getRecentAttachmentNextStep = (attachment = {}) => {
    switch (attachment.status) {
        case 'save_failed':
            return t('nextStepRetry');
        case 'saved':
            return t('historyCopyLink');
        case 'deleted':
            return t('historyDeleted');
        default:
            return t('nextStepSave');
    }
};

const sortRecentAttachmentsForRecovery = (records = []) => [...(Array.isArray(records) ? records : [])]
    .sort((left, right) => {
        const leftPriority = RECENT_ATTACHMENT_STATUS_PRIORITY[left?.status] ?? RECENT_ATTACHMENT_STATUS_PRIORITY.uploaded;
        const rightPriority = RECENT_ATTACHMENT_STATUS_PRIORITY[right?.status] ?? RECENT_ATTACHMENT_STATUS_PRIORITY.uploaded;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return Number(right?.uploadedAt || 0) - Number(left?.uploadedAt || 0);
    });

const getPendingRecentAttachments = (records = [], limit = 3) => sortRecentAttachmentsForRecovery(records)
    .filter(item => RECOVERY_ATTACHMENT_STATUSES.has(item?.status || 'uploaded'))
    .slice(0, limit);

const formatRecentAttachmentDescription = (attachment = {}) => {
    const timeLabel = attachment.uploadedAt
        ? new Date(attachment.uploadedAt).toLocaleString()
        : 'Unknown';
    const parts = [
        getRecentAttachmentStatusLabel(attachment.status),
        timeLabel
    ];
    if (attachment.targetParentName) parts.push(attachment.targetParentName);
    if (attachment.lastError && attachment.status === 'save_failed') {
        parts.push(`${t('error')}: ${attachment.lastError}`);
    }
    parts.push(getRecentAttachmentNextStep(attachment));
    return parts.join(' | ');
};

const buildOssSetupStatus = (settings = {}) => {
    const normalized = normalizeOssSettings(settings);
    const missing = getMissingOssFields(normalized);
    const total = 4;
    const completed = total - missing.length;
    const enabledLabel = normalized.ossEnabled ? t('enabled') : t('disabled');
    const isConfigured = isOssConfigured(normalized);
    const description = isConfigured
        ? `${enabledLabel} | Required items completed, can test upload`
        : `${enabledLabel} | Missing: ${missing.join(' / ')}`;

    return {
        title: `OSS ${t('ossSettings').split(' ')[0]} ${completed}/${total}`,
        description,
        completed,
        total,
        missing,
        isConfigured
    };
};

const summarizeSettingsImport = (settings = {}) => {
    const normalized = settings || {};
    const savedTargetCount = Array.isArray(normalized.savedTargets) ? normalized.savedTargets.length : 0;
    const tagCount = Array.isArray(normalized.tags) ? normalized.tags.length : 0;
    const captureTargetName = trimString(normalized.captureTarget?.name || normalized.captureTarget?.ref) || t('notSet');
    const oss = normalizeOssSettings(normalized);
    const parts = [
        `API Key: ${normalized.apiKey ? t('willOverwrite') : t('empty')}`,
        `wf 发送目标: ${captureTargetName}`,
        `wfv 入口: ${savedTargetCount}`,
        `标签管理: ${tagCount}`,
        `OSS: ${oss.ossBucket ? `${oss.ossBucket}${oss.ossRegion ? ` / ${oss.ossRegion}` : ''}` : t('notConfigured')}`
    ];

    return {
        savedTargetCount,
        tagCount,
        captureTargetName,
        hasApiKey: !!normalized.apiKey,
        hasOssSecret: !!oss.ossAccessKeySecret,
        ossBucket: oss.ossBucket,
        ossRegion: oss.ossRegion,
        description: parts.join(' | ')
    };
};

const shouldStageClipboardImageFallback = ({
    hasImageItem = false,
    hasClipboardItems = false,
    hasText = false,
    hasExplicitFilePayload = false
} = {}) => (
    !hasImageItem
    && !hasClipboardItems
    && !hasText
    && !hasExplicitFilePayload
);

const buildSearchCreateItem = ({ keyword = '', resultCount = 0 } = {}) => {
    const text = trimString(keyword);
    if (!text) return null;

    if (resultCount === 0) {
        return {
            title: `➕ 没有匹配，创建节点: ${text}`,
            description: '当前路径下无搜索结果，按 Enter 新建',
            action: 'quick_create_node',
            data: text
        };
    }

    return {
        title: `➕ 仍要创建: ${text}`,
        description: `上方已有 ${resultCount} 条匹配；选择此项才会新建`,
        action: 'quick_create_node',
        data: text
    };
};

const buildCleanupStatusItem = ({ remainingCount = 0, feedback = '' } = {}) => ({
    title: `清理进度：剩余 ${remainingCount} 条`,
    description: trimString(feedback) || '移动、完成或删除后会自动刷新此列表',
    type: 'info'
});

const formatRememberedWebSourceDescription = (source = {}) => {
    const title = trimString(source.title || source.url) || t('notSet');
    const nodeHint = source.workflowyNodeId ? t('nextTextToSource') : t('sourceNoNodeId');
    return `${title} | ${nodeHint} | Enter ${t('clearSource')}`;
};

// One-shot bare clipboard link staged as the parent of the next typed note.
// The row is informational plus one dismiss action: submitting typed text
// creates the link node first and the note as its child, so the user never
// has to guess what Enter will do.
const buildStagedLinkStatusItem = (source = {}) => {
    const url = trimString(source?.url);
    if (!url) return null;

    return {
        title: '🔗 剪贴板链接将作为笔记的父节点',
        description: `Enter 同时创建链接节点与子笔记；子笔记不再套时间戳分组 | ${url}`,
        type: 'info',
        action: 'staged_link_dismiss'
    };
};

module.exports = {
    RECOVERY_ATTACHMENT_STATUSES,
    getRecentAttachmentStatusLabel,
    getRecentAttachmentNextStep,
    sortRecentAttachmentsForRecovery,
    getPendingRecentAttachments,
    formatRecentAttachmentDescription,
    buildOssSetupStatus,
    summarizeSettingsImport,
    shouldStageClipboardImageFallback,
    buildSearchCreateItem,
    buildCleanupStatusItem,
    formatRememberedWebSourceDescription,
    buildStagedLinkStatusItem
};
