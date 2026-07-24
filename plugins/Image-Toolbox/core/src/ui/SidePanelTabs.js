import { eventBus } from '../index.js';

const SIDE_PANEL_TAB_KEY = 'image-toolbox-side-panel-tab';
export const SIDE_PANEL_LAYOUT_KEY = 'image-toolbox-side-panel-layout';
export const SIDE_PANEL_LAYOUTS = {
  TABS: 'tabs',
  SPLIT: 'split',
};

const VALID_TABS = new Set(['property', 'layer']);
const VALID_LAYOUTS = new Set(Object.values(SIDE_PANEL_LAYOUTS));

/**
 * Side panel container.
 * Supports tab and split layouts, with remembered user preference.
 */
class SidePanelTabs {
  constructor(containerEl, layerManager) {
    this._el = containerEl;
    this._lm = layerManager;
    this._activeTab = this._getInitialTab();
    this._layout = this._getInitialLayout();
    this._eventBusUnsubscribers = [];

    this._render();
    this._bindEvents();
    this._applyLayout(this._layout, false);
    this._activateTab(this._activeTab, false);
    this._updateLayerCount();
  }

  _render() {
    this._el.innerHTML = `
      <div class="side-tabs">
        <div class="side-tabs__header" role="tablist" aria-label="右侧面板">
          <button class="side-tabs__tab" type="button" role="tab" data-panel-tab="property" aria-controls="side-pane-property">
            属性
          </button>
          <button class="side-tabs__tab" type="button" role="tab" data-panel-tab="layer" aria-controls="side-pane-layer">
            图层 <span class="side-tabs__badge" id="side-layer-count">0</span>
          </button>
        </div>
        <div class="side-tabs__content">
          <div class="side-tabs__pane" id="side-pane-property" role="tabpanel" data-panel-pane="property">
            <div id="property-panel"></div>
          </div>
          <div class="side-tabs__pane" id="side-pane-layer" role="tabpanel" data-panel-pane="layer">
            <div id="layer-panel"></div>
          </div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    this._el.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-panel-tab]');
      if (!tabBtn) return;

      this._activateTab(tabBtn.dataset.panelTab, true);
    });

    this._eventBusUnsubscribers.push(
      eventBus.on('layers:updated', () => this._updateLayerCount()),
      eventBus.on('image:loaded', () => this._updateLayerCount()),
      eventBus.on('canvas:restored', () => this._updateLayerCount())
    );
  }

  applyLayout(layout, persist = true) {
    this._applyLayout(layout, persist);
  }

  _activateTab(tabName, persist = true) {
    if (!VALID_TABS.has(tabName)) return;

    this._activeTab = tabName;
    this._syncTabs();
    this._syncPanes();

    if (persist) {
      localStorage.setItem(SIDE_PANEL_TAB_KEY, tabName);
      eventBus.emit('sidePanel:tabChanged', tabName);
    }
  }

  _applyLayout(layout, persist = true) {
    if (!VALID_LAYOUTS.has(layout)) return;

    this._layout = layout;
    const shell = this._el.querySelector('.side-tabs');
    if (shell) {
      shell.classList.toggle('side-tabs--tabs', layout === SIDE_PANEL_LAYOUTS.TABS);
      shell.classList.toggle('side-tabs--split', layout === SIDE_PANEL_LAYOUTS.SPLIT);
    }

    this._syncPanes();

    if (persist) {
      localStorage.setItem(SIDE_PANEL_LAYOUT_KEY, layout);
      eventBus.emit('sidePanel:layoutChanged', layout);
    }
  }

  _syncTabs() {
    this._el.querySelectorAll('[data-panel-tab]').forEach(btn => {
      const active = btn.dataset.panelTab === this._activeTab;
      btn.classList.toggle('side-tabs__tab--active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });
  }

  _syncPanes() {
    const isSplit = this._layout === SIDE_PANEL_LAYOUTS.SPLIT;
    this._el.querySelectorAll('[data-panel-pane]').forEach(pane => {
      const active = isSplit || pane.dataset.panelPane === this._activeTab;
      pane.classList.toggle('side-tabs__pane--active', active);
      pane.hidden = !active;
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  }

  _updateLayerCount() {
    const countEl = this._el.querySelector('#side-layer-count');
    if (!countEl) return;

    const count = this._lm?.getLayers?.().length || 0;
    countEl.textContent = count;
  }

  _getInitialTab() {
    const saved = localStorage.getItem(SIDE_PANEL_TAB_KEY);
    return VALID_TABS.has(saved) ? saved : 'property';
  }

  _getInitialLayout() {
    const saved = localStorage.getItem(SIDE_PANEL_LAYOUT_KEY);
    return VALID_LAYOUTS.has(saved) ? saved : SIDE_PANEL_LAYOUTS.TABS;
  }

  destroy() {
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
  }
}

export default SidePanelTabs;
