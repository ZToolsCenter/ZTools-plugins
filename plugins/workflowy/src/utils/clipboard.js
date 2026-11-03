// Clipboard text access for capture staging.
//
// The plugin runs in uTools' Electron preload context, so the Node-side
// `electron.clipboard` module is the reliable source. The require is guarded
// because the same modules are loaded by plain Node unit tests, where
// `require('electron')` throws.
//
// Precedence: ztools.getCopyedText() is preferred when present (it is what
// uTools itself would auto-fill into the sub-input), and the Electron
// clipboard is the fallback. Both failing is a normal, silent case — the
// caller must degrade to its previous behavior rather than block capture.

const trimString = (value) => String(value || '').trim();

const getElectronClipboard = () => {
    try {
        const electron = require('electron');
        return electron?.clipboard || null;
    } catch (error) {
        return null;
    }
};

const readClipboardTextViaUtools = (utoolsApi) => {
    if (typeof utoolsApi?.getCopyedText !== 'function') return '';
    try {
        return trimString(utoolsApi.getCopyedText());
    } catch (error) {
        return '';
    }
};

const readClipboardTextViaElectron = () => {
    const clipboard = getElectronClipboard();
    if (!clipboard || typeof clipboard.readText !== 'function') return '';
    try {
        return trimString(clipboard.readText());
    } catch (error) {
        return '';
    }
};

const readClipboardText = (utoolsApi) => (
    readClipboardTextViaUtools(utoolsApi) || readClipboardTextViaElectron()
);

module.exports = {
    readClipboardText,
    readClipboardTextViaUtools,
    readClipboardTextViaElectron
};
