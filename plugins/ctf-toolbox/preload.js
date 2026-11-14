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
  hmacDigest(algorithm, text, key) {
    const digest = crypto
      .createHmac(String(algorithm || "sha256"), String(key || ""))
      .update(String(text || ""), "utf8")
      .digest();
    return new Uint8Array(digest);
  },
  rsaSign(algorithm, text, pem) {
    const map = { RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512" };
    const name = map[String(algorithm || "").toUpperCase()];
    if (!name) throw new Error("不支持的 RSA 算法");
    const sig = crypto.createSign(name).update(String(text || "")).sign(String(pem || ""));
    return new Uint8Array(sig);
  },
  copy(text) {
    if (window.ztools && typeof window.ztools.copyText === "function") {
      return window.ztools.copyText(String(text == null ? "" : text));
    }
    return false;
  }
};
