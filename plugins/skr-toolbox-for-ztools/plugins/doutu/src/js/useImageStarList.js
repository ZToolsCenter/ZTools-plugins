import {computed, ref} from "vue";
import {useMessage} from "naive-ui";
import {downloadCollectedImages} from "./useFiles.js";

function fetchCollectEmoticonMap() {
    try {
        let items = ztools.dbStorage.getItem('imageStarList')

        if (items && typeof items === 'string') {
            const result = JSON.parse(items)
            if (!Array.isArray(result)) {
                return result
            }
            return {}
        }

        return {}
    } catch (e) {
        return {}
    }
}

function updateCollectEmoticonMap(items) {
    ztools.dbStorage.setItem('imageStarList', JSON.stringify(items))
}

// 是否已收藏
const starEmojiMap = ref(fetchCollectEmoticonMap())

// 动态获取最新的表情包列表
const starEmojiList = computed(() => {
    const imageLinks = Object.entries(starEmojiMap.value).map(val => val[0])
    // 尝试下载
    downloadCollectedImages(imageLinks)
    return Object.entries(starEmojiMap.value).map(val => ({
        imgSrc: val[0],
        fileSrc: `file://${window.composeCollectedFilePath(val[0])}`
    })).reverse()
})

export default function () {
    // 检查是否已经加入收藏
    const checkIfCollected = (imgSrc) => {
        return !!starEmojiMap.value[imgSrc]
    }

    const {success} = useMessage()
    // 切换收藏状态
    const switchCollectedStatus = (imgObj) => {
        const {imgSrc, fileSrc} = imgObj
        if (checkIfCollected(imgSrc)) {
            window.removeFile(window.composeCollectedFilePath(imgSrc))
            delete starEmojiMap.value[imgSrc]
            success('已取消收藏')
        } else {
            starEmojiMap.value[imgSrc] = fileSrc
            downloadCollectedImages([imgSrc])
            success('已加入收藏')
        }
        updateCollectEmoticonMap(starEmojiMap.value)
    }

    return {
        checkIfCollected,
        switchCollectedStatus,
        starEmojiList,
        downloadCollectedImages,
    }
}
