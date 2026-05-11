import { appStatus } from './appStatus.js';

/**
 * 图像处理类
 * 负责图像分析、处理和比较，包括灰度转换和图像匹配
 */
class ImageProcessor {
  constructor(canvasManager) {
    this.lastScalePixelData = null;
    this.currentScalePixelData = null;
    this.accuracy_ = 50; // 假设默认值，应从设置中获取
    this.canvasManager = canvasManager;
    this.contextOfGray = offscreenCanvasOfGray.getContext("2d", { willReadFrequently: true });
    this.imgHeight = null;

    // GPU相关配置
    // this.useGPU = true;
    // this.bestApi = 'webgl2';

    this.unMatchCount = 0;
    this._minAverageAE = 0.18;
    this.minAverageAE = this._minAverageAE;


    // 加载WebAssembly模块
    this.wasmModule = null;
    this.loadWasmModule();
  }

  /**
   * 加载WebAssembly模块
   */
  async loadWasmModule() {
    try {
      // 导入生成的WASM模块
      const wasmModule = await import('../wasm_image_processor.js');
      // 初始化WASM模块
      await wasmModule.default();
      this.wasmModule = wasmModule;
      console.log("WASM模块加载成功");
      
      // 初始化WebGL2上下文
      // await this.initWebGL2Context();
    } catch (err) {
      console.error("加载WASM模块失败:", err);
    }
  }

  /**
   * 初始化WebGL2上下文
   */
  async initWebGL2Context() {
    try {
      if (!this.wasmModule) {
        console.error("WASM模块未加载，无法初始化WebGL2上下文");
        return;
      }

      // 创建临时canvas测试WebGL2功能
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 1;
      tempCanvas.height = 1;
      tempCanvas.id = 'temp-gpu-detect-canvas';
      document.body.appendChild(tempCanvas);
      
      try {
        const contextType = this.wasmModule.create_webgl_context(tempCanvas.id);
        console.log("创建WebGL上下文:", contextType);
        
        if (contextType === "webgl2") {
          this.useGPU = true;
          this.bestApi = 'webgl2';
        } else {
          this.useGPU = false;
          this.bestApi = 'cpu';
        }
      } catch (err) {
        console.error("创建WebGL上下文失败:", err);
        this.useGPU = false;
        this.bestApi = 'cpu';
      } finally {
        // 清理临时canvas
        document.body.removeChild(tempCanvas);
      }
      
      console.log(`使用${this.useGPU ? this.bestApi : 'CPU'}进行图像处理`);
    } catch (err) {
      console.error("初始化WebGL2上下文失败:", err);
      this.useGPU = false;
      this.bestApi = 'cpu';
    }
  }

  /**
   * 计算当前截图与上一张截图的匹配位置
   * 处理灰度矩阵来确定最佳匹配位置，实现智能拼接
   * @param {ImageBitmap} image - 当前截取的图像
   */
  async calcuDistanse(image) {
    try {
      // 如果WASM模块未加载，尝试再次加载
      if (!this.wasmModule) {
        await this.loadWasmModule();
        if (!this.wasmModule) {
          console.error("WASM模块未加载，无法继续处理");
          return { status: -1, message: "处理失败，请重试" };
        }
      }

      this.currentScalePixelData = this.getScaledPixelData(image);

      // 检查图像数据是否有效
      if (!this.currentScalePixelData || this.currentScalePixelData.length === 0) {
        console.error("当前图像数据无效");
        return { status: -1, message: "图像数据无效" };
      }

      // 首次运行时处理
      if (!this.lastScalePixelData) {
        // 首次添加图像，直接追加到画布并保存当前数据
        await this.canvasManager.appendImageToCanvas(image);
        this.lastScalePixelData = this.currentScalePixelData;
        return { status: -1, message: "添加首帧图像" };
      }

      // 检测是否图像相同
      if (this.isImageSame(this.currentScalePixelData, this.lastScalePixelData, 10)) {
        return { status: -1, message: "图像相同" };
      }

      // 使用WASM处理图像匹配
      const result = this.wasmModule.process_images(
        this.currentScalePixelData,
        this.lastScalePixelData,
        scaledWidth,
        20, // minContinuousHeight
        0.6, // minMatchPercent
        this.minAverageAE,   // minAverageAE
        2000000,  // minSumAE
        0.60,  // maxOffsetRatio - 偏移量超过图像高度比例阈值
        0.35,   // maxStartLineRatio - 起始行超过剩余图像高度比例阈值
        0.6,   // blockMatchThreshold - 块匹配率阈值
        0.98,  // highMatchPercentThreshold - 高匹配百分比阈值
        0.7    // maxRegionTopRatio - 区域位于图像上部比例阈值
      );

      console.log("result:", result);

      // 根据WASM处理结果进行操作
      if (result.status === 1) {
        this.unMatchCount = 0;
        this.minAverageAE = this._minAverageAE;

        // 保存当前数据作为下一次比较的基准
        this.lastScalePixelData = this.currentScalePixelData;
        // 从WASM结果中提取最佳匹配并追加图像

        // 当前是否在自动滚动
        if (appStatus.status === "autoScroll") {
          // 如果result.best_match.start_line为0，则不追加图像
          if (result.best_match.start_line < 15) {
            result.best_match.start_line = 15;
          }
        }

        await this.canvasManager.appendImageToCanvas(image, result.best_match);


      }else{
        this.unMatchCount++;
        if(this.unMatchCount > 3 && this.minAverageAE <= 0.8){
          this.minAverageAE += 0.1;
        }
      }

      return result;
    } catch (err) {
      console.error("calcuDistanse 函数出错:", err);
      return;
    }
  }

  // 检测是否图像相同
  isImageSame(currentScalePixelData, lastScalePixelData, threshold) {
    let sum = 0;

    for (let i = 0; i < currentScalePixelData.length; i++) {
      sum += Math.abs(currentScalePixelData[i] - lastScalePixelData[i]);
      if (sum > threshold) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取bitmap的像素数据并转换为灰度
   * @param {ImageBitmap} imageBitmap - 输入的图像位图
   * @returns {Uint8Array} 图像的灰度像素数据
   */
  getScaledPixelData(imageBitmap) {
    // 绘制图像到灰度画布
    this.contextOfGray.drawImage(imageBitmap, 0, 0, scaledWidth, scaledHeight);
    const imageData = this.contextOfGray.getImageData(0, 0, scaledWidth, scaledHeight);

    // 使用Uint32Array视图处理RGBA数据
    const rgba = new Uint32Array(imageData.data.buffer);
    const grayData = new Uint8Array(rgba.length);

    // 使用整数计算进行灰度转换
    for (let i = 0; i < rgba.length; i++) {
      const pixel = rgba[i];
      // 从32位RGBA中提取各通道 (假设小端字节序ABGR格式)
      const r = pixel & 0xff;
      const g = (pixel >> 8) & 0xff;
      const b = (pixel >> 16) & 0xff;

      // 使用与Rust相同的灰度转换权重
      // 原始: r * 0.299 + g * 0.587 + b * 0.114
      // 整数近似: r * 76 + g * 150 + b * 29) >> 8
      const gray = ((r * 76 + g * 150 + b * 29) >> 8);

      // 与Rust代码保持一致的位压缩
      grayData[i] = gray >> 4;
    }

    return grayData;
  }

  /**
   * 强制追加当前帧到画布末尾
   * @param {ImageBitmap} bitmap - 当前帧图像
   */
  async forceAppendCurrentFrame(bitmap) {
    await this.canvasManager.appendImageToCanvas(bitmap);

    // 更新缓存的像素数据，以便下一次比较
    this.lastScalePixelData = this.getScaledPixelData(bitmap);
  }
}

export default ImageProcessor;


