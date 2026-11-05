(function () {
  "use strict";

  var z = window.ztools || window.utools || null;
  var $ = function (id) { return document.getElementById(id); };

  if (z && typeof z.setExpendHeight === "function") z.setExpendHeight(720);

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 1200);
  }

  function copyText(text) {
    var s = String(text == null ? "" : text);
    if (window.ctfToolbox && window.ctfToolbox.copy(s)) {
      toast("已复制");
      return;
    }
    if (z && typeof z.copyText === "function" && z.copyText(s)) {
      toast("已复制");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(function () { toast("已复制"); });
      return;
    }
    toast("复制失败");
  }

  var ENCODE_OPS = [
    { id: "base64_encode", label: "Base64 编码" },
    { id: "base64_decode", label: "Base64 解码" },
    { id: "base64url_encode", label: "Base64URL 编码" },
    { id: "base64url_decode", label: "Base64URL 解码" },
    { id: "hex_encode", label: "Hex 编码" },
    { id: "hex_decode", label: "Hex 解码" },
    { id: "url_encode", label: "URL 编码" },
    { id: "url_decode", label: "URL 解码" },
    { id: "html_encode", label: "HTML 实体编码" },
    { id: "html_decode", label: "HTML 实体解码" },
    { id: "unicode_encode", label: "Unicode \\u 编码" },
    { id: "unicode_decode", label: "Unicode 解码" },
    { id: "base32_encode", label: "Base32 编码" },
    { id: "base32_decode", label: "Base32 解码" },
    { id: "base58_encode", label: "Base58 编码" },
    { id: "base58_decode", label: "Base58 解码" },
    { id: "binary_encode", label: "二进制编码" },
    { id: "binary_decode", label: "二进制解码" },
    { id: "qp_encode", label: "Quoted-Printable 编码" },
    { id: "qp_decode", label: "Quoted-Printable 解码" },
    { id: "rot13", label: "ROT13" },
    { id: "caesar", label: "Caesar 位移" },
    { id: "morse_encode", label: "Morse 编码" },
    { id: "morse_decode", label: "Morse 解码" }
  ];

  var TABS = ["encode", "hash", "jwt", "cipher", "php-bypass", "payload"];

  function switchTab(name) {
    if (TABS.indexOf(name) < 0) name = "encode";
    document.querySelectorAll(".nav button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === name);
    });
    document.querySelectorAll(".panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.id === "panel-" + name);
    });
  }

  function fillOps() {
    var sel = $("encode-op");
    ENCODE_OPS.forEach(function (op) {
      var opt = document.createElement("option");
      opt.value = op.id;
      opt.textContent = op.label;
      sel.appendChild(opt);
    });
  }

  function renderDetect(text) {
    var box = $("encode-detect");
    box.innerHTML = "";
    var hits = window.CtfCodec.detect(text);
    if (!hits.length) return;
    hits.forEach(function (hit) {
      var chip = document.createElement("button");
      chip.className = "chip";
      chip.type = "button";
      chip.textContent = "识别到 " + hit.label;
      chip.addEventListener("click", function () {
        var map = {
          jwt: function () { switchTab("jwt"); $("jwt-in").value = text; renderJwt(); },
          base64: "base64_decode",
          base32: "base32_decode",
          hex: "hex_decode",
          url: "url_decode",
          unicode: "unicode_decode",
          html: "html_decode",
          morse: "morse_decode",
          binary: "binary_decode"
        };
        var mapped = map[hit.id];
        if (typeof mapped === "function") mapped();
        else if (mapped) {
          $("encode-op").value = mapped;
          runEncode();
        }
      });
      box.appendChild(chip);
    });
  }

  function runEncode() {
    var input = $("encode-in").value;
    var op = $("encode-op").value;
    $("caesar-wrap").hidden = op !== "caesar";
    renderDetect(input);
    if (!input) {
      $("encode-out").textContent = "";
      return;
    }
    try {
      var extra = { shift: Number($("caesar-shift").value || 0) };
      $("encode-out").textContent = window.CtfCodec.run(op, input, extra);
    } catch (err) {
      $("encode-out").textContent = "错误：" + (err && err.message ? err.message : err);
    }
  }

  async function runHash() {
    var input = $("hash-in").value;
    var algos = [
      ["MD5", "MD5"],
      ["SHA-1", "SHA-1"],
      ["SHA-256", "SHA-256"],
      ["SHA-512", "SHA-512"]
    ];
    var box = $("hash-out");
    box.innerHTML = "";
    if (!input) return;
    for (var i = 0; i < algos.length; i++) {
      var card = document.createElement("div");
      card.className = "card hash-item";
      var title = document.createElement("b");
      title.textContent = algos[i][0];
      var code = document.createElement("code");
      try {
        code.textContent = await window.CtfCodec.digest(algos[i][1], input);
      } catch (err) {
        code.textContent = err.message || String(err);
      }
      var btn = document.createElement("button");
      btn.className = "btn";
      btn.type = "button";
      btn.textContent = "复制";
      btn.addEventListener("click", function (el) {
        return function () { copyText(el.textContent); };
      }(code));
      card.appendChild(title);
      card.appendChild(code);
      card.appendChild(btn);
      box.appendChild(card);
    }
    var hmacKey = $("hmac-key").value;
    if (hmacKey && window.ctfToolbox && window.ctfToolbox.hmac) {
      var hmacCard = document.createElement("div");
      hmacCard.className = "card hash-item";
      hmacCard.innerHTML = "<b>HMAC-SHA256</b>";
      var hmacCode = document.createElement("code");
      hmacCode.textContent = window.ctfToolbox.hmac("sha256", input, hmacKey);
      var hmacBtn = document.createElement("button");
      hmacBtn.className = "btn";
      hmacBtn.type = "button";
      hmacBtn.textContent = "复制";
      hmacBtn.addEventListener("click", function () { copyText(hmacCode.textContent); });
      hmacCard.appendChild(hmacCode);
      hmacCard.appendChild(hmacBtn);
      box.appendChild(hmacCard);
    }
  }

  function pretty(obj) {
    return JSON.stringify(obj, null, 2);
  }

  function renderJwt() {
    var token = $("jwt-in").value.trim();
    if (!token) {
      $("jwt-header").textContent = "";
      $("jwt-payload").textContent = "";
      $("jwt-sig").textContent = "";
      return;
    }
    try {
      var parsed = window.CtfCodec.jwtSplit(token);
      $("jwt-header").textContent = parsed.header.json ? pretty(parsed.header.json) : parsed.header.raw;
      $("jwt-payload").textContent = parsed.payload.json ? pretty(parsed.payload.json) : parsed.payload.raw;
      $("jwt-sig").textContent = parsed.signature || "(无签名)";
    } catch (err) {
      $("jwt-header").textContent = "错误：" + err.message;
      $("jwt-payload").textContent = "";
      $("jwt-sig").textContent = "";
    }
  }

  function runCipher() {
    var text = $("cipher-in").value;
    var shift = Number($("cipher-shift").value || 0);
    var rows = Number($("rail-count").value || 2);
    $("cipher-rot").textContent = window.CtfCodec.rotN(text, shift);
    $("cipher-rot13").textContent = window.CtfCodec.rotN(text, 13);
    $("cipher-rail").textContent = railFence(text, rows);
  }

  function railFence(text, rails) {
    rails = Math.max(2, Math.min(12, rails | 0));
    var s = String(text || "");
    if (!s) return "";
    var fence = [];
    var i;
    for (i = 0; i < rails; i++) fence[i] = [];
    var row = 0;
    var dir = 1;
    for (i = 0; i < s.length; i++) {
      fence[row].push(s[i]);
      row += dir;
      if (row === 0 || row === rails - 1) dir *= -1;
    }
    return fence.map(function (r) { return r.join(""); }).join("");
  }

  var currentCat = 0;
  function renderPayloadCats(keyword) {
    var cats = window.CtfPayloads || [];
    var list = $("payload-cats");
    list.innerHTML = "";
    cats.forEach(function (cat, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = cat.name;
      btn.className = idx === currentCat ? "active" : "";
      btn.addEventListener("click", function () {
        currentCat = idx;
        renderPayloadCats($("payload-q").value);
        renderPayloadItems($("payload-q").value);
      });
      list.appendChild(btn);
    });
    renderPayloadItems(keyword);
  }

  function renderPayloadItems(keyword) {
    var q = String(keyword || "").toLowerCase();
    var cat = (window.CtfPayloads || [])[currentCat];
    var box = $("payload-items");
    box.innerHTML = "";
    if (!cat) return;
    var note = document.createElement("div");
    note.className = "item";
    note.innerHTML = "<h3>" + cat.name + "</h3><p>" + cat.note + "</p>";
    box.appendChild(note);
    cat.items.filter(function (item) {
      if (!q) return true;
      return (item.title + item.payload + item.desc + cat.name).toLowerCase().indexOf(q) >= 0;
    }).forEach(function (item) {
      var wrap = document.createElement("div");
      wrap.className = "item";
      var h = document.createElement("h3");
      h.textContent = item.title;
      var p = document.createElement("p");
      p.textContent = item.desc;
      var pre = document.createElement("pre");
      pre.textContent = item.payload;
      var actions = document.createElement("div");
      actions.className = "item-actions";
      var copyBtn = document.createElement("button");
      copyBtn.className = "btn primary";
      copyBtn.type = "button";
      copyBtn.textContent = "复制 Payload";
      copyBtn.addEventListener("click", function () { copyText(item.payload); });
      var sendBtn = document.createElement("button");
      sendBtn.className = "btn";
      sendBtn.type = "button";
      sendBtn.textContent = "送到编码器";
      sendBtn.addEventListener("click", function () {
        switchTab("encode");
        $("encode-in").value = item.payload;
        runEncode();
      });
      actions.appendChild(copyBtn);
      actions.appendChild(sendBtn);
      wrap.appendChild(h);
      wrap.appendChild(p);
      wrap.appendChild(pre);
      wrap.appendChild(actions);
      box.appendChild(wrap);
    });
  }

  function bind() {
    fillOps();
    document.querySelectorAll(".nav button").forEach(function (btn) {
      btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
    });
    ["encode-in", "encode-op", "caesar-shift"].forEach(function (id) {
      $(id).addEventListener("input", runEncode);
      $(id).addEventListener("change", runEncode);
    });
    $("encode-copy").addEventListener("click", function () { copyText($("encode-out").textContent); });
    $("encode-swap").addEventListener("click", function () {
      $("encode-in").value = $("encode-out").textContent;
      runEncode();
    });
    $("encode-clear").addEventListener("click", function () {
      $("encode-in").value = "";
      $("encode-out").textContent = "";
      $("encode-detect").innerHTML = "";
    });
    $("hash-in").addEventListener("input", function () { runHash(); });
    $("hmac-key").addEventListener("input", function () { runHash(); });
    $("jwt-in").addEventListener("input", renderJwt);
    $("jwt-copy-payload").addEventListener("click", function () { copyText($("jwt-payload").textContent); });
    ["cipher-in", "cipher-shift", "rail-count"].forEach(function (id) {
      $(id).addEventListener("input", runCipher);
    });
    $("payload-q").addEventListener("input", function () {
      renderPayloadCats($("payload-q").value);
    });
    $("php-gen-btn").addEventListener("click", renderPhpBypass);
    ["php-gen-fn", "php-gen-arg"].forEach(function (id) {
      $(id).addEventListener("input", renderPhpBypass);
      $(id).addEventListener("keydown", function (e) {
        if (e.key === "Enter") renderPhpBypass();
      });
    });
    $("php-example").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-fn]");
      if (!btn) return;
      $("php-gen-fn").value = btn.getAttribute("data-fn") || "phpinfo";
      $("php-gen-arg").value = btn.getAttribute("data-arg") || "";
      renderPhpBypass();
    });
    renderPayloadCats("");
    renderPhpBypass();
    switchTab("encode");
  }

  function renderPhpBypass() {
    var fn = $("php-gen-fn").value.trim() || "phpinfo";
    var arg = $("php-gen-arg").value;
    var box = $("php-gen-out");
    box.innerHTML = "";
    try {
      var bundle = window.CtfCodec.phpBypassBundle(fn, arg);
      var hint = arg
        ? "当前示例：构造 " + fn + "(" + JSON.stringify(arg) + ")，把结果作为 $code 交给 eval。"
        : "当前示例：构造 " + fn + "()，把结果作为 $code 交给 eval。";
      var rows = [
        ["取反  ·  " + hint, bundle.notCall],
        ["异或（每个字节 ^ 0x60）", bundle.xorFn],
        ["或（低 5 位 | 0x60）", bundle.orFn],
        ["自增（[].'' 取出 A 再 ++）", bundle.increment]
      ];
      rows.forEach(function (row) {
        var card = document.createElement("div");
        card.className = "card hash-item";
        var title = document.createElement("b");
        title.textContent = row[0];
        var code = document.createElement("code");
        code.textContent = row[1];
        var btn = document.createElement("button");
        btn.className = "btn";
        btn.type = "button";
        btn.textContent = "复制";
        btn.addEventListener("click", function () { copyText(row[1]); });
        card.appendChild(title);
        card.appendChild(code);
        card.appendChild(btn);
        box.appendChild(card);
      });
    } catch (err) {
      box.textContent = "构造失败：" + (err && err.message ? err.message : err);
    }
  }

  function applyEnter(action) {
    var code = action && action.code ? action.code : "toolbox";
    var payload = action && typeof action.payload === "string" ? action.payload : "";
    var fromRegex = action && action.type === "regex";
    if (code === "hash") {
      switchTab("hash");
      if (fromRegex) $("hash-in").value = payload;
      runHash();
      return;
    }
    if (code === "jwt") {
      switchTab("jwt");
      if (payload && (fromRegex || payload.indexOf("eyJ") === 0)) {
        $("jwt-in").value = payload.trim();
        renderJwt();
      }
      return;
    }
    if (code === "php-bypass") {
      switchTab("php-bypass");
      renderPhpBypass();
      return;
    }
    if (code === "payload") {
      switchTab("payload");
      if (payload && !fromRegex) {
        var keywordMap = {
          "无字母rce": "取反",
          "取反绕过": "取反",
          "异或绕过": "异或",
          "自增绕过": "自增",
          "payload库": ""
        };
        $("payload-q").value = keywordMap.hasOwnProperty(payload) ? keywordMap[payload] : payload;
        var cats = window.CtfPayloads || [];
        for (var i = 0; i < cats.length; i++) {
          if (cats[i].id === "php-rce-bypass" && /取反|异或|自增|无字母|rce/i.test($("payload-q").value + payload)) {
            currentCat = i;
            break;
          }
        }
      }
      renderPayloadCats($("payload-q").value);
      return;
    }
    switchTab("encode");
    if (fromRegex && payload) {
      $("encode-in").value = payload;
      if (code === "encode" || code === "toolbox") {
        var hits = window.CtfCodec.detect(payload);
        if (hits[0] && hits[0].id === "jwt") {
          switchTab("jwt");
          $("jwt-in").value = payload;
          renderJwt();
          return;
        }
      }
      runEncode();
    }
  }

  bind();
  if (z && typeof z.onPluginEnter === "function") z.onPluginEnter(applyEnter);
})();
