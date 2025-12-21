const electron = require("electron");
const { exec } = require('child_process');

// Ensure namespace exists
window.ztools = window.ztools || {};
window.ztools.shell = window.ztools.shell || {};

// Implement exec
window.ztools.shell.exec = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
};

window.ztools.onPluginEnter((param) => {
    console.log("port-use plugin enter", param);
})