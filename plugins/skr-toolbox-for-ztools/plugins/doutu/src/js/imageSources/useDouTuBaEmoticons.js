import axios from "axios";
import {downloadImages} from "../useFiles.js";

const useDouTuBaEmoticons = (loading, pagination, keyWord, preHandle, callback) => {
    if (loading.value) {
        return Promise.resolve()
    }
    preHandle && preHandle()
    let params = {curPage: pagination.pageNum.value, pageSize: 20, keyword: keyWord.value};
    let url = 'https://api.doutub.com/api/bq/search'
    if (!keyWord.value) {
        url = 'https://api.doutub.com/api/bq/queryNewBq'
        params = {curPage: pagination.pageNum.value, typeId: 1, isShowIndex: false, pageSize: 50};
    }
    const config = {method: 'get', url, params};
    return axios(config)
        .then(function (response) {
            const {rows, count} = response.data.data
            const imgLinks = rows.map(row => row['path'].replace('https', 'http'))
            pagination.hasLess.value = pagination.pageNum.value > 1
            pagination.hasMore.value = pagination.pageNum.value * pagination.pageSize.value < count;
            downloadImages(imgLinks, {headers: {'Host': 'api.doutub.com'}}, callback)
        })
}

export default useDouTuBaEmoticons;
