function objects(text) {
  const found = [];
  const re = /\{[^{}]*\}/g;
  let match;
  while ((match = re.exec(text))) {
    const obj = match[0];
    const quote = /"quote"\s*:\s*"([^"]+)"/.exec(obj);
    const rate = /"rate"\s*:\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?\d+)?)/.exec(obj);
    const date = /"date"\s*:\s*"([^"]+)"/.exec(obj);
    if (!quote || !rate) continue;
    found.push({
      date: date ? date[1] : "",
      quote: quote[1].toUpperCase(),
      rate: rate[1],
    });
  }
  return found;
}

export function parseLatest(text) {
  const rows = objects(text);
  const rates = {};
  let date = "";
  for (const row of rows) {
    rates[row.quote] = row.rate;
    if (row.date > date) date = row.date;
  }
  if (!rates.EUR) rates.EUR = "1";
  return { date, fetchedAt: Date.now(), rates };
}

function isoCodes(text) {
  const codes = [];
  const re = /"iso_code"\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(text))) codes.push(match[1].toUpperCase());
  return codes;
}

export function parseCurrencies(currentText, allText) {
  const current = new Set(isoCodes(currentText));
  const all = isoCodes(allText);
  const seen = new Set();
  const list = [];
  const source = all.length ? all : [...current];
  for (const code of source) {
    if (seen.has(code)) continue;
    seen.add(code);
    list.push({ code, deprecated: !current.has(code) });
  }
  for (const code of current) {
    if (seen.has(code)) continue;
    list.push({ code, deprecated: false });
  }
  return list;
}

export function parseSeries(text) {
  return objects(text);
}
