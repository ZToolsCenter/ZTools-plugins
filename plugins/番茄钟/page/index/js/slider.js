/*
    滑块组件
    sliderContainerId: 滑块容器id
    sliderThumbId: 滑块拖动块id
    minValue: 最小值
    maxValue: 最大值
    fix: 小数位
    step: 步长
    unit: 单位
    settingsConfigInstance: 配置实例
    configKey: 配置key
*/
class Slider {
    constructor(sliderContainerId, sliderThumbId, minValue, maxValue, fix = 1, step = 1, unit = '', settingsConfigInstance, configKey,callbackMode = 'release') {
        this.sliderContainerId = sliderContainerId;
        this.sliderContainer = document.getElementById(sliderContainerId);
        this.sliderThumb = document.getElementById(sliderThumbId);
        this.fillElement = document.createElement("div");
        this.fillElement.classList.add("slider-fill");
        this.sliderContainer.appendChild(this.fillElement);
        this.unit = unit;
        this.callbackMode = callbackMode;
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.isDragging = false;
        this.offsetX = 0; // 新增偏移量属性
        this.fix = fix;
        this.step = step; // 新增步长属性

        this.sliderThumb.setAttribute("unit", this.unit);

        this.settingsConfigInstance = settingsConfigInstance;
        this.configKey = configKey;

        // 初始化滑块位置
        this.setSliderPositionByValue(this.settingsConfigInstance.config[this.configKey]);

        this.attachEventListeners();
        this.onMouseUp = () => { };
        this.beforeCheck = () => { };
    }

    updateConfigValue(){
        const delay = this.calculateSliderValue();
        console.log("当前滑块值：", delay);

        // 更新配置
        this.settingsConfigInstance.updateConfig(this.configKey, delay);
        this.onMouseUp();
    }

    attachEventListeners() {
        // 滑块拖动事件
        this.sliderThumb.addEventListener("mousedown", (e) => {
            this.beforeCheck();
            this.isDragging = true;
            this.offsetX = e.clientX - this.sliderThumb.getBoundingClientRect().left;
        });

        // 鼠标释放事件
        document.addEventListener("mouseup", (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                this.updateConfigValue();
            }
        });

        // 鼠标移动事件
        document.addEventListener("mousemove", (e) => {
            if (this.isDragging) {
                const newLeft = this.calculateNewLeft(e.clientX);
                if (newLeft >= 0 && newLeft <= this.maxLeft) {
                    const snappedLeft = this.snapToStep(newLeft);
                    this.sliderThumb.style.left = snappedLeft + "px";
                    this.fillElement.style.width = `${snappedLeft + this.sliderThumb.offsetWidth / 2}px`;
                }
                const sliderValue = this.calculateSliderValue();
                this.sliderThumb.setAttribute("data-slider-value", sliderValue);

                if(this.sliderThumb.innerText != sliderValue){
                    this.sliderThumb.innerText = sliderValue;
                    this.callbackMode == 'update'&&this.updateConfigValue();
                }

            }
        });
    }

    calculateNewLeft(clientX) {
        const newLeft = Math.min(Math.max(0, clientX - this.sliderContainer.getBoundingClientRect().left - this.offsetX), this.maxLeft);
        return newLeft;
    }

    snapToStep(position) {
        const sliderWidth = this.sliderContainer.offsetWidth;
        const thumbWidth = this.sliderThumb.offsetWidth;
        const stepCount = (this.maxValue - this.minValue) / this.step;
        const stepWidth = (sliderWidth - thumbWidth) / stepCount;
        return Math.round(position / stepWidth) * stepWidth;
    }
    calculateSliderValue() {
        const thumbPosition = parseInt(this.sliderThumb.style.left, 10) || 0;
        const sliderWidth = this.sliderContainer.offsetWidth;
        const valueRange = this.maxValue - this.minValue;
        const valuePercent = thumbPosition / (sliderWidth - this.sliderThumb.offsetWidth);
        let sliderValue = this.minValue + valuePercent * valueRange;

        // 应用步长
        let roundedValue = Math.round(sliderValue / this.step) * this.step;

        // 保留指定小数位
        roundedValue = parseFloat(roundedValue.toFixed(this.fix));

        // 确保不超过最大值
        if (roundedValue > this.maxValue) {
            roundedValue = this.maxValue;
        }

        return roundedValue;
    }

    setSliderPositionByValue(targetValue) {
        // 应用步长
        targetValue = Math.round(targetValue / this.step) * this.step;
        
        // 添加小数位限制
        targetValue = parseFloat(targetValue.toFixed(this.fix));

        // 确保不超过最大值
        if (targetValue > this.maxValue) {
            targetValue = this.maxValue;
        }

        const valueRange = this.maxValue - this.minValue;
        const valuePercent = (targetValue - this.minValue) / valueRange;
        const sliderWidth = this.sliderContainer.offsetWidth;
        const newLeft = valuePercent * (sliderWidth - this.sliderThumb.offsetWidth);
        this.sliderThumb.style.left = newLeft + "px";
        this.sliderThumb.setAttribute("data-slider-value", targetValue);
        this.sliderThumb.innerText = targetValue;
        this.fillElement.style.width = `${newLeft + this.sliderThumb.offsetWidth / 2}px`;
    }

    render() {
        const currentValue = this.settingsConfigInstance.config[this.configKey];
        this.setSliderPositionByValue(currentValue);
    }

    get maxLeft() {
        return this.sliderContainer.offsetWidth - this.sliderThumb.offsetWidth + 1;
    }
}