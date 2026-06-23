import { eventBus } from '../../core/src/index.js';
import { SIDE_PANEL_LAYOUT_KEY, SIDE_PANEL_LAYOUTS } from './SidePanelTabs.js';
import { THEME_CHOICES, applyThemeChoice, getThemeChoice } from '../../core/src/utils/theme.js';
import { updateCategories, updateRecords, PLATFORMS } from '../../core/src/updateRecords.js';

/**
 * 获取当前平台标识
 */
function getCurrentPlatform() {
  if (typeof window === 'undefined') return null;
  if (window.ztools) return PLATFORMS.ZTOOLS;
  if (window.utools) return PLATFORMS.UTOOLS;
  return null;
}

/**
 * 检查更新项是否应在当前平台显示
 * @param {null|string[]} platforms - 平台限制 (null=所有平台, ['utools']=仅utools等)
 * @returns {boolean} 是否应显示
 */
function shouldShowForCurrentPlatform(platforms) {
  if (platforms === null || platforms === undefined) return true;
  if (!Array.isArray(platforms)) return true;
  
  const currentPlatform = getCurrentPlatform();
  return platforms.includes(currentPlatform);
}

export const EDITOR_BARS_LAYOUT_KEY = 'image-toolbox-editor-bars-layout';
export const EDITOR_BARS_LAYOUTS = {
  PRESETS_TOP: 'presets-top',
  STATUS_TOP: 'status-top',
};

export const EDITOR_SIDE_PANEL_POSITION_KEY = 'image-toolbox-editor-side-panel-position';
export const EDITOR_SIDE_PANEL_POSITIONS = {
  RIGHT: 'right',
  LEFT: 'left',
};

const VALID_EDITOR_BARS_LAYOUTS = new Set(Object.values(EDITOR_BARS_LAYOUTS));
const VALID_EDITOR_SIDE_PANEL_POSITIONS = new Set(Object.values(EDITOR_SIDE_PANEL_POSITIONS));

/**
 * Account page UI component.
 * Opens from the avatar into a standalone page with side navigation.
 */
class AccountPage {
  constructor(containerEl, editorEl, sidePanelTabs, host = null) {
    this._el = containerEl;
    this._editorEl = editorEl;
    this._sidePanelTabs = sidePanelTabs;
    this._host = host;
    this._activeSection = 'mine';
    this._user = this._getHostUser();

    this._render();
    this._bindEvents();
  }

  open() {
    this._user = this._getHostUser();
    this._render();
    this._editorEl?.classList.add('hidden');
    this._el?.classList.remove('hidden');
  }

  close() {
    this._el?.classList.add('hidden');
    this._editorEl?.classList.remove('hidden');
  }

  _render() {
    if (!this._el) return;

    const sectionTitle = this._getSectionTitle(this._activeSection);
    this._el.innerHTML = `
      <div class="account-page__shell">
        <aside class="account-page__sidebar">
          <div class="account-page__brand">
            <div class="account-page__brand-mark">
              <img class="account-page__brand-logo" src="../logo.png" alt="图片工具箱" draggable="false">
            </div>
            <div>
              <div class="account-page__brand-title">图片工具箱</div>
              <div class="account-page__brand-subtitle">账户中心</div>
            </div>
          </div>

          <nav class="account-page__nav" aria-label="账户导航">
            ${this._renderNavItem('mine', '我的')}
            ${this._renderNavItem('settings', '设置')}
            ${this._renderNavItem('updates', '更新记录')}
            ${this._renderNavItem('about', '关于')}
          </nav>

          <button class="account-page__back" type="button" data-action="back">返回编辑器</button>
        </aside>

        <main class="account-page__main">
          <header class="account-page__header">
            <div>
              <div class="account-page__eyebrow">账户中心</div>
              <h1>${this._escapeHTML(sectionTitle)}</h1>
            </div>
            <button class="account-page__header-back" type="button" data-action="back">返回编辑器</button>
          </header>

          <section class="account-page__content">
            ${this._renderSection()}
          </section>
        </main>
      </div>
    `;
  }

  _bindEvents() {
    if (!this._el) return;

    eventBus.on('account:open', () => this.open());

    this._el.addEventListener('click', (e) => {
      const navItem = this._closest(e.target, '[data-section]');
      if (navItem) {
        this._activeSection = navItem.getAttribute('data-section');
        this._render();
        return;
      }

      const action = this._closest(e.target, '[data-action]')?.getAttribute('data-action');
      if (action === 'back') {
        this.close();
        return;
      }

      const externalUrl = this._closest(e.target, '[data-external-url]')?.getAttribute('data-external-url');
      if (externalUrl) {
        e.preventDefault();
        this._openExternalUrl(externalUrl);
        return;
      }

      const theme = this._closest(e.target, '[data-theme-choice]')?.getAttribute('data-theme-choice');
      if (theme) {
        this._setTheme(theme);
        this._render();
        return;
      }

      const panelLayout = this._closest(e.target, '[data-side-panel-layout]')?.getAttribute('data-side-panel-layout');
      if (panelLayout) {
        this._setSidePanelLayout(panelLayout);
        this._render();
        return;
      }

      const editorBarsLayout = this._closest(e.target, '[data-editor-bars-layout]')?.getAttribute('data-editor-bars-layout');
      if (editorBarsLayout) {
        this._setEditorBarsLayout(editorBarsLayout);
        this._render();
        return;
      }

      const editorSidePanelPosition = this._closest(e.target, '[data-editor-side-panel-position]')?.getAttribute('data-editor-side-panel-position');
      if (editorSidePanelPosition) {
        this._setEditorSidePanelPosition(editorSidePanelPosition);
        this._render();
      }
    });

    this._el.addEventListener('error', (e) => {
      const avatar = e.target.closest?.('.account-page__avatar-img');
      if (!avatar) return;
      const fallback = document.createElement('div');
      fallback.className = avatar.className.replace('account-page__avatar-img', 'account-page__avatar-fallback');
      fallback.textContent = avatar.dataset.initial || 'U';
      avatar.replaceWith(fallback);
    }, true);
  }

  _renderNavItem(section, label) {
    const isActive = this._activeSection === section;
    return `
      <button class="account-page__nav-item ${isActive ? 'account-page__nav-item--active' : ''}" type="button" data-section="${section}">
        ${this._escapeHTML(label)}
      </button>
    `;
  }

  _closest(target, selector) {
    if (!target) return null;
    const match = typeof target.closest === 'function'
      ? target.closest(selector)
      : target.parentElement?.closest?.(selector) || null;

    if (match && typeof this._el?.contains === 'function' && !this._el.contains(match)) return null;
    return match;
  }

  _renderSection() {
    if (this._activeSection === 'settings') return this._renderSettings();
    if (this._activeSection === 'updates') return this._renderUpdates();
    if (this._activeSection === 'about') return this._renderAbout();
    return this._renderMine();
  }

  _renderMine() {
    const user = this._getUserView();
    const hostName = this._getHostName();
    return `
      <div class="account-card account-card--profile">
        <div class="account-card__avatar-wrap">
          ${this._renderAvatar('account-page__avatar account-page__avatar--large')}
        </div>
        <div class="account-card__body">
          <div class="account-card__label">${this._escapeHTML(hostName)} 账号</div>
          <h2>${this._escapeHTML(user.name)}</h2>
          <p>${this._escapeHTML(user.status)}</p>
        </div>
      </div>
    `;
  }

  _renderSettings() {
    const theme = getThemeChoice();
    const sidePanelLayout = this._getSidePanelLayout();
    const editorBarsLayout = this._getEditorBarsLayout();
    const editorSidePanelPosition = this._getEditorSidePanelPosition();
    return `
      <div class="account-card">
        <div class="account-card__label">外观</div>
        <div class="account-card__value">主题设置</div>
        <p>选择适合当前图片处理环境的界面主题。</p>
        <div class="account-page__theme-row">
          <button class="account-page__theme-choice ${theme === THEME_CHOICES.SYSTEM ? 'account-page__theme-choice--active' : ''}" type="button" data-theme-choice="${THEME_CHOICES.SYSTEM}">跟随系统</button>
          <button class="account-page__theme-choice ${theme === THEME_CHOICES.LIGHT ? 'account-page__theme-choice--active' : ''}" type="button" data-theme-choice="${THEME_CHOICES.LIGHT}">浅色</button>
          <button class="account-page__theme-choice ${theme === THEME_CHOICES.DARK ? 'account-page__theme-choice--active' : ''}" type="button" data-theme-choice="${THEME_CHOICES.DARK}">深色</button>
        </div>
      </div>

      <div class="account-card">
        <div class="account-card__label">编辑器</div>
        <div class="account-card__value">属性/图层面板布局</div>
        <p>选择属性和图层的展示方式。Tab 布局更节省空间，上下布局可以同时查看两块内容。</p>
        <div class="account-page__theme-row">
          <button class="account-page__theme-choice ${sidePanelLayout === SIDE_PANEL_LAYOUTS.TABS ? 'account-page__theme-choice--active' : ''}" type="button" data-side-panel-layout="${SIDE_PANEL_LAYOUTS.TABS}">Tab 切换</button>
          <button class="account-page__theme-choice ${sidePanelLayout === SIDE_PANEL_LAYOUTS.SPLIT ? 'account-page__theme-choice--active' : ''}" type="button" data-side-panel-layout="${SIDE_PANEL_LAYOUTS.SPLIT}">上下布局</button>
        </div>
      </div>

      <div class="account-card">
        <div class="account-card__label">编辑器</div>
        <div class="account-card__value">属性/图层面板位置</div>
        <p>将属性和图层侧栏放在画板右侧，或移到左侧工具栏与画板之间。</p>
        <div class="account-page__theme-row">
          <button class="account-page__theme-choice ${editorSidePanelPosition === EDITOR_SIDE_PANEL_POSITIONS.RIGHT ? 'account-page__theme-choice--active' : ''}" type="button" data-editor-side-panel-position="${EDITOR_SIDE_PANEL_POSITIONS.RIGHT}">画板右侧</button>
          <button class="account-page__theme-choice ${editorSidePanelPosition === EDITOR_SIDE_PANEL_POSITIONS.LEFT ? 'account-page__theme-choice--active' : ''}" type="button" data-editor-side-panel-position="${EDITOR_SIDE_PANEL_POSITIONS.LEFT}">工具栏右侧</button>
        </div>
      </div>

      <div class="account-card">
        <div class="account-card__label">编辑器</div>
        <div class="account-card__value">顶部/底部栏位置</div>
        <p>切换预设栏和状态栏在编辑器顶部、底部的相对位置。</p>
        <div class="account-page__theme-row">
          <button class="account-page__theme-choice ${editorBarsLayout === EDITOR_BARS_LAYOUTS.PRESETS_TOP ? 'account-page__theme-choice--active' : ''}" type="button" data-editor-bars-layout="${EDITOR_BARS_LAYOUTS.PRESETS_TOP}">预设栏在顶部</button>
          <button class="account-page__theme-choice ${editorBarsLayout === EDITOR_BARS_LAYOUTS.STATUS_TOP ? 'account-page__theme-choice--active' : ''}" type="button" data-editor-bars-layout="${EDITOR_BARS_LAYOUTS.STATUS_TOP}">状态栏在顶部</button>
        </div>
      </div>
    `;
  }

  _renderAbout() {
    const appVersion = this._getCurrentVersion();
    const hostName = this._getHostName();
    const hostVersion = this._getHostVersion();

    return `
      <div class="account-about">
        <section class="account-about__hero">
          <div class="account-about__hero-glow"></div>
          <div class="account-about__logo-wrap">
            <img class="account-about__logo" src="../logo.png" alt="图片工具箱" draggable="false">
          </div>
          <div class="account-about__hero-body">
            <div class="account-about__kicker">Image Toolbox for ${this._escapeHTML(hostName)}</div>
            <h2>图片工具箱</h2>
            <p>一款专注截图和图片快速处理的 ${this._escapeHTML(hostName)} 插件，提供马赛克、裁剪、加字和快速导出能力。</p>
            <div class="account-about__tags" aria-label="功能标签">
              <span>轻量编辑</span>
              <span>本地处理</span>
              <span>快速导出</span>
            </div>
          </div>
        </section>

        <div class="account-about__layout">
          <section class="account-about__panel account-about__author">
            <div class="account-about__section-label">作者</div>
            <div class="account-about__author-name">抹露茶柒</div>
            <p>感谢使用图片工具箱。如果你有功能建议、问题反馈或协作想法，可以通过下面的方式联系。</p>
          </section>

          <section class="account-about__panel account-about__contacts" aria-label="联系方式">
            <a class="account-about__contact" href="https://moruteaven.com" data-external-url="https://moruteaven.com">
              <span class="account-about__contact-icon">W</span>
              <span>
                <strong>作者主页</strong>
                <em>moruteaven.com</em>
              </span>
            </a>
            <a class="account-about__contact" href="mailto:me@moruteaven.com" data-external-url="mailto:me@moruteaven.com">
              <span class="account-about__contact-icon">@</span>
              <span>
                <strong>联系邮箱</strong>
                <em>me@moruteaven.com</em>
              </span>
            </a>
            <a class="account-about__contact" href="https://qm.qq.com/q/xdx9hstuGA" data-external-url="https://qm.qq.com/q/xdx9hstuGA">
              <span class="account-about__contact-icon">Q</span>
              <span>
                <strong>QQ 交流群</strong>
                <em>加入群聊反馈问题</em>
              </span>
            </a>
          </section>
        </div>

        <section class="account-about__footer">
          <span>图片工具箱版本：${this._escapeHTML(appVersion)}</span>
          <span>${this._escapeHTML(hostName)} 版本：${this._escapeHTML(hostVersion)}</span>
          <span>Copyright © 抹露茶柒</span>
        </section>
      </div>
    `;
  }

  _renderUpdates() {
    return `
      <div class="updates-list">
        ${updateRecords.map(record => this._renderUpdateRecord(record)).join('')}
      </div>
    `;
  }

  _renderUpdateRecord(record) {
    return `
      <article class="update-record">
        <div class="update-record__header">
          <h2>版本 ${this._escapeHTML(record.version)}</h2>
          <time>${this._escapeHTML(record.date)}</time>
        </div>
        <div class="update-record__changes">
          ${updateCategories.map(category => this._renderChangeGroup(record, category)).join('')}
        </div>
      </article>
    `;
  }

   _renderChangeGroup(record, category) {
     const items = record.changes?.[category.key] || [];
     if (items.length === 0) return '';

     // 过滤出当前平台应显示的项目
     const visibleItems = items.filter(item => {
       // 兼容旧格式（字符串）
       if (typeof item === 'string') return true;
       // 新格式（对象）- 检查平台限制
       return shouldShowForCurrentPlatform(item.platforms);
     });

     if (visibleItems.length === 0) return '';

     return `
       <div class="update-record__group update-record__group--${category.key}">
         <div class="update-record__group-title">${this._escapeHTML(category.title)}</div>
         <ul>
           ${visibleItems.map(item => this._renderChangeItem(item)).join('')}
         </ul>
       </div>
     `;
   }

   /**
    * 渲染单个更新项，处理平台限制标记
    */
   _renderChangeItem(item) {
     // 兼容旧格式（字符串）
     if (typeof item === 'string') {
       return `<li>${this._escapeHTML(item)}</li>`;
     }

     // 新格式（对象）
     const text = item.text || '';
     const platforms = item.platforms;
     const currentPlatform = getCurrentPlatform();

     // 如果有平台限制且当前不是所有平台，添加平台标签
     let badge = '';
     if (Array.isArray(platforms) && platforms.length > 0 && platforms.length < 3) {
       const platformLabels = {
         'utools': 'uTools',
         'ztools': 'ZTools',
         'local': '本地环境'
       };
       const labels = platforms.map(p => platformLabels[p] || p).join('/');
       const isCurrentPlatform = shouldShowForCurrentPlatform(platforms);
       const badgeClass = isCurrentPlatform ? 'update-item__platform-badge--current' : 'update-item__platform-badge--other';
       badge = `<span class="update-item__platform-badge ${badgeClass}">${this._escapeHTML(labels)}</span>`;
     }

     return `<li><span class="update-item__text">${this._escapeHTML(text)}</span>${badge}</li>`;
   }

  _renderAvatar(className) {
    const user = this._getUserView();
    const title = this._escapeAttr(user.name);
    const initial = this._escapeAttr(user.initial);

    if (user.avatar) {
      return `<img class="${className} account-page__avatar-img" src="${this._escapeAttr(user.avatar)}" alt="${title}" data-initial="${initial}" draggable="false">`;
    }

    return `<div class="${className} account-page__avatar-fallback">${this._escapeHTML(user.initial)}</div>`;
  }

  _getUserView() {
    const user = this._user || {};
    const hostName = this._getHostName();
    const name = user.nickname || user.name || user.userName || user.username || `${hostName} 用户`;
    const avatar = user.avatar || user.avatarUrl || user.photo || '';
    return {
      name,
      avatar,
      initial: this._getInitial(name),
      status: this._user ? `已连接 ${hostName} 用户信息` : `未获取到 ${hostName} 用户信息`,
    };
  }

  _getSectionTitle(section) {
    const titles = {
      mine: '我的',
      settings: '设置',
      updates: '更新记录',
      about: '关于',
    };
    return titles[section] || titles.mine;
  }

  _setTheme(theme) {
    applyThemeChoice(theme);
  }

  _getCurrentVersion() {
    const version = updateRecords?.[0]?.version;
    return this._formatVersion(version);
  }

  _getHostVersion() {
    try {
      return this._formatVersion(this._host?.platform?.version || this._host?.getHostAppVersion?.());
    } catch (e) {
      console.warn('[AccountPage] 获取宿主版本失败:', e);
    }

    return '未知';
  }

  _formatVersion(version) {
    const text = String(version || '').trim();
    if (!text) return '未知';
    return /^v/i.test(text) ? text : `v${text}`;
  }

  _openExternalUrl(url) {
    if (!url) return;

    try {
      if (this._host?.system?.openExternal?.(url) || this._host?.openHostExternal?.(url)) {
        return;
      }
    } catch (e) {
      console.warn('[AccountPage] 使用宿主打开外部链接失败:', e);
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  _setSidePanelLayout(layout) {
    if (!Object.values(SIDE_PANEL_LAYOUTS).includes(layout)) return;

    localStorage.setItem(SIDE_PANEL_LAYOUT_KEY, layout);
    this._sidePanelTabs?.applyLayout(layout, false);
    eventBus.emit('sidePanel:layoutChanged', layout);
  }

  _setEditorBarsLayout(layout) {
    if (!VALID_EDITOR_BARS_LAYOUTS.has(layout)) return;

    localStorage.setItem(EDITOR_BARS_LAYOUT_KEY, layout);
    eventBus.emit('editorBars:layoutChanged', layout);
  }

  _setEditorSidePanelPosition(position) {
    if (!VALID_EDITOR_SIDE_PANEL_POSITIONS.has(position)) return;

    localStorage.setItem(EDITOR_SIDE_PANEL_POSITION_KEY, position);
    eventBus.emit('editorSidePanel:positionChanged', position);
  }

  _getSidePanelLayout() {
    const saved = localStorage.getItem(SIDE_PANEL_LAYOUT_KEY);
    return Object.values(SIDE_PANEL_LAYOUTS).includes(saved) ? saved : SIDE_PANEL_LAYOUTS.TABS;
  }

  _getEditorBarsLayout() {
    const saved = localStorage.getItem(EDITOR_BARS_LAYOUT_KEY);
    return VALID_EDITOR_BARS_LAYOUTS.has(saved) ? saved : EDITOR_BARS_LAYOUTS.PRESETS_TOP;
  }

  _getEditorSidePanelPosition() {
    const saved = localStorage.getItem(EDITOR_SIDE_PANEL_POSITION_KEY);
    return VALID_EDITOR_SIDE_PANEL_POSITIONS.has(saved) ? saved : EDITOR_SIDE_PANEL_POSITIONS.RIGHT;
  }

  _getHostUser() {
    try {
      const result = this._host?.user?.getCurrentUser?.() || this._host?.getHostUser?.() || null;
      if (result && typeof result.then === 'function') {
        result.then((user) => {
          this._user = user;
          this._render();
        }).catch((e) => console.warn('[AccountPage] 获取宿主用户信息失败:', e));
        return null;
      }
      return result;
    } catch (e) {
      console.warn('[AccountPage] 获取宿主用户信息失败:', e);
    }
    return null;
  }

  _getHostName() {
    return this._host?.platform?.name || this._host?.getHostName?.() || 'uTools';
  }

  _getInitial(name) {
    const text = String(name || '').trim();
    return text ? text.slice(0, 1).toUpperCase() : 'U';
  }

  _escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _escapeHTML(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

export default AccountPage;
