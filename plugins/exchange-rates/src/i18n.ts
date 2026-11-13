export type Locale = "zh-Hant" | "en";

export type Messages = {
  digits: string;
  select: string;
  addAll: string;
  deprecated: string;
  dark: string;
  updated: string;
  index: string;
  flag: string;
  name: string;
  code: string;
  symbol: string;
  amount: string;
  action: string;
  trend: string;
  remove: string;
  noRate: string;
  already: string;
  change: string;
  chart: string;
  ratesFailed: string;
  blocks: string[];
};

const zh: Messages = {
  digits: "小數位數",
  select: "選擇貨幣",
  addAll: "添加全部",
  deprecated: "顯示已廢棄的貨幣",
  dark: "深色模式",
  updated: "匯率更新時間",
  index: "序號",
  flag: "國旗",
  name: "國家名稱",
  code: "代碼",
  symbol: "符號",
  amount: "折算金額",
  action: "操作",
  trend: "趨勢",
  remove: "移除",
  noRate: "無匯率",
  already: "貨幣已參與計算",
  change: "變動（較上一個觀測日）",
  chart: "圖表（近 30 個觀測日）",
  ratesFailed: "匯率更新失敗，畫面仍用上次的資料",
  blocks: ["不可以哦～", "基準貨幣要留著", "這個不能移除", "先換一個基準吧", "它正在當基準"],
};

const en: Messages = {
  digits: "Decimal places",
  select: "Select currency",
  addAll: "Add all",
  deprecated: "Show deprecated currencies",
  dark: "Dark mode",
  updated: "Rates updated",
  index: "No.",
  flag: "Flag",
  name: "Name",
  code: "Code",
  symbol: "Symbol",
  amount: "Amount",
  action: "Action",
  trend: "Trend",
  remove: "Remove",
  noRate: "No rate",
  already: "Already in the calculation",
  change: "Change (vs previous observation)",
  chart: "Chart (last 30 observations)",
  ratesFailed: "Couldn't update rates. Showing the last saved data.",
  blocks: [
    "Not this one~",
    "Keep the base currency",
    "This one stays",
    "Switch the base first",
    "It's the base right now",
  ],
};

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith("zh") ? "zh-Hant" : "en";
}

export function messages(locale: Locale): Messages {
  return locale === "zh-Hant" ? zh : en;
}
