// 下载文件
export async function downloadImages(imgLinks, config = {}, callback) {
    // 把图片都下载到本地用户目录，跳过跨域限制
    if (imgLinks.length === 0) {
        callback && callback([])
        return
    }
    let promises = []

    const downloadImageLinks = imgLinks.sort((v1, v2) => v1.localeCompare(v2))

    for (let i = 0; i < downloadImageLinks.length; i++) {
        promises.push(window.downloadImage(imgLinks[i], config))

        // 批量下载，一次3个
        if ((i === imgLinks.length - 1) || (i > 0 && i % 5 === 0)) {
            Promise.all(promises.map(p => p.catch(err => Promise.resolve(null)))).then(values => {
                // [{imgSrc:'',fileSrc:''}]
                const callbackValues = values
                    .filter(v => !!v)
                    .sort((v1, v2) => v1.imgSrc.localeCompare(v2.imgSrc))

                callback && callback(callbackValues)
            })

            promises = []
        }
    }
}

// 下载收藏的表情包
export async function downloadCollectedImages(imgLinks, config = {}) {
    config['downloadPath'] = window.checkOrCreateDirectory(`${ztools.getPath('userData')}/ztoolsCollectedEmoticons`)
    downloadImages(imgLinks, config)
}
