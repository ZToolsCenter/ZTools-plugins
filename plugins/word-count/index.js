(function () {
  "use strict";

  var input = document.getElementById("input-text");
  var toastEl = document.getElementById("toast");
  var btnCopy = document.getElementById("btn-copy");
  var btnClear = document.getElementById("btn-clear");
  var btnPaste = document.getElementById("btn-paste");

  var lastStats = null;
  var debounceTimer = null;
  var toastTimer = null;

  function z() {
    return typeof window !== "undefined" && window.ztools ? window.ztools : null;
  }

  function setTheme(isDark) {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }

  function applyThemeFromHost() {
    var api = z();
    if (!api) {
      var prefersDark =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme(prefersDark);
      return;
    }
    try {
      if (typeof api.isDarkColors === "function") {
        setTheme(!!api.isDarkColors());
      } else if (typeof api.getThemeInfo === "function") {
        var info = api.getThemeInfo();
        setTheme(!!(info && info.isDark));
      }
      if (typeof api.onThemeChange === "function") {
        api.onThemeChange(function (themeInfo) {
          setTheme(!!(themeInfo && themeInfo.isDark));
        });
      }
    } catch (e) {
      console.warn("theme init failed", e);
    }
  }

  function renderStats(stats) {
    lastStats = stats;
    var keys = [
      "han",
      "latinWords",
      "readingLabel",
      "charCount",
      "charNoSpace",
      "numbers",
      "punctuation",
      "lines",
      "paragraphs",
    ];
    keys.forEach(function (key) {
      var el = document.querySelector('[data-key="' + key + '"]');
      if (!el) return;
      el.textContent = String(stats[key]);
    });
  }

  function refresh(text) {
    var stats = WordCount.countText(text || "");
    renderStats(stats);
    return stats;
  }

  function scheduleRefresh() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      refresh(input.value);
    }, 80);
  }

  function showToast(message) {
    var api = z();
    if (api && typeof api.showToast === "function") {
      try {
        api.showToast(message);
        return;
      } catch (e) {
        /* fall through */
      }
    }
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      setTimeout(function () {
        toastEl.hidden = true;
      }, 200);
    }, 1600);
  }

  async function copyReport() {
    var stats = lastStats || refresh(input.value);
    var text = WordCount.formatFullReport(stats);
    var api = z();
    if (api && typeof api.copyText === "function") {
      try {
        var ok = api.copyText(text);
        showToast(ok ? "已复制" : "复制失败");
        return;
      } catch (e) {
        /* fall through */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制");
    } catch (e) {
      showToast("复制失败");
    }
  }

  async function pasteFromClipboard() {
    var api = z();
    if (api && api.clipboard && typeof api.clipboard.getHistory === "function") {
      try {
        var history = await api.clipboard.getHistory(1, 1, "text");
        var items = (history && (history.items || history.list || history)) || [];
        if (Array.isArray(items) && items[0]) {
          var content = items[0].content || items[0].text || items[0].data || "";
          if (typeof content === "string" && content) {
            input.value = content;
            refresh(input.value);
            showToast("已粘贴");
            return;
          }
        }
      } catch (e) {
        /* fall through */
      }
    }
    try {
      var text = await navigator.clipboard.readText();
      input.value = text || "";
      refresh(input.value);
      showToast(text ? "已粘贴" : "剪贴板为空");
    } catch (e) {
      showToast("无法读取剪贴板");
      input.focus();
    }
  }

  function clearAll() {
    input.value = "";
    refresh("");
    input.focus();
  }

  function setText(text) {
    input.value = typeof text === "string" ? text : "";
    refresh(input.value);
  }

  function onPluginEnter(param) {
    if (!param) return;
    var payload = param.payload;
    if (typeof payload === "string" && payload) {
      setText(payload);
    } else if (payload && typeof payload === "object") {
      var maybe =
        payload.text ||
        payload.content ||
        payload.payload ||
        (typeof payload.data === "string" ? payload.data : "");
      if (typeof maybe === "string" && maybe) setText(maybe);
    }
  }

  function bindHostEvents() {
    var api = z();
    if (!api) return;
    try {
      if (typeof api.onPluginEnter === "function") {
        api.onPluginEnter(onPluginEnter);
      } else if (typeof api.onPluginReady === "function") {
        api.onPluginReady(onPluginEnter);
      }
    } catch (e) {
      console.warn("onPluginEnter bind failed", e);
    }
  }

  input.addEventListener("input", scheduleRefresh);
  btnCopy.addEventListener("click", function () {
    copyReport();
  });
  btnClear.addEventListener("click", clearAll);
  btnPaste.addEventListener("click", function () {
    pasteFromClipboard();
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "enter") {
      e.preventDefault();
      copyReport();
    }
  });

  applyThemeFromHost();
  bindHostEvents();
  refresh(input.value);

  try {
    var params = new URLSearchParams(window.location.search);
    var q = params.get("text");
    if (q) setText(q);
  } catch (e) {
    /* ignore */
  }
})();
