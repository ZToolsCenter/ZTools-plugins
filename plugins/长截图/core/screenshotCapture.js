/**
 * 屏幕截图捕获类
 * 负责管理截图过程、媒体流和实际截图操作
 */
class ScreenshotCapture {
    constructor(imageProcessor, canvasManager) {
        this.mediaStream = null;
        this.confirmFlag = false;
        this.imageProcessor = imageProcessor;
        this.canvasManager = canvasManager;
        this.screenshotArea = null; // 存储计算后的选择区域
        this.selectionViewStatus = "idle"; // 存储selectionView的状态
        this.frameCallbackId = null; // 存储视频帧回调ID
        this.imageCapture = null; // 存储ImageCapture实例

        // 添加帧率计算相关变量
        this.frameCount = 0;
        this.lastFrameTime = 0;
        this.currentFPS = 0;

        this.waitTime = 0;

        // 添加重试相关变量
        this.maxRetryAttempts = 3;
        this.retryDelay = 1000; // 初始重试延迟1秒

        // 在创建实例时添加对状态变更事件的监听
        document.addEventListener('selectionViewStatusChange', (event) => {
            this.selectionViewStatus = event.detail.status;
        });
    }

    /**
     * 基于视频帧更新的截图方法
     * 使用requestVideoFrameCallback在每帧更新时触发
     */
    setupFrameCallback() {
        const video = document.querySelector("video");
        if (!video) return;

        const frameCallback = async (now, metadata) => {
            // 计算帧率
            if (this.lastFrameTime === 0) {
                this.lastFrameTime = now;
            }

            this.frameCount++;
            const elapsed = now - this.lastFrameTime;

            if (elapsed >= 500) { // 每秒更新一次
                this.currentFPS = (Math.round(this.frameCount * 1000 / elapsed * 10) / 10).toFixed(1);
                // 更新UI
                document.getElementById('fpsNotice').textContent = `FPS: ${this.currentFPS}`;
                // console.log("当前帧率:", this.currentFPS);
                this.frameCount = 0;
                this.lastFrameTime = now;
            }

            // 请求检查是否在选区中
            document.dispatchEvent(new CustomEvent('checkMouseInSelection'));

            // 根据selectionView状态判断是否执行截图
            if ((!window.tooLarge && (this.selectionViewStatus === "recording" || this.selectionViewStatus === "autoScroll")) && this.screenshotArea && window.newStudentGuidance.status === 'close') {
                try {




                    if (this.selectionViewStatus !== "autoScroll") {
                        const result = await this.takeScreenshotAndCalculateDistanse();
                        switch (result.status) {
                            case 1:
                            case -2:
                            case -3:
                                updateCtrlNotice(result.message);
                                break;
                        }
                    } else {

                        if (this.selectionViewStatus === "autoScroll" && Date.now() - this.waitTime > 800) {
                            updateCtrlNotice("自动滚动中，请不要移动鼠标，否则会停止自动滚动");

                            nodeWinMouse.scroll(-window.scaledHeight / 8);

                            // 暂停
                            await new Promise(resolve => setTimeout(resolve, 100));

                            // 当前时间戳
                            this.waitTime = Date.now();
                        }

                        const result = await this.takeScreenshotAndCalculateDistanse();


                        if (result.status === 1) {
                            this.waitTime = 0;
                        } else {
                            updateCtrlNotice('可能有动态内容，等待匹配，自动滚动中请勿移动鼠标');
                        }
                    }




                } catch (error) {
                    console.error("截图失败:", error);
                }
            }

            // 继续监听下一帧
            if (this.mediaStream) {
                this.frameCallbackId = video.requestVideoFrameCallback(frameCallback);
            }
        };

        // 开始监听视频帧更新
        this.frameCallbackId = video.requestVideoFrameCallback(frameCallback);
    }

    /**
     * 开始捕获屏幕内容
     * 初始化媒体流、视频元素，设置截图区域参数，显示控制界面
     * @param {number} retryCount - 当前重试次数，默认为0
     */
    async startCapture(retryCount = 0) {
        // 检查是否已有媒体流在运行
        if (this.mediaStream) {
            console.log("捕捉已在进行中");
            return;
        }

        try {


            const displayRealSize = {
                width: displayBounds.size.width * displayBounds.scaleFactor,
                height: displayBounds.size.height * displayBounds.scaleFactor
            }

            console.log("displayBounds:", displayBounds);

            // 获取桌面捕获源
            const sources = await ztools.desktopCaptureSources({ types: ["screen"] });

            // 添加错误检查，确保sources存在
            if (!sources || sources.length === 0) {
                throw new Error("未成功获取录屏源");
            }

            // 添加错误检查，确保displayBounds存在
            if (!displayBounds) {
                throw new Error("displayBounds未定义");
            }



            let sourcesId;
            if (sources.length === 1) {
                // 如果只有一个桌面源，直接使用它
                sourcesId = sources[0].id;
            } else {


                // 添加错误检查，确保displayBounds.id存在
                if (!displayBounds.id) {
                    throw new Error("displayBounds无id属性");
                }


                // 找到sources中对应的屏幕
                const matchedSource = sources.find((source) => source.display_id == displayBounds.id);

                // 添加错误检查，确保找到了匹配的屏幕源
                if (!matchedSource) {
                    console.error("未找到匹配的屏幕源，可用源:", sources);
                    throw new Error(`未找到ID为${displayBounds.id}的屏幕源`);
                }

                sourcesId = matchedSource.id;
            }

            // 设置捕获参数
            var mandatory = {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourcesId,
                // maxFrameRate: 60, // 最大帧率
                maxWidth: displayRealSize.width,
                maxHeight: displayRealSize.height,
                minWidth: displayRealSize.width,
                minHeight: displayRealSize.height,

            }

            // 获取媒体流
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory,
                    // 可以添加如下设置来提高质量
                    // videoBitsPerSecond: 10000000 // 设置高比特率以减少压缩
                },
            });


            // 创建ImageCapture对象
            const track = this.mediaStream.getVideoTracks()[0];
            this.imageCapture = new ImageCapture(track);

            // 设置视频元素
            const video = document.querySelector("video");
            video.srcObject = this.mediaStream;
            video.onloadedmetadata = (e) => {
                video.play();
                // 设置基于帧更新的截图回调
                this.setupFrameCallback();
            };

            // 请求获取选择区域
            document.dispatchEvent(new CustomEvent('getSelectionAreaInfo', {
                detail: {
                    callback: (selectionRect) => {
                        // 计算实际选择区域(考虑缩放因素)
                        var scaleDisplay = displayBounds.scaleFactor;
                        console.log("⚠️⚠️⚠️⚠️displayBounds:", displayBounds);

                        this.screenshotArea = {
                            x: (selectionRect.x + (isMacOs ? (displayBounds.workArea.x - displayBounds.bounds.x) : 0)) * scaleDisplay + 2,
                            y: (selectionRect.y + (isMacOs ? (displayBounds.workArea.y - displayBounds.bounds.y) : 0)) * scaleDisplay + 2,
                            width: (selectionRect.width) * scaleDisplay - 4,
                            height: (selectionRect.height) * scaleDisplay - 4
                        }
                        console.log("screenshotArea:", this.screenshotArea);

                        // 设置画布尺寸
                        window.scaledWidth = 160;
                        window.scaledHeight = this.screenshotArea.height

                        offscreenCanvasOfGray.width = scaledWidth;
                        offscreenCanvasOfGray.height = this.screenshotArea.height


                        // 通知父窗口捕获已开始
                        window.ipcRenderer.sendTo(window.parentSenderId, "pong", {
                            type: "startCapture",
                            rect: this.screenshotArea
                        });
                    }
                }
            }));


        } catch (err) {
            console.error("Error: " + err);

            // 判断是否可以重试
            if (retryCount < this.maxRetryAttempts) {
                console.log(`截图失败，正在尝试第 ${retryCount + 1} 次重试...`);
                updateCtrlNotice(`截图失败，正在尝试第 ${retryCount + 1} 次重试...`);



                // 设置延迟后重试
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve(this.startCapture(retryCount + 1));
                    }, this.retryDelay);
                });
            }

            // 超过最大重试次数，显示错误信息
            const errorText = {
                message: err.message,
                stack: err.stack,
                name: err.name
            };
            // 将纯文本复制到剪贴板
            ztools.copyText(JSON.stringify(errorText, null, 2));
            ztools.showNotification("截图失败，错误信息已经复制到剪贴板");

            console.log("errorText:", errorText);

            // 发送通知
            updateCtrlNotice("截图失败：" + errorText.message);

        }

        // 设置确认标志
        setTimeout(() => { this.confirmFlag = true; }, 50);
    }

    /**
     * 停止捕获屏幕内容
     * 清理媒体流和视频元素
     */
    stopCapture() {
        if (this.mediaStream) {
            // 取消视频帧回调
            if (this.frameCallbackId !== null) {
                const video = document.querySelector("video");
                if (video) {
                    video.cancelVideoFrameCallback(this.frameCallbackId);
                }
                this.frameCallbackId = null;
            }

            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
            const video = document.querySelector("video");
            video.pause(); // 暂停视频播放
            video.srcObject = null; // 清空视频元素的源
            console.log("捕捉已停止");
        } else {
            console.log("没有正在进行的捕捉");
        }
    }

    /**
     * 执行实际的截图操作
     * 从媒体流中获取当前帧，裁剪指定区域，进行图像处理以拼接长截图
     * 根据结果判断是否进行自动滚动
     * @param {Object} rect - 截图区域对象，包含x、y、width、height属性
     */
    async takeScreenshot(rect = this.screenshotArea) {
        if (!this.mediaStream || !this.imageCapture) {
            console.log("没有捕捉到媒体流或imageCapture未初始化");
            updateCtrlNotice("截图失败，请检查权限或重启插件");
            return;
        }

        // 捕获当前视频帧
        const fullBitmap = await this.imageCapture.grabFrame();



        // 直接使用 crop 方法裁剪 ImageBitmap
        const croppedBitmap = await createImageBitmap(fullBitmap, rect.x, rect.y, rect.width, rect.height);

        // 释放完整帧的 ImageBitmap
        fullBitmap.close();

        return croppedBitmap;
    }

    /**
     * 截图并计算距离
     * @param {Object} rect - 截图区域对象，包含x、y、width、height属性
     * @returns {Promise<number>} - 返回计算的距离
     */
    async takeScreenshotAndCalculateDistanse(rect = this.screenshotArea) {
        const croppedBitmap = await this.takeScreenshot(rect);
        return this.imageProcessor.calcuDistanse(croppedBitmap);
    }

    /**
     * 强制追加当前帧到画布末尾
     * 从媒体流中获取当前帧，裁剪指定区域，直接添加到画布
     */
    async forceAppendCurrentFrame() {
        const croppedBitmap = await this.takeScreenshot();
        this.imageProcessor.forceAppendCurrentFrame(croppedBitmap);
    }
}

export default ScreenshotCapture; 