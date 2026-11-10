window.addEventListener('error', event => console.error('LX plugin error', event.error || event.message))
window.addEventListener('unhandledrejection', event => console.error('LX plugin rejected request', event.reason))
