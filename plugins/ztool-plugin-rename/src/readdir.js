const fs = require("original-fs"),
  path = require("path");
function readdir(r) {
  let t;
  try {
    t = fs.readdirSync(r);
  } catch {
    return;
  }
  t.forEach((t) => {
    const e = path.join(r, t);
    let a;
    try {
      a = fs.lstatSync(e);
    } catch {
      return;
    }
    a.isDirectory() ? readdir(e) : process.send(e);
  });
}
readdir(process.argv[2]);
