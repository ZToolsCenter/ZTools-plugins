const ztoolsHost = typeof window !== 'undefined' ? window.ztools : undefined;

export const isZtoolsEnv = typeof ztoolsHost !== 'undefined';
export const hostApi = ztoolsHost || null;

export const storage = hostApi?.dbStorage || localStorage;

export function isMacOS() {
    if (typeof ztoolsHost?.isMacOs === 'function') {
        return ztoolsHost.isMacOs();
    }
    if (typeof ztoolsHost?.isMacOS === 'function') {
        return ztoolsHost.isMacOS();
    }
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

export function isDarkColors() {
    if (typeof hostApi?.isDarkColors === 'function') {
        return hostApi.isDarkColors();
    }
    return typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
}

export function onThemeChange(callback) {
    if (typeof window.matchMedia !== 'function') {
        return () => {};
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => callback(event.matches);

    if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', handler);
        return () => media.removeEventListener('change', handler);
    }

    if (typeof media.addListener === 'function') {
        media.addListener(handler);
        return () => media.removeListener(handler);
    }

    return () => {};
}

export function onPluginEnter(callback) {
    if (typeof hostApi?.onPluginEnter === 'function') {
        hostApi.onPluginEnter(callback);
    }
}

export function onPluginOut(callback) {
    if (typeof hostApi?.onPluginOut === 'function') {
        hostApi.onPluginOut(callback);
    }
}

export function onMainPush(callback, selectCallback) {
    if (typeof hostApi?.onMainPush === 'function') {
        hostApi.onMainPush(callback, selectCallback);
    }
}

export async function pasteText(text) {
    if (!text) {
        return false;
    }

    if (typeof ztoolsHost?.clipboard?.writeContent === 'function') {
        await ztoolsHost.clipboard.writeContent({ type: 'text', content: text }, true);
        return true;
    }

    if (typeof ztoolsHost?.copyText === 'function') {
        ztoolsHost.copyText(text);
        if (typeof ztoolsHost.hideMainWindow === 'function') {
            await ztoolsHost.hideMainWindow();
        }
        return true;
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    return true;
}

export function openExternal(url) {
    if (!url) {
        return false;
    }

    if (typeof hostApi?.shellOpenExternal === 'function') {
        return hostApi.shellOpenExternal(url);
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    return false;
}

if (typeof window !== 'undefined') {
    window.openExternalLink = (url) => {
        openExternal(url);
        return false;
    };
}
