'use strict';
(function () {
  const pending = new Map();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target); const load = pending.get(entry.target); pending.delete(entry.target); if (entry.target.isConnected) load?.();
    }
  }, { rootMargin: '80px' });
  function prune() { for (const node of pending.keys()) if (!node.isConnected) { observer.unobserve(node); pending.delete(node); } }
  function create(siteId, author, value, className = '') {
    const node = document.createElement('span'); node.className = 'avatar ' + className;
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', (author || '匿名') + ' 的头像');
    const letter = document.createElement('span'); letter.className = 'avatar-initial'; letter.textContent = (author || '?').slice(0, 1).toUpperCase(); letter.setAttribute('aria-hidden', 'true'); node.append(letter);
    const url = ReaderCore.avatarUrl(siteId, value);
    if (url && window.communityServices?.avatar) {
      pending.set(node, async () => {
        try {
          const data = await window.communityServices.avatar(siteId, url); if (!node.isConnected || !data) return;
          if (!/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(data)) return;
          const image = document.createElement('img'); image.alt = ''; image.decoding = 'async';
          image.onload = () => { if (node.isConnected) node.classList.add('has-image'); };
          image.onerror = () => { image.remove(); node.classList.remove('has-image'); };
          image.src = data; node.append(image);
        } catch { /* Keep the author's initial as a quiet fallback. */ }
      });
      observer.observe(node);
    }
    return node;
  }
  window.CommunityAvatars = { create, prune };
})();
