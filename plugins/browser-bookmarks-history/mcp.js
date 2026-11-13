
const bookmarks = require('./bookmarks')

const handleBookmarksQuery = async ({ keyword }, ctx) => {
    // 读取插件配置的便携版数据目录（未配置则退回默认路径）
    let extra = null
    try {
        const raw = window.ztools.dbStorage.getItem('bookmarks-config')
        if (raw) {
            const cfg = JSON.parse(raw)
            extra = {
                chrome: Array.isArray(cfg.chromeDirs) ? cfg.chromeDirs : [],
                edge: Array.isArray(cfg.edgeDirs) ? cfg.edgeDirs : []
            }
        }
    } catch (e) {}
    bookmarks.readBookmarksData(null, extra)
    const bookmarksResult = bookmarks.searchBookmarks(keyword)
    // 根据 outputSchema，返回数组，每个元素有 title 和 url
    return bookmarksResult.map(b => ({
        title: b.title,
        url: b.url
    }))
}

/**
 * 注册所有工具
 */
function registerTools() {
    if (window.ztools && window.ztools.registerTool) {
        window.ztools.registerTool('bookmarks_query', handleBookmarksQuery)
    } else {
        console.warn('ztools API 不可用，工具注册失败')
    }
}

module.exports = {
    registerTools
} 
