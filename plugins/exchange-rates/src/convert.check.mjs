import {
  appendMissing,
  canonicalAmount,
  commitRowAmount,
  convertAmount,
  formatAmount,
  formatPercent,
  moveItem,
  reselectCurrency,
} from "./convert.ts";
import { parseCurrencies, parseLatest } from "../public/fx-parse.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rates = { EUR: "1", USD: "2", JPY: "200" };

assert(convertAmount("10.50", "USD", "USD", rates) === "10.5", "base to itself keeps the amount");
assert(convertAmount("2", "USD", "EUR", rates) === "1", "cross rate uses the euro pivot");
assert(convertAmount("1", "USD", "ZZZ", rates) === null, "missing rate is empty");
assert(formatAmount("1.005", 2) === "1.01", "half up at the display digit");
assert(formatAmount("1.004", 2) === "1.00", "below half stays down");
assert(formatAmount("0", 2) === "0.00", "zero pads to the selected digits");
assert(formatPercent("1", "1.002897") === "+0.2897%", "percent keeps four digits and a sign");
assert(formatPercent("2", "1") === "-50.0000%", "a drop is negative");

const board = { base: "USD", amount: "0", codes: ["CNY", "USD", "EUR", "JPY", "HKD", "TWD"] };
const committed = commitRowAmount(board, "JPY", "10.50");
assert(committed?.base === "JPY" && committed.amount === "10.5", "committing another row switches the base");
assert(committed.codes.includes("JPY") && committed.codes.includes("USD"), "the switched currency stays in the list");
assert(commitRowAmount(board, "USD", "nope") === null, "a bad amount does not commit");

const switched = reselectCurrency(
  { base: "USD", amount: "2", codes: ["USD", "EUR"] },
  "EUR",
  rates,
);
assert(switched?.base === "EUR" && switched.amount === "1", "reselect keeps the money value");
assert(canonicalAmount("00.50") === "0.5", "canonical amount strips extra zeros");

const added = appendMissing(["CNY"], ["USD", "CNY", "EUR"]);
assert(added.join() === "CNY,USD,EUR", "add all skips codes already in the list");
assert(moveItem(["A", "B", "C"], 0, 2).join() === "B,C,A", "drag moves a row");

const parsed = parseLatest(
  '[{"date":"2026-11-10","base":"EUR","quote":"IRR","rate":0.00000054341},{"date":"2026-11-09","base":"EUR","quote":"EUR","rate":1}]',
);
assert(parsed.rates.IRR === "0.00000054341", "rate text keeps every fraction digit");
assert(parsed.date === "2026-11-10", "update date is the newest observation");

const currencies = parseCurrencies(
  '[{"iso_code":"USD","name":"US Dollar"}]',
  '[{"iso_code":"USD"},{"iso_code":"DEM"}]',
);
assert(currencies.find((item) => item.code === "DEM")?.deprecated === true, "legacy code is deprecated");
assert(currencies.find((item) => item.code === "USD")?.deprecated === false, "current code stays available");

console.log("convert.check ok");
