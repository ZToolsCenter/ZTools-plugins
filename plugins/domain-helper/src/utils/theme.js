
function getThemeMode() {
    return utools.dbStorage.getItem('theme') || "auto";
}


function getCustomThemeMode() {
    return utools.dbStorage.getItem('custome_theme') || "#1677FF";
}

function setCustomThemeMode(theme) {
    return utools.dbStorage.setItem('custome_theme', theme)
}

function getRealThemeMode() {
    if ("auto" === getThemeMode()) {
        return utools.isDarkColors() ? "dark" : "light"
    }
    return getThemeMode()
}

function renderThemeMode() {
    let theme = getThemeMode()
    if (theme === "auto") {
        if (utools.isDarkColors()) {
            document.body.setAttribute('arco-theme', 'dark')
        } else {
            document.body.removeAttribute('arco-theme')
        }
    } else if (theme === "dark") {
        document.body.setAttribute('arco-theme', 'dark')
    } else {
        document.body.removeAttribute('arco-theme')
    }
}

function setThemeMode(theme) {
    utools.dbStorage.setItem('theme', theme)
    renderThemeMode()
}


export {
    renderThemeMode,
    setThemeMode,
    getThemeMode,
    getRealThemeMode,
    getCustomThemeMode,
    setCustomThemeMode,
}
