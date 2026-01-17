/**
 * 画布管理类
 * 负责管理画布大小、图像绘制和导出等功能
 */
class CanvasManager {
    constructor() {
        this.canvasBox = document.getElementById('canvasBox');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvasCtrlBox = document.getElementById('canvasCtrlBox');
        this.canvasBoxAbsolute = document.getElementById('canvasBoxAbsolute');
        this.images = [];
        this._canvasScaleLevel = 0.4;
        this.hoveredImage = null;
        this.draggingImage = null;

        this.offsetX = 0;
        this.offsetY = 0;

        this.lastImageAnchor = { x: 0, y: 0, startLine: 0 };

        this.singleImageHeight = 0;

        this.anchor = null;   // 锚点X坐标

        // 初始化canvasBox滚动事件监听
        this.canvasBox.addEventListener('scroll', () => {
            this.drawImages();
        });
    }

    /**
     * 获取画布缩放级别
     * @returns {number} 画布缩放级别
     */
    get canvasScaleLevel() {
        return this._canvasScaleLevel;
    }

    /**
     * 设置画布缩放级别并更新画布大小
     * @param {number} value - 新的缩放级别
     */
    set canvasScaleLevel(value) {
        this._canvasScaleLevel = Math.max(0.1, Math.min(2.0, value)); // 限制缩放级别在0.1到1.0之间
        this.drawImages();
    }

    /**
     * 更新画布大小
     * 根据所有图像块的位置和尺寸计算需要的画布大小，并应用缩放
     */
    updateCanvasSize() {
        let maxX = 0,
            maxY = 0;

        this.images.forEach((image) => {
            if (image.bitmap) {
                maxX = Math.max(maxX, image.x + image.width);
                maxY = Math.max(maxY, image.y + image.height);
            }
        });

        // 如果没有变化，不更新
        if (this.canvas.width === maxX && this.canvas.height === maxY &&
            this.canvas.style.transform === `scale(${this.canvasScaleLevel})`
        ) {
            return;
        }

        this.canvas.width = maxX;
        this.canvas.height = maxY;


        this.canvasBoxAbsolute.style.height = `${this.canvas.height * this.canvasScaleLevel}px`;
        this.canvasBoxAbsolute.style.width = `${this.canvas.width * this.canvasScaleLevel}px`;

        this.canvas.style.transform = `scale(${this.canvasScaleLevel})`;

        this.updateCanvasBoxSize();
    }

    updateCanvasBoxSize() {
        this.canvasBox.style.display = "block";
        this.canvasCtrlBox.style.display = "flex";

        // 设置canvasBox的宽度与canvas缩放后的宽度一致
        this.canvasBox.style.width = `${this.canvasBoxAbsolute.width + 8}px`;

        const heightOfBox = this.canvas.height * this.canvasScaleLevel;

        if (heightOfBox > this.anchor.y) {
            this.canvasBox.style.height = `${this.anchor.y}px`;
        } else {
            this.canvasBox.style.height = `${heightOfBox}px`;
        }

    }

    /**
     * 在画布上绘制所有图像
     * 根据可见性状态只绘制需要刷新的图像，优化性能
     * 根据spaceKeyDown.value状态决定绘制行为：
     * - 当为true时，只在悬停图像上高亮
     * - 当为false时，在悬停图像及其后面的所有图像上高亮
     * @param {boolean} toUpdateCanvasSize - 是否需要更新画布大小
     */
    drawImages(toUpdateCanvasSize = true) {
        if (toUpdateCanvasSize) {
            this.updateCanvasSize();
        } else {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // this.hoveredImage 在this.images的index
        const hoverdIndex = this.images.findIndex(image => image === this.hoveredImage);


        let num = 0;
        this.images.forEach((image, index) => {
            this.setVisibleImageFlash(image);

            // console.log("image.flash:", image.flash);

            if (image.bitmap && image.flash) {
                num++;

                if (index === 0) {
                    // 绘制一个矩形
                    this.ctx.globalAlpha = 1;
                    this.ctx.drawImage(image.bitmap, image.x, image.y, image.width, image.height);

                    if (index === hoverdIndex) {
                        // image.bitmap 半透明
                        this.ctx.globalAlpha = 0.5;
                        // 绘制半透明矩形
                        this.ctx.fillStyle = 'rgba(62, 105, 255, 0.06)';
                        this.ctx.fillRect(image.x, image.y, image.width, image.height);
                    }
                } else {
                    // 绘制一个矩形

                    if (hoverdIndex === -1) {
                        this.ctx.globalAlpha = 1;
                        this.ctx.drawImage(image.bitmap, image.x, image.y, image.width, image.height);
                    } else if (index === hoverdIndex) {
                        // 当前悬停图像，添加蓝色边框
                        this.ctx.beginPath();
                        this.ctx.strokeStyle = 'blue';
                        this.ctx.lineWidth = 1;
                        this.ctx.moveTo(image.x, image.y);
                        this.ctx.lineTo(image.x + image.width, image.y);
                        this.ctx.stroke();

                        // 以半透明方式绘制悬停图像
                        this.ctx.globalAlpha = 0.8;
                        this.ctx.drawImage(image.bitmap, image.x, image.y, image.width, image.height);

                        // 绘制半透明矩形
                        this.ctx.fillStyle = 'rgba(62, 105, 255, 0.06)';
                        this.ctx.fillRect(image.x, image.y, image.width, image.height);

                    } else if (index > hoverdIndex && !window.spaceKeyDown.value) {
                        // 悬停图像之后的图像，仅在整体模式（spaceKeyDown.value为false）时高亮
                        // image.bitmap 半透明
                        this.ctx.globalAlpha = 0.8;
                        this.ctx.drawImage(image.bitmap, image.x, image.y, image.width, image.height);
                        // 绘制半透明矩形
                        this.ctx.fillStyle = 'rgba(62, 105, 255, 0.06)';
                        this.ctx.fillRect(image.x, image.y, image.width, image.height);
                    } else {
                        // 其他情况正常绘制
                        this.ctx.globalAlpha = 1;
                        this.ctx.drawImage(image.bitmap, image.x, image.y, image.width, image.height);
                    }
                }

                image.flash = false;
            }
        });

        console.log("num:", num);
    }


    /**
     * 添加图像到画布
     * 处理图像拼接的逻辑，添加新图像到图像数组，更新画布并滚动到底部
     * @param {ImageBitmap} bitmap - 要添加的图像
     * @param {number} x - 图像的X坐标
     * @param {number} y - 图像的Y坐标
     * @param {number} top - 图像的顶部偏移量
     * @param {number} right - 图像的右侧偏移量
     * @param {number} bottom - 图像的底部偏移量
     * @param {number} left - 图像的左侧偏移量
     */
    async addImageToCanvas(bitmap, x, y, top = 0, right = 0, bottom = 0, left = 0) {


        if (y + bitmap.height >= 32000) {
            alert("图片高度超过32000，停止添加");
            window.tooLarge = true;
            return;
        } else {
            window.tooLarge = false;
        }


        if (top > 0 || right > 0 || bottom > 0 || left > 0) {
            // 裁剪图像
            bitmap = await createImageBitmap(
                bitmap,
                left,
                top,
                bitmap.width - left - right,
                bitmap.height - top - bottom
            );
            x = x + left;
            y = y + top;
        }


        // 智能拼接逻辑：如果已有至少两张图片，且新图片与倒数第二张图片有重叠
        if (this.images.length >= 2) {
            // 判断新图片的顶部是否在倒数第二张图片的底部以上（有重叠）
            if (y + scaledHeight / 4 <= this.images[this.images.length - 2].y + this.images[this.images.length - 2].height) {
                // 移除最后一个元素（通常是临时预览图）
                this.images[this.images.length - 1].bitmap.close(); // 释放bitmap资源
                this.images.pop(); // 从数组中移除
            }
        }


        // 将新图像添加到图像数组
        this.images.push({
            bitmap: bitmap,  // 图像位图
            x: x,            // X坐标
            y: y,            // Y坐标
            width: bitmap.width, // 宽度
            height: bitmap.height, // 高度
            flash: false     // 闪烁状态标记，用于优化渲染
        });

        // 重绘画布显示新添加的图像
        this.drawImages();
        // 滚动到画布底部，显示新添加的内容
        this.canvasBox.scrollTop = this.canvasBox.scrollHeight;
    }

    /**
     * 设置可见图像的闪烁状态
     * 根据图像在可视区域内的位置判断是否需要重绘该图像
     * @param {Object} image - 图像对象
     */
    setVisibleImageFlash(image) {
        // 图片的顶部百分比
        const topPercent = image.y / this.canvas.height;
        // 图片的底部百分比
        const bottomPercent = (image.y + image.height) / this.canvas.height;

        // 容器可视区域的顶部百分比
        const visibleTopPercent = this.canvasBox.scrollTop / this.canvasBox.scrollHeight;
        // 容器可视区域的底部百分比
        const visibleBottomPercent = (this.canvasBox.scrollTop + this.canvasBox.clientHeight) / this.canvasBox.scrollHeight;

        // 图片有任意部分在可视区域内
        const isVisible = topPercent < visibleBottomPercent + 0.05 && bottomPercent > visibleTopPercent - 0.05;

        if (isVisible) {
            image.flash = true;
        }
    }

    /**
     * 判断坐标点是否在图像内
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {Object} image - 图像对象
     * @returns {boolean} 坐标是否在图像内
     */
    isInsideImage(x, y, image) {
        return x >= image.x && x <= image.x + image.width &&
            y >= image.y && y <= image.y + image.height;
    }

    /**
     * 移动指定图像后面的所有图像
     * 支持整体移动或只移动当前图像后的所有图像
     * @param {number} deltaY - Y方向的移动距离
     * @param {boolean} toUpdateCanvasSize - 是否需要更新画布大小
     */
    moveAfterImages(deltaY, toUpdateCanvasSize = false) {
        if (this.draggingImage.y + deltaY < 50) {
            return;
        }

        if (window.spaceKeyDown.value) {
            this.draggingImage.y += deltaY;
            this.drawImages(toUpdateCanvasSize);
            return;
        }


        let maxY = 0;

        this.images.forEach((image) => {
            if (image.y > maxY) {
                maxY = image.y;
            }
        });

        if (maxY + deltaY + this.images[this.images.length - 1].height >= 32000) {
            // alert("图片高度超过32000，停止移动");
            window.tooLarge = true;
            return;
        } else {
            window.tooLarge = false;
        }


        this.images.forEach((image) => {
            if (image.y >= this.draggingImage.y) {
                image.y += deltaY;
            }
        });

        this.drawImages(toUpdateCanvasSize);
    }

    /**
     * 将画布转换为Base64编码的图像
     * @param {string} format - 输出格式，默认为 "image/png"
     * @param {number} quality - 输出质量，默认为 1.0
     * @returns {string} Base64编码的图像数据
     */
    canvasToBase64(format = "image/png", quality = 1.0) {
        return this.canvas.toDataURL(format, quality);
    }

    /**
     * 绘制所有图像并输出Base64编码
     * 确保画布大小正确，绘制所有图像后转换为Base64
     * @returns {string} Base64编码的图像数据
     */
    drawAndToBase64() {
        this.updateCanvasSize();

        this.images.forEach((image) => {
            if (image.bitmap) {
                this.ctx.drawImage(image.bitmap, image.x, image.y, image.width, image.height);
            }
        });

        return this.canvasToBase64();
    }

    /**
     * 根据选区位置计算并显示canvasBox
     * @param {Object} selectionRect - 选区矩形，包含x, y, width, height属性
     */
    showCanvasBoxPosition(selectionRect) {
        this.canvasBox.style.left = `${selectionRect.x + selectionRect.width + 12}px`;
        const windowHeight = window.innerHeight;
        const windowBottom = windowHeight - selectionRect.y - selectionRect.height + 40;
        this.canvasBox.style.bottom = `${windowBottom}px`;



        this.canvasCtrlBox.style.left = `${selectionRect.x + selectionRect.width + 12}px`;
        this.canvasCtrlBox.style.bottom = `${windowBottom}px`;

        this.anchor = {
            x: selectionRect.x + selectionRect.width + 12,
            y: selectionRect.y + selectionRect.height - 40
        }


    }


    moveCanvas(clientX, clientY, deltaX, deltaY) {


        const left = clientX - deltaX;
        const bottom = window.innerHeight - clientY + deltaY;



        this.canvasBox.style.left = `${left}px`;
        this.canvasBox.style.bottom = `${bottom}px`;

        this.canvasCtrlBox.style.left = `${left}px`;
        this.canvasCtrlBox.style.bottom = `${bottom}px`;

        // 更新 anchor 坐标，同步移动距离
        if (this.anchor) {
            this.anchor.x = left;
            this.anchor.y = clientY - deltaY;
        }

        this.updateCanvasBoxSize();
    }



    /**
     * 追加图片到画布末尾
     * @param {ImageBitmap} bitmap - 要添加的图像
     * @param {dict} bestMatch - 最佳匹配行，默认为null
     */
    appendImageToCanvas(bitmap, bestMatch = null) {
        if (this.images.length === 0) {
            // 如果没有图片
            this.lastImageAnchor = { x: 0, y: 0, startLine: 0 };
            this.singleImageHeight = bitmap.height;
        } else if (bestMatch) {
            // 如果存在最佳匹配对象组
            this.lastImageAnchor = {
                x: 0,
                y: this.canvas.height - this.singleImageHeight + bestMatch.offset,
                startLine: bestMatch.start_line == 0 ? 0 : bestMatch.start_line + 10
            };
            console.log(
                "lastImageAnchor:", this.lastImageAnchor,
                "this.canvas.height:", this.canvas.height,
                "this.singleImageHeight:", this.singleImageHeight,
                "best_match_row:", bestMatch.offset,
                "startLine:", bestMatch.start_line
            );
        } else {
            // canvas的底部
            this.lastImageAnchor = { x: 0, y: this.canvas.height, startLine: 0 };
        }

        // 添加图片到画布
        this.addImageToCanvas(
            bitmap,
            this.lastImageAnchor.x,
            this.lastImageAnchor.y,
            this.lastImageAnchor.startLine
        );
    }

    /**
     * 根据传入的y坐标列表在canvas上绘制横向蓝色线条
     * @param {Array<number>} yCoordinates - y坐标列表
     * @param {string} color - 线条颜色，默认为蓝色
     * @param {number} lineWidth - 线条宽度，默认为1
     */
    drawHorizontalLines(yCoordinates, color = 'blue', lineWidth = 1) {
        if (!yCoordinates || !Array.isArray(yCoordinates) || yCoordinates.length === 0) {
            return;
        }

        this.ctx.beginPath();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineWidth;

        yCoordinates.forEach(y => {
            // 确保y坐标在画布范围内
            if (y >= 0 && y <= this.canvas.height) {
                this.ctx.moveTo(0, y);
                this.ctx.lineTo(this.canvas.width, y);
            }
        });

        this.ctx.stroke();
    }

    /**
     * 移除当前悬停的图像
     * 如果有悬停的图像，则从images数组中移除并重绘画布
     * 根据spaceKeyDown.value状态决定删除行为：
     * - 当为true时，只删除当前悬停图像
     * - 当为false时，删除当前悬停图像及其后面的所有图像
     * @returns {boolean} 是否成功移除图像
     */
    removeHoveredImage() {
        if (!this.hoveredImage || this.hoveredImage === this.images[0]) {
            return false; // 没有悬停图像或悬停的是第一张图片（通常是背景），不执行操作
        }

        const index = this.images.findIndex(image => image === this.hoveredImage);
        if (index !== -1) {
            if (window.spaceKeyDown.value) {
                // 单张模式：只删除当前悬停的图像
                // 释放bitmap资源
                if (this.hoveredImage.bitmap) {
                    this.hoveredImage.bitmap.close();
                }

                // 从数组中移除
                this.images.splice(index, 1);
            } else {
                // 整体模式：删除当前悬停图像及其后面的所有图像
                // 从当前索引开始，删除到数组末尾的所有元素
                for (let i = this.images.length - 1; i >= index; i--) {
                    // 释放bitmap资源
                    if (this.images[i].bitmap) {
                        this.images[i].bitmap.close();
                    }
                }

                // 从数组中移除
                this.images.splice(index);
            }

            // 清除悬停引用
            this.hoveredImage = null;

            // 重绘画布
            this.drawImages();
            return true;
        }

        return false;
    }

}

export default CanvasManager; 