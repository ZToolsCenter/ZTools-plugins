// The launcher (ztools/utools/rubick) injects its own API object; this only
// adds a native clipboard fallback used when the launcher copyText is unavailable.
try {
  const { clipboard } = require('electron');
  window.__nativeCopy = (text) => {
    clipboard.writeText(String(text));
    return true;
  };
} catch (e) {
  // index.html falls back to navigator.clipboard / execCommand.
}
