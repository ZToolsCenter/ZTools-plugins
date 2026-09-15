// widget 运行时代码字符串：注入到 iframe 内部的 JS 脚本

const UTOOLS_WEBVIEW_BOTTOM_RESERVE = 72;

/** 自动调整 iframe 高度的运行时脚本（注入到 iframe 内） */
export const RESIZE_SCRIPT = `<script>
(() => {
  const container = document.getElementById('vis-container');
  let rafId = 0;
  let settleTimer = 0;
  const TAB_CLASS_RE = /\btab(s|[-_](bar|nav|list|header|content|panel|pane|body|wrapper|container|buttons?|controls?))?\b/i;

  function isModuleElement(node) {
    return (
      node instanceof HTMLElement &&
      (node.classList.contains('viz-module') ||
        node.hasAttribute('data-viz-module') ||
        node.tagName === 'SECTION' ||
        node.tagName === 'ARTICLE')
    );
  }

  function hasGapClass(node) {
    return Array.from(node.classList).some((className) => /^gap(?:-[xy])?-/.test(className));
  }

  function isKnownLayoutContainer(node) {
    const inlineStyle = (node.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();

    return (
      node.classList.contains('tab-content') ||
      node.classList.contains('gallery') ||
      node.classList.contains('tab-bar') ||
      node.classList.contains('nav-pills') ||
      node.classList.contains('nav-tabs') ||
      node.classList.contains('btn-row') ||
      node.classList.contains('flex') ||
      node.classList.contains('inline-flex') ||
      node.classList.contains('grid') ||
      TAB_CLASS_RE.test(node.className) ||
      hasGapClass(node) ||
      node.matches('[role="tab"],[role="tabpanel"],[role="tablist"]') ||
      !!node.querySelector('[role="tab"],[role="tabpanel"],[role="tablist"]') ||
      inlineStyle.includes('display:flex') ||
      inlineStyle.includes('display:grid') ||
      inlineStyle.includes('gap:') ||
      inlineStyle.includes('row-gap:') ||
      inlineStyle.includes('column-gap:')
    );
  }

  function annotateTopLevelModuleWrappers() {
    if (!container) return;

    Array.from(container.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      if (child.tagName !== 'DIV' && child.tagName !== 'MAIN') return;

      child.classList.remove('viz-module-stack');
      if (isKnownLayoutContainer(child)) return;

      const moduleChildren = Array.from(child.children).filter((node) => isModuleElement(node));
      if (moduleChildren.length < 2) return;

      child.classList.add('viz-module-stack');
    });
  }

  function isTransparentColor(value) {
    return !value || value === 'transparent' || /^rgba?\\(0,\\s*0,\\s*0,\\s*0(?:\\.0+)?\\)$/.test(value);
  }

  function isLikelyShellRoot(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.hasAttribute('data-goose-keep-shell')) return false;
    if (
      node.classList.contains('card') ||
      node.classList.contains('metric') ||
      node.classList.contains('compare-card') ||
      node.classList.contains('tab-content') ||
      node.classList.contains('tab') ||
      node.classList.contains('pill')
    ) {
      return false;
    }

    const blocks = getContentBlocks(node);
    if (blocks.length === 0) return false;

    const headingCount = blocks.filter((child) => /^H[1-6]$/.test(child.tagName)).length;
    const hasHeading = headingCount > 0 || !!node.querySelector('h1,h2,h3,h4,h5,h6');
    const hasTabs = hasTabLayout(node, blocks);
    const nestedCardCount = node.querySelectorAll(
      '.cards > .card, .compare-grid > .compare-card, .metric-row > .metric'
    ).length;
    const nestedPanelCount = node.querySelectorAll('.tab-content, [data-viz-module], .viz-module').length;
    const computed = window.getComputedStyle(node);
    const hasBorder =
      computed.borderStyle !== 'none' && Number.parseFloat(computed.borderTopWidth || '0') > 0;
    const hasRadius = Number.parseFloat(computed.borderTopLeftRadius || '0') > 0;
    const hasBackground = !isTransparentColor(computed.backgroundColor);

    if (!(hasBorder || hasRadius || hasBackground)) return false;

    return hasHeading && (hasTabs || nestedCardCount >= 2 || nestedPanelCount >= 2 || blocks.length >= 4);
  }

  function annotateShellRoots(root) {
    getContentBlocks(root).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      child.removeAttribute('data-goose-shell-root');

      if (isLikelyShellRoot(child)) {
        child.setAttribute('data-goose-shell-root', '');
      }

      if (child.tagName === 'DIV' || child.tagName === 'MAIN') {
        annotateShellRoots(child);
      }
    });
  }

  function getContentBlocks(root) {
    return Array.from(root.children).filter((child) =>
      child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE'
    );
  }

  function hasTabLayout(root, blocks) {
    return (
      !!root.querySelector('[role="tab"],[role="tabpanel"],[role="tablist"]') ||
      blocks.some((child) =>
        TAB_CLASS_RE.test(child.className) ||
        child.classList.contains('nav-pills') ||
        child.classList.contains('nav-tabs') ||
        Array.from(child.querySelectorAll('[role="tab"],[role="tabpanel"]')).length > 0
      ) ||
      // Detect a row/nav of 3+ buttons acting as tab navigation
      Array.from(root.querySelectorAll('div,nav,ul')).some((el) =>
        Array.from(el.children).filter((c) => c.tagName === 'BUTTON' || c.tagName === 'LI').length >= 3
      )
    );
  }

  function normalizeHeadingModules(root) {
    const blocks = getContentBlocks(root);
    const explicitModuleCount = blocks.filter((child) => isModuleElement(child)).length;
    const headingCount = blocks.filter((child) => /^H[1-6]$/.test(child.tagName)).length;

    if (
      hasTabLayout(root, blocks) ||
      headingCount === 0 ||
      (headingCount < 2 && explicitModuleCount === 0)
    ) return;

    let currentModule = null;
    blocks.forEach((block) => {
      if (isModuleElement(block)) {
        currentModule = null;
        return;
      }

      if (/^H[1-6]$/.test(block.tagName)) {
        currentModule = document.createElement('section');
        currentModule.className = 'viz-module';
        root.insertBefore(currentModule, block);
      }
      currentModule?.appendChild(block);
    });
  }

  function normalizeTopLevelHeadingModules() {
    if (!container) return;

    normalizeHeadingModules(container);

    Array.from(container.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      if (child.tagName !== 'DIV' && child.tagName !== 'MAIN') return;
      if (isKnownLayoutContainer(child)) return;
      normalizeHeadingModules(child);
    });

    annotateTopLevelModuleWrappers();
    annotateShellRoots(container);
  }

  function readHeight() {
    expandVerticalOverflowContainers();

    const bodyTop = document.body.getBoundingClientRect().top;
    const directChildren = container ? Array.from(container.children) : [];
    const containerPaddingBottom = container
      ? Number.parseFloat(window.getComputedStyle(container).paddingBottom) || 0
      : 0;
    const childrenBottom = directChildren.reduce((max, child) => {
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') return max;
      const rect = child.getBoundingClientRect();
      return Math.max(max, rect.bottom - bodyTop + containerPaddingBottom);
    }, 0);
    const nestedScrollBottom = container
      ? Array.from(container.querySelectorAll('*')).reduce((max, node) => {
          if (!(node instanceof HTMLElement)) return max;
          if (node.scrollHeight <= node.clientHeight + 1) return max;
          const rect = node.getBoundingClientRect();
          return Math.max(max, rect.top - bodyTop + node.scrollHeight);
        }, 0)
      : 0;

    return Math.ceil(Math.max(
      container ? container.scrollHeight : 0,
      childrenBottom,
      nestedScrollBottom
    )) + ${UTOOLS_WEBVIEW_BOTTOM_RESERVE};
  }

  function expandVerticalOverflowContainers() {
    if (!container) return;

    Array.from(container.querySelectorAll('*')).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
      if (node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') return;
      if (node.hasAttribute('data-goose-keep-scroll')) return;
      if (node.clientHeight <= 0) return;

      const computed = window.getComputedStyle(node);
      const overflowY = computed.overflowY;
      const overflow = computed.overflow;
      const isScrollableY =
        overflowY === 'auto' ||
        overflowY === 'scroll' ||
        overflow === 'auto' ||
        overflow === 'scroll';

      if (!isScrollableY) return;
      if (node.scrollHeight <= node.clientHeight + 1) return;

      const nextHeight = String(Math.ceil(node.scrollHeight)) + 'px';

      if (
        node.style.getPropertyValue('overflow-y') !== 'hidden' ||
        node.style.getPropertyPriority('overflow-y') !== 'important'
      ) {
        node.style.setProperty('overflow-y', 'hidden', 'important');
      }
      if (
        computed.maxHeight !== 'none' &&
        (
          node.style.getPropertyValue('max-height') !== 'none' ||
          node.style.getPropertyPriority('max-height') !== 'important'
        )
      ) {
        node.style.setProperty('max-height', 'none', 'important');
      }
      if (
        node.style.getPropertyValue('height') !== nextHeight ||
        node.style.getPropertyPriority('height') !== 'important'
      ) {
        node.style.setProperty('height', nextHeight, 'important');
      }
    });
  }

  function notifyHeight() {
    window.parent.postMessage({ type: 'iframe-height', height: readHeight() }, '*');
  }

  function scheduleHeight() {
    window.cancelAnimationFrame(rafId);
    window.clearTimeout(settleTimer);
    rafId = window.requestAnimationFrame(() => {
      notifyHeight();
      settleTimer = window.setTimeout(notifyHeight, 120);
    });
  }

  normalizeTopLevelHeadingModules();
  window.__gooseWidgetResize = scheduleHeight;
  window.addEventListener('load', scheduleHeight);
  window.addEventListener('resize', scheduleHeight);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleHeight).catch(() => {});
  }

  ['click', 'input', 'change', 'transitionend', 'animationend'].forEach((eventName) => {
    document.addEventListener(eventName, scheduleHeight, true);
  });

  const mutationObserver = new MutationObserver(scheduleHeight);
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(scheduleHeight);
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);
    if (container) resizeObserver.observe(container);
  }

  document.addEventListener('keydown', (event) => {
    if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.repeat) return;
    const isZoomKey =
      event.key === '+' ||
      event.key === '=' ||
      event.key === '-' ||
      event.key === '0' ||
      event.code === 'Equal' ||
      event.code === 'Minus' ||
      event.code === 'Digit0' ||
      event.code === 'NumpadAdd' ||
      event.code === 'NumpadSubtract' ||
      event.code === 'Numpad0';

    if (isZoomKey) {
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage(
        { type: 'iframe-editor-zoom', key: event.key, code: event.code },
        '*'
      );
    }
  }, true);

  window.setTimeout(scheduleHeight, 40);
  window.setTimeout(scheduleHeight, 140);
  window.setTimeout(scheduleHeight, 320);
})();
<\/script>`;

/** localStorage / sessionStorage 沙箱 shim（注入到 iframe 内） */
export const STORAGE_SHIM = `<script data-goose-storage-shim>
(() => {
  const createStorage = () => {
    const data = Object.create(null);
    return {
      clear() { Object.keys(data).forEach(k => delete data[k]); },
      getItem(k) { return k in data ? data[k] : null; },
      setItem(k, v) { data[k] = String(v); },
      removeItem(k) { delete data[k]; },
      key(i) { return Object.keys(data)[i] ?? null; },
      get length() { return Object.keys(data).length; },
    };
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: createStorage() });
    Object.defineProperty(window, 'sessionStorage', { value: createStorage() });
  } catch (e) {}
})();
<\/script>`;

/** 监听 update-html 消息并更新 vis-container（注入到 iframe 内） */
export const UPDATE_LISTENER_SCRIPT = `<script data-goose-update-listener>
(() => {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (event.data && event.data.type === 'update-html') {
      const container = document.getElementById('vis-container');
      if (container) {
        container.innerHTML = event.data.html;
        if (window.__gooseWidgetResize) window.__gooseWidgetResize();
      }
    }
  });
})();
<\/script>`;
