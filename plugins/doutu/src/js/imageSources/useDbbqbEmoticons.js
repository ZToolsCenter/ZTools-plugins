import axios from "axios";
import {downloadImages} from "../useFiles.js";

const useDbbqbEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    let params = {
        start: (pagination.pageNum.value - 1) * pagination.pageSize.value,
        w: keyWord.value
    }
    if (!keyWord.value) {
        params = {size: pagination.pageSize.value}
    }
    const config = {
        method: 'get',
        headers: {"Web-Agent": "web"},
        url: `https://www.dbbqb.com/api/search/json`,
        params
    };
    return axios(config)
        .then(function (response) {
            const imgLinks = response.data.map(img => `https://image.dbbqb.com/${img.path}`)
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = response.data.length >= pagination.pageSize.value;
            downloadImages(imgLinks, {}, callback)
        })
}

export default useDbbqbEmoticons;
