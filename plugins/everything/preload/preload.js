const cp = require("child_process"), fs = require("original-fs"), path = require("path"), iconv = require("iconv-lite"),
  chardet = require("chardet"), isBinaryFileSync = require("isbinaryfile").isBinaryFileSync,
  addon = require(`./addon-${process.arch}.node`), _fileIconCache = {}, _waitFileIconFetch = {};
console.log(addon);
window.rubick = {
  ...window.ztools,
  showMainWindow: () => {
    console.log("showMainWindow");
  }
}
window.services = {
  setFileIconSrc: (e, n) => {
    n in _fileIconCache ? null === _fileIconCache[n] ? _waitFileIconFetch[n].push(e) : document.contains(e) && (e.src = _fileIconCache[n]) : (_fileIconCache[n] = null, _waitFileIconFetch[n] = [e], addon.fetchFileIcon(n, (e => {
      const i = e ? URL.createObjectURL(new window.Blob([e], { type: "image/png" })) : "";
      _fileIconCache[n] = i, _waitFileIconFetch[n].forEach((e => {
        document.contains(e) && (e.src = i)
      })), delete _waitFileIconFetch[n]
    })))
  },
  runEverythingExeProcess: e => {
    let n = !1;
    cp.execFile(path.join(__dirname, "everything", "Everything.exe"), ["-startup"], ((i, t, r) => {
      i && (n = !0, window.rubick.showMainWindow(), e(i))
    }));
    const i = () => {
      n || (addon.everythingIsRuning() ? (window.rubick.showMainWindow(), e(null)) : setTimeout(i, 200))
    };
    i()
  },
  runEverythingExeProcess_EE: e => {
    const n = path.join(path.dirname(window.rubick.getPath("exe")), "Everything.exe");
    if (fs.existsSync(n) && (cp.execFile(n, ["-startup"]), "function" == typeof e)) {
      const n = () => {
        addon.everythingIsRuning() ? e() : setTimeout(n, 200)
      };
      n()
    }
  },
  everythingIsRuning: () => addon.everythingIsRuning(),
  getEverythingVersion: () => addon.getEverythingVersion(),
  everythingSearch: (e, n = 1, i = 30, t = 0) => {
    return addon.everythingSearch(e, n, i, t)
  },
  everythingIsReady: () => addon.everythingIsDBLoaded(),
  getProcessArch: () => "ia32" === process.arch ? "32" : "64",
  recycleBin: (e, n) => {
    cp.execFile(path.join(__dirname, "recycle-bin.exe"), e, ((e, i, t) => {
      n()
    }))
  },
  readMarkDownFileContent: e => {
    if (!fs.existsSync(e)) return "";
    try {
      const n = fs.openSync(e, "r"), i = 102400, t = Buffer.alloc(i), r = fs.readSync(n, t, 0, i, 0);
      return t.toString("utf-8", 0, r)
    } catch (e) {
      return ""
    }
  },
  readFileContent: e => {
    const n = { encoding: "未知", content: "" };
    if (!fs.existsSync(e)) return n;
    try {
      const i = fs.openSync(e, "r"), t = 20480, r = Buffer.alloc(t), c = fs.readSync(i, r, 0, t, 0);
      if (0 === c) return n;
      const o = r.slice(0, c);
      return n.encoding = chardet.detect(o), n.content = iconv.decode(o, n.encoding), n
    } catch (e) {
      return n
    }
  },
  asyncReadFileBuffer: (e, n) => {
    fs.readFile(e, n)
  },
  readArchiveFile: (e, n) => {
    if (/\.rar$/i.test(e)) {
      const i = path.join(process.env.programfiles, "winrar", "rar.exe");
      if (!fs.existsSync(i)) return;
      cp.execFile(i, ["lb", e], { encoding: "buffer" }, ((e, i, t) => {
        e || n(iconv.decode(i, "GBK"))
      }))
    } else cp.execFile(path.join(__dirname, "7za.exe"), ["-ba", "l", e], { encoding: "buffer" }, ((e, i, t) => {
      e || n(iconv.decode(i, "GBK").replace(/^.{53}/gm, ""))
    }))
  },
  isBinaryFile: e => {
    try {
      return isBinaryFileSync(e)
    } catch (e) {
      return !0
    }
  },
  getPathBasename: e => path.basename(e) || e,
  getPopUpDialogEverythingFilter: e => {
    const n = addon.getPopUpDialogFilterTextForUTools(e);
    if (!n) return "folder:";
    const i = n.match(/\((.+)\)$/);
    return i && "*.*" !== i[1] ? "file:ext:" + i[1].replaceAll("*.", "") : "file:"
  },
  setPopUpDialogInputValueForUTools: (e, n) => addon.setPopUpDialogInputValueForUTools(e, n)
};