const crypto = require('crypto');
const { appendSystemTag } = require('./helpers');
const { formatImageTitle } = require('./image');

const DEFAULT_MARKDOWN_FILE_ICON = '📄';
const DEFAULT_MARKDOWN_FILE_TAG = 'file';

const trimString = (value) => String(value || '').trim();

const normalizeAttachmentKind = (value) => (value === 'markdown' ? 'markdown' : 'image');

const normalizeMarkdownFileIcon = (value) => trimString(value) || DEFAULT_MARKDOWN_FILE_ICON;

const normalizeMarkdownFileTag = (value) => trimString(value)
    .replace(/^#+/g, '') || DEFAULT_MARKDOWN_FILE_TAG;

const createAttachmentId = () => {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return crypto.randomBytes(16).toString('hex');
};

const buildPendingUploadRecord = ({ uploaded = {}, prepared = {}, payload = {}, context = {} } = {}) => ({
    id: trimString(payload.id) || createAttachmentId(),
    kind: normalizeAttachmentKind(payload.kind || prepared.kind),
    objectKey: trimString(uploaded.objectKey),
    url: trimString(uploaded.url),
    rawUrl: trimString(uploaded.rawUrl || context.rawUrl),
    viewerUrl: trimString(uploaded.viewerUrl || context.viewerUrl),
    contentType: trimString(uploaded.contentType || prepared.contentType),
    size: Number.isFinite(uploaded.size) ? uploaded.size : Number(prepared.size || payload.size || 0),
    originalSize: Number.isFinite(prepared.originalSize) ? prepared.originalSize : Number(payload.size || uploaded.size || 0),
    name: trimString(prepared.name || payload.name),
    displayName: trimString(prepared.displayName || payload.displayName || payload.name),
    source: trimString(payload.source),
    uploadedAt: Number.isFinite(context.uploadedAt) ? context.uploadedAt : Date.now(),
    targetParentId: trimString(context.targetParentId) || null,
    targetParentName: trimString(context.targetParentName),
    sourceMode: trimString(context.sourceMode) || 'add',
    captureText: typeof context.captureText === 'string' ? context.captureText : '',
    status: trimString(context.status) || 'uploaded',
    lastError: trimString(context.lastError),
    workflowyNodeId: trimString(context.workflowyNodeId),
    savedAt: Number.isFinite(context.savedAt) ? context.savedAt : 0
});

const buildMarkdownAttachmentTitle = (attachment = {}, settings = {}) => {
    let title = trimString(attachment.displayName || attachment.name) || 'untitled.md';

    if (settings.ossFileIconEnabled !== false) {
        const icon = normalizeMarkdownFileIcon(settings.ossFileIcon);
        title = `${icon} ${title}`.trim();
    }

    if (settings.ossFileTagEnabled !== false) {
        title = appendSystemTag(title, normalizeMarkdownFileTag(settings.ossFileTag));
    }

    return title;
};

const buildImageAttachmentTitle = (attachment = {}, settings = {}, options = {}) => {
    const title = trimString(options.text) || formatImageTitle(options.date);
    const tags = [];

    if (options.sourceMode === 'add' && settings.defaultTag) tags.push(settings.defaultTag);
    if (settings.ossImageTagEnabled !== false && settings.ossImageTag) tags.push(settings.ossImageTag);

    return tags.reduce((acc, tag) => appendSystemTag(acc, tag), title);
};

const buildAttachmentNodePayload = (attachment = {}, settings = {}, options = {}) => {
    const kind = normalizeAttachmentKind(attachment.kind);
    const note = trimString(attachment.url);

    if (kind === 'markdown') {
        return {
            name: buildMarkdownAttachmentTitle(attachment, settings),
            note
        };
    }

    return {
        name: buildImageAttachmentTitle(attachment, settings, options),
        note
    };
};

module.exports = {
    DEFAULT_MARKDOWN_FILE_ICON,
    DEFAULT_MARKDOWN_FILE_TAG,
    normalizeAttachmentKind,
    normalizeMarkdownFileIcon,
    normalizeMarkdownFileTag,
    createAttachmentId,
    buildPendingUploadRecord,
    buildMarkdownAttachmentTitle,
    buildImageAttachmentTitle,
    buildAttachmentNodePayload
};
