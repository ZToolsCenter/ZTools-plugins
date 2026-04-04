const path = require("path"),
  fs = require("original-fs"),
  cp = require("child_process");
window.services = {
  parseRenameFiles: (e) => {
    const r = [];
    return (
      e.forEach((e) => {
        try {
          const s = fs.lstatSync(e),
            i = s.isDirectory(),
            t = path.parse(e);
          r.push({
            path: e,
            name: t.base,
            basename: i ? t.base : t.name,
            ext: i ? "" : t.ext,
            isDirectory: i,
            isFile: s.isFile(),
            size: s.size,
            birthtimeMs: s.birthtimeMs,
            mtimeMs: s.mtimeMs,
          });
        } catch (e) {}
      }),
      r
    );
  },
  renameFiles: (e, r, s) => {
    const i = cp.fork(path.join(__dirname, "rename.js")),
      t = [],
      n = [];
    (i.on("message", (e) => {
      (e.error && n.push(e.error), t.push(e.file), r(t.length));
    }),
      i.once("exit", () => {
        s({ errors: n, renamedFiles: t });
      }),
      i.send(e));
  },
  readDirectoryAllFiles: (e, r, s) => {
    const i = cp.fork(path.join(__dirname, "readdir.js"), [e]),
      t = [];
    return (
      i.on("message", (e) => {
        (t.push(e), r(t.length));
      }),
      i.once("exit", () => {
        if (i.killed) return s(null);
        s(t);
      }),
      () => {
        i.kill();
      }
    );
  },
};
