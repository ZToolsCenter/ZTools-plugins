/**
 * preload.js - ZTools 插件预加载脚本
 * 这里可以使用 Node.js 和 Electron API
 */

const OCR_IMAGE_STORAGE_KEY = "latex_ocr_image";
const OCR_IMAGE_EVENT = "ztools-ocr-image";

const getImageFromAction = (action) => {
  if (!action) return "";
  if (typeof action.payload === "string" && action.payload.startsWith("data:image")) {
    return action.payload;
  }
  if (action.payload && typeof action.payload.img === "string") {
    return action.payload.img;
  }
  if (action.inputState && typeof action.inputState.pastedImage === "string") {
    return action.inputState.pastedImage;
  }
  return "";
};

// 监听插件进入事件
window.exports = {
  /**
   * 插件被调用时触发
   * @param {Object} action - 触发动作信息
   * @param {string} action.code - 功能代码
   * @param {string} action.type - 触发类型 (text/regex/over/img/files)
   * @param {*} action.payload - 携带的数据
   */
  'latex-editor': {
    mode: 'none', // 不显示搜索框
    args: {
      enter: (action, callbackSetList) => {
        // 进入 LaTeX 编辑器
        window.ztools.showMainWindow();
        return [{ title: 'LaTeX 公式编辑器', description: '打开编辑器' }];
      }
    }
  },
  
  'latex-ocr': {
    mode: 'none',
    args: {
      enter: (action, callbackSetList) => {
        // 处理图片 OCR 识别
        if (action.type === 'img') {
          const base64 = getImageFromAction(action);
          if (base64) {
            try {
              window.ztools.dbStorage.setItem(OCR_IMAGE_STORAGE_KEY, base64);
            } catch (e) {
              console.warn("保存图片到 dbStorage 失败", e);
            }
            try {
              window.__ZTOOLS_OCR_IMAGE__ = base64;
              const dispatch = () => {
                window.dispatchEvent(new CustomEvent(OCR_IMAGE_EVENT, { detail: base64 }));
              };
              if (document.readyState === "complete" || document.readyState === "interactive") {
                dispatch();
              } else {
                window.addEventListener("DOMContentLoaded", dispatch, { once: true });
              }
            } catch (e) {
              console.warn("触发 OCR 图片事件失败", e);
            }
          }
          window.ztools.showMainWindow();
        }
        return [{ title: '识别图片转 LaTeX', description: '处理中...' }];
      }
    }
  }
};
