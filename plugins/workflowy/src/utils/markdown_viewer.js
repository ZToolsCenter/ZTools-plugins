const { normalizeOssSettings, buildOssObjectKey } = require('../api/oss');
const { MARKDOWN_OSS_PATH_PREFIX, MARKDOWN_CONTENT_TYPE } = require('./markdown_file');

const MARKDOWN_VIEWER_OBJECT_KEY = 'workflowy-viewer/index.html';
const MARKDOWN_VIEWER_PATH_PREFIX = 'workflowy-viewer/';
const MARKDOWN_VIEWER_CONTENT_TYPE = 'text/html; charset=utf-8';

const DEFAULT_VIEWER_MARKDOWN = `# Workflowy Markdown Viewer

This page is rendered from OSS using the default OSS domain.

- Bucket-hosted viewer
- Same-origin fetch for Markdown
- Basic rendering for headings, lists, quotes, code fences, and links

\`\`\`js
console.log('markdown viewer ready');
\`\`\`
`;

const buildOssDefaultPublicUrl = (settings = {}, objectKey = '') => {
    const normalized = normalizeOssSettings(settings);
    if (!normalized.ossBucket || !normalized.ossEndpoint || !objectKey) return '';
    return `https://${normalized.ossBucket}.${normalized.ossEndpoint}/${String(objectKey).replace(/^\/+/g, '')}`;
};

const buildMarkdownViewerUrl = (settings = {}, objectKey = '') => {
    const viewerBaseUrl = buildOssDefaultPublicUrl(settings, MARKDOWN_VIEWER_OBJECT_KEY);
    if (!viewerBaseUrl || !objectKey) return '';
    const url = new URL(viewerBaseUrl);
    url.searchParams.set('key', objectKey);
    return url.toString();
};

const buildMarkdownViewerObjectKey = (markdownObjectKey = '') => {
    const cleanKey = String(markdownObjectKey || '').trim().replace(/^\/+/g, '');
    if (!cleanKey) return MARKDOWN_VIEWER_OBJECT_KEY;

    const relativeKey = cleanKey.startsWith(MARKDOWN_OSS_PATH_PREFIX)
        ? cleanKey.slice(MARKDOWN_OSS_PATH_PREFIX.length)
        : cleanKey;

    return `${MARKDOWN_VIEWER_PATH_PREFIX}${relativeKey.replace(/\.(md|markdown|txt)$/i, '')}`;
};

const buildStandaloneMarkdownViewerUrl = (settings = {}, markdownObjectKey = '') => {
    const viewerObjectKey = buildMarkdownViewerObjectKey(markdownObjectKey);
    return buildOssDefaultPublicUrl(settings, viewerObjectKey);
};

const resolveMarkdownAttachmentUrls = (settings = {}, objectKey = '') => {
    const rawUrl = buildOssDefaultPublicUrl(settings, objectKey);
    const viewerUrl = buildStandaloneMarkdownViewerUrl(settings, objectKey);
    const viewerEnabled = settings.ossMarkdownViewerEnabled === true;

    return {
        rawUrl,
        viewerUrl,
        viewerObjectKey: buildMarkdownViewerObjectKey(objectKey),
        noteUrl: viewerEnabled && viewerUrl ? viewerUrl : rawUrl
    };
};

const createMarkdownViewerUploadPayload = () => {
    const buffer = Buffer.from(MARKDOWN_VIEWER_HTML, 'utf8');
    return {
        kind: 'markdown-viewer',
        objectKey: MARKDOWN_VIEWER_OBJECT_KEY,
        buffer,
        contentType: MARKDOWN_VIEWER_CONTENT_TYPE,
        extension: 'html',
        name: 'workflowy-markdown-viewer.html',
        displayName: 'workflowy-markdown-viewer.html',
        originalSize: buffer.length,
        size: buffer.length,
        compressed: false
    };
};

const createMarkdownViewerDemoFile = (options = {}) => {
    const buffer = Buffer.from(options.content || DEFAULT_VIEWER_MARKDOWN, 'utf8');
    return {
        kind: 'markdown',
        objectKey: buildOssObjectKey({
            pathPrefix: MARKDOWN_OSS_PATH_PREFIX,
            date: options.date,
            extension: 'md'
        }),
        buffer,
        contentType: MARKDOWN_CONTENT_TYPE,
        extension: 'md',
        name: options.name || 'viewer-check.md',
        displayName: options.displayName || 'viewer-check.md',
        originalSize: buffer.length,
        size: buffer.length,
        compressed: false
    };
};

const renderStandaloneMarkdownViewerHtml = ({
    title = 'Markdown Viewer',
    markdownText = '',
    rawUrl = '',
    objectKey = ''
} = {}) => {
    const serializedTitle = JSON.stringify(title);
    const serializedMarkdown = JSON.stringify(markdownText);
    const serializedRawUrl = JSON.stringify(rawUrl);
    const serializedObjectKey = JSON.stringify(objectKey);

    return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflowy Markdown Viewer</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f3ee;
      --panel: rgba(255, 252, 247, 0.94);
      --ink: #1f1e1a;
      --muted: #706a5f;
      --line: rgba(31, 30, 26, 0.12);
      --accent: #0c7a6c;
      --accent-soft: rgba(12, 122, 108, 0.12);
      --code-bg: #1f2430;
      --code-ink: #f7f7f2;
      --shadow: 0 24px 60px rgba(31, 30, 26, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(12, 122, 108, 0.12), transparent 28%),
        linear-gradient(180deg, #fdfaf4 0%, var(--bg) 100%);
      min-height: 100vh;
    }
    .shell {
      width: min(980px, calc(100vw - 32px));
      margin: 24px auto;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(14px);
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.5);
    }
    .meta { min-width: 0; }
    .eyebrow {
      margin: 0 0 4px;
      color: var(--muted);
      font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .title {
      margin: 0;
      font-size: clamp(22px, 4vw, 34px);
      line-height: 1.1;
      overflow-wrap: anywhere;
    }
    .subtle {
      margin: 8px 0 0;
      color: var(--muted);
      font: 500 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .button {
      appearance: none;
      border: 1px solid var(--line);
      background: white;
      color: var(--ink);
      border-radius: 999px;
      padding: 10px 14px;
      font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-decoration: none;
      cursor: pointer;
    }
    .button.primary {
      background: var(--accent);
      color: white;
      border-color: transparent;
    }
    .status {
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: var(--accent-soft);
      color: var(--muted);
      font: 500 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .content { padding: clamp(22px, 4vw, 44px); }
    .markdown {
      max-width: 760px;
      margin: 0 auto;
      font-size: 18px;
      line-height: 1.8;
      overflow-wrap: anywhere;
    }
    .markdown > :first-child { margin-top: 0; }
    .markdown > :last-child { margin-bottom: 0; }
    .markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 {
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      line-height: 1.15;
      margin: 1.8em 0 0.6em;
    }
    .markdown h1 { font-size: 2em; }
    .markdown h2 { font-size: 1.55em; }
    .markdown h3 { font-size: 1.25em; }
    .markdown p, .markdown ul, .markdown ol, .markdown blockquote, .markdown pre { margin: 0 0 1em; }
    .markdown ul, .markdown ol { padding-left: 1.4em; }
    .markdown li + li { margin-top: 0.3em; }
    .markdown blockquote {
      border-left: 3px solid rgba(12, 122, 108, 0.35);
      padding: 0.1em 0 0.1em 1em;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.6);
    }
    .markdown code {
      font-family: "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.9em;
      background: rgba(31, 36, 48, 0.08);
      padding: 0.12em 0.35em;
      border-radius: 6px;
    }
    .markdown pre {
      background: var(--code-bg);
      color: var(--code-ink);
      padding: 18px;
      border-radius: 12px;
      overflow: auto;
    }
    .markdown pre code {
      background: transparent;
      padding: 0;
      color: inherit;
    }
    .markdown a {
      color: var(--accent);
      text-decoration-thickness: 1px;
      text-underline-offset: 0.14em;
    }
    .markdown img {
      max-width: 100%;
      display: block;
      border-radius: 12px;
      margin: 1.2em 0;
      box-shadow: 0 14px 30px rgba(31, 30, 26, 0.12);
    }
    .empty {
      color: var(--muted);
      font-style: italic;
    }
    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .actions {
        width: 100%;
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="meta">
        <p class="eyebrow">Workflowy Markdown</p>
        <h1 id="title" class="title">Loading...</h1>
        <p id="subtitle" class="subtle"></p>
      </div>
      <div class="actions">
        <a id="raw-link" class="button" href="#" target="_blank" rel="noreferrer noopener">View Source</a>
        <button id="reload-button" class="button primary" type="button">Reload</button>
      </div>
    </header>
    <div id="status" class="status">Preparing viewer...</div>
    <section class="content">
      <article id="markdown" class="markdown"></article>
    </section>
  </main>
  <script>
    const titleText = ${serializedTitle};
    const objectKey = ${serializedObjectKey};
    const rawUrl = ${serializedRawUrl};
    const sourceMarkdown = ${serializedMarkdown};

    const titleElement = document.getElementById('title');
    const subtitleElement = document.getElementById('subtitle');
    const statusElement = document.getElementById('status');
    const markdownElement = document.getElementById('markdown');
    const rawLinkElement = document.getElementById('raw-link');
    const reloadButton = document.getElementById('reload-button');

    function setStatus(message) {
      statusElement.textContent = message;
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
      return escapeHtml(value);
    }

    function sanitizeUrl(value) {
      try {
        const url = new URL(value, window.location.href);
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
        return url.toString();
      } catch (error) {
        return '';
      }
    }

    function renderInline(text) {
      let html = escapeHtml(text);
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
        const safeUrl = sanitizeUrl(url);
        if (!safeUrl) return '';
        return '<img alt="' + escapeAttribute(alt) + '" src="' + escapeAttribute(safeUrl) + '">';
      });
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
        const safeUrl = sanitizeUrl(url);
        if (!safeUrl) return escapeHtml(label);
        return '<a href="' + escapeAttribute(safeUrl) + '" target="_blank" rel="noreferrer noopener">' + escapeHtml(label) + '</a>';
      });
      html = html.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      html = html.replace(/(^|[^\*])\*([^\*]+)\*(?!\*)/g, '$1<em>$2</em>');
      html = html.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
      return html;
    }

    function closeListIfNeeded(state, output) {
      if (!state.listType) return;
      output.push(state.listType === 'ol' ? '</ol>' : '</ul>');
      state.listType = null;
    }

    function renderMarkdown(source) {
      const text = String(source || '').replace(/\r\n/g, '\n');
      const lines = text.split('\n');
      const output = [];
      const state = { listType: null, inCode: false, codeBuffer: [] };
      const codeFence = '\x60\x60\x60';
      let paragraph = [];
      let quote = [];

      function flushParagraph() {
        if (!paragraph.length) return;
        output.push('<p>' + renderInline(paragraph.join(' ')) + '</p>');
        paragraph = [];
      }

      function flushQuote() {
        if (!quote.length) return;
        output.push('<blockquote><p>' + renderInline(quote.join(' ')) + '</p></blockquote>');
        quote = [];
      }

      function flushCode() {
        if (!state.inCode) return;
        output.push('<pre><code>' + escapeHtml(state.codeBuffer.join('\n')) + '</code></pre>');
        state.inCode = false;
        state.codeBuffer = [];
      }

      for (const rawLine of lines) {
        const line = rawLine;
        const trimmed = line.trim();

        if (state.inCode) {
          if (trimmed.startsWith(codeFence)) {
            flushCode();
          } else {
            state.codeBuffer.push(line);
          }
          continue;
        }

        if (trimmed.startsWith(codeFence)) {
          flushParagraph();
          flushQuote();
          closeListIfNeeded(state, output);
          state.inCode = true;
          state.codeBuffer = [];
          continue;
        }

        if (!trimmed) {
          flushParagraph();
          flushQuote();
          closeListIfNeeded(state, output);
          continue;
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          flushParagraph();
          flushQuote();
          closeListIfNeeded(state, output);
          const level = headingMatch[1].length;
          output.push('<h' + level + '>' + renderInline(headingMatch[2]) + '</h' + level + '>');
          continue;
        }

        if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
          flushParagraph();
          flushQuote();
          closeListIfNeeded(state, output);
          output.push('<hr>');
          continue;
        }

        const blockquoteMatch = line.match(/^>\s?(.*)$/);
        if (blockquoteMatch) {
          flushParagraph();
          closeListIfNeeded(state, output);
          quote.push(blockquoteMatch[1]);
          continue;
        }

        const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
        const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
        if (ulMatch || olMatch) {
          flushParagraph();
          flushQuote();
          const listType = ulMatch ? 'ul' : 'ol';
          if (state.listType && state.listType !== listType) {
            closeListIfNeeded(state, output);
          }
          if (!state.listType) {
            output.push(listType === 'ol' ? '<ol>' : '<ul>');
            state.listType = listType;
          }
          output.push('<li>' + renderInline((ulMatch || olMatch)[1]) + '</li>');
          continue;
        }

        flushQuote();
        closeListIfNeeded(state, output);
        paragraph.push(trimmed);
      }

      flushParagraph();
      flushQuote();
      closeListIfNeeded(state, output);
      flushCode();

      return output.join('') || '<p class="empty">Empty document.</p>';
    }

    function renderViewer() {
      titleElement.textContent = titleText || 'Workflowy Markdown Viewer';
      subtitleElement.textContent = objectKey || rawUrl || 'Self-contained viewer';
      if (rawUrl) {
        rawLinkElement.href = rawUrl;
      } else {
        rawLinkElement.removeAttribute('href');
      }
      markdownElement.innerHTML = renderMarkdown(sourceMarkdown);
      setStatus('Rendered from embedded Markdown content.');
    }

    reloadButton.addEventListener('click', () => {
      renderViewer();
    });

    renderViewer();
  </script>
</body>
</html>`;
};

const createMarkdownStandaloneViewerUploadPayload = ({
    markdownObjectKey = '',
    markdownText = '',
    rawUrl = '',
    displayName = ''
} = {}) => {
    const objectKey = buildMarkdownViewerObjectKey(markdownObjectKey);
    const title = displayName || String(markdownObjectKey || '').split('/').pop() || 'untitled.md';
    const buffer = Buffer.from(renderStandaloneMarkdownViewerHtml({
        title,
        markdownText,
        rawUrl,
        objectKey: markdownObjectKey
    }), 'utf8');

    return {
        kind: 'markdown-viewer-standalone',
        objectKey,
        buffer,
        contentType: MARKDOWN_VIEWER_CONTENT_TYPE,
        extension: '',
        name: `${title.replace(/\.(md|markdown|txt)$/i, '')}-viewer`,
        displayName: `${title.replace(/\.(md|markdown|txt)$/i, '')}-viewer`,
        originalSize: buffer.length,
        size: buffer.length,
        compressed: false
    };
};

const MARKDOWN_VIEWER_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflowy Markdown Viewer</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f3ee;
      --panel: rgba(255, 252, 247, 0.92);
      --ink: #1f1e1a;
      --muted: #706a5f;
      --line: rgba(31, 30, 26, 0.12);
      --accent: #0c7a6c;
      --accent-soft: rgba(12, 122, 108, 0.12);
      --code-bg: #1f2430;
      --code-ink: #f7f7f2;
      --shadow: 0 24px 60px rgba(31, 30, 26, 0.12);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(12, 122, 108, 0.12), transparent 28%),
        linear-gradient(180deg, #fdfaf4 0%, var(--bg) 100%);
      min-height: 100vh;
    }

    .shell {
      width: min(980px, calc(100vw - 32px));
      margin: 24px auto;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(14px);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.5);
    }

    .meta { min-width: 0; }

    .eyebrow {
      margin: 0 0 4px;
      color: var(--muted);
      font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .title {
      margin: 0;
      font-size: clamp(22px, 4vw, 34px);
      line-height: 1.1;
      overflow-wrap: anywhere;
    }

    .subtle {
      margin: 8px 0 0;
      color: var(--muted);
      font: 500 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-wrap: anywhere;
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .button {
      appearance: none;
      border: 1px solid var(--line);
      background: white;
      color: var(--ink);
      border-radius: 999px;
      padding: 10px 14px;
      font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-decoration: none;
      cursor: pointer;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
    }

    .button:hover {
      transform: translateY(-1px);
      border-color: rgba(12, 122, 108, 0.4);
      background: rgba(255, 255, 255, 0.9);
    }

    .button.primary {
      background: var(--accent);
      color: white;
      border-color: transparent;
    }

    .status {
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: var(--accent-soft);
      color: var(--muted);
      font: 500 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .status.error {
      background: rgba(153, 34, 34, 0.1);
      color: #7a1f1f;
    }

    .content {
      padding: clamp(22px, 4vw, 44px);
    }

    .markdown {
      max-width: 760px;
      margin: 0 auto;
      font-size: 18px;
      line-height: 1.8;
      overflow-wrap: anywhere;
    }

    .markdown > :first-child { margin-top: 0; }
    .markdown > :last-child { margin-bottom: 0; }
    .markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 {
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      line-height: 1.15;
      margin: 1.8em 0 0.6em;
    }
    .markdown h1 { font-size: 2em; }
    .markdown h2 { font-size: 1.55em; }
    .markdown h3 { font-size: 1.25em; }
    .markdown p, .markdown ul, .markdown ol, .markdown blockquote, .markdown pre {
      margin: 0 0 1em;
    }
    .markdown ul, .markdown ol { padding-left: 1.4em; }
    .markdown li + li { margin-top: 0.3em; }
    .markdown blockquote {
      border-left: 3px solid rgba(12, 122, 108, 0.35);
      padding: 0.1em 0 0.1em 1em;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.6);
    }
    .markdown code {
      font-family: "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.9em;
      background: rgba(31, 36, 48, 0.08);
      padding: 0.12em 0.35em;
      border-radius: 6px;
    }
    .markdown pre {
      background: var(--code-bg);
      color: var(--code-ink);
      padding: 18px;
      border-radius: 12px;
      overflow: auto;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    }
    .markdown pre code {
      background: transparent;
      padding: 0;
      color: inherit;
    }
    .markdown a {
      color: var(--accent);
      text-decoration-thickness: 1px;
      text-underline-offset: 0.14em;
    }
    .markdown img {
      max-width: 100%;
      display: block;
      border-radius: 12px;
      margin: 1.2em 0;
      box-shadow: 0 14px 30px rgba(31, 30, 26, 0.12);
    }
    .empty {
      color: var(--muted);
      font-style: italic;
    }

    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .actions {
        width: 100%;
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="meta">
        <p class="eyebrow">Workflowy Markdown</p>
        <h1 id="title" class="title">Loading...</h1>
        <p id="subtitle" class="subtle"></p>
      </div>
      <div class="actions">
        <a id="raw-link" class="button" href="#" target="_blank" rel="noreferrer noopener">View Source</a>
        <button id="reload-button" class="button primary" type="button">Reload</button>
      </div>
    </header>
    <div id="status" class="status">Preparing viewer...</div>
    <section class="content">
      <article id="markdown" class="markdown"></article>
    </section>
  </main>
  <script>
    const allowedPrefix = 'workflowy-markdown/';

    const titleElement = document.getElementById('title');
    const subtitleElement = document.getElementById('subtitle');
    const statusElement = document.getElementById('status');
    const markdownElement = document.getElementById('markdown');
    const rawLinkElement = document.getElementById('raw-link');
    const reloadButton = document.getElementById('reload-button');

    const params = new URLSearchParams(window.location.search);
    const objectKey = params.get('key') || '';

    function setStatus(message, isError) {
      statusElement.textContent = message;
      statusElement.className = isError ? 'status error' : 'status';
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
      return escapeHtml(value);
    }

    function sanitizeUrl(value) {
      try {
        const url = new URL(value, window.location.origin);
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
        return url.toString();
      } catch (error) {
        return '';
      }
    }

    function renderInline(text) {
      let html = escapeHtml(text);
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
        const safeUrl = sanitizeUrl(url);
        if (!safeUrl) return '';
        return '<img alt="' + escapeAttribute(alt) + '" src="' + escapeAttribute(safeUrl) + '">';
      });
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
        const safeUrl = sanitizeUrl(url);
        if (!safeUrl) return escapeHtml(label);
        return '<a href="' + escapeAttribute(safeUrl) + '" target="_blank" rel="noreferrer noopener">' + escapeHtml(label) + '</a>';
      });
      html = html.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      html = html.replace(/(^|[^\*])\*([^\*]+)\*(?!\*)/g, '$1<em>$2</em>');
      html = html.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
      return html;
    }

    function closeListIfNeeded(state, output) {
      if (!state.listType) return;
      output.push(state.listType === 'ol' ? '</ol>' : '</ul>');
      state.listType = null;
    }

    function renderMarkdown(source) {
      const text = String(source || '').replace(/\r\n/g, '\n');
      const lines = text.split('\n');
      const output = [];
      const state = { listType: null, inCode: false, codeBuffer: [] };
      const codeFence = '\x60\x60\x60';
      let paragraph = [];
      let quote = [];

      function flushParagraph() {
        if (!paragraph.length) return;
        output.push('<p>' + renderInline(paragraph.join(' ')) + '</p>');
        paragraph = [];
      }

      function flushQuote() {
        if (!quote.length) return;
        output.push('<blockquote><p>' + renderInline(quote.join(' ')) + '</p></blockquote>');
        quote = [];
      }

      function flushCode() {
        if (!state.inCode) return;
        output.push('<pre><code>' + escapeHtml(state.codeBuffer.join('\n')) + '</code></pre>');
        state.inCode = false;
        state.codeBuffer = [];
      }

      for (const rawLine of lines) {
        const line = rawLine;
        const trimmed = line.trim();

        if (state.inCode) {
          if (trimmed.startsWith(codeFence)) {
            flushCode();
          } else {
            state.codeBuffer.push(line);
          }
          continue;
        }

        if (trimmed.startsWith(codeFence)) {
          flushParagraph();
          flushQuote();
          closeListIfNeeded(state, output);
          state.inCode = true;
          state.codeBuffer = [];
          continue;
        }

        if (!trimmed) {
          flushParagraph();
          flushQuote();
          closeListIfNeeded(state, output);
          continue;
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          flushParagraph();
          flushQuote();
          closeListIfNeeded(state, output);
          const level = headingMatch[1].length;
          output.push('<h' + level + '>' + renderInline(headingMatch[2]) + '</h' + level + '>');
          continue;
        }

        if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
          flushParagraph();
          flushQuote();
          closeListIfNeeded(state, output);
          output.push('<hr>');
          continue;
        }

        const blockquoteMatch = line.match(/^>\s?(.*)$/);
        if (blockquoteMatch) {
          flushParagraph();
          closeListIfNeeded(state, output);
          quote.push(blockquoteMatch[1]);
          continue;
        }

        const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
        const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
        if (ulMatch || olMatch) {
          flushParagraph();
          flushQuote();
          const listType = ulMatch ? 'ul' : 'ol';
          if (state.listType && state.listType !== listType) {
            closeListIfNeeded(state, output);
          }
          if (!state.listType) {
            output.push(listType === 'ol' ? '<ol>' : '<ul>');
            state.listType = listType;
          }
          output.push('<li>' + renderInline((ulMatch || olMatch)[1]) + '</li>');
          continue;
        }

        flushQuote();
        closeListIfNeeded(state, output);
        paragraph.push(trimmed);
      }

      flushParagraph();
      flushQuote();
      closeListIfNeeded(state, output);
      flushCode();

      return output.join('') || '<p class="empty">Empty document.</p>';
    }

    async function loadMarkdown() {
      if (!objectKey || !objectKey.startsWith(allowedPrefix)) {
        titleElement.textContent = 'Invalid Markdown key';
        subtitleElement.textContent = objectKey || 'Missing key parameter';
        markdownElement.innerHTML = '';
        rawLinkElement.removeAttribute('href');
        setStatus('The viewer only accepts Markdown objects inside workflowy-markdown/.', true);
        return;
      }

      const encodedSegments = objectKey.split('/').map(segment => encodeURIComponent(segment));
      const requestPath = '/' + encodedSegments.join('/');
      const rawUrl = new URL(requestPath, window.location.origin).toString();
      const fileName = objectKey.split('/').pop() || objectKey;

      titleElement.textContent = fileName;
      subtitleElement.textContent = objectKey;
      rawLinkElement.href = rawUrl;
      setStatus('Loading Markdown from OSS default domain...', false);

      try {
        const response = await fetch(requestPath, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const markdown = await response.text();
        markdownElement.innerHTML = renderMarkdown(markdown);
        setStatus('Rendered from OSS default domain.', false);
      } catch (error) {
        markdownElement.innerHTML = '';
        setStatus('Failed to fetch Markdown: ' + error.message, true);
      }
    }

    reloadButton.addEventListener('click', () => {
      void loadMarkdown();
    });

    void loadMarkdown();
  </script>
</body>
</html>`;

module.exports = {
    MARKDOWN_VIEWER_OBJECT_KEY,
    MARKDOWN_VIEWER_PATH_PREFIX,
    MARKDOWN_VIEWER_CONTENT_TYPE,
    buildOssDefaultPublicUrl,
    buildMarkdownViewerUrl,
    buildMarkdownViewerObjectKey,
    buildStandaloneMarkdownViewerUrl,
    resolveMarkdownAttachmentUrls,
    createMarkdownViewerUploadPayload,
    createMarkdownViewerDemoFile,
    createMarkdownStandaloneViewerUploadPayload
};
