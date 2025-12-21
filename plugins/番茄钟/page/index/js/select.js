/**
 * Select 下拉选择器组件类
 */
class Select {
    /**
     * 构造函数
     * @param {string} selector - DOM元素的id选择器
     * @param {object} settingsConfigInstance - 设置配置实例对象
     * @param {string} configKey - 配置键名
     * @param {Array<{value: string, label: string, icon: string}>} options - 选项数组，每个选项包含value、label和icon
     * @param {string} initialValue - 初始选中值，默认为空字符串
     */
    constructor(selector, settingsConfigInstance, configKey, options, initialValue = '') {
        this.element = document.getElementById(selector);
        if (!this.element) {
            throw new Error(`Element not found for selector: ${selector}`);
        }

        this.settingsConfigInstance = settingsConfigInstance;
        this.configKey = configKey;
        this.options = options;
        this.value = this.settingsConfigInstance.config[this.configKey] ;
        this._isOpen = false;

        this.createSelect();
        this.render();
        this.bindEvents();
    }

    // isOpen 的 getter
    get isOpen() {
        return this._isOpen;
    }

    // isOpen 的 setter 
    set isOpen(value) {
        this._isOpen = value;
        if(value) {
            this.element.classList.add('open');
            console.log("select open");
            
        } else {
            this.element.classList.remove('open');
            console.log("select close");
        }
    }

    createSelect() {
        // 创建选择按钮
        this.selectButton = document.createElement('div');
        this.selectButton.classList.add('select-button');
        // 点击事件
        this.selectButton.addEventListener('click', (event) => {
            event.stopPropagation(); // 阻止事件冒泡
            this.render();
            this.isOpen = !this.isOpen;
        });
    
        // 创建下拉菜单容器
        this.dropdownContainer = document.createElement('div');
        this.dropdownContainer.classList.add('select-dropdown');
        
        // 创建选项列表
        this.optionsList = document.createElement('div');
        this.optionsList.classList.add('select-options');
    
        // 组装组件
        this.dropdownContainer.appendChild(this.optionsList);
        this.element.appendChild(this.selectButton);
        this.element.appendChild(this.dropdownContainer);
    }

    render() {

        // 渲染当前选中值到按钮
        const selectedOption = this.options.find(opt => opt.value === this.value);
        this.selectButton.innerHTML = ''; // 清空按钮内容

        // 设置按钮的data-value
        this.selectButton.dataset.value = this.value;
        
        if (selectedOption) {
            // 创建并添加图标
            const icon = document.createElement('img');
            icon.src = selectedOption.icon;
            icon.classList.add('select-icon');
            this.selectButton.appendChild(icon);
        } else {
            this.selectButton.textContent = '请选择';
        }

        // 渲染下拉选项
        this.optionsList.innerHTML = '';
        this.options.forEach(option => {
            // 跳过当前选中的选项
            if (option.value === this.value) {
                return;
            }
            
            const li = document.createElement('div');
            li.classList.add('select-option');
            
            const iconBox = document.createElement('div');
            iconBox.classList.add('select-option-icon-box');
            
            // 创建选项的图标
            const icon = document.createElement('img');
            icon.src = option.icon;
            icon.classList.add('select-option-icon');
            
            // 创建选项的文本
            const label = document.createElement('span');
            label.textContent = option.label;
            
            iconBox.appendChild(icon);
            li.appendChild(iconBox);
            li.appendChild(label);
            li.dataset.value = option.value;
            this.optionsList.appendChild(li);
        });


    }

    bindEvents() {
        // 点击选项
        this.optionsList.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            const option = e.target.closest('.select-option');
            if (option) {
                const newValue = option.dataset.value;
                this.setValue(newValue);
                this.isOpen = false;
                this.render();
            }
        });
    
        // 点击外部关闭下拉框
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.element.contains(e.target)) {
                this.isOpen = false;
                this.render();
            }
        });
    }

    setValue(value) {
        this.value = value;
        this.updateConfig();
        this.dispatchEvent();
    }

    // 更新配置
    updateConfig(value = this.value) {
        console.log("updateConfig", value);
        this.settingsConfigInstance.updateConfig(this.configKey, value);
        return this.settingsConfigInstance.config[this.configKey];
    }
    // 派发事件
    dispatchEvent() {
        const event = new CustomEvent('selectChange', {
            detail: {
                value: this.value,
                config: this.settingsConfigInstance.config,
            },
        });
        this.element.dispatchEvent(event);
    }

    // 获取当前选中值
    getValue() {
        return this.value;
    }
}
