const cheerio = require("cheerio");
const { default: ky } = require("./lib/ky");
const licia = require("licia");
const { DownloaderHelper } = require("node-downloader-helper");
const { setWallpaper } = require("wallpaper-setter");
const { default: umami } = require("@umami/node");

window.Preload = {
  cheerio,
  ky,
  licia,
  loadPage(url, options = {}) {
    return new Promise((resolve, reject) => {
      console.log("load url: " + url);
      ky.get(url, options)
        .text()
        .then((html) => {
          const $ = cheerio.load(html);
          resolve($);
        })
        .catch((error) => {
          reject(error);
        });
    });
  },
  downloader: DownloaderHelper,
  wallpaper: setWallpaper,
  umami,
};
