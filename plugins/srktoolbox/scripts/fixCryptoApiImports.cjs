const fs = require("fs");
const path = require("path");

const root = path.join("node_modules", "crypto-api", "src");

function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);

        if (stat.isDirectory()) {
            if (name !== ".git") walk(file);
        } else {
            const content = fs.readFileSync(file, "utf8");
            const next = content.replace(/from (["'])(\.[^"']+)(["'];)/g, function(match, quote, importPath, suffix) {
                if (importPath.endsWith(".mjs")) return match;
                return "from " + quote + importPath + ".mjs" + suffix;
            });

            if (next !== content) fs.writeFileSync(file, next);
        }
    }
}

walk(root);
