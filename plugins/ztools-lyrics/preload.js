// preload.js —— 歌词搜索插件
// 职责：通过 Node.js https 联网（渲染层有 CORS 限制），向前端暴露 window.lyricApi
// 数据源：网易云音乐（主）、lrclib.net（兜底）

const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 通用 GET/POST，自动处理 gzip，返回 utf-8 字符串
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      let stream = res;
      const encoding = (res.headers["content-encoding"] || "").toLowerCase();
      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      stream.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("网络请求超时")));
    if (body) req.write(body);
    req.end();
  });
}

function getJSON(url, headers) {
  return httpRequest({ method: "GET", headers: { "User-Agent": UA, ...(headers || {}) }, hostname: "", ...parseUrl(url) }).then((text) =>
    JSON.parse(text)
  );
}

// Node 需要拆分 hostname/path，这里做一次简单拆分
function parseUrl(url) {
  const u = new URL(url);
  return { hostname: u.hostname, path: u.pathname + u.search, port: u.port || 443 };
}

// ---------- 网易云音乐 ----------

function searchNetEase(keyword) {
  const body = "s=" + encodeURIComponent(keyword) + "&type=1&limit=30&offset=0";
  const opts = {
    ...parseUrl("https://music.163.com/api/search/get/"),
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
      Referer: "https://music.163.com",
    },
  };
  return httpRequest(opts, body).then((text) => {
    const data = JSON.parse(text);
    const songs = (data.result && data.result.songs) || [];
    return songs.map((s) => ({
      source: "netease",
      id: String(s.id),
      name: s.name,
      artists: (s.artists || []).map((a) => a.name).join(" / "),
      album: (s.album && s.album.name) || "",
    }));
  });
}

function getNetEaseLyric(id) {
  const url =
    "https://music.163.com/api/song/lyric?os=pc&id=" + encodeURIComponent(id) + "&lv=-1&kv=-1&tv=-1";
  return getJSON(url, { Referer: "https://music.163.com" }).then((data) => ({
    lrc: (data.lrc && data.lrc.lyric) || "",
    translation: (data.tlyric && data.tlyric.lyric) || "",
  }));
}

// ---------- lrclib.net（兜底，无需鉴权） ----------

function searchLrclib(keyword) {
  const url = "https://lrclib.net/api/search?q=" + encodeURIComponent(keyword) + "&limit=20";
  return getJSON(url, { "Lrclib-Client": "ZTools-Lyrics (https://github.com/ZToolsCenter)" }).then((list) =>
    (Array.isArray(list) ? list : []).slice(0, 20).map((t) => ({
      source: "lrclib",
      id: "lrclib-" + t.id,
      name: t.trackName,
      artists: t.artistName,
      album: t.albumName || "",
      // lrclib 搜索结果自带歌词，无需二次请求
      lrc: t.syncedLyrics || "",
      plain: t.plainLyrics || "",
    }))
  );
}

// ---------- 对前端暴露的 API ----------

// 搜索歌曲：网易云优先，失败或无结果时用 lrclib 兜底
async function search(keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];
  let results = [];
  let neteaseError = null;
  try {
    results = await searchNetEase(kw);
  } catch (e) {
    neteaseError = e;
  }
  if (results.length === 0) {
    try {
      results = await searchLrclib(kw);
    } catch (e) {
      // 两个源都失败时，优先抛出网易云的错误信息
      throw neteaseError || e;
    }
  }
  return results;
}

// 获取歌词：lrclib 结果自带歌词，直接返回
async function getLyric(song) {
  if (song && song.source === "lrclib") {
    return { lrc: song.lrc || "", translation: "", plain: song.plain || "" };
  }
  return getNetEaseLyric(song.id);
}

// 保存歌词为 TXT
function saveTextFile(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}

window.lyricApi = {
  search,
  getLyric,
  saveTextFile,
};
