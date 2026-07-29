/**
 * CommonJS：书签解析（与 lib/quick-open/bookmarks.js 保持一致）
 */

function walkChromeNode(node, folder, source, out) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'url' && node.url) {
    out.push({
      title: String(node.name || node.url),
      url: String(node.url),
      folder,
      source,
    });
    return;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  const nextFolder = node.name ? (folder ? `${folder}/${node.name}` : String(node.name)) : folder;
  for (const child of children) {
    walkChromeNode(child, nextFolder, source, out);
  }
}

/**
 * 跳过 roots 下「书签栏 / 其他书签 / 移动设备书签」等容器名，
 * 让用户顶层文件夹成为 folder 首段。
 */
function parseChromiumBookmarks(raw, source) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const out = [];
  const roots = data?.roots || {};
  for (const key of Object.keys(roots)) {
    const root = roots[key];
    if (!root || typeof root !== 'object') continue;
    if (root.type === 'url' && root.url) {
      walkChromeNode(root, '', source || 'chrome', out);
      continue;
    }
    const children = Array.isArray(root.children) ? root.children : [];
    for (const child of children) {
      walkChromeNode(child, '', source || 'chrome', out);
    }
  }
  return out;
}

function parseBookmarkHtml(html, source) {
  const text = String(html || '');
  const out = [];
  const folderStack = [];
  for (const line of text.split(/\r?\n/)) {
    const folderMatch = line.match(/<H3[^>]*>([^<]*)<\/H3>/i);
    if (folderMatch) {
      folderStack.push(folderMatch[1].trim());
      continue;
    }
    if (/<\/DL>/i.test(line) && folderStack.length) {
      folderStack.pop();
      continue;
    }
    const linkMatch = line.match(/<A[^>]+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/i);
    if (linkMatch) {
      out.push({
        title: linkMatch[2].trim() || linkMatch[1],
        url: linkMatch[1].trim(),
        folder: folderStack.join('/'),
        source: source || 'html',
      });
    }
  }
  return out;
}

function parseSafariPlistJson(raw, source) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const out = [];
  function walk(node, folder) {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.Children) ? node.Children : [];
    const title = String(node.Title || node.WebBookmarkUUID || '');
    const url = String(node.URLString || '');
    const type = String(node.WebBookmarkType || '');
    if (type === 'WebBookmarkTypeLeaf' && url) {
      out.push({ title: title || url, url, folder, source: source || 'safari' });
      return;
    }
    const nextFolder =
      type === 'WebBookmarkTypeList' && title && title !== 'BookmarksBar' && title !== 'BookmarksMenu'
        ? folder
          ? `${folder}/${title}`
          : title
        : folder;
    for (const child of children) walk(child, nextFolder);
  }
  walk(data, '');
  return out;
}

function parseBookmarkFileContent(content, filename, source) {
  const name = String(filename || '').toLowerCase();
  const text = String(content || '').trim();
  if (!text) return [];
  if (
    name.endsWith('.html') ||
    text.includes('<!DOCTYPE NETSCAPE-Bookmark-file') ||
    /<A\s+HREF=/i.test(text)
  ) {
    return parseBookmarkHtml(text, source || 'file');
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('无法识别书签文件格式');
  }
  if (json?.roots) return parseChromiumBookmarks(json, source || 'file');
  if (json?.Children || json?.WebBookmarkType) {
    return parseSafariPlistJson(json, source || 'file');
  }
  throw new Error('无法识别书签 JSON 结构');
}

module.exports = {
  parseChromiumBookmarks,
  parseBookmarkHtml,
  parseSafariPlistJson,
  parseBookmarkFileContent,
};
