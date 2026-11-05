const fs = require('fs');
const path = require('path');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DIRECT_UPLOAD_LIMIT_BYTES = 500 * 1024;
const MAX_IMAGE_WIDTH = 1920;
const JPEG_QUALITY = 85;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp'
]);

const normalizeMimeType = (mimeType) => String(mimeType || '').trim().toLowerCase();

const extensionToMimeType = (extension = '') => {
    switch (String(extension || '').trim().toLowerCase().replace(/^\./, '')) {
        case 'png':
            return 'image/png';
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'gif':
            return 'image/gif';
        case 'webp':
            return 'image/webp';
        default:
            return '';
    }
};

const mimeTypeToExtension = (mimeType) => {
    switch (normalizeMimeType(mimeType)) {
        case 'image/png':
            return 'png';
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/gif':
            return 'gif';
        case 'image/webp':
            return 'webp';
        default:
            return '';
    }
};

const isSupportedImageMimeType = (mimeType) => SUPPORTED_IMAGE_MIME_TYPES.has(normalizeMimeType(mimeType));

const noteContainsImageUrl = (note) => String(note || '')
    .split(/\n+/)
    .some(line => /^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(line.trim()));

const readBlobAsBuffer = (blob) => new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
        reject(new Error('当前环境不支持 FileReader'));
        return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取剪贴板图片失败'));
    reader.readAsArrayBuffer(blob);
});

const getElectronApis = () => {
    try {
        const electron = require('electron');
        return {
            clipboard: electron.clipboard,
            nativeImage: electron.nativeImage
        };
    } catch (error) {
        return {
            clipboard: null,
            nativeImage: null
        };
    }
};

const extractImageFromPasteEvent = async (event) => {
    const items = Array.from(event?.clipboardData?.items || []);
    const imageItem = items.find(item => /^image\//i.test(String(item?.type || '')));

    if (!imageItem) {
        return null;
    }

    const file = typeof imageItem.getAsFile === 'function' ? imageItem.getAsFile() : null;
    if (!file) {
        return null;
    }

    const buffer = await readBlobAsBuffer(file);
    return {
        buffer,
        mimeType: normalizeMimeType(file.type) || 'image/png',
        name: file.name || '',
        size: buffer.length,
        source: 'paste'
    };
};

const readImageFromElectronClipboard = () => {
    const { clipboard } = getElectronApis();
    if (!clipboard) return null;

    const image = clipboard.readImage();
    if (!image || image.isEmpty()) return null;

    const buffer = image.toPNG();
    return {
        buffer,
        mimeType: 'image/png',
        name: 'clipboard.png',
        size: buffer.length,
        source: 'clipboard'
    };
};

const normalizePayloadFilePath = (payload) => {
    if (typeof payload === 'string') return payload;
    return String(payload?.path || payload?.filePath || payload?.fullPath || '').trim();
};

const readImageFileFromPath = (filePath, source = 'plugin-payload') => {
    const value = String(filePath || '').trim();
    if (!value || !fs.existsSync(value) || !fs.statSync(value).isFile()) {
        return null;
    }

    const mimeType = extensionToMimeType(path.extname(value));
    if (!isSupportedImageMimeType(mimeType)) {
        return null;
    }

    const buffer = fs.readFileSync(value);
    return {
        buffer,
        mimeType,
        name: path.basename(value),
        size: buffer.length,
        source
    };
};

const readImageFileFromUtoolsClipboard = (utoolsApi) => {
    if (!utoolsApi || typeof utoolsApi.getCopyedFiles !== 'function') return null;

    const files = utoolsApi.getCopyedFiles() || [];
    for (const file of files) {
        const filePath = normalizePayloadFilePath(file);
        const result = readImageFileFromPath(filePath, 'clipboard-file');
        if (result) return result;
    }

    return null;
};

const extractImageFromPluginPayload = (payload) => {
    const candidates = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.files) ? payload.files : [payload]);

    for (const candidate of candidates) {
        const rawPayload = typeof candidate === 'string'
            ? candidate
            : (typeof candidate?.data === 'string' ? candidate.data : '');

        const value = String(rawPayload || '').trim();
        if (value) {
            const dataUrlMatch = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
            if (dataUrlMatch) {
                const mimeType = normalizeMimeType(dataUrlMatch[1]);
                if (!isSupportedImageMimeType(mimeType)) {
                    continue;
                }

                const buffer = Buffer.from(dataUrlMatch[2].replace(/\s+/g, ''), 'base64');
                return {
                    buffer,
                    mimeType,
                    name: `clipboard.${mimeTypeToExtension(mimeType) || 'png'}`,
                    size: buffer.length,
                    source: 'plugin-payload'
                };
            }
        }

        const filePath = normalizePayloadFilePath(candidate);
        const result = readImageFileFromPath(filePath, 'plugin-payload');
        if (result) {
            return result;
        }
    }

    return null;
};

const hasTransparency = (image) => {
    try {
        const bitmap = image.toBitmap();
        for (let index = 3; index < bitmap.length; index += 4) {
            if (bitmap[index] < 255) return true;
        }
    } catch (error) {
        return false;
    }
    return false;
};

const resizeImageIfNeeded = (image) => {
    const size = image.getSize();
    if (!size?.width || size.width <= MAX_IMAGE_WIDTH) return image;
    return image.resize({ width: MAX_IMAGE_WIDTH });
};

const prepareImageForUpload = async (payload) => {
    if (!payload?.buffer || !Buffer.isBuffer(payload.buffer)) {
        throw new Error('未读取到有效图片数据');
    }

    const mimeType = normalizeMimeType(payload.mimeType);
    if (!isSupportedImageMimeType(mimeType)) {
        throw new Error(`暂不支持的图片格式：${mimeType || 'unknown'}`);
    }

    if (payload.buffer.length > MAX_IMAGE_BYTES) {
        throw new Error('图片过大（>20MB），请压缩后再试');
    }

    if (mimeType === 'image/gif' || payload.buffer.length <= DIRECT_UPLOAD_LIMIT_BYTES) {
        return {
            buffer: payload.buffer,
            contentType: mimeType,
            extension: mimeTypeToExtension(mimeType),
            originalSize: payload.buffer.length,
            size: payload.buffer.length,
            compressed: false
        };
    }

    const { nativeImage } = getElectronApis();
    if (!nativeImage) {
        return {
            buffer: payload.buffer,
            contentType: mimeType,
            extension: mimeTypeToExtension(mimeType),
            originalSize: payload.buffer.length,
            size: payload.buffer.length,
            compressed: false
        };
    }

    const decoded = nativeImage.createFromBuffer(payload.buffer);
    if (!decoded || decoded.isEmpty()) {
        return {
            buffer: payload.buffer,
            contentType: mimeType,
            extension: mimeTypeToExtension(mimeType),
            originalSize: payload.buffer.length,
            size: payload.buffer.length,
            compressed: false
        };
    }

    if (mimeType === 'image/png' && hasTransparency(decoded)) {
        return {
            buffer: payload.buffer,
            contentType: mimeType,
            extension: 'png',
            originalSize: payload.buffer.length,
            size: payload.buffer.length,
            compressed: false
        };
    }

    const resized = resizeImageIfNeeded(decoded);
    const jpegBuffer = resized.toJPEG(JPEG_QUALITY);
    return {
        buffer: jpegBuffer,
        contentType: 'image/jpeg',
        extension: 'jpg',
        originalSize: payload.buffer.length,
        size: jpegBuffer.length,
        compressed: true
    };
};

const formatImageTitle = (date = new Date()) => {
    const pad = (value) => String(value).padStart(2, '0');
    return `图片 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

module.exports = {
    MAX_IMAGE_BYTES,
    DIRECT_UPLOAD_LIMIT_BYTES,
    MAX_IMAGE_WIDTH,
    JPEG_QUALITY,
    mimeTypeToExtension,
    isSupportedImageMimeType,
    noteContainsImageUrl,
    extractImageFromPasteEvent,
    extractImageFromPluginPayload,
    readImageFromElectronClipboard,
    readImageFileFromUtoolsClipboard,
    prepareImageForUpload,
    formatImageTitle
};
