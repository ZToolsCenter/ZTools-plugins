const fs = require("original-fs"),
  path = require("path");
function rename(e) {
  const s = [];
  (e.forEach((r) => {
    try {
      const n = path.dirname(r.path);
      let a = Array.isArray(r.rename)
        ? r.rename[0].trim() || r.name
        : r.rename + r.ext;
      a.endsWith(".") &&
        "win32" === process.platform &&
        (a = a.replace(/\.+$/g, ""));
      const t = path.join(n, a);
      if (r.path === t)
        return void process.send({ error: '"' + a + '" 名称未修改', file: r });
      if (fs.existsSync(t)) {
        if (e.find((e) => e.path === t)) {
          const e = path.join(
            n,
            "[ztools-rename-" +
              Date.now() +
              "-" +
              Math.floor(65536 * (1 + Math.random()))
                .toString(16)
                .substring(1) +
              "]" +
              r.name,
          );
          if (fs.existsSync(e)) throw new Error("rename exist");
          (fs.renameSync(r.path, e), s.push([e, t, r]));
        } else
          process.send({
            error: '"' + r.name + '" "' + a + '" 名称已存在',
            file: r,
          });
        return;
      }
      fs.renameSync(r.path, t);
      const o = path.parse(t);
      process.send({
        file: { ...r, path: t, name: o.base, basename: o.name, ext: o.ext },
      });
    } catch (e) {
      process.send({ error: '"' + r.name + '" 错误 ' + e.message, file: r });
    }
  }),
    s.length > 0 &&
      s.forEach((e) => {
        const [s, r, n] = e;
        try {
          if (fs.existsSync(r))
            return (
              fs.existsSync(n.path) || fs.renameSync(s, n.path),
              void process.send({
                error: '"' + n.name + '" "' + path.basename(r) + '" 名称已存在',
                file: n,
              })
            );
          fs.renameSync(s, r);
          const e = path.parse(r);
          process.send({
            file: { ...n, path: r, name: e.base, basename: e.name, ext: e.ext },
          });
        } catch (e) {
          process.send({
            error: '"' + n.name + '" 错误 ' + e.message,
            file: n,
          });
        }
      }));
}
process.once("message", (e) => {
  rename(e);
});
