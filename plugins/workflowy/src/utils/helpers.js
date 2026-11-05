const { fetchPageTitle, TITLE_FETCH_TIMEOUT_MS } = require('./link_title');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shortcutPattern = /^[a-z][a-z0-9]*(?:[ _-][a-z0-9]+)*$/i;
const timestampNodePattern = /^\[(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\]$/;
const SYNC_ANCHOR_TAG = '#utools-wf-inbox';

const isUuidId = (id) => uuidPattern.test((id || '').trim());
const isShortcutId = (id) => shortcutPattern.test((id || '').trim());

const stripHtml = (html) => (html || '').replace(/<[^>]*>?/gm, '');

const normalizeText = (text) => (text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const previewText = (text, maxLen = 40) => {
    if (!text) return '（无备注）';
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen)}…`;
};

const humanizeRefName = (ref) => {
    const value = String(ref || '').trim();
    if (!value) return '未命名';
    if (isUuidId(value)) return '未命名节点';
    return value
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || value;
};

const formatTargetItem = (t) => {
    let cleanName = stripHtml(t.name || t.key || '未命名').trim();
    let typePrefix = t.type === 'system' ? '[系统] ' : (t.type === 'shortcut' ? '[Shortcut] ' : (t.type === 'calendar' ? '[日历] ' : ''));
    const descParts = [];
    if (t.key) descParts.push(`⌨️ ${t.key}`);
    if (t.node_id && t.node_id !== t.key) descParts.push(`🆔 ${t.node_id.slice(0, 8)}...`);

    return {
        title: `${typePrefix}${cleanName}`,
        description: descParts.join('  |  '),
        originalData: t
    };
};

const getCurrentTime = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}]`;
};

const getCurrentDateKey = (date = new Date()) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const toIsoDate = (year, month, day) => {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (!y || !m || !d) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const extractTimestampDate = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const timeTag = raw.match(/<time\b[^>]*>/i);
    if (timeTag) {
        const tag = timeTag[0];
        const yearMatch = tag.match(/\bstartYear="(\d{4})"/i);
        const monthMatch = tag.match(/\bstartMonth="(\d{1,2})"/i);
        const dayMatch = tag.match(/\bstartDay="(\d{1,2})"/i);
        if (yearMatch && monthMatch && dayMatch) {
            return toIsoDate(yearMatch[1], monthMatch[1], dayMatch[1]);
        }
    }

    const normalized = normalizeText(stripHtml(raw));
    const match = normalized.match(timestampNodePattern);
    return match ? match[1] : null;
};

const isTimestampNodeName = (text) => !!extractTimestampDate(text);

const normalizeTagToken = (tag) => String(tag || '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase();

const hasTagToken = (text, tag) => {
    const expected = normalizeTagToken(tag);
    if (!expected) return false;

    const normalized = normalizeText(stripHtml(text || ''));
    if (!normalized) return false;

    return normalized
        .split(/\s+/)
        .some(token => normalizeTagToken(token) === expected);
};

const appendSystemTag = (text, tag) => {
    const cleanText = normalizeText(text || '');
    const cleanTag = normalizeTagToken(tag);
    if (!cleanTag) return cleanText;
    const finalTag = `#${cleanTag}`;
    if (hasTagToken(cleanText, finalTag)) return cleanText;
    return cleanText ? `${cleanText} ${finalTag}` : finalTag;
};

const appendTag = (text, tag) => {
    const cleanText = normalizeText(text || '');
    const cleanTag = String(tag || '').trim().replace(/^#/, '');
    if (!cleanTag) return cleanText;
    return cleanText ? `${cleanText} #${cleanTag}` : `#${cleanTag}`;
};

const appendTags = (text, tags = []) => {
    const cleanText = normalizeText(text || '');
    const uniqueTags = [];
    const seen = new Set();

    for (const tag of Array.isArray(tags) ? tags : []) {
        const normalized = normalizeTagToken(tag);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        uniqueTags.push(normalized);
    }

    return uniqueTags.reduce((acc, tag) => appendTag(acc, tag), cleanText);
};

const trimTrailingUrlPunctuation = (url) => String(url || '')
    .trim()
    .replace(/[，。；、,;!！?？]+$/u, '');

const extractLinksFromCaptureText = (input) => {
    const links = [];
    let rest = String(input || '');

    rest = rest.replace(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^>\s]+))[^>]*>([\s\S]*?)<\/a>/gi, (_, href1, href2, href3, label) => {
        const url = normalizeText(href1 || href2 || href3 || '');
        if (!url) return ' ';
        const title = normalizeText(stripHtml(label || '')) || url;
        links.push({ title, url, isExplicitTitle: true });
        return ' ';
    });

    rest = rest.replace(/(^|[^!])\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (match, prefix, label, url) => {
        const title = normalizeText(stripHtml(label || '')) || normalizeText(url || '');
        const cleanUrl = normalizeText(url || '');
        if (cleanUrl) links.push({ title: title || cleanUrl, url: cleanUrl, isExplicitTitle: true });
        return `${prefix || ''} `;
    });

    rest = rest.replace(/\bhttps?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*/gi, (url) => {
        const cleanUrl = trimTrailingUrlPunctuation(url);
        if (cleanUrl) links.push({ title: cleanUrl, url: cleanUrl, isExplicitTitle: false });
        return ' ';
    });

    const text = normalizeText(rest);
    return {
        text,
        links
    };
};

const buildWebLinkNote = (url, excerpt = '') => {
    const cleanUrl = normalizeText(url || '');
    const cleanExcerpt = normalizeText(stripHtml(excerpt || ''));
    if (!cleanExcerpt) return cleanUrl;
    if (!cleanUrl) return cleanExcerpt;
    return `${cleanUrl}\n\n${cleanExcerpt}`;
};

const normalizeRememberedWebSource = (source = {}) => {
    const safeSource = source || {};
    const url = normalizeText(safeSource.url || '');
    if (!/^https?:\/\//i.test(url)) return null;

    return {
        url,
        title: normalizeText(stripHtml(safeSource.title || '')) || url,
        workflowyNodeId: normalizeText(safeSource.workflowyNodeId || ''),
        savedAt: Number.isFinite(safeSource.savedAt) ? safeSource.savedAt : Date.now()
    };
};

const buildCaptureChildren = async (input, defaultTag, options = {}) => {
    const enableLinkTitleFetch = options.enableLinkTitleFetch !== false;
    const webTagEnabled = options.webTagEnabled !== false;
    const webTag = normalizeTagToken(options.webTag || 'web');
    const rememberedWebSource = normalizeRememberedWebSource(options.rememberedWebSource);

    const parsed = extractLinksFromCaptureText(input);
    const children = [];
    if (parsed.links.length > 0) {
        let remainingTitleFetches = Math.max(0, Number.isFinite(options.maxTitleFetches) ? options.maxTitleFetches : 1);
        const sharedExcerpt = parsed.links.length === 1 ? parsed.text : '';

        for (const link of parsed.links) {
            let resolvedTitle = link.title || link.url;
            let fetchedTitle = '';
            if (enableLinkTitleFetch && !link.isExplicitTitle && remainingTitleFetches > 0) {
                remainingTitleFetches -= 1;
                fetchedTitle = await fetchPageTitle(link.url, {
                    timeoutMs: options.linkTitleTimeoutMs || TITLE_FETCH_TIMEOUT_MS
                });
                if (fetchedTitle) resolvedTitle = fetchedTitle;
            }

            if (!link.isExplicitTitle && !fetchedTitle && sharedExcerpt) {
                resolvedTitle = sharedExcerpt;
            }

            children.push({
                name: appendTags(resolvedTitle || link.url, [
                    defaultTag,
                    webTagEnabled ? webTag : ''
                ]),
                note: buildWebLinkNote(link.url, sharedExcerpt)
            });
        }

        return children;
    }

    if (rememberedWebSource && parsed.text) {
        children.push({
            name: appendTags(rememberedWebSource.title, [
                defaultTag,
                webTagEnabled ? webTag : ''
            ]),
            note: buildWebLinkNote(rememberedWebSource.url, parsed.text)
        });
        return children;
    }

    const textNode = appendTag(parsed.text, defaultTag);
    if (textNode) children.push({ name: textNode });

    return children;
};

const WORKFLOWY_ADD_KEYWORDS = ['wf', 'workflowy', 'workflowy-add'];

const isWorkflowyAddKeyword = (text) => WORKFLOWY_ADD_KEYWORDS.includes(
    String(text || '').trim().toLowerCase()
);

const getActionPayloadText = (action) => {
    if (!action) return '';
    if (typeof action.payload === 'string') return action.payload;
    return action.payload?.text || '';
};

const deriveInitialQuickTextFromAction = ({
    action,
    hasInitialUploadPayload = false
} = {}) => {
    if (!action || hasInitialUploadPayload) return '';

    const payloadText = String(getActionPayloadText(action) || '').trim();
    if (!payloadText || isWorkflowyAddKeyword(payloadText)) return '';
    return payloadText;
};

const WORKFLOWY_COMPOSE_KEYWORDS = ['wfl', '长文本', 'workflowy-long'];

const isWorkflowyComposeKeyword = (text) => WORKFLOWY_COMPOSE_KEYWORDS.includes(
    String(text || '').trim().toLowerCase()
);

// uTools may hand the plugin either the whole typed line ("wfl 今天…") or only
// what follows the invoked keyword ("今天…"). Dropping one leading keyword
// token keeps both shapes usable; a keyword-only payload yields no text.
const stripComposeKeywordPrefix = (text) => {
    const trimmed = String(text || '').trim();
    const lowered = trimmed.toLowerCase();
    for (const keyword of WORKFLOWY_COMPOSE_KEYWORDS) {
        if (!lowered.startsWith(keyword)) continue;
        const rest = trimmed.slice(keyword.length);
        if (!rest) return '';
        if (!/^\s/.test(rest)) continue;
        return rest.trim();
    }
    return trimmed;
};

const deriveComposeInitialText = (action) => {
    const payloadText = String(getActionPayloadText(action) || '').trim();
    if (!payloadText || isWorkflowyComposeKeyword(payloadText)) return '';
    return stripComposeKeywordPrefix(payloadText);
};

const validateTaskboxId = (id) => {
    if (!id) return { valid: false, message: 'ID 不能为空' };
    const normalized = String(id).trim();
    if (isUuidId(normalized)) return { valid: true, type: 'uuid' };
    if (isShortcutId(normalized)) return { valid: true, type: 'target' };
    return { valid: false, message: '引用格式错误，请输入 UUID 或 Workflowy target' };
};

const parseTaskboxInput = (input) => {
    const text = (input || '').trim();
    if (!text) return null;
    const parts = text.split(/[|\t]/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const id = parts.length > 1 ? parts[parts.length - 1] : text;
    const name = parts.length > 1 ? parts.slice(0, -1).join(' ') : humanizeRefName(id);
    const validation = validateTaskboxId(id);

    if (!validation.valid) return { error: validation.message };
    return { id, name, type: validation.type };
};

const detectNodeType = (id) => {
    if (['inbox', 'home', 'trash'].includes(id)) return 'system';
    if (isUuidId(id)) return 'uuid';
    if (isShortcutId(id)) return 'target';
    return 'custom';
};

const normalizeNodes = (inputNodes) => {
    if (!Array.isArray(inputNodes)) return [];
    const normalized = inputNodes.map((node, idx) => {
        const shaped = { name: node?.name || `任务箱 ${idx + 1}`, ...node };
        shaped.id = (shaped.id || '').trim() || `node_${idx + 1}`;
        shaped.isDefault = !!shaped.isDefault;
        shaped.type = shaped.type || detectNodeType(shaped.id);
        shaped.useDaily = !!shaped.useDaily;
        return shaped;
    });
    if (!normalized.some(n => n.isDefault) && normalized.length > 0) normalized[0].isDefault = true;
    return normalized;
};

const LAYOUT_MODE_OPTIONS = [
    { value: 'bullets', label: '普通列表 (- text)' },
    { value: 'todo', label: '待办 (- [ ] text)' },
    { value: 'h1', label: 'H1 标题 (# Title)' },
    { value: 'h2', label: 'H2 标题 (## Title)' },
    { value: 'h3', label: 'H3 标题 (### Title)' },
    { value: 'code-block', label: '代码块 (```code```)' },
    { value: 'quote-block', label: '引用 (> text)' }
];

const layoutModeLabel = (value) => {
    const opt = LAYOUT_MODE_OPTIONS.find(o => o.value === value);
    return opt ? opt.label : (value || '自动');
};

const normalizeParentId = (id) => (id === 'None' || !id) ? null : id;

module.exports = {
    uuidPattern,
    shortcutPattern,
    SYNC_ANCHOR_TAG,
    isUuidId,
    isShortcutId,
    stripHtml,
    normalizeText,
    previewText,
    formatTargetItem,
    humanizeRefName,
    getCurrentTime,
    getCurrentDateKey,
    extractTimestampDate,
    isTimestampNodeName,
    hasTagToken,
    appendSystemTag,
    appendTag,
    appendTags,
    trimTrailingUrlPunctuation,
    extractLinksFromCaptureText,
    buildWebLinkNote,
    normalizeRememberedWebSource,
    buildCaptureChildren,
    WORKFLOWY_ADD_KEYWORDS,
    isWorkflowyAddKeyword,
    deriveInitialQuickTextFromAction,
    WORKFLOWY_COMPOSE_KEYWORDS,
    isWorkflowyComposeKeyword,
    deriveComposeInitialText,
    validateTaskboxId,
    parseTaskboxInput,
    detectNodeType,
    normalizeNodes,
    LAYOUT_MODE_OPTIONS,
    layoutModeLabel,
    normalizeParentId
};
