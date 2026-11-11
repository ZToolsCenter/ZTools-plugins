import { parseCurrencies, parseLatest, parseSeries } from "../public/fx-parse.mjs";
import type { FxBridge } from "./types";

const API = "https://api.frankfurter.dev/v2";

async function getText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return text;
}

export function installBrowserFx(): FxBridge {
  const fx: FxBridge = {
    getItem(key) {
      const raw = localStorage.getItem(key);
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
    async fetchRates() {
      return parseLatest(await getText(`${API}/rates?base=eur`));
    },
    async fetchCurrencies() {
      const [current, all] = await Promise.all([
        getText(`${API}/currencies`),
        getText(`${API}/currencies?scope=all`),
      ]);
      return parseCurrencies(current, all);
    },
    async fetchSeries(from, quotes) {
      const list = quotes.map((code) => encodeURIComponent(code.toLowerCase())).join(",");
      return parseSeries(await getText(`${API}/rates?base=eur&from=${from}&quotes=${list}`));
    },
  };
  window.fx = fx;
  return fx;
}
