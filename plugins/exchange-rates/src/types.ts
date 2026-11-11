export type RateBook = {
  date: string;
  fetchedAt: number;
  rates: Record<string, string>;
};

export type CurrencyInfo = {
  code: string;
  deprecated: boolean;
};

export type SeriesPoint = {
  date: string;
  quote: string;
  rate: string;
};

export type Settings = {
  base: string;
  amount: string;
  digits: number;
  dark: boolean;
  darkLocked: boolean;
  showDeprecated: boolean;
  codes: string[];
};

export type FxBridge = {
  getItem(key: string): unknown;
  setItem(key: string, value: unknown): void;
  fetchRates(): Promise<RateBook>;
  fetchCurrencies(): Promise<CurrencyInfo[]>;
  fetchSeries(from: string, quotes: string[]): Promise<SeriesPoint[]>;
};
