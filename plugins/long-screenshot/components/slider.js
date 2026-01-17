class Slider {
    constructor(sliderContainerId, sliderThumbId, minValue, maxValue, fix = 1, step = 1, unit = '', settingsConfigInstance, configKey) {
        this.sliderContainer = document.getElementById(sliderContainerId);
        this.sliderThumb = document.getElementById(sliderThumbId);
        this.fillElement = document.createElement("div");
        this.fillElement.classList.add("slider-fill");
        this.sliderContainer.appendChild(this.fillElement);
        this.unit = unit;

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
                const delay = this.calculateSliderValue();
                console.log("当前滑块值：", delay);

                // 更新配置
                this.settingsConfigInstance.updateConfig(this.configKey, delay);
                this.onMouseUp();
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
                this.sliderThumb.innerText = sliderValue;
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
        const sliderValue = this.minValue + valuePercent * valueRange;

        // 应用步长
        const roundedValue = Math.round(sliderValue / this.step) * this.step;

        // 保留指定小数位，并使用 parseFloat 去除多余的 0
        return parseFloat(roundedValue.toFixed(this.fix));
    }

    setSliderPositionByValue(targetValue) {
        // 应用步长，并确保值在合法范围内
        targetValue = Math.max(this.minValue, Math.min(this.maxValue, Math.round(targetValue / this.step) * this.step));

        const valueRange = this.maxValue - this.minValue;
        const valuePercent = (targetValue - this.minValue) / valueRange;
        const sliderWidth = this.sliderContainer.offsetWidth;
        const newLeft = valuePercent * (sliderWidth - this.sliderThumb.offsetWidth);
        this.sliderThumb.style.left = newLeft + "px";

        // 使用 toFixed 和 parseFloat 来格式化显示的值
        const displayValue = parseFloat(targetValue.toFixed(this.fix));
        this.sliderThumb.setAttribute("data-slider-value", displayValue);
        this.sliderThumb.innerText = displayValue;
        this.fillElement.style.width = `${newLeft + this.sliderThumb.offsetWidth / 2}px`;
    }

    render() {
        const currentValue = this.settingsConfigInstance.config[this.configKey];
        console.log("当前配置值：", currentValue);
        this.setSliderPositionByValue(currentValue);
    }

    get maxLeft() {
        return this.sliderContainer.offsetWidth - this.sliderThumb.offsetWidth + 1;
    }
}