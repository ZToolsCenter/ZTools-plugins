import { eventBus } from '../index.js';
import { SIDE_PANEL_LAYOUT_KEY, SIDE_PANEL_LAYOUTS } from './SidePanelTabs.js';
import { THEME_CHOICES, applyThemeChoice, getThemeChoice } from '../utils/theme.js';
import { updateCategories, updateRecords, PLATFORMS } from '../updateRecords.js';
import { escapeHTML, escapeAttr } from '../utils/helpers.js';
import IdentityClient from '../identity/IdentityClient.js';

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

export const TOOLBAR_LABELS_VISIBLE_KEY = 'image-toolbox-toolbar-labels-visible';
export const TOOLBAR_LABELS_VISIBLE = {
  ON: 'on',
  OFF: 'off',
};

export const TOOLBAR_COLLAPSED_KEY = 'image-toolbox-toolbar-collapsed';
export const TOOLBAR_COLLAPSED = {
  EXPANDED: 'expanded',
  COLLAPSED: 'collapsed',
};

export const TOOLBAR_TOGGLE_VISIBLE_KEY = 'image-toolbox-toolbar-toggle-visible';
export const TOOLBAR_TOGGLE_VISIBLE = {
  ON: 'on',
  OFF: 'off',
};

const VALID_EDITOR_BARS_LAYOUTS = new Set(Object.values(EDITOR_BARS_LAYOUTS));
const VALID_EDITOR_SIDE_PANEL_POSITIONS = new Set(Object.values(EDITOR_SIDE_PANEL_POSITIONS));
const VALID_TOOLBAR_LABELS_VISIBLE = new Set(Object.values(TOOLBAR_LABELS_VISIBLE));
const VALID_TOOLBAR_COLLAPSED = new Set(Object.values(TOOLBAR_COLLAPSED));
const VALID_TOOLBAR_TOGGLE_VISIBLE = new Set(Object.values(TOOLBAR_TOGGLE_VISIBLE));

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
    this._eventBusUnsubscribers = [];
    this._identity = new IdentityClient();
    this._profile = null;
    this._profileLoading = false;
    this._nicknameEditing = false;

    this._render();
    this._bindEvents();
  }

  open() {
    this._user = this._getHostUser();
    this._render();
    this._editorEl?.classList.add('hidden');
    this._el?.classList.remove('hidden');
    // 打开时尝试加载档案
    if (this._identity.isAuthenticated() && !this._profile) {
      this._loadProfile();
    }
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

    this._eventBusUnsubscribers.push(
      eventBus.on('account:open', () => this.open())
    );

    this._el.addEventListener('click', (e) => {
      const navItem = this._closest(e.target, '[data-section]');
      if (navItem) {
        this._activeSection = navItem.getAttribute('data-section');
        this._nicknameEditing = false;
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
        return;
      }

      const toolbarLabels = this._closest(e.target, '[data-toolbar-labels]')?.getAttribute('data-toolbar-labels');
      if (toolbarLabels) {
        this._setToolbarLabelsVisible(toolbarLabels);
        this._render();
        return;
      }

      const toolbarCollapsed = this._closest(e.target, '[data-toolbar-collapsed]')?.getAttribute('data-toolbar-collapsed');
      if (toolbarCollapsed) {
        this._setToolbarCollapsed(toolbarCollapsed);
        this._render();
        return;
      }

      const toolbarToggleVisible = this._closest(e.target, '[data-toolbar-toggle-visible]')?.getAttribute('data-toolbar-toggle-visible');
      if (toolbarToggleVisible) {
        this._setToolbarToggleVisible(toolbarToggleVisible);
        this._render();
        return;
      }

      // ── 账户区域操作 ──
      const accountAction = this._closest(e.target, '[data-action]')?.getAttribute('data-action');
      if (accountAction === 'login') {
        this._openLoginModal();
        return;
      }
      if (accountAction === 'logout') {
        this._handleLogout();
        return;
      }
      if (accountAction === 'edit-nickname') {
        this._nicknameEditing = true;
        this._render();
        this._el?.querySelector('[data-nickname-input]')?.focus();
        return;
      }
      if (accountAction === 'cancel-nickname') {
        this._nicknameEditing = false;
        this._render();
        return;
      }
      if (accountAction === 'save-nickname') {
        const input = this._el?.querySelector('[data-nickname-input]');
        if (input) this._handleNicknameSave(input.value);
        return;
      }
      if (accountAction === 'upload-avatar') {
        this._el?.querySelector('[data-avatar-input]')?.click();
        return;
      }

      // ── 登录弹窗操作 ──
      const modalAction = this._closest(e.target, '[data-modal-action]')?.getAttribute('data-modal-action');
      if (modalAction === 'close-login') {
        this._closeLoginModal();
        return;
      }
      if (modalAction === 'utools-login') {
        this._handleUToolsLogin();
        return;
      }
      if (modalAction === 'send-code') {
        const emailInput = document.getElementById('login-email-input');
        if (emailInput) this._handleSendCode(emailInput.value);
        return;
      }
      if (modalAction === 'email-login') {
        const emailInput = document.getElementById('login-email-input');
        const codeInput = document.getElementById('login-code-input');
        if (emailInput && codeInput) this._handleEmailLogin(emailInput.value, codeInput.value);
        return;
      }
    });

    // 头像文件选择
    this._el.addEventListener('change', (e) => {
      const fileInput = e.target.closest('[data-avatar-input]');
      if (fileInput && fileInput.files?.[0]) {
        this._handleAvatarUpload(fileInput.files[0]);
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

  // ═══════════════════════════════════════
  // 我的区域（登录 / 昵称头像编辑）
  // ═══════════════════════════════════════

  _renderMine() {
    let identityCard = '';
    if (this._profileLoading) {
      identityCard = `
        <div class="account-card account-card--profile">
          <div class="account-page__loading">加载中…</div>
        </div>
      `;
    } else if (!this._identity.isAuthenticated()) {
      identityCard = `
        <div class="account-card account-card--profile">
          <div class="account-card__body">
            <div class="account-card__label">我的账号</div>
            <h2>未登录</h2>
            <p>登录后可以同步昵称和头像，使用素材网盘等更多功能。</p>
            <button class="account-page__btn account-page__btn--primary" type="button" data-action="login">登录 / 注册</button>
          </div>
        </div>
      `;
    } else {
      const profile = this._profile || {};
      const nickname = profile.nickname || '未设置';
      const avatar = profile.avatar;
      const initial = this._getInitial(nickname);
      const uid = profile.id || '—';

      let nicknameRow = '';
      if (this._nicknameEditing) {
        nicknameRow = `
          <div class="account-page__nickname-row">
            <input type="text" class="account-page__nickname-input" id="nickname-input" value="${this._escapeAttr(nickname)}" placeholder="设置昵称" maxlength="32" data-nickname-input>
            <button class="account-page__btn account-page__btn--small" type="button" data-action="save-nickname">保存</button>
            <button class="account-page__btn account-page__btn--small" type="button" data-action="cancel-nickname">取消</button>
          </div>
        `;
      } else {
        nicknameRow = `
          <div class="account-page__nickname-row">
            <span class="account-page__nickname-display">${this._escapeHTML(nickname)}</span>
            <button class="account-page__btn account-page__btn--small" type="button" data-action="edit-nickname">修改</button>
          </div>
        `;
      }

      identityCard = `
        <div class="account-card account-card--profile">
          <div class="account-card__avatar-wrap" data-action="upload-avatar" title="点击更换头像">
            ${avatar
              ? `<img class="account-page__avatar account-page__avatar--large account-page__avatar-img" src="${this._escapeAttr(avatar)}" alt="${this._escapeAttr(nickname)}" data-initial="${this._escapeAttr(initial)}">`
              : `<div class="account-page__avatar account-page__avatar--large account-page__avatar-fallback">${this._escapeHTML(initial)}</div>`
            }
            <div class="account-page__avatar-edit-hint"><span>更换</span></div>
          </div>
          <div class="account-card__body">
            <div class="account-card__label">我的账号</div>
            ${nicknameRow}
            <p>UID：${this._escapeHTML(uid)}</p>
            <p class="account-page__hint">昵称和头像将同步到所有已登录的设备。</p>
            <button class="account-page__btn" type="button" data-action="logout">退出登录</button>
          </div>
          <input type="file" id="avatar-file-input" accept="image/png,image/jpeg,image/webp" data-avatar-input hidden>
        </div>
      `;
    }

    return identityCard;
  }

  _renderSettings() {
    const theme = getThemeChoice();
    const sidePanelLayout = this._getSidePanelLayout();
    const editorBarsLayout = this._getEditorBarsLayout();
    const editorSidePanelPosition = this._getEditorSidePanelPosition();
    const toolbarLabels = this._getToolbarLabelsVisible();
    const toolbarCollapsed = this._getToolbarCollapsed();
    const toolbarToggleVisible = this._getToolbarToggleVisible();
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

      <div class="account-card">
        <div class="account-card__label">编辑器</div>
        <div class="account-card__value">侧栏图标文字</div>
        <p>选择是否在侧栏工具图标下方显示文字标签。关闭后仅显示图标，更节省空间。</p>
        <div class="account-page__theme-row">
          <button class="account-page__theme-choice ${toolbarLabels === TOOLBAR_LABELS_VISIBLE.ON ? 'account-page__theme-choice--active' : ''}" type="button" data-toolbar-labels="${TOOLBAR_LABELS_VISIBLE.ON}">显示文字</button>
          <button class="account-page__theme-choice ${toolbarLabels === TOOLBAR_LABELS_VISIBLE.OFF ? 'account-page__theme-choice--active' : ''}" type="button" data-toolbar-labels="${TOOLBAR_LABELS_VISIBLE.OFF}">仅图标</button>
        </div>
      </div>

      <div class="account-card">
        <div class="account-card__label">编辑器</div>
        <div class="account-card__value">侧栏展开/收起</div>
        <p>展开后侧栏图标和文字并排显示，并在头像旁展示昵称；收起后仅显示图标和简短文字，更节省空间。</p>
        <div class="account-page__theme-row">
          <button class="account-page__theme-choice ${toolbarCollapsed === TOOLBAR_COLLAPSED.EXPANDED ? 'account-page__theme-choice--active' : ''}" type="button" data-toolbar-collapsed="${TOOLBAR_COLLAPSED.EXPANDED}">展开</button>
          <button class="account-page__theme-choice ${toolbarCollapsed === TOOLBAR_COLLAPSED.COLLAPSED ? 'account-page__theme-choice--active' : ''}" type="button" data-toolbar-collapsed="${TOOLBAR_COLLAPSED.COLLAPSED}">收起</button>
        </div>
      </div>

      <div class="account-card">
        <div class="account-card__label">编辑器</div>
        <div class="account-card__value">侧栏展开/收起按钮</div>
        <p>选择是否在侧栏顶部显示展开/收起切换按钮。关闭后仍可在设置中切换侧栏状态。</p>
        <div class="account-page__theme-row">
          <button class="account-page__theme-choice ${toolbarToggleVisible === TOOLBAR_TOGGLE_VISIBLE.ON ? 'account-page__theme-choice--active' : ''}" type="button" data-toolbar-toggle-visible="${TOOLBAR_TOGGLE_VISIBLE.ON}">显示按钮</button>
          <button class="account-page__theme-choice ${toolbarToggleVisible === TOOLBAR_TOGGLE_VISIBLE.OFF ? 'account-page__theme-choice--active' : ''}" type="button" data-toolbar-toggle-visible="${TOOLBAR_TOGGLE_VISIBLE.OFF}">隐藏按钮</button>
        </div>
      </div>
    `;
  }

  _renderAbout() {
    const appVersion = this._getCurrentVersion();
    const hostName = this._getHostName();
    const hostVersion = this._getHostVersion();
    const qqUrl = this._getContactUrl();

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
            <a class="account-about__contact" href="${this._escapeAttr(qqUrl)}" data-external-url="${this._escapeAttr(qqUrl)}">
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
    * 渲染单个更新项（仅展示文本内容，不展示平台标签）
    */
   _renderChangeItem(item) {
     // 兼容旧格式（字符串）
     if (typeof item === 'string') {
       return `<li>${this._escapeHTML(item)}</li>`;
     }

     // 新格式（对象）— 仅展示文本，平台过滤已在 _renderChangeGroup 中完成
     const text = item.text || '';
     return `<li>${this._escapeHTML(text)}</li>`;
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

  _setToolbarLabelsVisible(value) {
    if (!VALID_TOOLBAR_LABELS_VISIBLE.has(value)) return;

    localStorage.setItem(TOOLBAR_LABELS_VISIBLE_KEY, value);
    eventBus.emit('toolbar:labelsVisibilityChanged', value);
  }

  _setToolbarCollapsed(value) {
    if (!VALID_TOOLBAR_COLLAPSED.has(value)) return;

    localStorage.setItem(TOOLBAR_COLLAPSED_KEY, value);
    eventBus.emit('toolbar:collapsedChanged', value);
  }

  _setToolbarToggleVisible(value) {
    if (!VALID_TOOLBAR_TOGGLE_VISIBLE.has(value)) return;

    localStorage.setItem(TOOLBAR_TOGGLE_VISIBLE_KEY, value);
    eventBus.emit('toolbar:toggleVisibleChanged', value);
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

  _getToolbarLabelsVisible() {
    const saved = localStorage.getItem(TOOLBAR_LABELS_VISIBLE_KEY);
    return VALID_TOOLBAR_LABELS_VISIBLE.has(saved) ? saved : TOOLBAR_LABELS_VISIBLE.ON;
  }

  _getToolbarCollapsed() {
    const saved = localStorage.getItem(TOOLBAR_COLLAPSED_KEY);
    return VALID_TOOLBAR_COLLAPSED.has(saved) ? saved : TOOLBAR_COLLAPSED.COLLAPSED;
  }

  _getToolbarToggleVisible() {
    const saved = localStorage.getItem(TOOLBAR_TOGGLE_VISIBLE_KEY);
    return VALID_TOOLBAR_TOGGLE_VISIBLE.has(saved) ? saved : TOOLBAR_TOGGLE_VISIBLE.ON;
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

  _getContactUrl() {
    try {
      const url = this._host?.getContactUrl?.();
      if (url) return url;
    } catch (e) {
      console.warn('[AccountPage] 获取联系方式失败:', e);
    }
    return 'https://qm.qq.com/q/Nzn12S22e6';
  }

  _getInitial(name) {
    const text = String(name || '').trim();
    return text ? text.slice(0, 1).toUpperCase() : 'U';
  }

  _formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ═══════════════════════════════════════
  // 账户异步操作
  // ═══════════════════════════════════════

  async _loadProfile() {
    this._profileLoading = true;
    this._render();
    try {
      this._profile = await this._identity.getProfile();
    } catch (e) {
      console.warn('[AccountPage] 加载用户档案失败:', e);
      this._profile = null;
    }
    this._profileLoading = false;
    this._render();
    // 通知侧栏等外部组件同步刷新头像
    eventBus.emit('account:profileChanged', this._profile);
  }

  async _handleNicknameSave(nickname) {
    const trimmed = String(nickname || '').trim();
    if (!trimmed) {
      eventBus.emit('toast:show', { message: '昵称不能为空', type: 'error' });
      return;
    }
    if (trimmed.length > 32) {
      eventBus.emit('toast:show', { message: '昵称最多 32 字符', type: 'error' });
      return;
    }
    try {
      this._profile = await this._identity.updateProfile({ nickname: trimmed });
      this._nicknameEditing = false;
      this._render();
      eventBus.emit('toast:show', { message: '昵称已更新', type: 'success' });
      eventBus.emit('account:profileChanged', this._profile);
    } catch (e) {
      eventBus.emit('toast:show', { message: e?.message || '保存失败', type: 'error' });
    }
  }

  async _handleAvatarUpload(file) {
    try {
      this._profile = await this._identity.uploadAvatar(file);
      this._render();
      eventBus.emit('toast:show', { message: '头像已更新', type: 'success' });
      eventBus.emit('account:profileChanged', this._profile);
    } catch (e) {
      eventBus.emit('toast:show', { message: e?.message || '头像上传失败', type: 'error' });
    }
  }

  async _handleLogout() {
    try {
      await this._identity.logout();
    } catch {}
    this._profile = null;
    this._nicknameEditing = false;
    this._render();
    eventBus.emit('toast:show', { message: '已退出登录', type: 'success' });
    eventBus.emit('account:profileChanged', null);
  }

  // ═══════════════════════════════════════
  // 登录弹窗
  // ═══════════════════════════════════════

  _openLoginModal() {
    let modal = document.getElementById('login-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'login-modal';
      modal.className = 'login-modal';
      document.body.appendChild(modal);
    }
    const isUTools = !!window.utools;
    modal.innerHTML = `
      <div class="login-modal__backdrop" data-modal-action="close-login"></div>
      <div class="login-modal__card">
        <div class="login-modal__header">
          <h3>登录 / 注册</h3>
          <button class="login-modal__close" type="button" data-modal-action="close-login">×</button>
        </div>
        <div class="login-modal__body">
          ${isUTools ? `
            <button class="login-modal__btn login-modal__btn--utools" type="button" data-modal-action="utools-login">
              <span>使用 uTools 账号一键登录</span>
            </button>
            <div class="login-modal__divider"><span>或</span></div>
          ` : ''}
          <div class="login-modal__field">
            <label>邮箱</label>
            <input type="email" id="login-email-input" placeholder="请输入邮箱地址" autocomplete="email">
          </div>
          <div class="login-modal__field login-modal__field--code">
            <label>验证码</label>
            <div class="login-modal__code-row">
              <input type="text" id="login-code-input" placeholder="6 位验证码" maxlength="6" autocomplete="code">
              <button class="login-modal__btn login-modal__btn--small" type="button" data-modal-action="send-code" id="send-code-btn">发送验证码</button>
            </div>
          </div>
          <button class="login-modal__btn login-modal__btn--primary" type="button" data-modal-action="email-login">登录</button>
          <p class="login-modal__hint">首次登录将自动注册账号</p>
        </div>
      </div>
    `;
    modal.classList.add('login-modal--active');

    // 弹窗挂载在 document.body 上，不在 this._el 内，
    // 因此需要单独绑定点击事件
    modal.onclick = (e) => {
      const modalAction = e.target.closest('[data-modal-action]')?.getAttribute('data-modal-action');
      if (modalAction === 'close-login') {
        this._closeLoginModal();
        return;
      }
      if (modalAction === 'utools-login') {
        this._handleUToolsLogin();
        return;
      }
      if (modalAction === 'send-code') {
        const emailInput = document.getElementById('login-email-input');
        if (emailInput) this._handleSendCode(emailInput.value);
        return;
      }
      if (modalAction === 'email-login') {
        const emailInput = document.getElementById('login-email-input');
        const codeInput = document.getElementById('login-code-input');
        if (emailInput && codeInput) this._handleEmailLogin(emailInput.value, codeInput.value);
        return;
      }
    };
  }

  _closeLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
      modal.classList.remove('login-modal--active');
      setTimeout(() => modal.remove(), 200);
    }
  }

  async _handleSendCode(email) {
    const btn = document.getElementById('send-code-btn');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      eventBus.emit('toast:show', { message: '请输入有效的邮箱地址', type: 'error' });
      return;
    }
    try {
      if (btn) { btn.disabled = true; btn.textContent = '发送中…'; }
      await this._identity.requestEmailCode(email, 'login');
      eventBus.emit('toast:show', { message: '验证码已发送', type: 'success' });
      this._startCountdown(btn, 60);
    } catch (e) {
      eventBus.emit('toast:show', { message: e?.message || '发送失败', type: 'error' });
      if (btn) { btn.disabled = false; btn.textContent = '发送验证码'; }
    }
  }

  _startCountdown(btn, seconds) {
    if (!btn) return;
    let remaining = seconds;
    btn.disabled = true;
    btn.textContent = `${remaining}s`;
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = '发送验证码';
      } else {
        btn.textContent = `${remaining}s`;
      }
    }, 1000);
  }

  async _handleEmailLogin(email, code) {
    if (!email || !code) {
      eventBus.emit('toast:show', { message: '请填写邮箱和验证码', type: 'error' });
      return;
    }
    try {
      await this._identity.loginWithEmailCode(email, code, 'login');
      this._closeLoginModal();
      eventBus.emit('toast:show', { message: '登录成功', type: 'success' });
      await this._loadProfile();
    } catch (e) {
      eventBus.emit('toast:show', { message: e?.message || '登录失败', type: 'error' });
    }
  }

  async _handleUToolsLogin() {
    try {
      const api = window.utools;
      if (!api?.fetchUserServerTemporaryToken) {
        eventBus.emit('toast:show', { message: '当前环境不支持一键登录', type: 'error' });
        return;
      }
      const { token: accessToken } = await api.fetchUserServerTemporaryToken();
      const deviceId = api.getDeviceId?.() || 'utools-device';
      await this._identity.loginWithUTools(accessToken, deviceId);
      this._closeLoginModal();
      eventBus.emit('toast:show', { message: '登录成功', type: 'success' });
      await this._loadProfile();
    } catch (e) {
      eventBus.emit('toast:show', { message: e?.message || '登录失败', type: 'error' });
    }
  }

  _escapeAttr(value) {
    return escapeAttr(value);
  }

  _escapeHTML(value) {
    return escapeHTML(value);
  }

  destroy() {
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
  }
}

export default AccountPage;
