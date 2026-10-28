'use strict';
(function () {
  const C = window.ReaderCore;
  const $ = id => document.getElementById(id);
  const service = window.communityServices;
  const icons = {
    bookmark: '<path d="M6 4h12v17l-6-4-6 4Z"/>', history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    reload: '<path d="M20 5v6h-6M4 19v-6h6M5.5 8a7 7 0 0 1 11.8-2l2.7 5M4 13l2.7 5A7 7 0 0 0 18.5 16"/>',
    back: '<path d="m14 5-7 7 7 7"/>', copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    reply: '<path d="M4 4h16v12H9l-5 4Z"/>', panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>'; }
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  function readStore(key) {
    try { const doc = window.ztools?.db?.get(key); if (doc?.value) return doc.value; } catch { /* Use local storage when host storage is unavailable. */ }
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }
  let storageWarning = false;
  function writeStore(key, value) {
    try {
      if (window.ztools?.db?.put) { const old = window.ztools.db.get(key); window.ztools.db.put({ _id: key, ...(old?._rev ? { _rev: old._rev } : {}), value }); return; }
      localStorage.setItem(key, JSON.stringify(value));
    } catch { if (!storageWarning) { storageWarning = true; toast('本地存储不可用，新的阅读记录暂时无法保存。'); } }
  }
  let state = C.cleanState(readStore('community-reader-state-v2') || readStore('community-hub.state.v1'));
  let mode = 'feed';
  let activeSite = state.activeSite;
  let selected = null;
  let detail = null;
  let detailLoading = false;
  let detailError = '';
  let repliesLoading = false;
  let repliesError = '';
  let listEpoch = 0, detailEpoch = 0;
  const views = new Map(), details = new Map();
  const persistedFeeds = readStore('community-reader-feeds-v2') || {};
  let saveTimer, toastTimer;
  function saveNow() { writeStore('community-reader-state-v2', state); }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 150); }
  const layout = window.CommunityLayout.mount({ state, save });
  window.addEventListener('beforeunload', saveNow);
  function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
  function relativeTime(value) {
    if (!value) return '';
    const time = typeof value === 'number' || /^\d{10,13}$/.test(String(value)) ? Number(value) * (Number(value) < 1e12 ? 1000 : 1) : Date.parse(value);
    if (!Number.isFinite(time)) return String(value).slice(0, 30);
    const seconds = Math.max(0, (Date.now() - time) / 1000);
    if (seconds < 60) return '刚刚'; if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前'; if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时前';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' 天前'; return new Date(time).toLocaleDateString();
  }
  function viewFor(siteId = activeSite) {
    if (!views.has(siteId)) {
      const channel = C.site(siteId).channels[0][0];
      const cached = persistedFeeds[siteId + ':' + channel];
      const topics = cached ? C.cleanState({ history: cached.topics }).history : [];
      views.set(siteId, { channel, topics, page: 1, hasMore: false, loading: false, error: '', cached: topics.length > 0, time: Number(cached?.time) || 0 });
    }
    return views.get(siteId);
  }
  function applyTheme() {
    let hostDark; try { hostDark = window.ztools?.isDarkColors?.(); } catch { /* Follow browser preference. */ }
    const dark = state.theme === 'dark' || state.theme === 'system' && (hostDark ?? matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('theme-name').textContent = { system: '跟随系统', light: '浅色外观', dark: '深色外观' }[state.theme];
  }
  $('theme-button').onclick = () => { state.theme = { system: 'light', light: 'dark', dark: 'system' }[state.theme]; applyTheme(); save(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); window.ztools?.onThemeChange?.(applyTheme); applyTheme();
  function renderNavigation() {
    $('sites').replaceChildren();
    for (const s of C.SITES) {
      const button = document.createElement('button'); button.className = 'site-button' + (mode === 'feed' && activeSite === s.id ? ' active' : ''); button.dataset.site = s.id;
      button.setAttribute('aria-current', mode === 'feed' && activeSite === s.id ? 'page' : 'false');
      const mark = document.createElement('span'); mark.className = 'site-mark'; mark.style.setProperty('--site-color', s.color); mark.textContent = s.mark;
      const copy = document.createElement('span'); copy.className = 'site-copy'; const title = document.createElement('strong'); title.textContent = s.name; const sub = document.createElement('small'); sub.textContent = s.subtitle; copy.append(title, sub); button.append(mark, copy);
      if (mode === 'feed' && activeSite === s.id) { const dot = document.createElement('span'); dot.className = 'site-dot'; button.append(dot); }
      button.onclick = () => selectSite(s.id); $('sites').append(button);
    }
    $('bookmarks-nav').classList.toggle('active', mode === 'bookmarks'); $('history-nav').classList.toggle('active', mode === 'history');
    $('bookmarks-count').textContent = state.bookmarks.length; $('history-count').textContent = state.history.length;
    $('header-title').textContent = mode === 'feed' ? C.site(activeSite).name : mode === 'bookmarks' ? '我的收藏' : '阅读足迹';
    $('header-eyebrow').textContent = mode === 'feed' ? C.site(activeSite).subtitle : mode === 'bookmarks' ? '值得留住的讨论' : '沿着好奇心留下的脚步';
    $('verify-button').hidden = mode !== 'feed';
    renderChannels();
  }
  function renderChannels() {
    $('channels').replaceChildren();
    if (mode !== 'feed') return;
    const view = viewFor();
    for (const [value, label] of C.site(activeSite).channels) {
      const button = document.createElement('button'); button.className = 'channel-button' + (view.channel === value ? ' active' : ''); button.textContent = label; button.dataset.channel = value;
      button.onclick = () => { if (view.channel === value) return; view.channel = value; view.topics = []; view.error = ''; view.time = 0; view.hasMore = false; view.cached = false; $('filter').value = ''; clearDetail(); renderChannels(); loadFeed(); };
      $('channels').append(button);
    }
  }
  function notice(element, message, actions = [], loading = false) {
    element.replaceChildren(); element.hidden = !message; element.classList.toggle('loading', loading); element.classList.toggle('error', !!message && !loading);
    if (!message) return;
    const text = document.createElement('span'); text.textContent = message; element.append(text);
    if (actions.length) { const row = document.createElement('div'); row.className = 'notice-actions'; for (const [label, handler] of actions) { const button = document.createElement('button'); button.className = 'secondary'; button.textContent = label; button.onclick = handler; row.append(button); } element.append(row); }
  }
  function sourceTopics() { return mode === 'feed' ? viewFor().topics : state[mode]; }
  function renderFeed() {
    const view = viewFor(); const source = sourceTopics(); const query = $('filter').value.trim().toLocaleLowerCase();
    const topics = source.filter(t => (t.title + ' ' + t.author + ' ' + t.node).toLocaleLowerCase().includes(query));
    $('feed-count').textContent = `${topics.length} 个话题${query ? ' · 筛选结果' : ''}`;
    $('feed-updated').textContent = mode === 'feed' && view.time ? (view.cached ? '上次缓存 · ' : '更新于 ') + new Date(view.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    $('topic-list').replaceChildren();
    if (mode === 'feed') {
      if (view.error) notice($('feed-notice'), view.error + (source.length ? ' 当前保留上次读取的列表。' : ''), [['重试', () => loadFeed()], ['登录 / 验证', verify]]);
      else if (view.loading) notice($('feed-notice'), source.length ? '正在更新帖子…' : '正在读取帖子列表…', [], true);
      else notice($('feed-notice'), '');
    } else notice($('feed-notice'), '');
    const read = new Set(state.history.map(C.key));
    for (const topic of topics) {
      const button = document.createElement('button'); button.className = 'topic-row' + (selected && C.key(selected) === C.key(topic) ? ' selected' : '') + (read.has(C.key(topic)) ? ' read' : ''); button.dataset.topic = C.key(topic);
      button.append(CommunityAvatars.create(topic.siteId, topic.author, topic.avatar, 'topic-avatar'));
      const copy = document.createElement('span'); copy.className = 'topic-copy';
      if (mode !== 'feed') { const source = document.createElement('span'); source.className = 'library-site'; source.textContent = C.site(topic.siteId).name; copy.append(source); }
      const title = document.createElement('span'); title.className = 'topic-title';
      if (topic.pinned) { const pinned = document.createElement('span'); pinned.className = 'pinned-mark'; pinned.textContent = '置顶'; title.append(pinned); }
      title.append(document.createTextNode(topic.title));
      const meta = document.createElement('span'); meta.className = 'topic-meta';
      if (topic.node) { const node = document.createElement('span'); node.className = 'node-tag'; node.textContent = topic.node; meta.append(node); }
      const author = document.createElement('span'); author.textContent = topic.author;
      const time = document.createElement('span'); time.textContent = relativeTime(topic.time); meta.append(author, time);
      const replies = document.createElement('span'); replies.className = 'reply-count'; replies.innerHTML = icon('reply'); replies.append(document.createTextNode(String(topic.replies))); meta.append(replies);
      copy.append(title, meta); button.append(copy); button.onclick = () => openTopic(topic); $('topic-list').append(button);
    }
    if (!topics.length && !(mode === 'feed' && view.loading) && !(mode === 'feed' && view.error)) { const empty = document.createElement('p'); empty.className = 'list-empty'; empty.textContent = query ? '没有匹配的帖子，试试其他关键词。' : mode === 'bookmarks' ? '还没有收藏。阅读时点一下收藏按钮，留住喜欢的讨论。' : mode === 'history' ? '阅读帖子后，这里会留下你的足迹。' : '当前没有可显示的帖子。'; $('topic-list').append(empty); }
    $('load-more').hidden = mode !== 'feed' || !view.hasMore || !!query; $('load-more').disabled = view.loading;
    $('load-more').textContent = view.loading ? '正在加载…' : '加载更多帖子';
    $('feed-end').textContent = mode === 'feed' && source.length && !view.hasMore && !view.loading ? activeSite === 'v2ex' ? '公开 API 当前列表已全部显示' : '当前列表已读到底' : '';
    $('refresh-button').disabled = mode === 'feed' && view.loading;
    $('status-text').textContent = mode === 'feed' ? view.loading ? '正在读取 ' + C.site(activeSite).name : view.error ? '读取未完成，可重试或连接验证' : `${C.site(activeSite).name} · ${source.length} 个话题` : `${mode === 'bookmarks' ? '收藏' : '足迹'} · ${source.length} 个话题`;
    $('status-mode').textContent = mode === 'feed' && state.sessions[activeSite] ? '浏览器会话读取 · 原生阅读' : '公开数据读取 · 原生阅读';
    CommunityAvatars.prune();
  }
  async function loadFeed(more = false) {
    if (mode !== 'feed') { renderFeed(); return; }
    const id = activeSite, view = viewFor(id), channel = view.channel;
    if (more && view.loading) return;
    const page = more ? view.page + 1 : 1, epoch = ++listEpoch;
    view.requestId = epoch; view.loading = true; view.error = ''; renderFeed();
    try {
      if (!service) throw new Error('请在 ZTools 中导入 plugin.json 后使用，普通浏览器不能请求社区数据。');
      const data = await service.request(id, 'list', { channel, page, session: state.sessions[id] });
      const result = C.parseList(id, data, { page });
      if (view.channel !== channel || view.requestId !== epoch) return;
      const known = new Set(more ? view.topics.map(C.key) : []);
      view.topics = [...(more ? view.topics : []), ...result.topics.filter(t => { if (known.has(C.key(t))) return false; known.add(C.key(t)); return true; })].slice(0, 1000);
      view.page = page; view.hasMore = result.hasMore && view.topics.length < 1000; view.cached = false; view.time = Date.now();
      persistedFeeds[id + ':' + channel] = { topics: view.topics.slice(0, 100), time: view.time };
      writeStore('community-reader-feeds-v2', persistedFeeds);
    } catch (error) { if (view.channel === channel && view.requestId === epoch) view.error = friendlyError(error); }
    finally { if (view.channel === channel && view.requestId === epoch) view.loading = false; if (view.requestId === epoch && view.channel === channel && mode === 'feed' && activeSite === id) renderFeed(); }
  }
  function friendlyError(error) { const message = String(error?.message || error || '读取失败。'); return /ECONN|ENOTFOUND|ETIMEDOUT|TLS|socket|certificate/i.test(message) ? '无法连接社区，请检查网络或系统代理后重试。' : message.slice(0, 500); }
  function selectSite(id) {
    ++listEpoch; mode = 'feed'; activeSite = id; state.activeSite = id; $('filter').value = ''; clearDetail(); renderNavigation(); renderFeed(); save();
    if (!viewFor().time || viewFor().cached || Date.now() - viewFor().time > 120000) loadFeed();
  }
  function selectLibrary(value) { ++listEpoch; mode = value; $('filter').value = ''; clearDetail(); renderNavigation(); renderFeed(); }
  function clearDetail() { ++detailEpoch; selected = null; detail = null; detailLoading = false; detailError = ''; repliesLoading = false; repliesError = ''; document.body.classList.remove('has-topic'); renderDetail(); renderFeed(); }
  function recordRead(topic) { const summary = C.cleanState({ history: [topic] }).history[0]; if (!summary) return; state.history = [summary, ...state.history.filter(t => C.key(t) !== C.key(topic))].slice(0, 300); save(); $('history-count').textContent = state.history.length; }
  async function openTopic(topic, force = false) {
    const epoch = ++detailEpoch; selected = topic; detail = null; detailLoading = true; detailError = ''; repliesLoading = false; repliesError = ''; document.body.classList.add('has-topic'); $('reader-scroll').scrollTop = 0;
    renderFeed(); renderDetail();
    try {
      const cached = details.get(C.key(topic));
      if (cached && !force) detail = cached;
      else {
        if (!service) throw new Error('请在 ZTools 内打开插件。');
        const data = await service.request(topic.siteId, 'topic', { id: topic.id, session: state.sessions[topic.siteId] });
        const parsed = C.parseTopic(topic.siteId, data, topic.id, topic);
        details.set(C.key(topic), parsed); if (details.size > 30) details.delete(details.keys().next().value);
        if (epoch !== detailEpoch) return;
        detail = parsed;
      }
      if (epoch !== detailEpoch) return;
      selected = detail; recordRead(detail); detailLoading = false; renderFeed(); renderDetail();
      if (detail.siteId === 'v2ex' && !detail.page && detail.replyTotal) loadReplies();
    } catch (error) { if (epoch === detailEpoch) { detailError = friendlyError(error); detailLoading = false; renderDetail(); } }
  }
  function appendBody(element, html, text, url) {
    if (html) { element.innerHTML = C.sanitize(html, url, state.images); element.classList.remove('text-content'); if (state.images) CommunityMedia.hydrate(element, openExternal); }
    else { element.textContent = text || '这篇帖子没有正文。'; element.classList.add('text-content'); }
  }
  function renderDetail() {
    const topic = detail || selected;
    $('save-topic').disabled = !topic; $('copy-topic').disabled = !topic; $('open-topic').disabled = !topic;
    $('save-topic').classList.toggle('active', !!topic && state.bookmarks.some(t => C.key(t) === C.key(topic)));
    $('reader-source').textContent = topic ? C.site(topic.siteId).name : '专注阅读';
    $('reader-empty').hidden = !!selected; $('article').hidden = !detail || detailLoading || !!detailError;
    if (detailLoading) { notice($('reader-notice'), '正在读取正文与讨论…', [], true); return; }
    if (detailError) { notice($('reader-notice'), detailError, [['重新读取', () => openTopic(selected, true)], ['登录 / 验证', () => verify(selected.siteId)], ['在原站打开', () => openExternal(selected.url)]]); return; }
    notice($('reader-notice'), ''); if (!detail) return;
    $('article-title').textContent = detail.title; $('article-tags').textContent = C.site(detail.siteId).name + (detail.node ? '  /  ' + detail.node : '');
    $('article-meta').replaceChildren();
    $('article-meta').append(CommunityAvatars.create(detail.siteId, detail.author, detail.avatar, 'author-avatar'));
    for (const value of [detail.author, relativeTime(detail.time), `${detail.replyTotal} 条回复`]) { const span = document.createElement('span'); span.textContent = value; $('article-meta').append(span); }
    appendBody($('article-body'), detail.html, detail.text, detail.url); renderReplies();
  }
  function renderReplies() {
    if (!detail) return;
    if ($('article-meta').lastElementChild) $('article-meta').lastElementChild.textContent = `${detail.replyTotal} 条回复`;
    $('reply-total').textContent = detail.replyTotal;
    $('replies-caption').textContent = detail.repliesList.length ? `已加载 ${detail.repliesList.length} 条` : '';
    $('replies-list').replaceChildren();
    if (detail.loginRequired) notice($('reply-notice'), `原站有 ${detail.replyTotal} 条评论，登录后可见。`, [['登录 / 验证', () => verify(detail.siteId)], ['重新读取', () => openTopic(selected, true)]]);
    else if (repliesError) notice($('reply-notice'), repliesError, [['重试回复', loadReplies]]);
    else if (repliesLoading) notice($('reply-notice'), '正在读取回复…', [], true);
    else if (!detail.repliesList.length) notice($('reply-notice'), detail.replyTotal ? '暂未读取到可见回复，可在原站确认权限。' : '还没有回复，讨论从这里开始。', []);
    else notice($('reply-notice'), '');
    for (const reply of detail.repliesList) {
      const row = document.createElement('section'); row.className = 'reply-item';
      const header = document.createElement('div'); header.className = 'reply-header';
      const author = document.createElement('strong'); author.textContent = reply.author || '匿名'; const time = document.createElement('small'); time.textContent = relativeTime(reply.time); const number = document.createElement('span'); number.className = 'reply-floor'; number.textContent = '#' + reply.number; header.append(CommunityAvatars.create(detail.siteId, reply.author, reply.avatar, 'reply-avatar'), author, time, number);
      const body = document.createElement('div'); body.className = 'reply-body'; appendBody(body, reply.html, reply.text, detail.url); row.append(header, body); $('replies-list').append(row);
    }
    $('replies-more').hidden = !detail.hasMore || detail.loginRequired; $('replies-more').disabled = repliesLoading; $('replies-more').textContent = repliesLoading ? '正在加载…' : '加载更多回复';
    CommunityAvatars.prune();
  }
  async function loadReplies() {
    if (!detail || repliesLoading || detail.loginRequired) return;
    if (detail.siteId === 'v2ex' && detail.allReplies) {
      detail.repliesList = detail.allReplies.slice(0, detail.repliesList.length + 100);
      detail.hasMore = detail.repliesList.length < detail.allReplies.length; renderReplies(); return;
    }
    const target = detail, epoch = detailEpoch, page = target.page + 1;
    repliesLoading = true; repliesError = ''; renderReplies();
    try {
      const postIds = target.postIds.filter(id => !target.loadedPostIds.includes(id)).slice(0, 20);
      const data = await service.request(target.siteId, 'replies', { id: target.id, page, postIds, session: state.sessions[target.siteId] });
      const result = C.parseReplies(target.siteId, data, target, page);
      target.repliesList = C.mergeReplies(target.repliesList, result.replies).sort((a, b) => a.number - b.number);
      target.page = page; target.hasMore = result.hasMore;
      if (target.siteId === 'v2ex') { target.allReplies = target.repliesList; target.replyTotal = Math.max(target.replyTotal, target.allReplies.length); target.repliesList = target.allReplies.slice(0, 100); target.hasMore = target.allReplies.length > 100; }
      if (target.siteId === 'linuxdo') target.loadedPostIds = result.loadedPostIds;
    } catch (error) { if (epoch === detailEpoch) repliesError = friendlyError(error); }
    finally { if (epoch === detailEpoch) { repliesLoading = false; renderReplies(); } }
  }
  function toggleBookmark() {
    const topic = detail || selected; if (!topic) return;
    if (state.bookmarks.some(t => C.key(t) === C.key(topic))) { state.bookmarks = state.bookmarks.filter(t => C.key(t) !== C.key(topic)); toast('已取消收藏'); }
    else { if (state.bookmarks.length >= 500) return toast('收藏已满，请先整理已有收藏。'); const summary = C.cleanState({ history: [topic] }).history[0]; state.bookmarks.unshift(summary); toast('已加入我的收藏'); }
    save(); $('bookmarks-count').textContent = state.bookmarks.length; $('save-topic').classList.toggle('active', state.bookmarks.some(t => C.key(t) === C.key(topic))); if (mode === 'bookmarks') renderFeed();
  }
  async function openExternal(input) {
    const url = C.safeUrl(input); if (!url) return;
    try {
      if (!window.ztools?.shellOpenExternal) throw new Error('请在 ZTools 中打开原站链接。');
      const result = await window.ztools.shellOpenExternal(url); if (result?.success === false) throw new Error(result.error || '无法打开浏览器。');
    } catch (error) { toast(friendlyError(error)); }
  }
  $('article').addEventListener('click', event => {
    const a = event.target.closest('a[href]'); if (!a) return; event.preventDefault();
    const url = C.safeUrl(a.getAttribute('href')); if (!url) return;
    for (const s of C.SITES) { const id = C.fromUrl(s.id, url); if (id) { openTopic({ siteId: s.id, id, title: a.textContent || '帖子 ' + id, author: '', node: '', replies: 0, url }); return; } }
    openExternal(url);
  });
  async function verify(argument) {
    const id = typeof argument === 'string' ? argument : activeSite;
    try {
      if (!service) throw new Error('请在 ZTools 中进行站点登录或验证。');
      toast('请在弹出的窗口手动完成登录或验证，然后回到这里刷新。');
      state.sessions[id] = true; save(); await service.verify(id); renderFeed();
    } catch (error) { toast(friendlyError(error)); }
  }
  $('verify-button').onclick = () => verify();
  $('filter').oninput = renderFeed;
  $('load-more').onclick = () => loadFeed(true); $('replies-more').onclick = loadReplies;
  $('refresh-button').onclick = () => { if (selected) openTopic(selected, true); if (mode === 'feed') loadFeed(); else renderFeed(); };
  $('back-to-list').onclick = clearDetail; $('save-topic').onclick = toggleBookmark;
  $('open-topic').onclick = () => { if (selected) openExternal(selected.url); };
  $('copy-topic').onclick = () => { try { if (selected && service) { service.copy(selected.url); toast('链接已复制'); } } catch (error) { toast(friendlyError(error)); } };
  $('bookmarks-nav').onclick = () => selectLibrary('bookmarks'); $('history-nav').onclick = () => selectLibrary('history');
  function renderSettings() {
    $('images-setting').checked = state.images; $('session-settings').replaceChildren();
    for (const s of C.SITES) {
      const row = document.createElement('div'); row.className = 'session-setting'; const name = document.createElement('span'); name.textContent = s.name;
      const label = document.createElement('span'); label.textContent = state.sessions[s.id] ? '浏览器会话' : '直接请求';
      const button = document.createElement('button'); button.textContent = state.sessions[s.id] ? '恢复直接请求' : '登录 / 验证';
      button.onclick = () => { if (state.sessions[s.id]) { state.sessions[s.id] = false; save(); renderSettings(); toast('已恢复直接请求，刷新后生效。'); } else { $('settings-dialog').close(); verify(s.id); } };
      row.append(name, label, button); $('session-settings').append(row);
    }
  }
  $('settings-button').onclick = () => { renderSettings(); $('settings-dialog').showModal(); };
  $('close-settings').onclick = () => $('settings-dialog').close();
  $('images-setting').onchange = () => { state.images = $('images-setting').checked; save(); if (detail) renderDetail(); };
  $('clear-history').onclick = () => { if (!confirm('清空阅读足迹？收藏会保留。')) return; state.history = []; save(); $('history-count').textContent = 0; if (mode === 'history') renderFeed(); toast('阅读足迹已清空'); };
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); layout.toggle(); return; }
    if ((event.ctrlKey || event.metaKey) && ['k', 'r', 'd'].includes(event.key.toLowerCase())) { event.preventDefault(); if (event.key.toLowerCase() === 'k') { $('filter').focus(); $('filter').select(); } if (event.key.toLowerCase() === 'r') $('refresh-button').click(); if (event.key.toLowerCase() === 'd') toggleBookmark(); }
    if (event.key === 'Escape' && selected) clearDetail();
  });
  const launchSites = { 'community-v2ex': 'v2ex', 'community-linuxdo': 'linuxdo', 'community-linuxsb': 'linuxsb' };
  window.ztools?.setExpendHeight?.(860);
  renderNavigation(); renderFeed(); renderDetail(); loadFeed();
  window.ztools?.onPluginEnter?.(action => { const id = launchSites[action?.code]; if (id && (activeSite !== id || mode !== 'feed')) selectSite(id); });
})();
