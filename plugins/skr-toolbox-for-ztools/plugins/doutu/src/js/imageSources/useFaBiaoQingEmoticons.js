import axios from "axios";
import { load } from 'cheerio'
import {downloadImages} from "../useFiles.js";

const useFaBiaoQingEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    let url = `https://fabiaoqing.com/search/bqb/keyword/${keyWord.value}/type/bq/page/${pagination.pageNum.value}.html`
    if (!keyWord.value) {
        url = `https://fabiaoqing.com/biaoqing/lists/page/${pagination.pageNum.value}.html`
        if (pagination.pageNum.value === 1) {
            url = `https://fabiaoqing.com/biaoqing`
        }
    }
    const config = {method: 'get', url};
    return axios(config)
        .then(function (response) {
            const $ = load(response.data)
            const imgLinks = $('#bqb a img').map((_, img) => img.attribs['data-original']).get()
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = $('.menu .item:contains("下一页")').length > 0;
            downloadImages(imgLinks, {'headers': {Referer: 'https://fabiaoqing.com/'}}, callback)
        })
}

export default useFaBiaoQingEmoticons;
