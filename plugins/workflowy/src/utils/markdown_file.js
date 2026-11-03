const fs = require('fs');
const path = require('path');
const { buildOssObjectKey } = require('../api/oss');

const MAX_MARKDOWN_FILE_BYTES = 5 * 1024 * 1024;
const MARKDOWN_OSS_PATH_PREFIX = 'workflowy-markdown/';
const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

const SUPPORTED_MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'txt']);

const normalizeExtension = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '');

const isSupportedMarkdownExtension = (value) => SUPPORTED_MARKDOWN_EXTENSIONS.has(normalizeExtension(value));

const getMarkdownDisplayName = (fileName = 'untitled.md') => {
    const baseName = path.basename(String(fileName || '').trim() || 'untitled.md');
    const parsed = path.parse(baseName);
    const stem = parsed.name || 'untitled';
    return `${stem}.md`;
};

const readBlobAsBuffer = (blob) => new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
        reject(new Error('当前环境不支持 FileReader'));
        return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取剪贴板 Markdown 文件失败'));
    reader.readAsArrayBuffer(blob);
});

const normalizePayloadFilePath = (payload) => {
    if (typeof payload === 'string') return payload;
    return String(payload?.path || payload?.filePath || payload?.fullPath || '').trim();
};

const readMarkdownFileFromPath = (filePath, source = 'plugin-payload') => {
    const value = String(filePath || '').trim();
    if (!value || !fs.existsSync(value) || !fs.statSync(value).isFile()) return null;

    const extension = normalizeExtension(path.extname(value));
    if (!isSupportedMarkdownExtension(extension)) return null;

    const buffer = fs.readFileSync(value);
    return {
        kind: 'markdown',
        buffer,
        name: path.basename(value),
        displayName: getMarkdownDisplayName(value),
        extension,
        size: buffer.length,
        source
    };
};

const extractMarkdownFileFromPluginPayload = (payload) => {
    const candidates = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.files) ? payload.files : [payload]);

    for (const candidate of candidates) {
        const filePath = normalizePayloadFilePath(candidate);
        const result = readMarkdownFileFromPath(filePath, 'plugin-payload');
        if (result) return result;
    }

    return null;
};

const extractMarkdownFileFromPasteEvent = async (event) => {
    const files = Array.from(event?.clipboardData?.files || []);
    const candidates = files.length
        ? files
        : Array.from(event?.clipboardData?.items || [])
            .filter(item => String(item?.kind || '').toLowerCase() === 'file')
            .map(item => (typeof item.getAsFile === 'function' ? item.getAsFile() : null))
            .filter(Boolean);

    const markdownFile = candidates.find(file => isSupportedMarkdownExtension(path.extname(file?.name || '')));
    if (!markdownFile) return null;

    const buffer = await readBlobAsBuffer(markdownFile);
    return {
        kind: 'markdown',
        buffer,
        name: markdownFile.name || 'untitled.md',
        displayName: getMarkdownDisplayName(markdownFile.name || 'untitled.md'),
        extension: normalizeExtension(path.extname(markdownFile.name || '')),
        size: buffer.length,
        source: 'paste'
    };
};

const readMarkdownFileFromUtoolsClipboard = (utoolsApi) => {
    if (!utoolsApi || typeof utoolsApi.getCopyedFiles !== 'function') return null;

    const files = utoolsApi.getCopyedFiles() || [];
    for (const file of files) {
        const filePath = normalizePayloadFilePath(file);
        const result = readMarkdownFileFromPath(filePath, 'clipboard');
        if (result) return result;
    }

    return null;
};

const prepareMarkdownFileForUpload = (payload, options = {}) => {
    if (!payload?.buffer || !Buffer.isBuffer(payload.buffer)) {
        throw new Error('未读取到有效 Markdown 文件');
    }

    const extension = normalizeExtension(payload.extension || path.extname(payload.name || ''));
    if (!isSupportedMarkdownExtension(extension)) {
        throw new Error('仅支持 .md / .markdown / .txt 文件');
    }

    if (payload.buffer.length > MAX_MARKDOWN_FILE_BYTES) {
        throw new Error('Markdown 文件过大（>5MB），请拆分后再试');
    }

    return {
        kind: 'markdown',
        buffer: payload.buffer,
        contentType: MARKDOWN_CONTENT_TYPE,
        extension: 'md',
        objectKey: buildOssObjectKey({
            pathPrefix: MARKDOWN_OSS_PATH_PREFIX,
            date: options.date,
            extension: 'md'
        }),
        name: payload.name || 'untitled.md',
        displayName: getMarkdownDisplayName(payload.displayName || payload.name || 'untitled.md'),
        originalSize: payload.buffer.length,
        size: payload.buffer.length,
        compressed: false
    };
};

module.exports = {
    MAX_MARKDOWN_FILE_BYTES,
    MARKDOWN_OSS_PATH_PREFIX,
    MARKDOWN_CONTENT_TYPE,
    isSupportedMarkdownExtension,
    getMarkdownDisplayName,
    extractMarkdownFileFromPluginPayload,
    extractMarkdownFileFromPasteEvent,
    readMarkdownFileFromUtoolsClipboard,
    prepareMarkdownFileForUpload
};
