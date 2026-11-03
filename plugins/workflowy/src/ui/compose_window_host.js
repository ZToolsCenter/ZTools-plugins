const COMPOSE_DRAFT_KEY = 'wf_compose_draft';
const COMPOSE_CHANNELS = Object.freeze({
    submit: 'wf-compose-submit',
    cancel: 'wf-compose-cancel',
    result: 'wf-compose-result',
    session: 'wf-compose-session',
    ready: 'wf-compose-ready'
});

const normalizeComposeText = (value) => String(value == null ? '' : value);

const isComposeTextEmpty = (value) => normalizeComposeText(value).trim().length === 0;

const isComposeSendShortcut = (event = {}) => {
    if (!event || String(event.key || '') !== 'Enter') return false;
    if (!(event.ctrlKey || event.metaKey)) return false;
    if (event.keyCode === 229) return false;
    return !event.altKey && !event.shiftKey && !event.isComposing;
};

const isComposeCancelKey = (event = {}) => (
    String(event?.key || '') === 'Escape' && !event?.isComposing && event?.keyCode !== 229
);

const buildComposeWindowUrl = ({ id = '', targetName = '' } = {}) => {
    const params = new URLSearchParams();
    params.set('id', String(id || ''));
    if (targetName) params.set('targetName', String(targetName));
    return `compose.html?${params.toString()}`;
};

const normalizeComposeDraft = (draft = {}) => {
    const id = String(draft?.id || '').trim();
    if (!id) return null;

    return {
        id,
        text: normalizeComposeText(draft.text),
        parentId: draft.parentId == null ? null : String(draft.parentId),
        parentName: normalizeComposeText(draft.parentName),
        standalone: draft.standalone === true,
        createdAt: Number.isFinite(draft.createdAt) ? draft.createdAt : 0
    };
};

const readComposeDraft = (storage, id) => {
    if (!storage?.getItem) return null;
    const draft = normalizeComposeDraft(storage.getItem(COMPOSE_DRAFT_KEY));
    if (!draft) return null;
    if (String(id || '') !== draft.id) return null;
    return draft;
};

const buildComposePayload = ({ id, text } = {}) => ({
    id: String(id || ''),
    text: normalizeComposeText(text)
});

const isComposeResultFor = (result, id) => {
    if (!result || !String(id || '')) return false;
    return String(result.id || '') === String(id);
};

module.exports = {
    COMPOSE_DRAFT_KEY,
    COMPOSE_CHANNELS,
    normalizeComposeText,
    isComposeTextEmpty,
    isComposeSendShortcut,
    isComposeCancelKey,
    buildComposeWindowUrl,
    normalizeComposeDraft,
    readComposeDraft,
    buildComposePayload,
    isComposeResultFor
};
