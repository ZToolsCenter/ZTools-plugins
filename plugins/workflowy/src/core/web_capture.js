const {
    getStorageItem,
    setStorageItem,
    removeStorageItem
} = require('./storage');
const { normalizeRememberedWebSource, extractLinksFromCaptureText, trimTrailingUrlPunctuation } = require('../utils/helpers');

const REMEMBERED_WEB_SOURCE_KEY = 'wf_remembered_web_source';

const getRememberedWebSource = () => normalizeRememberedWebSource(
    getStorageItem(REMEMBERED_WEB_SOURCE_KEY)
);

const rememberWebSource = (source = {}) => {
    const normalized = normalizeRememberedWebSource(source);
    if (!normalized) return null;
    setStorageItem(REMEMBERED_WEB_SOURCE_KEY, normalized);
    return normalized;
};

const clearRememberedWebSource = () => {
    removeStorageItem(REMEMBERED_WEB_SOURCE_KEY);
};

// ---------------------------------------------------------------------------
// Staged one-shot parent link
// ---------------------------------------------------------------------------
// When `wf` is opened by hotkey right after the user copied a link, uTools
// auto-fills that link into the sub-input. Merging it with the note the user
// is about to type produced a single web-clip node, so the note could never
// be captured on its own.
//
// Instead we recognize the clipboard text as exactly one bare link and keep
// it *out* of the input, staging it as the parent of the next note. This is
// deliberately NOT the persisted remembered-web-source: the staged link lives
// in AppState only and is cleared after a single submission, so consecutive
// notes do not pile up under one link.

const normalizeStagedWebLink = (source = {}) => {
    const url = String(source?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return null;
    return {
        url,
        title: String(source?.title || '').trim() || url
    };
};

// A clipboard string is stageable only when it is exactly one link with no
// surrounding text. "https://x.com 随手记一句" is left alone on purpose: it is
// an excerpt the user composed, and today's web-clip merge is correct for it.
const parseStagedWebLinkCandidate = (input = '') => {
    const text = String(input || '').trim();
    if (!text) return null;

    const parsed = extractLinksFromCaptureText(text);
    if (parsed.links.length !== 1) return null;
    if (parsed.text) return null;

    return normalizeStagedWebLink(parsed.links[0]);
};

// uTools auto-fills the clipboard into the sub-input on its own. Staging the
// link is only half the job: the auto-fill still arrives, and if it reaches
// the capture text it merges the link and the note the user is typing into a
// single web-clip node. This identifies that echo so the caller can clear it.
// Comparison is tolerant of surrounding whitespace, trailing punctuation, and
// markdown/autolink shapes, because uTools may normalize the filled text.
const isStagedWebLinkEcho = (text, stagedLink) => {
    const url = String(stagedLink?.url || '').trim();
    if (!url) return false;

    const candidate = trimTrailingUrlPunctuation(String(text || '').trim());
    if (!candidate) return false;
    if (candidate === url) return true;

    const parsed = extractLinksFromCaptureText(candidate);
    return parsed.links.length === 1
        && !parsed.text
        && parsed.links[0].url === url;
};

module.exports = {
    REMEMBERED_WEB_SOURCE_KEY,
    getRememberedWebSource,
    rememberWebSource,
    clearRememberedWebSource,
    normalizeStagedWebLink,
    parseStagedWebLinkCandidate,
    isStagedWebLinkEcho
};
