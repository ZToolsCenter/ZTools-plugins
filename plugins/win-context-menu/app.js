// Windows 右键菜单管理前端交互逻辑（支持一次 UAC 常驻提权 + 毫秒级局部更新）
(function () {
  const state = {
    scope: "dir-bg",
    keyword: "",
    status: "all",
    items: [],
    historyCount: 0,
    busy: false,
    adminActive: false,
    autoElevAttempted: false,
  };

  const els = {
    scopeTabs: document.getElementById("scopeTabs"),
    searchInput: document.getElementById("searchInput"),
    statusFilter: document.getElementById("statusFilter"),
    adminSessionBtn: document.getElementById("adminSessionBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    explorerBanner: document.getElementById("explorerBanner"),
    bannerRestartBtn: document.getElementById("bannerRestartBtn"),
    loadingBox: document.getElementById("loadingBox"),
    emptyBox: document.getElementById("emptyBox"),
    itemList: document.getElementById("itemList"),
    statsText: document.getElementById("statsText"),
    openBackupBtn: document.getElementById("openBackupBtn"),
    restartExplorerBtn: document.getElementById("restartExplorerBtn"),
    restoreAllBtn: document.getElementById("restoreAllBtn"),
    toast: document.getElementById("toast"),
  };

  let toastTimer = null;
  function showToast(msg, duration = 2400) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.add("hidden");
    }, duration);
  }

  function applyTheme(isDark) {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }

  function updateAdminButton() {
    if (state.adminActive) {
      els.adminSessionBtn.textContent = "管理员已授权";
      els.adminSessionBtn.className = "btn btn-ok";
      els.adminSessionBtn.title = "常驻管理员会话已激活（15 分钟空闲自动退出），切换 HKLM 项免重复 UAC 弹窗；点击可手动退出会话";
    } else {
      els.adminSessionBtn.textContent = "获取管理员权限";
      els.adminSessionBtn.className = "btn btn-secondary";
      els.adminSessionBtn.title = "一次性获取管理员权限，后续切换 HKLM 菜单项免重复 UAC 弹窗";
    }
  }

  const isStandalone = new URLSearchParams(window.location.search).get("standalone") === "1";
  let standaloneWin = null;

  /**
   * 配置型插件默认以独立窗口打开（带任务栏图标、失焦/弹 UAC 不自动关闭）
   */
  function openInStandaloneWindow() {
    if (!window.ztools || typeof window.ztools.createBrowserWindow !== "function") {
      return false;
    }

    // 若独立窗口已存在且未关闭，直接唤回前台（单例复用）
    if (standaloneWin) {
      try {
        const destroyed = typeof standaloneWin.isDestroyed === "function" ? standaloneWin.isDestroyed() : false;
        if (!destroyed) {
          if (typeof standaloneWin.show === "function") standaloneWin.show();
          if (typeof standaloneWin.focus === "function") standaloneWin.focus();
          if (typeof window.ztools.hideMainWindow === "function") window.ztools.hideMainWindow();
          return true;
        }
      } catch (_) {}
      standaloneWin = null;
    }

    try {
      standaloneWin = window.ztools.createBrowserWindow("index.html?standalone=1", {
        title: "Windows 右键菜单管理",
        width: 880,
        height: 640,
        minWidth: 680,
        minHeight: 480,
        show: true,
        autoHideMenuBar: true,
        webPreferences: {
          preload: "preload.js",
          devTools: true,
        },
      });
      if (typeof window.ztools.hideMainWindow === "function") {
        window.ztools.hideMainWindow();
      }
      // 在悬浮主窗口保留简洁提示，万一用户手动切回主窗口也能一键唤回独立窗口
      els.loadingBox.innerHTML =
        '已在独立窗口中打开「Windows 右键菜单管理」<br/><br/><button id="reopenStandaloneBtn" class="btn btn-primary">重新打开 / 置顶独立窗口</button>';
      els.loadingBox.classList.remove("hidden");
      const btn = document.getElementById("reopenStandaloneBtn");
      if (btn) btn.addEventListener("click", () => openInStandaloneWindow());
      return true;
    } catch (_) {
      standaloneWin = null;
      return false;
    }
  }

  function shouldLaunchStandalone() {
    if (isStandalone) return false;
    if (!window.ztools || typeof window.ztools.createBrowserWindow !== "function") return false;
    try {
      if (typeof window.ztools.getWindowType === "function") {
        const wt = window.ztools.getWindowType();
        // 如果用户已在 ZTools 中把插件手动分离为独立窗口，就直接在当前窗口运行，不再套娃开新窗
        if (wt && wt !== "main") return false;
      }
    } catch (_) {}
    return true;
  }

  function initZToolsBridge() {
    if (!window.ztools) return;
    try {
      if (typeof window.ztools.getThemeInfo === "function") {
        const info = window.ztools.getThemeInfo();
        applyTheme(Boolean(info && info.isDark));
      } else if (typeof window.ztools.isDarkColors === "function") {
        applyTheme(Boolean(window.ztools.isDarkColors()));
      }
      if (typeof window.ztools.onThemeChange === "function") {
        window.ztools.onThemeChange((info) => {
          applyTheme(Boolean(info && info.isDark));
        });
      }
      if (!isStandalone && typeof window.ztools.setExpendHeight === "function") {
        window.ztools.setExpendHeight(220);
      }
      if (!isStandalone && typeof window.ztools.onPluginEnter === "function") {
        window.ztools.onPluginEnter(() => {
          if (shouldLaunchStandalone()) {
            openInStandaloneWindow();
          } else {
            bootstrap();
          }
        });
      }
    } catch (_) {}
  }

  function getFilteredItems() {
    const kw = state.keyword.trim().toLowerCase();
    return state.items.filter((item) => {
      if (state.scope !== "all" && item.scopeId !== state.scope) return false;
      if (state.status === "enabled" && !item.enabled) return false;
      if (state.status === "disabled" && item.enabled) return false;
      if (kw) {
        const hay = `${item.displayName} ${item.keyName} ${item.regPath} ${item.command || ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render() {
    updateAdminButton();
    const list = getFilteredItems();
    const enabledCount = list.filter((i) => i.enabled).length;
    const disabledCount = list.length - enabledCount;

    els.statsText.textContent = `当前显示 ${list.length} 项（已启用 ${enabledCount} / 已停用 ${disabledCount}）`;
    els.restoreAllBtn.textContent = `一键还原全部修改 (${state.historyCount})`;
    els.restoreAllBtn.disabled = state.busy || state.historyCount === 0;

    if (list.length === 0) {
      els.itemList.innerHTML = "";
      els.emptyBox.classList.remove("hidden");
      return;
    }

    els.emptyBox.classList.add("hidden");
    els.itemList.innerHTML = list
      .map((item) => {
        const badges = [];
        if (state.scope === "all") {
          badges.push(`<span class="badge">${escapeHtml(item.scopeLabel)}</span>`);
        }
        badges.push(
          item.subKind === "win11"
            ? `<span class="badge" style="color:var(--primary);border:1px solid var(--primary);background:transparent;">Win11现代扩展</span>`
            : item.kind === "shellex"
              ? `<span class="badge">COM扩展</span>`
              : `<span class="badge">Shell项</span>`
        );
        if (item.needsAdmin && !state.adminActive) {
          badges.push(`<span class="badge badge-warn">需管理员(UAC)</span>`);
        } else if (item.needsAdmin && state.adminActive) {
          badges.push(`<span class="badge badge-ok">HKLM · 已授权</span>`);
        } else {
          badges.push(`<span class="badge badge-ok">免提权</span>`);
        }
        if (item.isExtended) {
          badges.push(`<span class="badge">按住Shift显示</span>`);
        }
        if (item.isSystemHint) {
          badges.push(`<span class="badge badge-danger">系统内置</span>`);
        }
        if (!item.enabled) {
          badges.push(`<span class="badge badge-danger">已停用</span>`);
        }

        const subLine = item.command
          ? `${item.keyName} · ${item.command}`
          : `${item.keyName} · ${item.regPath}`;

        const iconHtml = item.iconDataUrl
          ? `<div class="card-icon"><img src="${escapeHtml(item.iconDataUrl)}" alt="" /></div>`
          : `<div class="card-icon"><span class="card-icon-fallback">${item.kind === "shellex" ? "⚙" : "▸"}</span></div>`;

        return `
          <div class="card ${item.enabled ? "" : "disabled"}" data-id="${escapeHtml(item.id)}">
            ${iconHtml}
            <div class="card-main">
              <div class="card-title-row">
                <span class="card-title">${escapeHtml(item.displayName)}</span>
                ${badges.join("")}
              </div>
              <div class="card-meta" title="${escapeHtml(item.regPath)}">${escapeHtml(subLine)}</div>
            </div>
            <label class="switch" title="${item.enabled ? "点击停用此右键菜单项" : "点击重新启用"}">
              <input type="checkbox" class="toggle-input" data-id="${escapeHtml(item.id)}" ${item.enabled ? "checked" : ""} ${state.busy ? "disabled" : ""} />
              <span class="slider"></span>
            </label>
          </div>
        `;
      })
      .join("");
  }

  async function loadItems(silent = false) {
    if (!window.ctxMenuApi) {
      els.loadingBox.textContent = "未检测到 preload 接口，请在 ZTools 宿主中打开此插件。";
      return;
    }
    state.busy = true;
    if (!silent) {
      els.loadingBox.classList.remove("hidden");
      els.emptyBox.classList.add("hidden");
      els.itemList.innerHTML = "";
    }
    els.refreshBtn.disabled = true;

    const res = await window.ctxMenuApi.scan();
    state.busy = false;
    els.loadingBox.classList.add("hidden");
    els.refreshBtn.disabled = false;

    if (!res || !res.ok) {
      els.emptyBox.textContent = `扫描失败：${(res && res.error) || "未知错误"}`;
      els.emptyBox.classList.remove("hidden");
      return;
    }

    state.items = Array.isArray(res.items) ? res.items : [];
    state.historyCount = Number(res.historyCount || 0);
    if (res.isAdmin) state.adminActive = true;
    render();
  }

  /**
   * 启动引导：
   * 1. 先检查是否已有存活的常驻管理员会话（有的话直接秒级复用 scan，无需弹 UAC）
   * 2. 若未激活且首次进入，自动一次性发起 UAC 申请常驻管理员会话，激活后后续 scan & toggle 均毫秒级完成
   */
  async function bootstrap() {
    if (!window.ctxMenuApi) return;
    const status = await window.ctxMenuApi.getSessionStatus();
    state.adminActive = Boolean(status && status.active && status.isAdmin);
    updateAdminButton();

    if (state.adminActive) {
      // 已有常驻 Worker，直接毫秒级扫描
      await loadItems(state.items.length > 0);
      return;
    }

    if (!state.autoElevAttempted) {
      state.autoElevAttempted = true;
      els.loadingBox.textContent = "正在申请一次性管理员权限（激活后全程免重复 UAC 且操作秒级响应）...";
      els.loadingBox.classList.remove("hidden");
      const elev = await window.ctxMenuApi.startElevatedSession();
      if (elev && elev.ok && elev.isAdmin) {
        state.adminActive = true;
        updateAdminButton();
        showToast("管理员会话已激活，后续切换无需再弹 UAC");
      } else {
        showToast("已使用普通模式加载（HKCU/COM 扩展可免提权开关）");
      }
    }

    await loadItems(state.items.length > 0);
  }

  async function handleAdminBtnClick() {
    if (state.busy) return;
    if (state.adminActive) {
      const ok = window.confirm("确定退出当前常驻管理员会话吗？退出后修改 HKLM 项将重新请求 UAC。");
      if (!ok) return;
      await window.ctxMenuApi.stopElevatedSession();
      state.adminActive = false;
      render();
      showToast("已退出管理员会话");
      return;
    }

    showToast("正在请求一次性管理员授权...", 3000);
    const elev = await window.ctxMenuApi.startElevatedSession();
    if (elev && elev.ok && elev.isAdmin) {
      state.adminActive = true;
      render();
      showToast("管理员会话已激活，后续操作全程免重复 UAC");
    } else {
      showToast(`未获取管理员权限：${(elev && elev.error) || "已取消"}`);
    }
  }

  async function handleToggle(item, targetEnabled, checkboxEl) {
    if (state.busy) return;
    if (item.isSystemHint && !targetEnabled) {
      const ok = window.confirm(`「${item.displayName}」属于系统常用/内置项，确定要停用吗？（随时可一键还原）`);
      if (!ok) {
        checkboxEl.checked = item.enabled;
        return;
      }
    }

    state.busy = true;
    checkboxEl.disabled = true;

    const op = {
      id: item.id,
      kind: item.kind,
      hive: item.hive,
      keyName: item.keyName,
      displayName: item.displayName,
      regPath: item.regPath,
      clsid: item.clsid,
      currentEnabled: item.enabled,
      targetEnabled,
      needsAdmin: item.needsAdmin,
    };

    const res = await window.ctxMenuApi.toggleItems([op]);
    state.busy = false;

    if (!res || !res.ok) {
      checkboxEl.checked = item.enabled;
      checkboxEl.disabled = false;
      showToast(`操作失败：${(res && res.error) || "未知错误"}`, 3500);
      return;
    }

    // 毫秒级局部状态更新，无需再花十几秒全量扫描！
    if (item.kind === "shellex" && item.clsid) {
      // 同 CLSID 的 COM 扩展在多个场景下共享拦截状态，一并同步
      for (const it of state.items) {
        if (it.kind === "shellex" && it.clsid === item.clsid) {
          it.enabled = targetEnabled;
        }
      }
    } else {
      item.enabled = targetEnabled;
    }

    if (typeof res.historyCount === "number") {
      state.historyCount = res.historyCount;
    }
    if (item.needsAdmin) {
      const st = await window.ctxMenuApi.getSessionStatus();
      state.adminActive = Boolean(st && st.active && st.isAdmin);
    }

    if (res.needsExplorerRestart) {
      els.explorerBanner.classList.remove("hidden");
    }
    render();
    showToast(`已${targetEnabled ? "启用" : "停用"}「${item.displayName}」`);
  }

  async function handleRestoreAll() {
    if (state.busy || state.historyCount === 0) return;
    const ok = window.confirm(`确定要还原所有由本插件修改过的 ${state.historyCount} 项右键菜单吗？`);
    if (!ok) return;

    state.busy = true;
    render();
    showToast("正在还原修改记录...", 4000);
    const res = await window.ctxMenuApi.restoreAll();
    state.busy = false;

    if (!res || !res.ok) {
      showToast(`还原失败：${(res && res.error) || "未知错误"}`, 3500);
      await loadItems(true);
      return;
    }

    if (res.needsExplorerRestart) {
      els.explorerBanner.classList.remove("hidden");
    }
    showToast(`已还原 ${res.restoredCount || 0} 项右键菜单配置`);
    await loadItems(true);
  }

  async function handleRestartExplorer() {
    if (state.busy) return;
    showToast("正在重启资源管理器...", 2500);
    const res = await window.ctxMenuApi.restartExplorer();
    if (res && res.ok) {
      els.explorerBanner.classList.add("hidden");
      showToast("资源管理器已重启，COM 扩展变更已生效");
    } else {
      showToast(`重启失败：${(res && res.error) || "未知错误"}`);
    }
  }

  // 事件绑定
  els.scopeTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    els.scopeTabs.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.scope = btn.dataset.scope;
    render();
  });

  els.searchInput.addEventListener("input", (e) => {
    state.keyword = e.target.value;
    render();
  });

  els.statusFilter.addEventListener("change", (e) => {
    state.status = e.target.value;
    render();
  });

  els.adminSessionBtn.addEventListener("click", handleAdminBtnClick);
  els.refreshBtn.addEventListener("click", () => loadItems(false));
  els.openBackupBtn.addEventListener("click", () => window.ctxMenuApi && window.ctxMenuApi.openBackupDir());
  els.restoreAllBtn.addEventListener("click", handleRestoreAll);
  els.restartExplorerBtn.addEventListener("click", handleRestartExplorer);
  els.bannerRestartBtn.addEventListener("click", handleRestartExplorer);

  els.itemList.addEventListener("change", (e) => {
    const input = e.target.closest(".toggle-input");
    if (!input) return;
    const item = state.items.find((i) => i.id === input.dataset.id);
    if (!item) return;
    handleToggle(item, input.checked, input);
  });

  initZToolsBridge();
  if (shouldLaunchStandalone()) {
    // 悬浮主窗口入口：交给 onPluginEnter 或兜底直接拉起独立窗口
    openInStandaloneWindow();
  } else {
    // 独立窗口（或已被宿主分离的窗口）：正常初始化扫描与一次 UAC 授权
    bootstrap();
  }
})();
