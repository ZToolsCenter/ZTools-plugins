/**
 * 汉字转拼音插件 —— UI 交互逻辑
 * 依赖：vendor/pinyin-pro.js（window.pinyinPro）、converter.js（window.PinyinConverter）
 */
(function () {
  'use strict';

  var STORE_KEY = 'ztools-hanzi-pinyin-config';

  var inputEl = document.getElementById('input');
  var resultEl = document.getElementById('result');
  var modeSwitch = document.getElementById('modeSwitch');
  var panelMode1 = document.getElementById('panel-mode1');
  var panelMode2 = document.getElementById('panel-mode2');
  var copyBtn = document.getElementById('copyBtn');
  var clearBtn = document.getElementById('clearBtn');
  var clearInputBtn = document.getElementById('clearInputBtn');
  var themeToggle = document.getElementById('themeToggle');
  var toastEl = document.getElementById('toast');

  var currentMode = 'mode1';

  // 受持久化管控的字段
  var SELECT_FIELDS = ['caseMode', 'toneMode', 'resultMode', 'nonHanMode', 'formatMode'];
  var CHECK_FIELDS = ['rmSpacing', 'rmNewline', 'uvToV', 'surname'];

  function fieldValue(name) {
    var el = document.querySelector('[name="' + name + '"]');
    return el ? el.value : '';
  }

  function checkboxChecked(name) {
    var el = document.querySelector('input[name="' + name + '"]');
    return !!(el && el.checked);
  }

  function readConfig() {
    if (currentMode === 'mode2') {
      return {
        mode: 'mode2',
        formatMode: fieldValue('formatMode') || 'camel'
      };
    }
    return {
      mode: 'mode1',
      caseMode: fieldValue('caseMode') || 'lower',
      toneMode: fieldValue('toneMode') || 'none',
      resultMode: fieldValue('resultMode') || 'pinyin',
      nonHanMode: fieldValue('nonHanMode') || 'normal',
      rmSpacing: checkboxChecked('rmSpacing'),
      rmNewline: checkboxChecked('rmNewline'),
      uvToV: checkboxChecked('uvToV'),
      surname: checkboxChecked('surname')
    };
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.mode === 'mode1' || cfg.mode === 'mode2') {
      currentMode = cfg.mode;
    }
    SELECT_FIELDS.forEach(function (name) {
      if (cfg[name] != null) {
        var el = document.querySelector('[name="' + name + '"]');
        if (el) el.value = cfg[name];
      }
    });
    CHECK_FIELDS.forEach(function (name) {
      if (cfg[name] != null) {
        var el = document.querySelector('input[name="' + name + '"]');
        if (el) el.checked = !!cfg[name];
      }
    });
    setMode(currentMode);
  }

  function saveConfig() {
    var cfg = readConfig();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
    } catch (e) {
      /* 忽略隐私模式等存储异常 */
    }
  }

  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* 忽略解析异常 */
    }
    return null;
  }

  function render() {
    var text = inputEl.value;
    var cfg = readConfig();
    var out = '';
    try {
      out = window.PinyinConverter.convert(text, cfg);
    } catch (e) {
      out = '转换出错：' + (e && e.message ? e.message : e);
    }
    resultEl.value = out;
  }

  function setMode(mode) {
    currentMode = mode;
    var btns = modeSwitch.querySelectorAll('.mode-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    panelMode1.classList.toggle('hidden', mode !== 'mode1');
    panelMode2.classList.toggle('hidden', mode !== 'mode2');
    render();
  }

  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', !!dark);
    try {
      localStorage.setItem(STORE_KEY + '-theme', dark ? 'dark' : 'light');
    } catch (e) {}
  }

  function loadTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem(STORE_KEY + '-theme');
    } catch (e) {}
    if (saved === 'dark' || saved === 'light') {
      applyTheme(saved === 'dark');
    } else {
      applyTheme(false);
    }
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(function () {
      toastEl.classList.remove('show');
    }, 1500);
  }

  function copyResult() {
    var text = resultEl.value;
    if (!text) {
      showToast('没有可复制的内容');
      return;
    }
    if (window.ztools && typeof window.ztools.copyText === 'function') {
      window.ztools.copyText(text);
      showToast('已复制');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          showToast('已复制');
        },
        function () {
          fallbackCopy(text);
        }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    resultEl.removeAttribute('readonly');
    resultEl.select();
    try {
      document.execCommand('copy');
      showToast('已复制');
    } catch (e) {
      showToast('复制失败');
    }
    resultEl.setAttribute('readonly', 'readonly');
    window.getSelection().removeAllRanges();
  }

  // 事件绑定
  inputEl.addEventListener('input', render);

  // 所有配置项变化实时重算并保存
  document.addEventListener('change', function (e) {
    if (e.target && e.target.name) {
      render();
      saveConfig();
    }
  });

  modeSwitch.addEventListener('click', function (e) {
    var btn = e.target.closest('.mode-btn');
    if (btn) {
      setMode(btn.getAttribute('data-mode'));
      saveConfig();
    }
  });

  themeToggle.addEventListener('click', function () {
    applyTheme(!document.documentElement.classList.contains('dark'));
  });

  copyBtn.addEventListener('click', copyResult);
  clearBtn.addEventListener('click', function () {
    inputEl.value = '';
    resultEl.value = '';
    inputEl.focus();
  });
  clearInputBtn.addEventListener('click', function () {
    inputEl.value = '';
    render();
    inputEl.focus();
  });

  // 接入 Ztools：进入插件时带入主搜索框文本
  if (window.ztools && typeof window.ztools.onPluginEnter === 'function') {
    window.ztools.onPluginEnter(function (param) {
      if (param && param.payload != null) {
        inputEl.value = String(param.payload);
        render();
      }
    });
  }

  // 初始化：先应用主题与上次配置，再渲染
  loadTheme();
  applyConfig(loadConfig());
  render();
})();
