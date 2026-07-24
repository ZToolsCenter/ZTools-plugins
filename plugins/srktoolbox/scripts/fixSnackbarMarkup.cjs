const fs = require("fs");

const file = "./node_modules/snackbarjs/src/snackbar.js";
const content = fs.readFileSync(file, "utf8");
const next = content.replace("<div id=snackbar-container/>", "<div id=snackbar-container>");

if (next !== content) fs.writeFileSync(file, next);
