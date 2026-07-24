import axios from "axios";
import { load } from 'cheerio'
import {downloadImages} from "../useFiles.js";

const usePkDouTuEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    const params = {type: 'photo', page: pagination.pageNum.value, keyword: keyWord.value, more: 1};
    const config = {method: 'get', url: `https://www.pkdoutu.com/search`, params};
    return axios(config)
        .then(function (response) {
            const $ = load(response.data)
            const imgTags = $('.random_picture img.image_dtb')
            const imgLinks = imgTags.map((_, img) => img.attribs['data-original']).get()
            downloadImages(imgLinks, {}, callback)
        })
}

export default usePkDouTuEmoticons;
