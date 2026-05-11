import axios from "axios";
import { load } from 'cheerio'
import {downloadImages} from "../useFiles.js";

const useAiDouTuEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    let params = {type: 1, page: pagination.pageNum.value, keyword: keyWord.value};
    let url = `http://www.adoutu.com/search`
    if (!keyWord.value) {
        url = `http://www.adoutu.com/picture/list/${pagination.pageNum.value}`
        params = {}
    }
    const config = {method: 'get', url, params};
    return axios(config)
        .then(function (response) {
            const $ = load(response.data)
            const imgLinks = $('.min-w-0 img').map((_, img) => img.attribs['src']).get()
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = $('.pagination .page-link:contains(">>")').length > 0;
            downloadImages(imgLinks, {}, callback)
        })
}

export default useAiDouTuEmoticons;
