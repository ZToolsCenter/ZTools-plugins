window.rootPath = (function (src) {
    $.each(document.scripts, (i, s) => {
        src = s.src;
        if (src.includes('layuiExt')) {
            src = src.substring(0, src.lastIndexOf("/") + 1);
            return true;
        }
    })
    return src;
})();

layui.config({
    base: rootPath,
    version: true
}).extend({
    xmSelect: 'xmSelect/xm-select',
    soulTable: 'soulTable/soulTable.slim'
})