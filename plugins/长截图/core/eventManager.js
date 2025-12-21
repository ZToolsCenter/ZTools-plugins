/**
 * 事件管理器类
 * 负责处理各种事件，包括鼠标和键盘事件
 */
class EventManager {
    constructor(canvasManager, uiController) {
        this.canvasManager = canvasManager;
        this.uiController = uiController;
        
        // 获取appStatus引用
        this.appStatus = window.appStatus;
    }

    /**
     * 初始化所有事件监听器
     */
    initEventListeners() {
        // 鼠标事件
        this.canvasManager.canvas.addEventListener("mousedown", (e) => this.handleMouseDown(e));
        this.canvasManager.canvas.addEventListener("mouseup", () => this.handleMouseUp());
        this.canvasManager.canvas.addEventListener("mousemove", (e) => this.handleMouseMove(e));
        this.canvasManager.canvas.addEventListener("mouseleave", () => this.handleMouseLeave());
        
        // 键盘事件
        document.addEventListener("keydown", (e) => this.handleKeyDown(e));
        document.addEventListener("keyup", (e) => this.handleKeyUp(e));
        
        // 滚轮事件
        document.addEventListener('wheel', (event) => this.handleWheel(event));
    }
    
    /**
     * 检查应用是否处于shop状态
     * @returns {boolean} - 是否处于shop状态
     */
    isShopActive() {
        if (!this.appStatus) {
            this.appStatus = window.appStatus;
        }
        return this.appStatus && this.appStatus.status === "shop";
    }

    /**
     * 处理键盘按键按下事件
     * @param {KeyboardEvent} e - 键盘事件对象
     */
    handleKeyDown(e) {
        // 如果正在显示购买弹窗，除了Escape外不处理其他按键
        if (this.isShopActive()) {
            if (e.key === "Escape") {
                // 允许使用Escape关闭购买弹窗
                document.getElementById('shop_popup_close').click();
            }
            return;
        }
        
        event.preventDefault(); // 阻止默认滚动行为
        
        if (e.key === "Escape") {
            this.uiController.exitShoot();
        }
        if (e.key === "Enter") {
            this.uiController.confirmShoot();
        }
        if (e.key === " ") {
            this.uiController.spaceKeyDown.value = true;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
            if (!isProUser()) return;
            
            if (this.canvasManager.hoveredImage) {
                this.canvasManager.removeHoveredImage();
            }
        }

        console.log(e.key);
        if (e.key == "ArrowDown") {
            if (!isProUser()) return;

            console.log("ArrowDown");
            if (this.canvasManager.hoveredImage) {
                this.canvasManager.draggingImage = this.canvasManager.hoveredImage;
                this.canvasManager.moveAfterImages(1, true);
                this.canvasManager.draggingImage = null;
            }
        }
        if (e.key == "ArrowUp") {
            if (!isProUser()) return;

            console.log("ArrowUp");
            if (this.canvasManager.hoveredImage) {
                this.canvasManager.draggingImage = this.canvasManager.hoveredImage;
                this.canvasManager.moveAfterImages(-1, true);
                this.canvasManager.draggingImage = null;
            }
        }
    }

    /**
     * 处理键盘按键释放事件
     * @param {KeyboardEvent} e - 键盘事件对象
     */
    handleKeyUp(e) {
        // 如果正在显示购买弹窗，不处理任何按键释放
        if (this.isShopActive()) return;
        
        if (e.key === " ") {
            this.uiController.spaceKeyDown.value = false;
        }
    }

    /**
     * 处理鼠标按下事件
     * @param {MouseEvent} e - 鼠标事件对象
     */
    handleMouseDown(e) {
        // 如果正在显示购买弹窗，不处理鼠标点击
        if (this.isShopActive()) return;
        
        if (!isProUser()) return;
        
        const mouseX = e.offsetX;
        const mouseY = e.offsetY;
        
        for (let i = this.canvasManager.images.length - 1; i >= 1; i--) {
            if (this.canvasManager.isInsideImage(mouseX, mouseY, this.canvasManager.images[i])) {
                this.canvasManager.draggingImage = this.canvasManager.images[i];
                this.canvasManager.offsetX = mouseX - this.canvasManager.draggingImage.x;
                this.canvasManager.offsetY = mouseY - this.canvasManager.draggingImage.y;
                break;
            }
        }

        this.canvasManager.canvas.style.transition = "none";
    }

    /**
     * 处理鼠标移动事件
     * @param {MouseEvent} e - 鼠标事件对象
     */
    handleMouseMove(e) {
        // 如果正在显示购买弹窗，不处理鼠标移动
        if (this.isShopActive()) return;
        
        const mouseX = e.offsetX;
        const mouseY = e.offsetY;
        
        this.canvasManager.canvas.style.cursor = this.canvasManager.hoveredImage ? "n-resize" : "default";

        if (this.canvasManager.draggingImage) {
            const deltaY = mouseY - this.canvasManager.offsetY - this.canvasManager.draggingImage.y;
            this.canvasManager.moveAfterImages(deltaY);
        } else {
            let foundHoveredImage = null;
            
            for (let i = this.canvasManager.images.length - 1; i >= 0; i--) {
                if (this.canvasManager.isInsideImage(mouseX, mouseY, this.canvasManager.images[i])) {
                    this.canvasManager.images[i].flash = true;
                    foundHoveredImage = this.canvasManager.images[i];
                    break;
                }
            }

            if (foundHoveredImage !== this.canvasManager.hoveredImage) {
                this.canvasManager.hoveredImage = foundHoveredImage;
                this.canvasManager.drawImages(false);
            }
        }
    }

    /**
     * 处理鼠标释放事件
     */
    handleMouseUp() {
        // 如果正在显示购买弹窗，不处理鼠标释放
        if (this.isShopActive()) return;
        
        this.canvasManager.draggingImage = null;
        this.canvasManager.canvas.style.transition = "";
        this.canvasManager.drawImages();
    }

    /**
     * 处理鼠标离开事件
     */
    handleMouseLeave() {
        // 如果正在显示购买弹窗，不处理鼠标离开
        if (this.isShopActive()) return;
        
        this.canvasManager.draggingImage = null;
        this.canvasManager.hoveredImage = null;
        this.canvasManager.drawImages();
        this.canvasManager.canvas.style.transition = "";
    }

    /**
     * 处理滚轮事件
     * @param {WheelEvent} event - 滚轮事件对象
     */
    handleWheel(event) {
        // 如果正在显示购买弹窗，不处理滚轮事件
        if (this.isShopActive()) return;
        
        // 如果鼠标不在canvas上,则不执行操作
        if (!this.canvasManager.hoveredImage) return;

        // // event.deltaY > 0 表示向下滚动,< 0 表示向上滚动
        // if (event.deltaY > 0) {
        //     console.log('向下滚动');

        //     if (this.canvasManager.canvasScaleLevel > 0.1) {
        //         this.canvasManager.canvasScaleLevel -= 0.05;
        //     }
        // } else if (event.deltaY < 0) {
        //     console.log('向上滚动');
        //     this.canvasManager.canvasScaleLevel += 0.05;
        // }

        // this.canvasManager.drawImages();
    }
}

export default EventManager; 