import axios from "axios";
import {downloadImages} from "../useFiles.js";

const useBiaoQing2333Emoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value || !keyWord.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    const config = {
        method: 'get',
        url: `https://biaoqing233.com/app/search/${keyWord.value}?page=${pagination.pageNum.value}&limit=50`
    };
    return axios(config)
        .then(function (response) {
            const imgLinks = response.data.docs.map(d => `https://lz.sinaimg.cn/large/${d.key}`)
            downloadImages(imgLinks, {}, callback)
        })
}

export default useBiaoQing2333Emoticons;
