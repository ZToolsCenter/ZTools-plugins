import axios from "axios";
import {downloadImages} from "../useFiles.js";

const useBaiduEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    if (!keyWord.value) {
        keyWord.value = '表情包'
    }
    preHandle && preHandle()
    const config = {
        method: 'get',
        url: `https://image.baidu.com/search/acjson`,
        params: {
            tn: "resultjson_com",
            word: keyWord.value,
            pn: pagination.pageNum.value * pagination.pageSize.value,
            rn: pagination.pageSize.value
        }
    };
    return axios(config)
        .then(function (response) {
            const data = response.data.data
            const imgLinks = data.map(d => d['middleURL'])
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = data.length >= pagination.pageSize.value;
            downloadImages(imgLinks, {}, callback)
        })
}

export default useBaiduEmoticons;
