"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const pluginRoot = path.resolve(__dirname, "../..");
const cacheRoot = path.join(pluginRoot, ".cache/e2e");
const screenshotRoot = path.join(cacheRoot, "screenshots");
fs.mkdirSync(screenshotRoot, { recursive: true });

async function launchBrowser() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe")
  ];
  const executablePath = candidates.find(candidate => candidate && fs.existsSync(candidate));
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), env: { ...process.env, TMPDIR: cacheRoot, TMP: cacheRoot, TEMP: cacheRoot } });
}
module.exports = { launchBrowser, pluginRoot, cacheRoot, screenshotRoot };
