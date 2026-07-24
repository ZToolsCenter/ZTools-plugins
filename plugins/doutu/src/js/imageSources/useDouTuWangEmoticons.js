import axios from "axios";
import { load } from 'cheerio'
import {downloadImages} from "../useFiles.js";

const useDouTuWangEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    let url = `https://www.doutuwang.com/page/${pagination.pageNum.value}?s=${keyWord.value}`
    if (!keyWord.value) {
        url = `https://www.doutuwang.com/category/dashijian/page/${pagination.pageNum.value}`
    }
    const config = {method: 'get', url};
    return axios(config)
        .then(function (response) {
            const $ = load(response.data)
            const imgLinks = $('.post img').map((_, img) => img.attribs['src']).get()
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = $('.pagination .next').length > 0;
            downloadImages(imgLinks, {}, callback)
        })
}

export default useDouTuWangEmoticons;
