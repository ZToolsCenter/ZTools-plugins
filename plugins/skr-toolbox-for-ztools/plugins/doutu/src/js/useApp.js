import {nextTick, onMounted, reactive, ref, toRefs} from "vue";
import {fetchConfig} from "./useConfig.js";
import usePkDouTuEmoticons from "./imageSources/usePkDouTuEmoticons.js";
import useAiDouTuEmoticons from "./imageSources/useAiDouTuEmoticons.js";
import useDouTuEmoticons from "./imageSources/useDouTuEmoticons.js";
import useDouTulaEmoticons from "./imageSources/useDouTulaEmoticons.js";
import useFaBiaoQingEmoticons from "./imageSources/useFaBiaoQingEmoticons.js";
import useDouTuBaEmoticons from "./imageSources/useDouTuBaEmoticons.js";
import useDouTuWangEmoticons from "./imageSources/useDouTuWangEmoticons.js";
import useQuDouTuEmoticons from "./imageSources/useQuDouTuEmoticons.js";
import useBiaoQing2333Emoticons from "./imageSources/useBiaoQing2333Emoticons.js";
import useDbbqbEmoticons from "./imageSources/useDbbqbEmoticons.js";
import useBaiduEmoticons from "./imageSources/useBaiduEmoticons.js";
import useDouLeGeTuEmoticons from "./imageSources/useDouLeGeTuEmoticons.js";
import useSogouEmoticons from "./imageSources/useSogouEmoticons.js";


/**
 * 初始化插件
 */
function init(keyWord, reload) {
    ztools.setSubInput(({text}) => {
            keyWord.value = text
        },
        "鼠标操作:回车搜索,左击复制图片,中击查看大图,右击加入收藏～"
    );

    ztools.onPluginEnter(({type, payload}) => {
        console.log(`进入了插件`)
        if (type === 'over') {
            ztools.setSubInputValue(payload)
            keyWord.value = payload
            reload()
        }
    })

    addEventListener('keydown', (event) => {
        // 回车的时候，进行搜索
        if (event.code === 'Enter') {
            reload()
        }
    });
    // 初始化进入就加载随机表情包
    reload()
}

export default function (reloadCallback) {
    const emoticons = ref([])
    const keyWord = ref("")
    const loading = ref(false)

    const pagination = toRefs(reactive({
        pageNum: 1,
        pageSize: 20,
        hasMore: false,
        hasLess: false,
    }))

    // 数据返回后，不断追加表情包数据
    const callback = items => {
        // 异步取消loading状态，等待表情包渲染完成后再进行取消loading
        nextTick(() => emoticons.value.push(...items))
            .then(() => setTimeout(() => loading.value = false, 100))
    }

    // 数据加载
    const loadData = (pagination, loadCConfig = {}) => {
        const {isAppend} = loadCConfig
        // 不是追加模式的话,则清空图片列表
        if (!isAppend) {
            emoticons.value = []
        }

        // 为每个图源设置不同的接口响应延迟
        const callbackTimeoutMap = {
            '搜狗': 20000,
            '逗比表情包': 20000,
            '斗了个图': 20000,
        }
        // 加载之前，统一清空图片列表
        const preHandle = () => loading.value = true

        try {
            const {imageSource} = fetchConfig()
            let callbackTimeout = callbackTimeoutMap[imageSource] || 15000

            // 最长8秒后，强制结束加载请求，避免页面卡死
            setTimeout(() => callback([]), callbackTimeout)

            if ("pk斗图网" === imageSource) {
                return usePkDouTuEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ("搜狗" === imageSource) {
                return useSogouEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ("爱斗图" === imageSource) {
                return useAiDouTuEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ("斗图啦" === imageSource) {
                return useDouTulaEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ("发表情" === imageSource) {
                return useFaBiaoQingEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ('斗图吧' === imageSource) {
                return useDouTuBaEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ('斗图王' === imageSource) {
                return useDouTuWangEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ("斗图" === imageSource) {
                return useDouTuEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ('去斗图' === imageSource) {
                return useQuDouTuEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ('表情2333网' === imageSource) {
                return useBiaoQing2333Emoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ('逗比表情包' === imageSource) {
                return useDbbqbEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ('百度' === imageSource) {
                return useBaiduEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
            if ('斗了个图' === imageSource) {
                return useDouLeGeTuEmoticons(loading, pagination, keyWord, preHandle, callback)
            }
        } catch (e) {
            callback([])
            alert('加载出错，错误信息: ' + e)
        }
    }

    // 重置为加载第一页
    const reload = () => {
        // 正在加载中,不再进行新的数据加载
        if (!!loading.value) {
            return
        }
        pagination.pageNum.value = 1
        loading.value = false
        reloadCallback && reloadCallback()
        loadData(pagination)
    }

    onMounted(() => init(keyWord, reload))

    // 翻页到上一页
    const nextPage = (loadCConfig) => {
        pagination.pageNum.value++
        loadData(pagination, loadCConfig)
    }

    // 翻页到下一页
    const previousPage = () => {
        pagination.pageNum.value--
        loadData(pagination)
    }

    // 退出或者隐藏时，清空关键字
    ztools.onPluginOut(() => {
        keyWord.value = ''
    })


    // 滚动到底部的时候,加载更多数据
    const loadMore = (e) => {
        if (e.target instanceof HTMLDivElement) {
            if (Math.round(e.target.scrollTop) + e.target.clientHeight >= e.target.scrollHeight) {
                if (!loading.value && pagination.hasMore.value) {
                    nextPage && nextPage({isAppend: true})
                }
            }
        }
    }

    return {
        emoticons,
        loading,
        pagination,
        keyWord,
        previousPage,
        nextPage,
        reload,
        config: fetchConfig(),
        loadMore,
    }
}
