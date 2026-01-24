// 二维码识别管理器
class QRCodeManager {
    constructor() {
        this.jsQRLoaded = false;
        this.loadJsQR();
    }

    // 加载 jsQR 库
    loadJsQR() {
        if (typeof jsQR !== 'undefined') {
            this.jsQRLoaded = true;
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'assets/jsqr/jsQR.js';
            script.onload = () => {
                this.jsQRLoaded = true;

                resolve();
            };
            script.onerror = (error) => {
                console.error('jsQR 库加载失败:', error);
                reject(error);
            };
            document.head.appendChild(script);
        });
    }

    // 从 base64 图片中检测并识别二维码
    async detectQRCode(imageBase64) {
        try {
            // 确保 jsQR 库已加载
            if (!this.jsQRLoaded) {
                await this.loadJsQR();
            }

            // 检查 jsQR 是否可用
            if (typeof jsQR === 'undefined') {
                console.warn('jsQR 库未加载,跳过二维码检测');
                return null;
            }

            // 将 base64 图片转换为 ImageData
            const imageData = await this.base64ToImageData(imageBase64);
            
            if (!imageData) {
                console.warn('无法将图片转换为 ImageData');
                return null;
            }

            // 使用 jsQR 检测二维码
            const startTime = performance.now();
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "attemptBoth", // 尝试正常和反色两种模式
            });
            const endTime = performance.now();

            if (code) {

                return {
                    success: true,
                    data: code.data,
                    location: code.location,
                    binaryData: code.binaryData,
                    version: code.version,
                    detectionTime: endTime - startTime
                };
            } else {

                return null;
            }
        } catch (error) {
            console.error('二维码检测失败:', error);
            return null;
        }
    }

    // 将 base64 图片转换为 ImageData
    async base64ToImageData(base64) {
        return new Promise((resolve, reject) => {
            try {
                const img = new Image();
                
                img.onload = () => {
                    try {
                        // 创建 canvas
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        
                        const ctx = canvas.getContext('2d');
                        if (!ctx) {
                            reject(new Error('无法获取 canvas context'));
                            return;
                        }

                        // 绘制图片到 canvas
                        ctx.drawImage(img, 0, 0);
                        
                        // 获取 ImageData
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        resolve(imageData);
                    } catch (error) {
                        reject(error);
                    }
                };

                img.onerror = (error) => {
                    reject(new Error('图片加载失败: ' + error));
                };

                // 设置图片源
                img.src = base64;
            } catch (error) {
                reject(error);
            }
        });
    }

    // 检查是否启用了二维码识别功能
    isQRCodeDetectionEnabled(config) {
        // 默认启用二维码识别
        return config?.enableQRCodeDetection !== false;
    }

    // 格式化二维码识别结果用于显示
    // 返回纯文本内容，不添加任何前缀或格式化信息
    formatQRCodeResult(qrResult) {
        if (!qrResult || !qrResult.success) {
            return null;
        }

        // 直接返回二维码的原始内容，不添加任何额外信息
        return qrResult.data;
    }

    // 判断是否应该继续进行 OCR 识别
    shouldContinueOCR(qrResult, config) {
        // 如果没有检测到二维码,继续 OCR
        if (!qrResult || !qrResult.success) {
            return true;
        }

        // 如果配置中设置了"检测到二维码后仍然进行 OCR",则继续
        if (config?.continueOCRAfterQRCode === true) {
            return true;
        }

        // 默认情况下,检测到二维码后不再进行 OCR
        return false;
    }

    // 合并二维码结果和 OCR 结果
    mergeResults(qrResult, ocrResult) {
        if (!qrResult || !qrResult.success) {
            return ocrResult;
        }

        if (!ocrResult || !ocrResult.success) {
            return {
                success: true,
                text: this.formatQRCodeResult(qrResult),
                isQRCode: true,
                qrCodeData: qrResult.data
            };
        }

        // 合并两种结果
        const mergedText = this.formatQRCodeResult(qrResult) + '\n\n' + 
                          '【OCR 文字识别结果】\n\n' + 
                          ocrResult.text;

        return {
            success: true,
            text: mergedText,
            hasQRCode: true,
            qrCodeData: qrResult.data,
            ocrText: ocrResult.text,
            confidence: ocrResult.confidence
        };
    }

    // 检测图片中是否可能包含二维码(快速预检测)
    async quickCheck(imageBase64) {
        try {
            // 创建一个小尺寸的图片进行快速检测
            const smallImageData = await this.base64ToImageData(imageBase64, 200); // 限制最大宽度为200px
            
            if (!smallImageData) {
                return false;
            }

            // 简单的黑白像素比例检测
            const data = smallImageData.data;
            let blackPixels = 0;
            let whitePixels = 0;
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const brightness = (r + g + b) / 3;
                
                if (brightness < 128) {
                    blackPixels++;
                } else {
                    whitePixels++;
                }
            }

            const totalPixels = blackPixels + whitePixels;
            const blackRatio = blackPixels / totalPixels;

            // 二维码通常有 30%-70% 的黑色像素
            return blackRatio > 0.2 && blackRatio < 0.8;
        } catch (error) {
            console.warn('快速检测失败:', error);
            return true; // 检测失败时默认继续完整检测
        }
    }
}

// 导出为全局变量
if (typeof window !== 'undefined') {
    window.QRCodeManager = QRCodeManager;
}

