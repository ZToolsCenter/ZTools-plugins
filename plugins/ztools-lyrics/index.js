// index.js —— 歌词搜索前端逻辑
// 依赖 preload.js 暴露的 window.lyricApi 和 ZTools 全局对象 window.ztools

const zt = window.ztools;
const api = window.lyricApi;

// ---------- 全局状态 ----------
let searchTimer = null;
let results = []; // 当前搜索结果列表
let currentSong = null; // 正在查看歌词的歌曲
let currentLyric = null; // { lines: [{time, text, trans}], raw }
let favorites = [];

const $ = (sel) => document.querySelector(sel);
const input = $("#search-input");
const listStatus = $("#list-status");
const songList = $("#song-list");
const viewList = $("#view-list");
const viewLyric = $("#view-lyric");

// ---------- 工具 ----------

function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 1200);
}

// 解析 LRC：一行可能带多个时间戳，返回按时间排序的 [{time, text}]
function parseLrc(lrcText) {
  const lines = [];
  const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  for (const raw of String(lrcText || "").split("\n")) {
    re.lastIndex = 0;
    const stamps = [];
    let m;
    while ((m = re.exec(raw))) {
      stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]));
    }
    const text = raw.replace(re, "").trim();
    if (stamps.length === 0 && !text) continue;
    if (stamps.length === 0) stamps.push(Infinity); // 无时间戳的行排到最后
    for (const t of stamps) lines.push({ time: t, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// 解析翻译 LRC，返回 time -> text 的 Map
function parseTranslation(tlText) {
  const map = new Map();
  const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  for (const raw of String(tlText || "").split("\n")) {
    re.lastIndex = 0;
    const m = re.exec(raw);
    if (!m) continue;
    const time = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    const text = raw.replace(re, "").trim();
    if (text) map.set(time, text);
  }
  return map;
}

// ---------- 数据 ----------

function loadFavorites() {
  try {
    favorites = zt.dbStorage.getItem("lyrics_favorites") || [];
  } catch (e) {
    favorites = [];
  }
}

function saveFavorites() {
  zt.dbStorage.setItem("lyrics_favorites", favorites);
}

function isFaved(song) {
  return favorites.some((f) => f.id === song.id && f.source === song.source);
}

function toggleFavorite() {
  if (!currentSong) return;
  if (isFaved(currentSong)) {
    favorites = favorites.filter((f) => !(f.id === currentSong.id && f.source === currentSong.source));
    saveFavorites();
    toast("已取消收藏");
  } else {
    favorites.unshift({
      id: currentSong.id,
      source: currentSong.source,
      name: currentSong.name,
      artists: currentSong.artists,
      album: currentSong.album,
    });
    saveFavorites();
    toast("已收藏");
  }
  updateFavButton();
}

// ---------- 视图切换 ----------

function showListView() {
  viewLyric.classList.add("hidden");
  viewList.classList.remove("hidden");
  $("#btn-back").classList.add("hidden");
  currentSong = null;
  renderEmptyList();
}

function renderEmptyList() {
  songList.innerHTML = "";
  if (favorites.length > 0) {
    listStatus.textContent = "我的收藏";
    for (const f of favorites) {
      appendSongItem({ ...f, _fav: true });
    }
  } else {
    listStatus.textContent = "输入关键词搜索歌曲，或点击歌曲查看歌词";
  }
}

function showLyricView() {
  viewList.classList.add("hidden");
  viewLyric.classList.remove("hidden");
  $("#btn-back").classList.remove("hidden");
}

// ---------- 搜索 ----------

async function doSearch(keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) return;
  showListView();
  listStatus.textContent = "正在搜索「" + kw + "」…";
  listStatus.classList.remove("error");
  songList.innerHTML = "";
  try {
    results = await api.search(kw);
  } catch (e) {
    results = [];
    listStatus.textContent = "搜索失败：" + (e && e.message ? e.message : "网络错误");
    listStatus.classList.add("error");
    return;
  }
  if (results.length === 0) {
    listStatus.textContent = "没有找到「" + kw + "」相关的歌曲";
    return;
  }
  listStatus.textContent = "找到 " + results.length + " 首歌曲";
  results.forEach((song, i) => appendSongItem(song, i));
}

function appendSongItem(song, index) {
  const li = document.createElement("li");
  li.innerHTML =
    '<span class="song-idx">' + (index == null ? "★" : index + 1) + "</span>" +
    '<div class="song-main">' +
    '<div class="song-name">' + esc(song.name) + "</div>" +
    '<div class="song-sub">' + esc(song.artists) + (song.album ? " · " + esc(song.album) : "") + "</div>" +
    "</div>" +
    '<span class="song-source">' + (song.source === "lrclib" ? "lrclib" : "网易云") + "</span>";
  li.addEventListener("click", () => openLyric(song));
  songList.appendChild(li);
}

// ---------- 歌词 ----------

async function openLyric(song) {
  currentSong = song;
  showLyricView();
  $("#lyric-title").textContent = song.name;
  $("#lyric-sub").textContent = song.artists + (song.album ? " · " + song.album : "") + " · 加载中…";
  const body = $("#lyric-body");
  body.innerHTML = '<div class="lrc-empty">歌词加载中…</div>';
  try {
    currentLyric = await api.getLyric(song);
  } catch (e) {
    currentLyric = null;
    body.innerHTML = '<div class="lrc-empty">歌词获取失败：' + esc(e && e.message) + "</div>";
    $("#lyric-sub").textContent = song.artists;
    updateFavButton();
    return;
  }
  const transMap = currentLyric.translation ? parseTranslation(currentLyric.translation) : new Map();
  let lines = parseLrc(currentLyric.lrc);
  if (lines.length === 0 && currentLyric.plain) {
    // 纯文本歌词（lrclib 兜底）
    lines = String(currentLyric.plain)
      .split("\n")
      .map((t) => ({ time: Infinity, text: t.trim() }));
  }
  const hasTrans = transMap.size > 0;
  $("#trans-toggle-wrap").classList.toggle("hidden", !hasTrans);
  $("#trans-toggle").checked = hasTrans; // 默认显示翻译

  body.innerHTML = "";
  if (lines.length === 0) {
    body.innerHTML = '<div class="lrc-empty">暂无歌词</div>';
  } else {
    for (const line of lines) {
      const div = document.createElement("div");
      if (!line.text) {
        div.className = "lrc-line blank";
      } else {
        div.className = "lrc-line";
        div.innerHTML = esc(line.text) +
          (hasTrans && transMap.has(line.time)
            ? '<span class="trans">' + esc(transMap.get(line.time)) + "</span>"
            : "");
        div.addEventListener("click", () => {
          zt.copyText(line.text);
          toast("已复制：" + line.text);
        });
      }
      body.appendChild(div);
    }
  }
  $("#lyric-sub").textContent =
    song.artists + (song.album ? " · " + song.album : "") + " · " + (song.source === "lrclib" ? "lrclib" : "网易云音乐");
  body.scrollTop = 0;
  updateFavButton();
}

function updateFavButton() {
  const btn = $("#btn-fav");
  if (!currentSong) return;
  const faved = isFaved(currentSong);
  btn.textContent = faved ? "★ 已收藏" : "☆ 收藏";
  btn.classList.toggle("faved", faved);
}

// 导出当前歌词为纯文本（含翻译）
function buildLyricText() {
  if (!currentLyric) return "";
  const body = $("#lyric-body");
  const out = [];
  for (const node of body.querySelectorAll(".lrc-line")) {
    if (node.classList.contains("blank")) {
      out.push("");
      continue;
    }
    const trans = node.querySelector(".trans");
    const main = node.childNodes[0] ? node.childNodes[0].textContent : "";
    out.push(main + (trans && !trans.classList.contains("hidden-t") ? "  " + trans.textContent : ""));
  }
  const header =
    currentSong.name + " - " + currentSong.artists + (currentSong.album ? "\n专辑：" + currentSong.album : "");
  return header + "\n\n" + out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function copyAll() {
  if (!currentLyric) return;
  zt.copyText(buildLyricText());
  toast("歌词已复制到剪贴板");
}

function saveTxt() {
  if (!currentLyric) return;
  const safeName = (currentSong.name + "-" + currentSong.artists).replace(/[\\/:*?"<>|]/g, "_");
  const filePath = zt.showSaveDialog({
    title: "保存歌词",
    defaultPath: safeName + ".txt",
    filters: [{ name: "文本文件", extensions: ["txt"] }],
  });
  if (!filePath) return;
  try {
    api.saveTextFile(filePath, buildLyricText());
    toast("已保存：" + filePath);
  } catch (e) {
    toast("保存失败：" + (e && e.message));
  }
}

// ---------- 初始化 ----------

function initTheme() {
  try {
    if (zt.isDarkColors()) document.body.classList.add("dark");
  } catch (e) {
    /* 忽略，保持浅色 */
  }
}

function init() {
  if (!api || !zt) {
    document.body.innerHTML = '<div class="status error">未检测到 ZTools 环境，请在 ZTools 中运行本插件</div>';
    return;
  }
  initTheme();
  loadFavorites();
  renderEmptyList();

  // 插件内输入框：回车 / 按钮 / 实时防抖搜索
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      doSearch(input.value);
    }
  });
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(input.value), 400);
  });
  $("#btn-search").addEventListener("click", () => doSearch(input.value));

  // 主搜索框作为子输入框：插件激活后直接在主搜索框里打字即可实时搜索
  try {
    zt.setSubInput(
      (text) => {
        input.value = text;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => doSearch(text), 400);
      },
      "输入歌名 / 歌手，搜索歌词",
      true
    );
  } catch (e) {
    /* 部分场景（如分离窗口）可能不支持，忽略 */
  }

  $("#btn-back").addEventListener("click", showListView);
  $("#btn-copy-all").addEventListener("click", copyAll);
  $("#btn-save").addEventListener("click", saveTxt);
  $("#btn-fav").addEventListener("click", toggleFavorite);
  $("#trans-toggle").addEventListener("change", () => {
    const show = $("#trans-toggle").checked;
    document.querySelectorAll("#lyric-body .trans").forEach((el) => {
      el.classList.toggle("hidden-t", !show);
    });
  });

  // 插件进入：携带关键词时自动搜索
  zt.onPluginEnter((param) => {
    const kw = param && typeof param.payload === "string" ? param.payload.trim() : "";
    const isCmdText = ["歌词", "搜歌词", "lyric", "gc"].includes(kw);
    if (kw && !isCmdText) {
      input.value = kw;
      doSearch(kw);
    } else {
      showListView();
    }
  });

  zt.setExpendHeight(600);
}

init();
