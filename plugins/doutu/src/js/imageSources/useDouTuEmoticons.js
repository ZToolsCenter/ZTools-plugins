import axios from "axios";
import {downloadImages} from "../useFiles.js";

const useDouTuEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    const pageSize = 20
    let params = {type: 1, pageNum: pagination.pageNum.value, pageSize, keyword: keyWord.value};
    let url = `https://doutu.lccyy.com/doutu/items`
    if (!keyWord.value) {
        url = `https://doutu.lccyy.com/doutu/all`
        params = {ac: 'home', start: 0, limit: 30, keyword: ''}
    }
    const config = {
        method: 'get', url, params,
        headers: {
            "User-Agent": "Nice"
        }
    };
    return axios(config)
        .then(function (response) {
            let imgLinks = []
            const {items, totalSize} = response.data
            if (!!items) {
                imgLinks = items.map(item => item['url'])
            }
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = (pagination.pageNum.value * pageSize) < totalSize;
            downloadImages(imgLinks, {}, callback)
        })
}

export default useDouTuEmoticons;
