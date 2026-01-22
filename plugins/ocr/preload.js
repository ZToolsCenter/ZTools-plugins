window.utools = {
    ...window.ztools,
    fetchUserServerTemporaryToken: async () => {
        return new Error('未登录')
    },
}
const fs = require("fs"), path = require("path"), { clipboard } = require("electron"); window.services = { getImageBase64: e => { try { return fs.readFileSync(e).toString("base64") } catch { } }, getFileBlob: e => { let t; try { t = fs.readFileSync(e) } catch (e) { return null } return new window.Blob([Uint8Array.from(t).buffer]) }, getCopyedImage: () => { const e = clipboard.readImage(); return !e || e.isEmpty() ? null : e.toDataURL() }, copyHtmlTable: e => { clipboard.writeHTML(e) }, writeFileXLSX: e => { const t = path.join(window.utools.getPath("downloads"), "OCR_" + Date.now() + ".xlsx"); fs.writeFileSync(t, e), window.utools.shellShowItemInFolder(t) }, writeImage: e => { const t = path.join(window.utools.getPath("downloads"), "公式_OCR_" + Date.now() + ".png"); try { fs.writeFileSync(t, e.replace(/^data:image\/png;base64,/i, ""), { encoding: "base64" }) } catch { return } window.utools.shellShowItemInFolder(t) } };