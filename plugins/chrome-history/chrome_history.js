const initSqlJs = require("./lib/sql-wasm");
const { readFileSync } = require("fs");
const { join } = require("path");
const { getProfilePathId } = require("./setting");

function createListItem(title, description, payload, icon) {
  return {
    title,
    description,
    payload: payload == null ? null : payload,
    icon,
  };
}

function escapeSqlValue(value) {
  return String(value).replace(/'/g, "''");
}

class ChromeHistory {
  constructor() {
    this.code = "ch";
    this.historyDB = null;
    this.faviconDB = null;
    this.history = [];
    this.lastInit = 0;
  }

  profile() {
    const item = window.ztools.db.get(getProfilePathId());
    if (item) return item.data;
    return this.getDefaultProfile();
  }

  getDefaultProfile() {
    const data = window.ztools.getPath("appData");
    switch (process.platform) {
      case "darwin":
        return join(data, "Google/Chrome/Default");
      case "win32":
        return join(data, "../Local/Google/Chrome/User Data/Default");
      case "linux":
        return join(data, "google-chrome/default");
      default:
        return "";
    }
  }

  async init() {
    const now = Date.now();
    if (this.historyDB && (now - this.lastInit) / 1000 < 30) {
      console.log("db inited, skip");
      return;
    }

    this.lastInit = now;
    const profile = this.profile();
    console.log(`init db from ${profile}`);

    const sql = await initSqlJs();
    const historyFile = readFileSync(join(profile, "History"));
    this.historyDB = new sql.Database(historyFile);

    const faviconFile = readFileSync(join(profile, "Favicons"));
    this.faviconDB = new sql.Database(faviconFile);
  }

  async enter(action) {
    await this.init();
    return this.search(action ? action.payload : "");
  }

  async search(word) {
    const queries = String(word || "")
      .trim()
      .split(/\s+/g)
      .filter((query) => query !== "");

    let items = [];
    let sql = "select * from urls";

    queries.forEach((query) => {
      const escapedQuery = escapeSqlValue(query);
      sql += sql.includes("where") ? " and " : " where ";
      sql += ` (title like '%${escapedQuery}%' or url like '%${escapedQuery}%')`;
    });

    sql += " order by last_visit_time desc limit 20";

    this.historyDB.each(
      sql,
      (row) => {
        items.push(createListItem(row.title, row.url, null, "icon/browser.png"));
      },
      () => {}
    );

    items = items.map((item) => {
      if (!String(item.description).includes("http")) return item;

      try {
        const url = new URL(item.description);
        url.search = "";
        url.pathname = "";
        const faviconSql =
          "select * from favicons " +
          "JOIN icon_mapping on icon_mapping.icon_id = favicons.id " +
          `and page_url like '${escapeSqlValue(url.toString())}%'`;

        this.faviconDB.each(
          faviconSql,
          (row) => {
            const icon = row.url;
            if (icon && icon.length > 0) item.icon = icon;
          },
          () => {}
        );
      } catch (error) {
        console.warn("parse favicon url failed", item.description, error);
      }

      return item;
    });

    if (queries.length === 0) {
      items = this.history.slice().concat(items);
    }

    return items;
  }

  select(item) {
    window.ztools.hideMainWindow(false)
    this.history.push(item);
    window.ztools.shellOpenExternal(item.description);
    window.ztools.outPlugin()
  }
}

module.exports = {
  ChromeHistory,
  createListItem,
};
