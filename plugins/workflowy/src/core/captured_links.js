const {
    getStorageItem,
    setStorageItem,
    removeStorageItem
} = require('./storage');

const CAPTURED_LINKS_KEY = 'wf_captured_links';
// Bounded so the list cannot grow without limit. Oldest entries fall off first;
// a URL that falls off simply creates a fresh link node next time.
const CAPTURED_LINKS_LIMIT = 50;

const normalizeCapturedLinkUrl = (url) => String(url || '').trim();

const normalizeCapturedLink = (entry = {}) => {
    const url = normalizeCapturedLinkUrl(entry?.url);
    const nodeId = String(entry?.nodeId || '').trim();
    if (!url || !nodeId) return null;
    if (!/^https?:\/\//i.test(url)) return null;
    return {
        url,
        nodeId,
        title: String(entry?.title || '').trim() || url,
        capturedAt: Number.isFinite(entry?.capturedAt) ? entry.capturedAt : 0
    };
};

const readCapturedLinks = () => {
    const raw = getStorageItem(CAPTURED_LINKS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeCapturedLink).filter(Boolean);
};

const getCapturedLink = (url) => {
    const target = normalizeCapturedLinkUrl(url);
    if (!target) return null;
    return readCapturedLinks().find(entry => entry.url === target) || null;
};

const getCapturedLinkNodeId = (url) => getCapturedLink(url)?.nodeId || '';

const rememberCapturedLink = ({ url, nodeId, title, capturedAt = Date.now() } = {}) => {
    const entry = normalizeCapturedLink({ url, nodeId, title, capturedAt });
    if (!entry) return null;

    const rest = readCapturedLinks().filter(existing => existing.url !== entry.url);
    const next = [entry, ...rest].slice(0, CAPTURED_LINKS_LIMIT);
    setStorageItem(CAPTURED_LINKS_KEY, next);
    return entry;
};

const forgetCapturedLink = (url) => {
    const target = normalizeCapturedLinkUrl(url);
    if (!target) return false;

    const current = readCapturedLinks();
    const next = current.filter(entry => entry.url !== target);
    if (next.length === current.length) return false;

    if (next.length === 0) removeStorageItem(CAPTURED_LINKS_KEY);
    else setStorageItem(CAPTURED_LINKS_KEY, next);
    return true;
};

module.exports = {
    CAPTURED_LINKS_KEY,
    CAPTURED_LINKS_LIMIT,
    normalizeCapturedLinkUrl,
    normalizeCapturedLink,
    readCapturedLinks,
    getCapturedLink,
    getCapturedLinkNodeId,
    rememberCapturedLink,
    forgetCapturedLink
};
