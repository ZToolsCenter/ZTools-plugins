const { getSettings } = require('../core/settings');

const SYNTHETIC_SYSTEM_TARGETS = ['inbox'];
// Legacy refs the plugin itself once synthesized as capture targets but that
// are NOT built-in API locations. `today` used to be in this set, but the
// official API reference (https://beta.workflowy.com/api-reference/) lists
// `today` as a built-in calendar target for POST /nodes, so it is now a
// first-class passthrough ref instead of a recoverable legacy value.
const RECOVERABLE_SYNTHETIC_TARGETS = new Set(['home']);
// Built-in calendar target refs accepted directly by POST /nodes parent_id.
// Calendar nodes are created on demand by Create/Move operations; reading
// children of an unmaterialized calendar node returns 404 (treated as an
// empty list by fetchNodes).
const CALENDAR_TARGET_REFS = new Set(['calendar', 'today', 'tomorrow', 'next_week']);
const CALENDAR_DATE_PATTERN = /^\d{4}(?:-\d{2})?(?:-\d{2})?$/;
const isCalendarTargetRef = (ref) => {
    const value = String(ref || '').trim().toLowerCase();
    return CALENDAR_TARGET_REFS.has(value) || CALENDAR_DATE_PATTERN.test(value);
};
const SYNTHETIC_CALENDAR_TARGETS = Object.freeze([
    Object.freeze({ key: 'today', name: 'Today', type: 'calendar', node_id: null })
]);
const INBOX_CAPTURE_TARGET = Object.freeze({
    ref: 'inbox',
    refType: 'target',
    name: 'Inbox'
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_REQUEST_TIMEOUT_MS = 15000;

const createRequestTimeoutError = () => {
    const error = new Error(`Workflowy 请求超时（${API_REQUEST_TIMEOUT_MS / 1000} 秒）`);
    error.code = 'WORKFLOWY_NETWORK_ERROR';
    return error;
};

async function workflowyApiRequest(endpoint, body, method = 'POST', useQueryParams = false) {
    const apiKey = getSettings().apiKey;
    if (!apiKey) throw new Error('API Key 未设置');

    let url = `https://workflowy.com/api/v1/${endpoint}`;
    const fetchOptions = {
        method,
        headers: { "Authorization": `Bearer ${apiKey}` }
    };

    if (method === 'GET' && useQueryParams && body) {
        url += `?${new URLSearchParams(body).toString()}`;
    } else if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(body);
    }

    // A stalled connection must not leave the caller (and the capture state)
    // waiting forever; bound every request and surface the timeout as a
    // transport failure so existing offline-recovery paths can handle it.
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    if (abortController) fetchOptions.signal = abortController.signal;
    let timeoutId = null;
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            timedOut = true;
            abortController?.abort();
            reject(createRequestTimeoutError());
        }, API_REQUEST_TIMEOUT_MS);
    });

    let response;
    try {
        response = await Promise.race([
            fetch(url, fetchOptions),
            timeoutPromise
        ]);
    } catch (error) {
        // Transport-level failure (DNS, reset, closed connection, offline,
        // timeout): no usable HTTP response was received. Tag it so callers
        // can distinguish it from API-level errors like 401 or
        // WORKFLOWY_TARGET_NOT_FOUND.
        if (timedOut) throw createRequestTimeoutError();
        if (!error.code) error.code = 'WORKFLOWY_NETWORK_ERROR';
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }

    if (!response.ok) {
        const text = await response.text();
        if (response.status === 401) {
            throw new Error('Workflowy API Key 无效或已过期，请在 wfs 中重新设置 API Key');
        }
        let msg = `API Error ${response.status}`;
        try { msg += ` - ${JSON.parse(text).message}`; } catch (e) { msg += ` - ${text}`; }
        throw new Error(msg);
    }
    const cType = response.headers.get("content-type");
    return (cType && cType.includes("application/json")) ? response.json() : { status: 'ok' };
}

async function listTargets(options = {}) {
    const includeSynthetic = options.includeSynthetic !== false;
    const includeCalendar = options.includeCalendar !== false;
    const data = await workflowyApiRequest('targets', null, 'GET', false);
    const rawTargets = Array.isArray(data)
        ? data
        : Array.isArray(data?.targets)
            ? data.targets
            : Array.isArray(data?.data)
                ? data.data
                : [];
    let targets = rawTargets
        .filter(target => target && typeof target === 'object')
        .map(target => {
            const key = String(target.key || target.shortcut || '').trim();
            return key && !target.key ? { ...target, key } : target;
        });

    if (includeSynthetic) {
        SYNTHETIC_SYSTEM_TARGETS.forEach(key => {
            if (!targets.some(t => t.key === key)) {
                targets.push({
                    key: key,
                    name: key.charAt(0).toUpperCase() + key.slice(1),
                    type: 'system',
                    node_id: null
                });
            }
        });
    }
    if (includeCalendar) {
        // GET /targets only returns system targets and user-defined
        // shortcuts; built-in calendar targets like `today` never appear
        // there even though POST /nodes accepts them. Offer them as
        // clearly-typed synthetic rows so they remain selectable.
        SYNTHETIC_CALENDAR_TARGETS.forEach(calendarTarget => {
            if (!targets.some(t => String(t.key || '').toLowerCase() === calendarTarget.key)) {
                targets.push({ ...calendarTarget });
            }
        });
    }
    return targets;
}

async function getTargetByKey(key, options = {}) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey) return null;
    const targets = await listTargets(options);
    return targets.find(t => String(t.key || '').trim().toLowerCase() === normalizedKey) || null;
}

// Targets that resolve locally without any API request (passthrough refs:
// the inbox system target plus built-in calendar targets). Pickers offer
// these as a fallback when GET /targets cannot be loaded at all.
const listOfflineTargets = () => ([
    { key: 'inbox', name: 'Inbox', type: 'system', node_id: null },
    ...SYNTHETIC_CALENDAR_TARGETS.map(target => ({ ...target }))
]);

const createTargetNotFoundError = (ref) => {
    const error = new Error(`Workflowy target "${ref}" 不存在，请在 wfs 中重新选择目标`);
    error.code = 'WORKFLOWY_TARGET_NOT_FOUND';
    error.targetRef = ref;
    return error;
};

const resolveApiRef = async (ref, refType) => {
    const normalizedRef = String(ref || '').trim();
    if (!normalizedRef) return null;
    if (refType === 'uuid' || UUID_PATTERN.test(normalizedRef) || normalizedRef === 'inbox') {
        return normalizedRef;
    }
    if (isCalendarTargetRef(normalizedRef)) {
        // Calendar keys are documented lowercase; normalize stored variants.
        return normalizedRef.toLowerCase();
    }

    const target = await getTargetByKey(normalizedRef, { includeSynthetic: false, includeCalendar: false });
    if (target) return String(target.key || normalizedRef).trim();
    throw createTargetNotFoundError(normalizedRef);
};

const resolveCaptureApiRef = async (captureTarget, onRecover) => {
    const ref = String(captureTarget?.ref || captureTarget?.id || '').trim();
    const refType = captureTarget?.refType || captureTarget?.type;

    try {
        return await resolveApiRef(ref, refType);
    } catch (error) {
        // Recoverable error classes:
        // - WORKFLOWY_TARGET_NOT_FOUND: the stored legacy target is gone for
        //   good; the recovery handler should persist the inbox fallback.
        // - WORKFLOWY_NETWORK_ERROR: the target list could not be loaded at
        //   all (offline/reset connection); the recovery handler should fall
        //   back to inbox for this capture only without overwriting the
        //   stored target.
        const isRecoverableError = error?.code === 'WORKFLOWY_TARGET_NOT_FOUND'
            || error?.code === 'WORKFLOWY_NETWORK_ERROR';
        const canRecover = isRecoverableError
            && RECOVERABLE_SYNTHETIC_TARGETS.has(ref);
        if (!canRecover) throw error;

        const recoveredTarget = { ...INBOX_CAPTURE_TARGET };
        if (typeof onRecover === 'function') {
            await onRecover(recoveredTarget, error);
        }
        return recoveredTarget.ref;
    }
};

async function resolveConcreteNodeId(ref) {
    if (!ref) return null;
    if (UUID_PATTERN.test(ref)) {
        return ref;
    }
    try {
        const target = await getTargetByKey(ref);
        if (target) {
            return target.id || target.nodeId || target.node_id || null;
        }
    } catch (e) { }
    return null;
}

const resolveNodeId = resolveConcreteNodeId;

const { CacheManager } = require('../core/cache');

async function fetchNodes(parentId, onCached, onFresh) {
    const cacheKey = `nodes_${parentId}`;
    const cached = CacheManager.get(cacheKey);

    // 1. Return cached data immediately
    if (cached) {
        onCached(cached);
    }

    // 2. Fetch fresh data
    try {
        const data = await workflowyApiRequest('nodes', { parent_id: parentId }, 'GET', true);

        // 3. Update cache
        CacheManager.set(cacheKey, data);

        // 4. Return fresh data
        onFresh(data);
    } catch (e) {
        // If no cache and fetch failed, throw error
        if (!cached) {
            // Calendar nodes that have never been materialized return 404 on
            // child listing (the API only auto-creates them on POST/move).
            // Treat that as an empty, still-valid location instead of an error.
            if (isCalendarTargetRef(parentId) && /\b404\b/.test(String(e?.message || ''))) {
                onFresh({ nodes: [] });
                return;
            }
            throw e;
        }
        // If we had cache, just log error or ignore (user still sees cached data)
        console.error('Fetch failed, using cache:', e);
    }
}

module.exports = {
    API_REQUEST_TIMEOUT_MS,
    workflowyApiRequest,
    listTargets,
    listOfflineTargets,
    getTargetByKey,
    isCalendarTargetRef,
    resolveApiRef,
    resolveCaptureApiRef,
    resolveConcreteNodeId,
    resolveNodeId,
    fetchNodes
};
