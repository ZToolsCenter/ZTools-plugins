
const bookmarks = require('./bookmarks')

const handleBookmarksQuery = async ({ keyword }, ctx) => {
    if (!bookmarks.BOOKMARKS_DATA) bookmarks.readBookmarksData()
    const bookmarksResult = bookmarks.searchBookmarks(keyword)
    console.log(bookmarksResult)
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