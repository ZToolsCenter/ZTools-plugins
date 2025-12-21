const electron = require("electron");

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

window.ztools.onPluginEnter((param) => {
    console.log("clipboard plugin enter", param);
})

window.ztools.setSubInput((details) => {
    console.log('子输入框变化:', details)
}, '搜索剪贴板')