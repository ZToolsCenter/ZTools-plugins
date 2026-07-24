import axios from "axios";
import { load } from 'cheerio'
import {downloadImages} from "../useFiles.js";

const useDouTulaEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    let params = {page: pagination.pageNum.value, keyword: keyWord.value};
    let url = 'https://www.doutupk.com/search?type=photo&more=1'
    if (!keyWord.value) {
        url = 'https://www.doutupk.com/article/list'
        params = {page: pagination.pageNum.value}
    }
    const config = {method: 'get', url, params};
    return axios(config)
        .then(function (response) {
            const $ = load(response.data)
            const imgLinks = $('.image_dtb,.image_dta').map((_, img) => `${img.attribs['data-backup']}`).get()
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = $('.pagination .disabled:contains("»")').length === 0;
            downloadImages(imgLinks, {}, callback)
        })
}

export default useDouTulaEmoticons;
