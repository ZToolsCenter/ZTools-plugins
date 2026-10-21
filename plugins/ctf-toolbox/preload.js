"use strict";

const crypto = require("crypto");

function toBuffer(input, encoding) {
  if (input instanceof Uint8Array) return Buffer.from(input);
  return Buffer.from(String(input == null ? "" : input), encoding || "utf8");
}

window.ctfToolbox = {
  hash(algorithm, text, encoding) {
    const algo = String(algorithm || "md5").toLowerCase();
    const buf = toBuffer(text, encoding || "utf8");
    return crypto.createHash(algo).update(buf).digest("hex");
  },
  hmac(algorithm, text, key) {
    return crypto
      .createHmac(String(algorithm || "sha256"), String(key || ""))
      .update(String(text || ""), "utf8")
      .digest("hex");
  },
  copy(text) {
    if (window.ztools && typeof window.ztools.copyText === "function") {
      return window.ztools.copyText(String(text == null ? "" : text));
    }
    return false;
  }
};
