'use strict';
(function () {
  const pending = new Map();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); const load = pending.get(entry.target); pending.delete(entry.target); if (entry.target.isConnected) load?.(); }
  }, { rootMargin: '150px' });
  let originalUrl = '', originalOpen;
  function initViewer() {
    const dialog = document.getElementById('image-viewer');
    document.getElementById('image-close').onclick = () => dialog.close();
    document.getElementById('image-original').onclick = () => originalOpen?.(originalUrl);
    document.getElementById('image-size').onclick = () => dialog.classList.toggle('actual-size');
    dialog.addEventListener('close', () => { document.getElementById('image-full').removeAttribute('src'); dialog.classList.remove('actual-size'); });
    return dialog;
  }
  function hydrate(container, openExternal) {
    for (const node of pending.keys()) if (!node.isConnected) { observer.unobserve(node); pending.delete(node); }
    for (const image of container.querySelectorAll('img[data-image-url]')) {
      const url = image.dataset.imageUrl; image.removeAttribute('data-image-url'); image.className = 'inline-image';
      // The observer already defers fetching. Native lazy loading would wait for
      // this hidden image to become visible, while visibility waits for onload.
      image.loading = 'eager'; image.decoding = 'async';
      const figure = document.createElement('figure'); figure.className = 'post-image'; image.replaceWith(figure);
      const status = document.createElement('span'); status.className = 'image-status'; status.textContent = '图片将在接近可见区域时加载';
      const controls = document.createElement('span'); controls.className = 'image-controls';
      const original = document.createElement('button'); original.type = 'button'; original.textContent = '查看原图'; original.onclick = () => openExternal(url);
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试'; retry.hidden = true;
      controls.append(original, retry); figure.append(image, status, controls);
      // Images can originate inside links; preview controls should keep their own action.
      figure.addEventListener('click', event => { if (event.target === image || event.target.closest('button')) { event.preventDefault(); event.stopPropagation(); } });
      let data;
      image.onload = () => { figure.classList.add('loaded'); status.hidden = true; retry.hidden = true; };
      image.onerror = () => { figure.classList.remove('loaded'); status.hidden = false; status.textContent = '图片未能显示，可重试或查看原图'; retry.hidden = false; };
      const load = async () => {
        status.textContent = '正在加载图片…'; retry.hidden = true;
        try {
          if (!window.communityServices?.image) throw new Error('请在 ZTools 中加载图片。');
          data = await window.communityServices.image(url); if (!image.isConnected) return;
          if (!/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(data)) throw new Error('图片数据无效。');
          image.src = data;
        } catch (error) { if (image.isConnected) { status.textContent = error?.message || '图片加载失败'; retry.hidden = false; } }
      };
      retry.onclick = load;
      image.onclick = () => {
        if (!data || !figure.classList.contains('loaded')) return;
        originalUrl = url; originalOpen = openExternal;
        const dialog = document.getElementById('image-viewer'); document.getElementById('image-full').src = data; dialog.showModal();
      };
      image.tabIndex = 0; image.setAttribute('role', 'button'); image.setAttribute('aria-label', (image.alt || '帖子图片') + '，点击放大');
      image.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); image.click(); } };
      pending.set(figure, load); observer.observe(figure);
    }
  }
  document.addEventListener('DOMContentLoaded', initViewer);
  window.CommunityMedia = { hydrate };
})();
