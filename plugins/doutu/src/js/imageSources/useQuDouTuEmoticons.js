import axios from "axios";
import { load } from 'cheerio'
import {downloadImages} from "../useFiles.js";

const useQuDouTuEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    let url = `http://www.godoutu.com/search/type/face/keyword/${keyWord.value}/page/${pagination.pageNum.value}.html`
    let img_matcher = '.bqppsearch'
    if (!keyWord.value) {
        url = `http://www.godoutu.com`
        img_matcher = '.bqppdiv img'
    }
    const config = {method: 'get', url};
    return axios(config)
        .then(function (response) {
            const $ = load(response.data)
            const imgLinks = $(img_matcher).map((_, img) => img.attribs['data-original']).get()
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = $('.menu .item:contains("下一页")').length > 0;
            downloadImages(imgLinks, {}, callback)
        })
}

export default useQuDouTuEmoticons;
