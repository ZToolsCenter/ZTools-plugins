import axios from "axios";
import {downloadImages} from "../useFiles.js";

/**
 * 爱斗图表情包搜索 - 发送请求搜索表情包列表
 * @param loading
 * @param pagination
 * @param keyWord
 * @param preHandle
 * @param callback
 */
const useSogouEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }

    preHandle && preHandle()

    const len = 47;
    const start = (pagination.pageNum.value - 1) * len;
    let params = {reqFrom: 'wap_result', start, query: `${keyWord.value} 表情`};
    let url = `https://pic.sogou.com/napi/wap/pic`
    let imgExtractor = (response) => {
        const {maxEnd, items} = response.data.data
        pagination.hasMore.value = maxEnd >= pagination.pageNum.value * len;
        return items.map(img => img['locImageLink'])
    }

    // 没有关键字的时候,加载热门表情包
    if (!keyWord.value) {
        url = `https://pic.sogou.com/napi/wap/emoji/moreEmo`
        params = {start, len}
        imgExtractor = response => {
            const data = response.data.data
            pagination.hasMore.value = data.length > 0
            return data.map(img => img['cover'])
        }
    }
    const config = {method: 'get', url, params};

    return axios(config)
        .then(function (response) {
            const imgLinks = imgExtractor(response)
            pagination.hasLess.value = pagination.pageNum.value > 1
            downloadImages(imgLinks, {}, callback)
        })
}

export default useSogouEmoticons;
