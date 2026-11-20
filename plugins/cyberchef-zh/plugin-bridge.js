/**
 * CyberChef 中文版 —— ZTools 页面侧桥接层
 *
 * 由 index.html 与 CyberChef_v11.5.0.html 引用。职责只有三件：
 *   1. 向宿主申请足够的窗口高度；
 *   2. 接收 ZTools 入口参数（文本 / 文件）；
 *   3. 调用 CyberChef 自身的 window.app.manager.input.setInput() 自动填入 Input。
 *
 *   v1.0.3 起：不再自动读取剪贴板——无入口参数时 Input 保持空白，等用户自己粘贴。
 *   （preload.js 仍保留 getClipboardText 能力，供以后手动功能使用）
 *
 * 设计约束：
 *   - 不修改 CyberChef 任何业务代码，逻辑键（操作名/分类名/选项 value）保持英文；
 *   - 宿主 API 与插件 API 一律在运行时读取，不在顶层读（加载顺序不保证）；
 *   - 没有 window.ztools 时完全静默，方便直接在浏览器里打开 index.html 调试；
 *   - 任何一步失败都给出具体提示，不出现静默白屏。
 */
(function () {
  'use strict';

  var MAX_CHARS = 512 * 1024;   // 自动带入上限，避免卡死 CodeMirror
  var filled = false;           // 每次打开只带入一次

  function ztools() {
    return window.ztools || null;
  }

  // 真实宿主用 cyberchefApi（本插件 preload）；mock 测试台用 pluginApi
  function api() {
    return window.cyberchefApi || window.pluginApi || null;
  }

  function toast(message) {
    var A = api();
    try {
      if (A && typeof A.showToast === 'function' && A.showToast(String(message))) return;
    } catch (e) {
      // 落到 DOM 提示
    }
    try {
      if (!document.body) return;
      var el = document.getElementById('__cczh_toast__');
      if (!el) {
        el = document.createElement('div');
        el.id = '__cczh_toast__';
        el.style.cssText = [
          'position:fixed', 'z-index:2147483647', 'left:50%', 'bottom:18px',
          'transform:translateX(-50%)', 'background:rgba(28,34,48,.94)',
          'color:#fff', 'padding:8px 14px', 'border-radius:8px',
          'font:12px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
          'pointer-events:none', 'opacity:0', 'transition:opacity .18s',
          'max-width:80vw', 'text-align:center'
        ].join(';');
        document.body.appendChild(el);
      }
      el.textContent = String(message);
      el.style.opacity = '1';
      clearTimeout(toast._timer);
      toast._timer = setTimeout(function () { el.style.opacity = '0'; }, 2600);
    } catch (e) {
      // 提示本身失败也不影响 CyberChef
    }
  }

  // window.app 由 CyberChef 在 DOMContentLoaded 时创建，可能略晚于本脚本
  function waitApp(callback) {
    var tries = 0;
    var timer = setInterval(function () {
      var app = window.app;
      if (app && app.manager && app.manager.input &&
          typeof app.manager.input.setInput === 'function') {
        clearInterval(timer);
        callback(app);
      } else if (++tries >= 150) {
        clearInterval(timer);
        toast('CyberChef 未就绪，未能自动带入内容');
      }
    }, 100);
  }

  function setInput(text, label) {
    if (filled) return;
    if (typeof text !== 'string' || text.length === 0) return;
    if (text.length > MAX_CHARS) {
      toast('内容超过 512 KB，未自动带入，请手动粘贴');
      return;
    }
    filled = true;
    waitApp(function (app) {
      try {
        app.manager.input.setInput(text);
        // setInput 内部用 setTimeout 派发 CodeMirror change，稍后再触发 inputChange
        setTimeout(function () {
          try {
            if (typeof app.manager.input.inputChange === 'function') {
              app.manager.input.inputChange(new Event('keyup'));
            }
          } catch (e) {
            // 自动执行不是必须项，输入已带入即可
          }
        }, 150);
        toast('已带入' + label);
      } catch (e) {
        toast('自动带入失败：' + String((e && e.message) || e));
      }
    });
  }

  function fromFile(filePath) {
    var A = api();
    if (!A || typeof A.readInputFile !== 'function') {
      toast('文件读取能力不可用，请用面板内的「打开文件」按钮');
      return;
    }
    var result;
    try {
      result = A.readInputFile(filePath);
    } catch (e) {
      toast('读取失败：' + String((e && e.message) || e));
      return;
    }
    if (result && result.error) {
      toast('读取失败：' + result.error);
      return;
    }
    if (result && result.kind === 'binary') {
      setInput(result.text, '文件 ' + result.name + '（二进制已转 Base64，可用「从 Base64 解码」还原）');
      return;
    }
    if (result && result.kind === 'text') {
      setInput(result.text, '文件：' + result.name);
    }
  }

  function fromText(text) {
    var A = api();
    // 入口文本也可能本身就是一条文件路径
    try {
      var isPath = A && typeof A.exists === 'function' && A.exists(text) &&
                   (typeof A.isFile !== 'function' || A.isFile(text));
      if (isPath) { fromFile(text); return; }
    } catch (e) {
      // 判路径失败就按普通文本处理
    }
    setInput(text, '入口文本');
  }

  // payload 可能是字符串、字符串数组、对象数组或对象，全部兼容
  function normalize(payload) {
    if (typeof payload === 'string') {
      return { text: payload };
    }
    if (Array.isArray(payload) && payload.length) {
      var first = payload[0];
      var value = typeof first === 'string'
        ? first
        : (first && (first.path || first.filePath || first.value));
      if (value) return { path: String(value) };
    }
    if (payload && typeof payload === 'object') {
      var v = payload.path || payload.filePath || payload.value || payload.text;
      if (v) return { path: String(v) };
    }
    return null;
  }

  function boot() {
    var Z = ztools();
    if (!Z) return;   // 普通浏览器打开：不接管任何行为

    try {
      if (typeof Z.setExpendHeight === 'function') {
        var h = Math.min(820, Math.max(600, (window.screen.availHeight || 900) - 180));
        Z.setExpendHeight(h);
      }
    } catch (e) {
      // 高度申请失败不影响使用
    }

    if (typeof Z.onPluginEnter === 'function') {
      Z.onPluginEnter(function (param) {
        var payload = param && param.payload;
        var n = normalize(payload);
        if (n && n.path) {
          fromFile(n.path);
          return;
        }
        if (n && n.text && n.text.trim()) {
          fromText(n.text.trim());
        }
        // 无入口参数：什么都不做（v1.0.3 起不再读剪贴板）
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})();
