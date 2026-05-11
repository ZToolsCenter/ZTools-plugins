const fs = require('fs');

console.log("preload js loaded")

//读取文件
window.readFile = function (path) {
    return fs.readFileSync(path, {
        encoding: "utf-8"
    });
}

//写文件
window.writeFile = function (path, content) {
    fs.writeFileSync(path, content)
    return true;
}
