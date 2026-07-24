const { ChromeHistory } = require("./chrome_history");
const { Setting } = require("./setting");

function createErrorItems(error) {
  const message = error && error.message ? error.message : String(error);
  return [
    {
      title: message,
      description: message,
      icon: "icon/browser.png",
    },
  ];
}

function createFeature(plugin) {
  const mode = plugin.mode || "list";
  const placeholder = plugin.placeholder || "请输入关键词查询";
  const delay = typeof plugin.delay === "number" ? plugin.delay : 500;
  let searchTimer = null;

  async function runWithCallback(work, callbackSetList) {
    try {
      const items = await work();
      if (items && typeof callbackSetList === "function") callbackSetList(items);
    } catch (error) {
      console.error(error);
      if (typeof callbackSetList === "function") {
        callbackSetList(createErrorItems(error));
      }
    }
  }

  return {
    mode,
    args: {
      placeholder,
      enter(action, callbackSetList) {
        if (typeof plugin.enter === "function") {
          runWithCallback(() => plugin.enter(action), callbackSetList);
          return;
        }

        if (mode !== "none" && typeof plugin.search === "function") {
          runWithCallback(() => plugin.search("", action), callbackSetList);
        }
      },
      search(action, word, callbackSetList) {
        if (typeof plugin.search !== "function") return;

        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          runWithCallback(() => plugin.search(word, action), callbackSetList);
        }, delay);
      },
      select(action, item, callbackSetList) {
        if (typeof plugin.select !== "function") return;
        runWithCallback(() => plugin.select(item, action), callbackSetList);
      },
    },
  };
}

function normalizeOption(option) {
  return {
    title: option.text,
    description: option.title,
    payload: null,
    icon: option.icon,
  };
}

function normalizeDedupUrl(description) {
  try {
    const url = new URL(description);
    url.search = "";
    return url.toString();
  } catch (error) {
    return String(description);
  }
}

const ch = new ChromeHistory();
const setting = new Setting();

window.exports = {
  [ch.code]: createFeature(ch),
  [setting.code]: createFeature(setting),
};

async function callback(action) {
  if (ch.code !== action.code || action.type !== "over") return [];

  try {
    let items = await ch.enter(action);
    const dedupMap = new Map();

    items = items.filter((item) => {
      const dedupUrl = normalizeDedupUrl(item.description);
      return !dedupMap.has(dedupUrl) && dedupMap.set(dedupUrl, true);
    });

    return items.map((item) => ({
      title: item.description,
      icon: item.icon,
      text: `${item.title} - ${item.description}`,
    }));
  } catch (error) {
    console.error(error);
    return createErrorItems(error).map((item) => ({
      title: item.description,
      icon: item.icon,
      text: item.title,
    }));
  }
}

function selectCallback(action) {
  ch.select(normalizeOption(action.option));
  return false;
}

window.ztools.onMainPush(callback, selectCallback);
