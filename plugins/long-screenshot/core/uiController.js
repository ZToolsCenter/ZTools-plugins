/**
 * UI控制器类
 * 负责处理用户界面交互，包括按钮点击、快捷键和通知显示
 */
import { appStatus } from './appStatus.js';

class UIController {
    constructor(screenshotCapture, canvasManager) {
        this._autoScroll = false;

        this.spaceKeyDown = window.spaceKeyDown;
        this.ctrlNotice = document.getElementById('ctrlNotice'); // 假设已存在
        this.screenshotCapture = screenshotCapture;
        this.canvasManager = canvasManager;
        this.hasSelection = false; // 假设是全局变量

        // 提取DOM元素引用
        this.cutSlider = document.getElementById("cutSlider");
        this.cutBtnSettingSwitch = document.getElementById("cutBtnSettingSwitch");

        this.isDraggingCanvasBox = false;

        // 创建命名的事件处理函数
        this.handleExitAutoScroll = this.handleExitAutoScroll.bind(this);
    }

    /**
     * 处理退出自动滚动的事件
     * @param {Event} event - 事件对象
     */
    handleExitAutoScroll(event) {
        console.log("event:", event);
        this.autoScroll = false;
        window.ipcRenderer.sendTo(window.parentSenderId, "pong", { type: "mouseEnter" });
    }

    /**
     * 更新控制通知区域的文本
     * 仅当文本内容发生变化时才更新DOM
     * @param {string} text - 要显示的通知文本
     */
    updateCtrlNotice(text) {
        if (window.tooLarge) {
            this.ctrlNotice.innerText = "图片高度超过32000，停止添加";
            return;
        }
        if (this.ctrlNotice.innerText !== text) {
            this.ctrlNotice.innerText = text;
        }
    }

    /**
     * 确认截图操作
     * 处理两种模式：1.选择区域并开始捕获；2.完成长截图并保存到剪贴板
     */
    confirmShoot() {
        if (this.hasSelection) {
            const rect = selection.getBoundingClientRect();
            selectionArea = {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
            };

            isDragging = false;
            isMoving = false;
            isResizing = false;
            currentHandle = null;
            this.screenshotCapture.startCapture();

            return;
        }

        if (this.canvasManager.canvas.height < 20) {
            this.screenshotCapture.stopCapture();
            window.close();
        }

        const pngBase64 = this.canvasManager.drawAndToBase64();
        ztools.copyImage(pngBase64);
        ztools.showNotification("截图已复制到剪贴板");

        this.exitShoot();
    }


    /**
     * 退出截图操作
     * 停止捕获，通知父窗口，关闭当前窗口
     */
    exitShoot() {
        window.ipcRenderer.sendTo(window.parentSenderId, "pong", { type: "endCapture" });
        this.screenshotCapture.stopCapture();
        window.close();
    }



    /**
     * 显示按钮扩展提示
     * 为按钮添加悬停提示，显示按钮功能说明
     * @param {HTMLElement} el - 按钮元素
     * @param {string} text - 提示文本
     * @param {boolean} pro - 是否为专业版功能，默认为false
     */
    showBtnEx(el, text, pro = false) {
        if (document.getElementById("BtnEx")) return;
        const BtnEx = document.createElement("div");
        BtnEx.id = "BtnEx";
        BtnEx.className = "btnEx";
        // if (pro) {
        //     BtnEx.innerHTML = "<img src='../assets/pro.svg'>";
        // }

        BtnEx.innerHTML += text;
        el.appendChild(BtnEx);
        this.canvasManager.drawImages();
    }

    /**
     * 显示按钮扩展设置
     * 为按钮添加悬停提示，显示按钮的扩展设置，用于操作
     * @param {string} eleId - 按钮元素的id
     */
    showBtnExSetting(eleId) {
        const ele = document.getElementById(eleId);
        if (!ele) return;
        ele.style.display = "flex";
    }

    /**
     * 隐藏按钮扩展设置
     */
    hideBtnExSetting() {
        document.querySelectorAll('.btnExSetting').forEach(el => {
            el.style.display = "none";
        });
    }

    /**
     * 保存截图到文件
     */
    saveScreenshot() {
        this.screenshotCapture.confirmFlag = false;
        this.screenshotCapture.stopCapture();
        document.body.style.display = "none";

        // 获取当前时间 年月日时分秒 字符串作为文件名
        const nowStr = new Date().toLocaleString().replace(/\s/g, "_").replace(/\/|:|\s/g, "-");

        setTimeout(() => {
            const pngBase64 = this.canvasManager.drawAndToBase64();

            // 移除data:image/png;base64,前缀
            const data = pngBase64.replace(/^data:image\/\w+;base64,/, "");

            let path = ztools.showSaveDialog({
                title: "保存截图",
                defaultPath: `长截图_${nowStr}.png`,
                buttonLabel: "保存",
                filters: [{ name: "Images", extensions: ["png"] }],
            });

            if (path) {
                console.log("保存路径:", path);

                // 直接使用 base64 数据
                window.writeFile(path, data, 'base64', (err) => {
                    if (err) {
                        console.error('保存失败:', err);
                        this.exitShoot();
                        ztools.showNotification('保存截图失败');
                    } else {
                        console.log('文件已保存');
                        ztools.showNotification('截图已成功保存');
                        this.confirmShoot();
                    }
                });
            } else {
                this.confirmShoot();
            }

            this.exitShoot();
        }, 100);
    }


    set autoScroll(value) {


        if (value && isProUser()) {
            window.ipcRenderer.sendTo(window.parentSenderId, "pong", { type: "mouseScroll" });
            // 获取中心点
            const X = window.absoluteRect.x + window.absoluteRect.width - 4;
            const Y = window.absoluteRect.y + 2;

            const screenPoint = ztools.dipToScreenPoint({ x: X, y: Y })
            ztools.simulateMouseMove(screenPoint.x, screenPoint.y)

            // 修改状态
            appStatus.status = "autoScroll";

            // 先移除之前可能存在的事件监听器，再添加新的
            document.removeEventListener("exitAutoScroll", this.handleExitAutoScroll);
            document.addEventListener("exitAutoScroll", this.handleExitAutoScroll);
            document.getElementById("autoBtn").classList.add("scrolling");

            this._autoScroll = true;
        } else if (!value) {
            document.getElementById("autoBtn").classList.remove("scrolling");
            // 移除事件监听器
            document.removeEventListener("exitAutoScroll", this.handleExitAutoScroll);
            this._autoScroll = false;
        }
    }

    get autoScroll() {
        return this._autoScroll;
    }

    /**
     * 将canvas垂直平均切分成指定数量的图片并处理
     * @param {number} count - 切分数量，大于等于2的整数
     * @param {number} type - 操作类型：1-拷贝全部图片到剪贴板，2-保存全部图片到指定路径
     */
    splitCanvasAndProcess(count, type) {
        console.log("splitCanvasAndProcess");
        console.log(count, type);
        // 类型转换
        count = parseInt(count);
        type = parseInt(type);


        if (!Number.isInteger(count) || count < 2) {
            ztools.showNotification("切分数量必须是大于等于2的整数");
            return;
        }

        // 先重绘画布，确保输出的图片上没有分界线
        this.canvasManager.drawImages();

        const canvas = this.canvasManager.canvas;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;

        // 使用calculatePartHeight获取高度信息
        const heightInfo = this.calculatePartHeight(count);
        if (heightInfo.error) {
            ztools.showNotification(heightInfo.error);
            return;
        }

        const partHeight = heightInfo.partHeight;


        // 当前时间字符串，用于文件命名
        const nowStr = new Date().toLocaleString().replace(/\s/g, "_").replace(/\/|:|\s/g, "-");

        // 创建临时目录
        const tempDir = ztools.getPath('temp');

        // 使用Promise处理异步文件写入
        const savePromises = [];
        const tempFilePaths = [];

        // 切分并保存每一部分
        for (let i = 0; i < count; i++) {
            // 计算当前部分的高度（最后一部分可能会略大以处理除法的余数）
            const currentHeight = (i === count - 1) ? heightInfo.lastPartHeight : partHeight;

            // 创建新的canvas用于存储当前部分
            const partCanvas = document.createElement('canvas');
            partCanvas.width = width;
            partCanvas.height = currentHeight;
            const partCtx = partCanvas.getContext('2d');

            // 绘制当前部分
            partCtx.drawImage(
                canvas,
                0, i * partHeight, width, currentHeight,
                0, 0, width, currentHeight
            );

            // 转换为base64
            const partBase64 = partCanvas.toDataURL('image/png').replace(/^data:image\/\w+;base64,/, "");
            const fileName = `长截图分片_${i + 1}_${nowStr}.png`;
            const filePath = `${tempDir}/${fileName}`;

            tempFilePaths.push(filePath);

            // 创建一个Promise来处理文件写入
            const savePromise = new Promise((resolve, reject) => {
                window.writeFile(filePath, partBase64, 'base64', (err) => {
                    if (err) {
                        console.error('保存分片失败:', err);
                        ztools.showNotification(`保存分片${i + 1}失败`);
                        reject(err);
                    } else {
                        resolve(filePath);
                    }
                });
            });

            savePromises.push(savePromise);
        }

        // 等待所有文件写入完成后再处理
        Promise.all(savePromises)
            .then((savedFiles) => {
                console.log('所有分片保存成功:', savedFiles);

                // 根据操作类型处理文件
                if (type == 1) {
                    // 拷贝全部图片文件到剪贴板
                    ztools.copyFile(tempFilePaths);
                    ztools.showNotification(`已将${count}个图片文件复制到剪贴板`);
                    this.exitShoot();
                } else if (type == 2) {
                    // 保存全部文件到询问的路径
                    const saveDir = ztools.showOpenDialog({
                        title: '选择保存目录',
                        properties: ['openDirectory']
                    });

                    if (saveDir && saveDir.length > 0) {
                        const targetDir = saveDir[0];
                        let successCount = 0;

                        // 使用Promise处理文件复制
                        const copyPromises = tempFilePaths.map((tempPath, index) => {
                            const fileName = `长截图分片_${index + 1}_${nowStr}.png`;
                            const targetPath = `${targetDir}/${fileName}`;

                            return new Promise((resolve, reject) => {
                                window.copyFile(tempPath, targetPath, (err) => {
                                    if (err) {
                                        console.error(`保存文件失败: ${targetPath}`, err);
                                        reject(err);
                                    } else {
                                        resolve(targetPath);
                                    }
                                });
                            });
                        });

                        Promise.all(copyPromises)
                            .then((copiedFiles) => {
                                console.log('所有文件已复制到目标目录:', copiedFiles);
                                ztools.showNotification(`已将${count}个图片文件保存到: ${targetDir}`);
                                this.exitShoot();
                            })
                            .catch((error) => {
                                console.error('文件复制过程中出错:', error);
                                ztools.showNotification('部分文件保存失败，请查看控制台日志');
                            });
                    }
                }
            })
            .catch((error) => {
                console.error('文件保存过程中出错:', error);
                ztools.showNotification('图片切分保存失败');
            });
    }

    /**
     * 计算Canvas垂直平均分割后每份的高度
     * @param {number} count - 分割份数，大于等于1的整数
     * @returns {Object} 包含每份高度和最后一份高度的对象
     */
    calculatePartHeight(count) {
        if (!Number.isInteger(count) || count < 1) {
            return { error: "分割份数必须是大于等于1的整数" };
        }

        const canvas = this.canvasManager.canvas;
        const totalHeight = canvas.height;

        // 如果只有一份，则返回全部高度
        if (count === 1) {
            return {
                partHeight: totalHeight,
                lastPartHeight: totalHeight,
                totalHeight: totalHeight
            };
        }

        // 计算平均高度
        const partHeight = Math.floor(totalHeight / count);

        // 最后一份可能会略大以处理除法的余数
        const lastPartHeight = totalHeight - (count - 1) * partHeight;

        return {
            partHeight: partHeight,
            lastPartHeight: lastPartHeight,
            totalHeight: totalHeight
        };
    }

    onCutBtnInputChange(event) {
        console.log("onCutBtnInputChange");
        // 更新显示的数值
        const input = event.target;
        const valueSpan = input.nextElementSibling;
        valueSpan.textContent = input.value;

        // 计算分割高度信息
        const count = parseInt(input.value);
        const heightInfo = this.calculatePartHeight(count);

        // 创建或更新结果显示
        let resultInfo = document.getElementById('cutBtnResultInfo');

        if (heightInfo.error) {
            resultInfo.textContent = heightInfo.error;
        } else {
            resultInfo.textContent = `每份高度: ${heightInfo.partHeight}px`;

            // 计算分界线的y坐标
            const dividerLines = [];
            const partHeight = heightInfo.partHeight;

            // 只绘制每份之间的分界线，最后一份不需要分界线
            for (let i = 1; i < count; i++) {
                dividerLines.push(i * partHeight);
            }

            // 重绘画布上的图像
            this.canvasManager.drawImages();

            // 绘制预览分界线
            this.canvasManager.drawHorizontalLines(dividerLines, 'rgba(0, 102, 255, 0.8)', 2);
        }
    }

    /**
     * 初始化所有UI事件监听器
     */
    initEventListeners() {
        console.log("initEventListeners");
        document.getElementById("confirmBtn").addEventListener("click", () => this.confirmShoot());
        document.getElementById("exitBtn").addEventListener("click", () => this.exitShoot());
        document.getElementById("saveBtn").addEventListener("click", () => this.saveScreenshot());
        // document.getElementById("settingBtn").addEventListener("click", () => {
        //     this.screenshotCapture.stopCapture();
        //     window.close();
        //     ztools.redirect("长截图设置");
        // });

        document.getElementById("questionBtn").addEventListener("click", () => {
            window.newStudentGuidance.showGuidanceCard();
        });

        // ————————————————————转接功能——————————————————————————————————————

        // document.getElementById("floatBtn").addEventListener("click", () => {
        //     if (!isProUser()) return;
        //     const pngBase64 = this.canvasManager.drawAndToBase64();
        //     ztools.redirect(['悬浮', '悬浮'], {
        //         'type': 'img',
        //         'data': pngBase64
        //     });
        //     this.confirmShoot();
        // });

        // document.getElementById("editBtn").addEventListener("click", () => {
        //     if (!isProUser()) return;
        //     const pngBase64 = this.canvasManager.drawAndToBase64();
        //     ztools.redirect(['截图工具 Plus', '图片编辑'], {
        //         'type': 'img',
        //         'data': pngBase64
        //     });
        //     this.confirmShoot();
        // });

        // document.getElementById("uploadBtn").addEventListener("click", () => {
        //     if (!isProUser()) return;
        //     const pngBase64 = this.canvasManager.drawAndToBase64();
        //     ztools.redirect(['图床', '上传到图床'], {
        //         'type': 'img',
        //         'data': pngBase64
        //     });
        //     this.confirmShoot();
        // });

        // document.getElementById("ocrBtn").addEventListener("click", () => {
        //     if (!isProUser()) return;
        //     const pngBase64 = this.canvasManager.drawAndToBase64();
        //     ztools.redirect(['OCR 文字识别'], {
        //         'type': 'img',
        //         'data': pngBase64
        //     });
        //     this.confirmShoot();
        // });

        // document.getElementById("cutBtn").addEventListener("click", (event) => {
        //     ztools.showNotification("cutBtn");

        //     // 排除点击在BtnExSetting中
        //     const btnExSetting = document.getElementById("cutBtnSetting");
        //     if (btnExSetting && btnExSetting.contains(event.target)) {
        //         console.log("点击在BtnExSetting中");
        //         return;
        //     }

        //     if (!isProUser()) return;
        //     this.splitCanvasAndProcess(this.cutSlider.value, settings.config.cutBtnType);
        // });



        // ————————————————————————————————————————————————————————————————————————————


        document.getElementById("forceBtn").addEventListener("click", async () => {
            if (!isProUser()) return;
            this.screenshotCapture.forceAppendCurrentFrame();
        });

        // document.getElementById("autoBtn").addEventListener("click", () => {
        //     if (!isProUser()) return;
        //     this.autoScroll = !this.autoScroll;
        // });



        // 移动按钮，拖拽移动canvas
        document.getElementById("moveBtn").addEventListener("mousedown", (event) => {
            event.preventDefault();
            this.startMouseX = event.clientX;
            this.startMouseY = event.clientY;

            this.deltaX = this.startMouseX - this.canvasManager.canvasBox.offsetLeft;
            this.deltaY = this.startMouseY - (this.canvasManager.canvasBox.offsetTop + this.canvasManager.canvasBox.offsetHeight);

            this.isDraggingCanvasBox = true;
        });

        document.addEventListener("mouseup", () => {
            this.isDraggingCanvasBox = false;
        });

        document.addEventListener("mousemove", (event) => {

            if (this.isDraggingCanvasBox) {
                this.canvasManager.moveCanvas(event.clientX, event.clientY, this.deltaX, this.deltaY);
            }
        });

        document.getElementById("zoominBtn").addEventListener("click", () => {
            this.canvasManager.canvasScaleLevel += this.canvasManager.canvasScaleLevel * 0.3;

        });

        document.getElementById("zoomoutBtn").addEventListener("click", () => {
            this.canvasManager.canvasScaleLevel -= this.canvasManager.canvasScaleLevel * 0.3;

        });

        document.getElementById("bothmoveBtn").addEventListener("click", () => {
            this.spaceKeyDown.value = !this.spaceKeyDown.value;
        });




        // this.cutSlider.addEventListener("input", (event) => {
        //     this.onCutBtnInputChange(event);
        // });

        // this.cutBtnSettingSwitch.setAttribute("data-switch", settings.getConfig().cutBtnType);

        // this.cutBtnSettingSwitch.addEventListener("click", (event) => {

        //     if (this.cutBtnSettingSwitch.getAttribute("data-switch") === "1") {
        //         this.cutBtnSettingSwitch.setAttribute("data-switch", "2");
        //         settings.updateConfig("cutBtnType", 2);
        //     } else {
        //         this.cutBtnSettingSwitch.setAttribute("data-switch", "1");
        //         settings.updateConfig("cutBtnType", 1);
        //     }
        // });


        // 按钮提示事件
        const btnBox = document.getElementById('btnBox');

        btnBox.addEventListener('mouseover', (event) => {
            // 确保找到的元素是 btnBox 的直接子元素
            if (event.target.classList.contains('ctrlBtn')) {
                // 移除所有现有的拓展弹窗
                document.querySelectorAll('.btnEx').forEach(el => {
                    if (!el.classList.contains('btnExSetting')) {
                        el.remove();
                    }
                });
                this.hideBtnExSetting();

                // 根据不同的按钮ID显示不同的拓展弹窗
                switch (event.target.id) {
                    case "confirmBtn":
                        this.showBtnEx(event.target, "保存到剪贴板");
                        break;
                    case "exitBtn":
                        this.showBtnEx(event.target, "退出");
                        break;
                    case "saveBtn":
                        this.showBtnEx(event.target, "保存到文件夹和剪贴板");
                        break;
                    case "questionBtn":
                        this.showBtnEx(event.target, "查看使用教程");
                        break;
                    case "floatBtn":
                        this.showBtnEx(event.target, "悬浮并复制到剪贴板", true);
                        break;
                    case "editBtn":
                        this.showBtnEx(event.target, "编辑", true);
                        break;
                    case "uploadBtn":
                        this.showBtnEx(event.target, "上传到图床", true);
                        break;
                    case "ocrBtn":
                        this.showBtnEx(event.target, "OCR文字识别", true);
                        break;
                    case "settingBtn":
                        this.showBtnEx(event.target, "打开设置");
                        break;
                    case "forceBtn":
                        this.showBtnEx(event.target, "强制添加当前截图到末尾", true);
                        break;
                    case "autoBtn":
                        this.showBtnEx(event.target, "自动滚动（通过发送↓按键，有局限）", true);
                        break;
                    case "cutBtn":

                        this.showBtnExSetting("cutBtnSetting");

                        // 触发input事件
                        this.onCutBtnInputChange({ target: document.getElementById("cutSlider") });
                        break;
                }
            }
        });

        btnBox.addEventListener('mouseout', function (event) {
            // 检查鼠标是否真的离开了 btnBox 或其子元素
            if (!this.contains(event.relatedTarget)) {
                // 移除所有拓展弹窗
                document.querySelectorAll('.btnEx').forEach(el => {
                    if (!el.classList.contains('btnExSetting')) {
                        el.remove();
                    }
                });
            }
        });

        // 处理IPC消息
        ipcRenderer.on("exc", (event, arg) => {
            console.log(event);
            console.log(arg);
            if (arg.type === "start") {
                console.log("confirmFlag");
                this.confirmShoot();
            } else if (arg.type === "exit") {
                console.log("exitFlag");
                this.exitShoot();
            } else if (arg.type === "setting") {
                console.log("settingFlag");
                this.screenshotCapture.stopCapture();
                window.close();
                ztools.redirect("长截图设置");
            }
        });
    }
}

export default UIController; 