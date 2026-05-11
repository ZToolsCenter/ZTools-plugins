import axios from "axios";
import { load } from 'cheerio'
import {downloadImages} from "../useFiles.js";

const useDouLeGeTuEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    let params = {page: pagination.pageNum.value, keyword: keyWord.value};
    let url = 'https://www.dogetu.com/search.html'
    if (!keyWord.value) {
        url = 'https://www.dogetu.com/biaoqing.html'
        params = {page: pagination.pageNum.value}
    }
    const config = {method: 'get', url, params};
    return axios(config)
        .then(function (response) {
            const $ = load(response.data)
            const imgLinks = $('.item-pic>a>img').map((_, img) => `${img.attribs['src']}`).get()
            downloadImages(imgLinks, {}, callback)
        })
}

export default useDouLeGeTuEmoticons;
