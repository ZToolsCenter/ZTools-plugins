(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReaderCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SITES = [
    { id: 'v2ex', name: 'V2EX', mark: 'V₂', subtitle: '分享与探索', url: 'https://www.v2ex.com/', color: '#557359', channels: [['hot', '最热'], ['latest', '最新']] },
    { id: 'linuxdo', name: 'LINUX DO', mark: 'LD', subtitle: '新的理想型社区', url: 'https://linux.do/', color: '#b18234', channels: [['latest', '最新'], ['top', '热门']] },
    { id: 'linuxsb', name: 'LINUX SB', mark: 'SB', subtitle: '人人都有饼吃', url: 'https://linux.sb/', color: '#7c65a5', channels: [['latest', '最新'], ['hot', '热议'], ['activity', '新回复']] }
  ];
  function site(id) { const value = SITES.find(s => s.id === id); if (!value) throw new Error('未知社区。'); return value; }
  function integer(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback; }
  function safeUrl(value, base) {
    try { const url = new URL(String(value || ''), base); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function avatarUrl(siteId, value) {
    if (!value) return '';
    try {
      const s = site(siteId), url = new URL(String(value).replace(/\{size\}/g, '48'), s.url);
      const hosts = siteId === 'v2ex' ? ['www.v2ex.com', 'v2ex.com', 'cdn.v2ex.com', 'www.gravatar.com', 'gravatar.com'] : siteId === 'linuxdo' ? ['linux.do'] : ['linux.sb', 'www.linux.sb'];
      return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && hosts.includes(url.hostname) ? url.href : '';
    } catch { return ''; }
  }
  function mediaUrl(value, base) {
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(String(value)) && String(value).length < 12 * 1024 * 1024) return String(value);
    return safeUrl(value, base);
  }
  function sidebarWidth(value, viewport = 1600) {
    const width = Number(value); const max = Math.max(153, Math.min(360, Number(viewport) - 320));
    return Math.round(Math.max(153, Math.min(max, Number.isFinite(width) ? width : 199)));
  }
  function resource(siteId, kind, options = {}) {
    const s = site(siteId), id = integer(options.id), page = Math.min(integer(options.page, 1), 10000);
    const channel = options.channel || s.channels[0][0];
    if (!s.channels.some(c => c[0] === channel)) throw new Error('无效的帖子分类。');
    if (kind !== 'list' && !id) throw new Error('无效的帖子编号。');
    if (kind === 'list') {
      if (siteId === 'v2ex') return { url: `${s.url}api/topics/${channel}.json`, format: 'json' };
      if (siteId === 'linuxdo') return { url: `${s.url}${channel}.json?page=${page - 1}${channel === 'top' ? '&period=daily' : ''}`, format: 'json' };
      const paths = { latest: 'index.php?sort=post', hot: 'hot_discussions', activity: '' };
      let url = s.url + paths[channel];
      if (page > 1) { if (channel === 'activity') url = s.url + 'index.php?sort=comment'; url += (url.includes('?') ? '&' : '?') + 'p=' + page; }
      return { url, format: 'html' };
    }
    if (siteId === 'v2ex') {
      if (kind === 'topic') return { url: `${s.url}api/topics/show.json?id=${id}`, format: 'json' };
      if (kind === 'replies') return { url: `${s.url}api/replies/show.json?topic_id=${id}`, format: 'json' };
    }
    if (siteId === 'linuxdo') {
      if (kind === 'topic') return { url: `${s.url}t/${id}.json`, format: 'json' };
      if (kind === 'replies') {
        const ids = Array.isArray(options.postIds) ? [...new Set(options.postIds.map(x => integer(x)).filter(Boolean))].slice(0, 20) : [];
        if (!ids.length) throw new Error('缺少回复编号。');
        return { url: `${s.url}t/${id}/posts.json?` + ids.map(x => `post_ids%5B%5D=${x}`).join('&'), format: 'json' };
      }
    }
    if (siteId === 'linuxsb' && ['topic', 'replies'].includes(kind)) return { url: `${s.url}topic/${id}` + (page > 1 ? `?p=${page}` : ''), format: 'html' };
    throw new Error('不支持的数据请求。');
  }
  function plain(value) { return String(value ?? '').slice(0, 1000000); }
  function count(value) { return Math.max(0, Number(value) || 0); }
  function key(topic) { return topic.siteId + ':' + topic.id; }
  function topicBase(siteId, value) {
    const id = integer(value.id); if (!id || !value.title) return null;
    return { siteId, id, title: plain(value.title).slice(0, 500), author: plain(value.author || '匿名'), avatar: avatarUrl(siteId, value.avatar), node: plain(value.node || ''), replies: count(value.replies), views: count(value.views), time: value.time || '', url: site(siteId).url + (siteId === 'linuxsb' ? 'topic/' : 't/') + id, pinned: !!value.pinned };
  }
  function documentFrom(html, detectChallenge = false) {
    if (typeof DOMParser === 'undefined') throw new Error('HTML 解析需要插件阅读界面。');
    if (typeof html !== 'string' || html.length > 8 * 1024 * 1024) throw new Error('页面内容无效或过大。');
    if (detectChallenge && /<title>\s*(Just a moment|Attention Required)|<script[^>]+src=["'][^"']*\/cdn-cgi\/challenge-platform\//i.test(html)) throw new Error('站点要求浏览器验证，请点击“登录 / 验证”后刷新。');
    return new DOMParser().parseFromString(html, 'text/html');
  }
  function text(element) { return element?.textContent?.trim() || ''; }
  function pagination(doc, page) {
    const pages = [...doc.querySelectorAll('.pagination a[href], a[rel="next"]')].map(a => { try { return Number(new URL(a.getAttribute('href'), site('linuxsb').url).searchParams.get('p')); } catch { return 0; } });
    return pages.some(value => value > page);
  }
  function parseList(siteId, data, options = {}) {
    const page = integer(options.page, 1);
    if (siteId === 'v2ex') {
      if (!Array.isArray(data)) throw new Error('V2EX 返回的帖子列表格式无效。');
      return { topics: data.map(t => topicBase(siteId, { ...t, author: t.member?.username, avatar: t.member?.avatar_normal || t.member?.avatar_mini, node: t.node?.title, time: t.last_modified || t.created })).filter(Boolean), hasMore: false };
    }
    if (siteId === 'linuxdo') {
      if (!Array.isArray(data?.topic_list?.topics)) throw new Error(data?.errors?.join('；') || 'LINUX DO 返回的帖子列表格式无效。');
      const users = new Map((data.users || []).map(u => [u.id, u]));
      const categories = new Map((data.topic_list.categories || []).map(c => [c.id, c.name]));
      return { topics: data.topic_list.topics.map(t => topicBase(siteId, { ...t, author: users.get(t.posters?.[0]?.user_id)?.username, avatar: users.get(t.posters?.[0]?.user_id)?.avatar_template, node: categories.get(t.category_id) || '讨论', replies: t.posts_count - 1, time: t.last_posted_at || t.created_at })).filter(Boolean), hasMore: !!data.topic_list.more_topics_url };
    }
    const doc = documentFrom(data, true); const topics = []; const seen = new Set();
    for (const row of doc.querySelectorAll('.post-item')) {
      const anchor = row.querySelector('a.post-title[href*="/topic/"]'); if (!anchor) continue;
      const id = /\/topic\/(\d+)/.exec(anchor.getAttribute('href'))?.[1];
      if (!id || seen.has(id)) continue; seen.add(id);
      const meta = row.querySelector('.post-meta');
      const number = [...(meta?.querySelectorAll(':scope > span') || [])].map(n => text(n)).find(t => /^\d+$/.test(t));
      const topic = topicBase(siteId, { id, title: text(anchor), author: text(meta?.querySelector('a[href*="/user/"]')), node: text(row.querySelector('.post-forum-badge, .post-forum-meta a')), replies: number, time: meta?.querySelector('[data-performance-time]')?.getAttribute('data-performance-time') || text(meta?.querySelector('span:last-child')), pinned: row.classList.contains('topic-pinned') });
      if (topic) { topic.avatar = avatarUrl(siteId, row.querySelector('.post-avatar img')?.getAttribute('src')); topics.push(topic); }
    }
    if (!topics.length && !doc.querySelector('.empty-state')) throw new Error('没有识别到帖子列表，站点可能要求登录或页面结构已变化。');
    return { topics, hasMore: pagination(doc, page) };
  }
  function discourseReplies(data) {
    return (data?.post_stream?.posts || []).filter(p => p.post_number !== 1 && p.post_type !== 2).map(p => ({ id: p.id, number: p.post_number, author: plain(p.username), avatar: avatarUrl('linuxdo', p.avatar_template), time: p.created_at, html: plain(p.cooked), text: '' }));
  }
  function parseTopic(siteId, data, id, previous = {}) {
    if (siteId === 'v2ex') {
      const t = Array.isArray(data) ? data[0] : null; if (!t?.id) throw new Error('帖子不存在、不可访问或已被移除。');
      return { ...topicBase(siteId, { ...t, author: t.member?.username, avatar: t.member?.avatar_normal, node: t.node?.title, time: t.created }), html: plain(t.content_rendered), text: plain(t.content), repliesList: [], replyTotal: count(t.replies), postIds: [], loadedPostIds: [], hasMore: t.replies > 0, page: 0 };
    }
    if (siteId === 'linuxdo') {
      if (!data?.id || !data.post_stream?.posts?.length) throw new Error(data?.errors?.join('；') || '帖子内容不可访问，可能需要登录。');
      const first = data.post_stream.posts.find(p => p.post_number === 1);
      if (!first) throw new Error('站点未返回主题正文，请在原站查看。');
      const ids = data.post_stream.stream || data.post_stream.posts.map(p => p.id);
      return { ...topicBase(siteId, { ...data, author: first.username, avatar: first.avatar_template, replies: data.posts_count - 1, time: data.created_at, node: previous.node || '讨论' }), html: plain(first.cooked), text: '', repliesList: discourseReplies(data), replyTotal: count(data.posts_count - 1), postIds: ids, loadedPostIds: data.post_stream.posts.map(p => p.id), hasMore: ids.some(id => !data.post_stream.posts.some(p => p.id === id)), page: 1 };
    }
    const doc = documentFrom(data, true); const heading = doc.querySelector('.post-content-title');
    const entries = [...doc.querySelectorAll('.topic-post-list .post-entry')];
    const first = entries.find(n => n.id === 'post-' + id) || entries[0];
    const content = first?.querySelector('.nb-editor-post-content, .post-readability-content, .post-content');
    if (!heading || !content) throw new Error('帖子内容不可访问，可能需要登录，或页面结构已变化。');
    const pageText = doc.body.textContent;
    const hidden = /共有\s*(\d+)\s*条评论，登录后可见/.exec(pageText);
    const total = hidden ? Number(hidden[1]) : Number(text(doc.querySelector('.post-content-stats')).match(/\d+/g)?.at(-1)) || previous.replies || Math.max(0, entries.length - 1);
    return { ...topicBase(siteId, { id, title: text(heading), author: text(first.querySelector('.post-author')), avatar: first.querySelector('.post-avatar img')?.getAttribute('src'), node: previous.node || '讨论', replies: total, time: text(first.querySelector('.post-time')) }), html: content.innerHTML, text: '', repliesList: parseSbReplies(doc, id), replyTotal: total, loginRequired: !!hidden, postIds: [], loadedPostIds: [], hasMore: !hidden && pagination(doc, 1), page: 1 };
  }
  function parseSbReplies(doc, id) {
    return [...doc.querySelectorAll('.topic-post-list .post-entry')].filter(n => n.id !== 'post-' + id && !n.querySelector('.post-content-title')).map((n, i) => ({
      id: integer(n.id.replace('post-', ''), i + 1), number: integer(n.dataset.floor, i + 1), author: text(n.querySelector('.post-author')), avatar: avatarUrl('linuxsb', n.querySelector('.post-avatar img')?.getAttribute('src')), time: text(n.querySelector('.post-time')), html: n.querySelector('.nb-editor-post-content, .post-readability-content, .post-content')?.innerHTML || '', text: ''
    }));
  }
  function parseReplies(siteId, data, topic, page) {
    if (siteId === 'v2ex') {
      if (!Array.isArray(data)) throw new Error('回复数据格式无效。');
      const replies = data.map((r, i) => ({ id: integer(r.id, i + 1), number: i + 1, author: plain(r.member?.username), avatar: avatarUrl(siteId, r.member?.avatar_normal || r.member?.avatar_mini), time: r.created, html: plain(r.content_rendered), text: plain(r.content) }));
      return { replies, hasMore: false, loadedPostIds: [] };
    }
    if (siteId === 'linuxdo') {
      if (!Array.isArray(data?.post_stream?.posts)) throw new Error(data?.errors?.join('；') || '回复数据格式无效。');
      const loaded = [...new Set([...topic.loadedPostIds, ...data.post_stream.posts.map(p => p.id)])];
      return { replies: discourseReplies(data), hasMore: topic.postIds.some(id => !loaded.includes(id)), loadedPostIds: loaded };
    }
    const doc = documentFrom(data, true);
    if (!doc.querySelector('.topic-post-list')) throw new Error('没有识别到回复列表，请重试或在原站查看。');
    return { replies: parseSbReplies(doc, topic.id), hasMore: pagination(doc, page), loadedPostIds: [] };
  }
  function sanitize(html, base, images = false) {
    const source = documentFrom(html); const result = source.createElement('div');
    const allowed = new Set(['P', 'DIV', 'SPAN', 'BR', 'STRONG', 'B', 'EM', 'I', 'S', 'DEL', 'UL', 'OL', 'LI', 'PRE', 'CODE', 'BLOCKQUOTE', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DETAILS', 'SUMMARY', 'KBD', 'SUP', 'SUB']);
    const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'VIDEO', 'AUDIO', 'LINK', 'META', 'BASE', 'TEMPLATE']);
    let nodes = 0;
    function copy(node, parent, depth) {
      if (++nodes > 20000 || depth > 50) return;
      if (node.nodeType === 3) { parent.append(source.createTextNode(node.textContent)); return; }
      if (node.nodeType !== 1 || blocked.has(node.tagName)) return;
      let target = parent;
      if (allowed.has(node.tagName)) {
        if (node.tagName === 'IMG') {
          const url = mediaUrl(node.getAttribute('data-original') || node.getAttribute('data-src') || node.getAttribute('src'), base); if (!url) return;
          const alt = String(node.getAttribute('alt') || '查看图片').slice(0, 200);
          target = source.createElement(images ? 'img' : 'a');
          if (images) { target.setAttribute('data-image-url', url); target.setAttribute('alt', alt); target.setAttribute('referrerpolicy', 'no-referrer'); }
          else { target.setAttribute('href', url); target.textContent = '▧ ' + alt; target.className = 'image-link'; }
          parent.append(target); return;
        }
        target = source.createElement(node.tagName.toLowerCase());
        if (node.tagName === 'A') { const href = safeUrl(node.getAttribute('href'), base); if (href) { target.setAttribute('href', href); target.setAttribute('rel', 'noopener noreferrer'); } }
        parent.append(target);
      }
      for (const child of node.childNodes) copy(child, target, depth + 1);
    }
    for (const child of source.body.childNodes) copy(child, result, 0);
    return result.innerHTML;
  }
  function fromUrl(siteId, url) {
    try { const u = new URL(url); const s = site(siteId); if (u.hostname.replace(/^www\./, '') !== new URL(s.url).hostname.replace(/^www\./, '')) return null;
      return integer((siteId === 'linuxsb' ? /\/topic\/(\d+)/ : /\/t\/(?:[^/]+\/)?(\d+)/).exec(u.pathname)?.[1]);
    } catch { return null; }
  }
  function cleanState(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    function records(input, limit) {
      const seen = new Set();
      return (Array.isArray(input) ? input : []).filter(x => x && SITES.some(s => s.id === x.siteId)).map(x => topicBase(x.siteId, { ...x, id: integer(x.id) || fromUrl(x.siteId, x.url), author: x.author || '', node: typeof x.node === 'string' ? x.node : '', title: x.title || '未命名帖子' })).filter(x => { if (!x || seen.has(key(x))) return false; seen.add(key(x)); return true; }).slice(0, limit);
    }
    return { version: 2, mediaVersion: 1, activeSite: SITES.some(s => s.id === raw.activeSite) ? raw.activeSite : 'v2ex', theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'system', images: raw.mediaVersion === 1 ? raw.images !== false : true, sidebarWidth: typeof raw.sidebarWidth === 'number' && Number.isFinite(raw.sidebarWidth) ? sidebarWidth(raw.sidebarWidth) : null, sidebarHidden: raw.sidebarHidden === true, bookmarks: records(raw.bookmarks, 500), history: records(raw.history, 300), sessions: Object.fromEntries(SITES.map(s => [s.id, raw.sessions?.[s.id] === true])) };
  }
  function mergeReplies(old, next) { const seen = new Set(old.map(r => r.id)); return [...old, ...next.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })]; }
  return { SITES, site, key, safeUrl, mediaUrl, avatarUrl, sidebarWidth, resource, parseList, parseTopic, parseReplies, sanitize, fromUrl, cleanState, mergeReplies };
});
