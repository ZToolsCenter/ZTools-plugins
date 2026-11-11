"use strict";

const https = require("https");

const API = "https://api.frankfurter.dev/v2";

function getText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { accept: "application/json" } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve(getText(new URL(res.headers.location, url).href));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (status !== 200) {
          const error = new Error("HTTP " + status);
          error.status = status;
          error.retryAfter = res.headers["retry-after"] || "";
          error.body = text.slice(0, 300);
          reject(error);
          return;
        }
        resolve(text);
      });
    });
    req.on("error", reject);
  });
}

function storageGet(key) {
  try {
    if (window.ztools && window.ztools.dbStorage) return window.ztools.dbStorage.getItem(key);
  } catch (error) {
    console.error(error);
  }
  return null;
}

function storageSet(key, value) {
  try {
    if (window.ztools && window.ztools.dbStorage) window.ztools.dbStorage.setItem(key, value);
  } catch (error) {
    console.error(error);
  }
}

window.fx = {
  getItem: storageGet,
  setItem: storageSet,
  async fetchRates() {
    const { parseLatest } = await import("./fx-parse.mjs");
    return parseLatest(await getText(API + "/rates?base=eur"));
  },
  async fetchCurrencies() {
    const { parseCurrencies } = await import("./fx-parse.mjs");
    const current = await getText(API + "/currencies");
    const all = await getText(API + "/currencies?scope=all");
    return parseCurrencies(current, all);
  },
  async fetchSeries(from, quotes) {
    const { parseSeries } = await import("./fx-parse.mjs");
    const list = quotes.map((code) => encodeURIComponent(String(code).toLowerCase())).join(",");
    const text = await getText(API + "/rates?base=eur&from=" + from + "&quotes=" + list);
    return parseSeries(text);
  },
};
